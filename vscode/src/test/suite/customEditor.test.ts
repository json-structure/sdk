import * as assert from 'assert';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { isWithinUriRoot, readWorkspaceResource, renderCustomEditorHtml, validatePrimaryDocument, validateResourceSize, validateResourceUri } from '../../customEditor';
import { isSerializedMessageWithinBudget, isWebviewMessage } from '../../customEditorProtocol';
import { buildOutputManifest, effectiveWorkerLossiness, loadConversionCommandsManifest, normalizeConversionOptions, parseWorkerEvent, publishGeneratedFiles, validateGeneratedConversionFiles, validateTemporaryDirectoryForCleanup, VsCodeConversionHost, type PublicationFileSystem } from '../../editorServices';
import { createPublisherStore, type PublisherState } from '../../libraryPublisherStore';
import { createVsCodeLibraryRuntime } from '../../libraryRuntime';

suite('JSON Structure custom editor protocol', () => {
    test('loads Monaco CSS and permits packaged worker resources in the webview CSP', () => {
        const html = renderCustomEditorHtml({
            nonce: 'test-nonce',
            readinessRequestId: 'renderer-1',
            scriptUri: 'vscode-webview://extension/media/editor/editor.iife.js',
            styleUri: 'vscode-webview://extension/media/editor/editor.css',
            cspSource: 'vscode-webview://extension',
        });
        assert.ok(html.includes('<link rel="stylesheet" href="vscode-webview://extension/media/editor/editor.css">'));
        assert.ok(html.includes("worker-src vscode-webview://extension blob:"));
        assert.ok(html.includes("style-src vscode-webview://extension 'nonce-test-nonce'"));
        assert.ok(html.includes("script-src vscode-webview://extension 'nonce-test-nonce'"));
    });

    test('accepts versioned resource read requests', () => {
        assert.strictEqual(isWebviewMessage({ type: 'readResource', protocolVersion: 1, requestId: 'resource-1', uri: 'file:///workspace/types.json' }), true);
        assert.strictEqual(isWebviewMessage({ type: 'readResource', protocolVersion: 1, requestId: '', uri: 'file:///workspace/types.json' }), false);
    });
    test('accepts versioned source text edit messages', () => {
        assert.ok(isWebviewMessage({ type: 'applyTextEdits', protocolVersion: 1, request: { requestId: 'source-1', documentVersion: 4, edits: [{ range: { startOffset: 2, endOffset: 3 }, newText: 'x' }] } }));
    });

    test('accepts conversion cancellation service requests', () => {
        assert.strictEqual(isWebviewMessage({ type: 'cancelConversion', protocolVersion: 1, requestId: 'service-1', request: { protocolVersion: 1, requestId: 'convert-1' } }), true);
    });

    test('accepts renderer readiness handshake messages', () => {
        assert.strictEqual(isWebviewMessage({ type: 'rendererReady', protocolVersion: 1, requestId: 'renderer-1', phase: 'mounted' }), true);
        assert.strictEqual(isWebviewMessage({ type: 'rendererReady', protocolVersion: 1, requestId: 'renderer-1', phase: 'confirmed' }), true);
        assert.strictEqual(isWebviewMessage({ type: 'rendererReady', protocolVersion: 1, requestId: 'renderer-1', phase: 'rendered' }), true);
        assert.strictEqual(isWebviewMessage({ type: 'rendererReady', protocolVersion: 1, requestId: 'renderer-1', phase: 'failed' }), false);
    });

    test('loads packaged converter options and validates non-default values', async () => {
        const extensionUri = vscode.Uri.file(path.resolve(__dirname, '../../..'));
        const manifest = await loadConversionCommandsManifest(extensionUri);
        assert.deepStrictEqual(manifest.converters.map((converter) => [converter.id, converter.options.map((option) => option.name)]), [
            ['jsonschema', ['rootName', 'preserveUnknownKeywords']],
            ['avro', ['rootName', 'preserveLogicalType', 'mode', 'uses', 'additional_properties', 'emit_doc']],
            ['protobuf', ['uses', 'additional_properties', 'emit_comments', 'numbers']],
            ['structurize-cli', ['dialect', 'namespace', 'root_class_name', 'type_name', 'base_id', 'sample_size', 'choice_depth', 'infer_choices', 'infer_enums', 'preserve_composition', 'detect_inheritance', 'detect_discriminators', 'lift_inline_schemas', 'convert_empty_objects_to_maps', 'naming', 'avro_encoding', 'kusto_uri', 'kusto_database', 'table_name', 'emit_cloudevents', 'emit_xregistry', 'message_type', 'proto_root', 'connection_string', 'username', 'password', 'database', 'infer_json', 'infer_xml', 'emit_cloudevents_columns', 'record_type']]
        ]);
        const request = {
            protocolVersion: 1 as const,
            requestId: 'convert-options',
            kind: 'conversion' as const,
            documentVersion: 1,
            commandId: 'import.jsonschema.to-json-structure',
            sourceName: 'schema.json',
            sourceText: '{}',
            options: { rootName: 'Invoice', preserveUnknownKeywords: true }
        };
        assert.deepStrictEqual(normalizeConversionOptions(manifest, request), { rootName: 'Invoice', preserveUnknownKeywords: true });
        assert.deepStrictEqual(normalizeConversionOptions(manifest, { ...request, options: {} }), { rootName: 'Root', preserveUnknownKeywords: false });
        assert.throws(() => normalizeConversionOptions(manifest, { ...request, options: { unsupported: true } }), /Unknown option/);
        const avroExport = { ...request, commandId: 'export.json-structure.to-avro', sourceName: 'schema.struct.json', options: { mode: 'full', uses: ['Audit'], additional_properties: 'error', emit_doc: false } };
        assert.deepStrictEqual(normalizeConversionOptions(manifest, avroExport), avroExport.options);
        assert.throws(() => normalizeConversionOptions(manifest, { ...avroExport, options: { rootName: 'Ignored' } }), /Unknown option/);
    });

    test('accepts supported generic library requests and rejects malformed operations', () => {
        assert.strictEqual(isWebviewMessage({ type: 'libraryRequest', protocolVersion: 1, requestId: 'service-1', request: { operation: 'listCatalog' } }), true);
        assert.strictEqual(isWebviewMessage({ type: 'libraryRequest', protocolVersion: 1, requestId: 'service-1', request: { operation: 'resolve', payload: { providerId: 'core', entryId: 'types', selector: { kind: 'pinned', version: '1' }, offline: false } } }), true);
        assert.strictEqual(isWebviewMessage({ type: 'libraryRequest', protocolVersion: 1, requestId: 'service-1', request: { operation: 'deleteProvider' } }), false);
        assert.strictEqual(isWebviewMessage({ type: 'libraryRequest', protocolVersion: 1, requestId: 'service-1', request: { operation: 'publish', payload: { document: () => undefined } } }), false);
        assert.strictEqual(isWebviewMessage({ type: 'libraryRequest', protocolVersion: 1, requestId: 'service-1', request: { operation: 'listCatalog', extra: true } }), false);
    });

    test('accepts offset-based command edit messages', () => {
        assert.ok(isWebviewMessage({ type: 'applyTextEdits', protocolVersion: 1, documentVersion: 4, request: { requestId: 'edit-1', documentVersion: 4, edits: [{ range: { startOffset: 0, endOffset: 2 }, newText: '{}' }] } }));
    });

    test('rejects aggregate edit and library payload amplification', () => {
        const chunks = Array.from({ length: 1_000 }, () => 'x'.repeat(5 * 1024));
        const edits = chunks.map((newText, startOffset) => ({ range: { startOffset, endOffset: startOffset }, newText }));
        assert.strictEqual(isWebviewMessage({ type: 'applyTextEdits', protocolVersion: 1, request: { requestId: 'amplified-edits', documentVersion: 1, edits } }), false);
        assert.strictEqual(isWebviewMessage({ type: 'libraryRequest', protocolVersion: 1, requestId: 'amplified-library', request: { operation: 'publish', payload: { chunks } } }), false);

        const nestedMembers = Array.from({ length: 1_000 }, () => Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`member${index}`, index])));
        assert.strictEqual(isWebviewMessage({ type: 'libraryRequest', protocolVersion: 1, requestId: 'amplified-members', request: { operation: 'publish', payload: { nestedMembers } } }), false);
        assert.strictEqual(isSerializedMessageWithinBudget({ type: 'serviceResult', result: Array.from({ length: 1_000 }, () => 'x'.repeat(6 * 1024)) }), false);
        assert.strictEqual(isSerializedMessageWithinBudget({ type: 'serviceResult', result: Array.from({ length: 1_000 }, () => '\u0000'.repeat(900)) }), false);

        const memberHeavyEdits = Array.from({ length: 1_000 }, (_, startOffset) => ({
            range: { startOffset, endOffset: startOffset },
            newText: '',
            metadata: Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`member${index}`, index]))
        }));
        assert.strictEqual(isWebviewMessage({ type: 'applyTextEdits', protocolVersion: 1, request: { requestId: 'amplified-edit-members', documentVersion: 1, edits: memberHeavyEdits } }), false);

        let deeplyNestedMetadata: Record<string, unknown> = {};
        for (let depth = 0; depth < 20; depth += 1) deeplyNestedMetadata = { child: deeplyNestedMetadata };
        assert.strictEqual(isWebviewMessage({ type: 'applyTextEdits', protocolVersion: 1, request: { requestId: 'deep-edit', documentVersion: 1, edits: [{ range: { startOffset: 0, endOffset: 0 }, newText: '', metadata: deeplyNestedMetadata }] } }), false);
    });

    test('rejects malformed or incompatible messages', () => {
        assert.strictEqual(isWebviewMessage({ type: 'replaceDocument', protocolVersion: 1, documentVersion: 1, text: '{}' }), false);
        assert.strictEqual(isWebviewMessage({ type: 'replaceDocument', protocolVersion: 2, documentVersion: 1, text: '{}' }), false);
        assert.strictEqual(isWebviewMessage({ type: 'applyTextEdits', protocolVersion: 1, documentVersion: 1, request: { requestId: '', documentVersion: 1, edits: [{ range: { startOffset: '0', endOffset: 1 }, newText: '{}' }] } }), false);
        assert.strictEqual(isWebviewMessage({ type: 'applyTextEdits', protocolVersion: 1, request: { requestId: 'edit-1', documentVersion: '2', edits: [] } }), false);
        assert.strictEqual(isWebviewMessage({ type: 'applyTextEdits', protocolVersion: 1, request: { requestId: 'edit-1', documentVersion: 1, edits: [{ range: { startOffset: -1, endOffset: 1 }, newText: '{}' }] } }), false);
        assert.strictEqual(isWebviewMessage({ type: 'applyTextEdits', protocolVersion: 1, request: { requestId: 'edit-1', documentVersion: 1, edits: [{ range: { startOffset: 2, endOffset: 1 }, newText: '{}' }] } }), false);
        assert.strictEqual(isWebviewMessage({ type: 'applyTextEdits', protocolVersion: 1, request: { requestId: 'edit-1', documentVersion: 1, edits: [{ range: { startOffset: 0, endOffset: 2 }, newText: '{}' }, { range: { startOffset: 1, endOffset: 3 }, newText: '{}' }] } }), false);
        assert.strictEqual(isWebviewMessage({ type: 'applyTextEdits', protocolVersion: 1, request: { requestId: 'edit-1', documentVersion: 1, edits: [{ range: { startOffset: 0, endOffset: 0 }, newText: 'x'.repeat(4 * 1024 * 1024 + 1) }] } }), false);
    });

    test('requires trust and rejects unsupported or remote schemes', () => {
        const document = vscode.Uri.parse('file:///workspace/project/main.struct.json');
        const root = vscode.Uri.parse('file:///workspace/project');
        assert.throws(() => validateResourceUri(document, vscode.Uri.parse('file:///workspace/project/types.json'), [root], false), /trusted workspace/);
        assert.throws(() => validateResourceUri(document, vscode.Uri.parse('https://example.test/types.json'), [root], true), /HTTP and HTTPS/);
        assert.throws(() => validateResourceUri(document, vscode.Uri.parse('data:text/plain,{}'), [root], true), /Unsupported/);
        assert.throws(() => validateResourceUri(document, vscode.Uri.parse('vscode-remote://ssh-remote+host/workspace/types.json'), [vscode.Uri.parse('vscode-remote://ssh-remote+host/workspace')], true), /canonical containment/);
    });

    test('allows only workspace or open-document resource roots', () => {
        const document = vscode.Uri.parse('file:///documents/current/main.struct.json');
        const workspaceRoot = vscode.Uri.parse('file:///workspace/project');
        assert.doesNotThrow(() => validateResourceUri(document, vscode.Uri.parse('file:///workspace/project/types.json'), [workspaceRoot], true));
        assert.doesNotThrow(() => validateResourceUri(document, vscode.Uri.parse('file:///documents/current/types.json'), [], true));
        assert.throws(() => validateResourceUri(document, vscode.Uri.parse('file:///documents/outside/types.json'), [], true), /must remain inside/);
    });

    test('resource containment respects path boundaries and remote authorities', () => {
        const root = vscode.Uri.parse('file:///workspace/project');
        assert.strictEqual(isWithinUriRoot(vscode.Uri.parse('file:///workspace/project/types.json'), root), true);
        assert.strictEqual(isWithinUriRoot(vscode.Uri.parse('file:///workspace/project-other/types.json'), root), false);
        assert.strictEqual(isWithinUriRoot(vscode.Uri.parse('https://example.test/workspace/project/types.json'), root), false);
        assert.strictEqual(isWithinUriRoot(vscode.Uri.parse('vscode-remote://ssh-remote+host/workspace/types.json'), vscode.Uri.parse('vscode-remote://ssh-remote+other/workspace')), false);
    });

    test('rejects imported resources larger than four MiB', () => {
        assert.doesNotThrow(() => validateResourceSize(4 * 1024 * 1024));
        assert.throws(() => validateResourceSize(4 * 1024 * 1024 + 1), /exceeds/);
    });

    test('rejects oversized or structurally excessive primary documents before mounting', () => {
        assert.doesNotThrow(() => validatePrimaryDocument('{}'));
        assert.throws(() => validatePrimaryDocument('x'.repeat(4 * 1024 * 1024 + 1)), /Primary document.*byte limit/);
        assert.throws(() => validatePrimaryDocument(`${'['.repeat(129)}${']'.repeat(129)}`), /128-level nesting limit/);
        assert.throws(() => validatePrimaryDocument(`[${'0,'.repeat(100_001)}0]`), /100000-node structural limit/);
    });

    test('requires trust before consulting library resource readers', async () => {
        let readerCalled = false;
        await assert.rejects(readWorkspaceResource(
            vscode.Uri.parse('file:///workspace/main.struct.json'),
            vscode.Uri.parse('memory://published/team/types.json'),
            async () => { readerCalled = true; return { uri: 'memory://published/team/types.json', document: {} }; },
            false
        ), /trusted workspace/);
        assert.strictEqual(readerCalled, false);
    });

    test('stats and reads the canonical target of a contained symlink', async () => {
        const root = await fs.mkdtemp(path.join(tmpdir(), 'json-structure-vscode-symlink-'));
        const targetDirectory = path.join(root, 'target');
        const linkDirectory = path.join(root, 'linked');
        await fs.mkdir(targetDirectory);
        const target = path.join(targetDirectory, 'types.json');
        await fs.writeFile(target, '{"canonical":true}', 'utf8');
        await fs.symlink(targetDirectory, linkDirectory, process.platform === 'win32' ? 'junction' : 'dir');
        const canonicalTarget = await fs.realpath(target);
        const observed: string[] = [];
        const fileSystem = {
            stat: async (uri: vscode.Uri) => { observed.push(uri.fsPath); return vscode.workspace.fs.stat(uri); },
            readFile: async (uri: vscode.Uri) => { observed.push(uri.fsPath); return vscode.workspace.fs.readFile(uri); }
        };

        assert.strictEqual(await readWorkspaceResource(
            vscode.Uri.file(path.join(root, 'main.struct.json')),
            vscode.Uri.file(path.join(linkDirectory, 'types.json')),
            undefined,
            true,
            fileSystem
        ), '{"canonical":true}');
        const comparablePath = (value: string) => process.platform === 'win32' ? path.normalize(value).toLowerCase() : path.normalize(value);
        assert.deepStrictEqual(observed.map(comparablePath), [comparablePath(canonicalTarget), comparablePath(canonicalTarget)]);
    });

    test('loads exact library import URIs without weakening fallback scheme checks', async () => {
        const document = vscode.Uri.parse('file:///workspace/project/main.struct.json');
        const libraryUri = vscode.Uri.parse('memory://published/team/.published/team/common/1.json');
        const readLibraryResource = async (uri: string) => uri === libraryUri.toString()
            ? { uri, document: { name: 'Published', type: 'string' } }
            : undefined;

        assert.strictEqual(await readWorkspaceResource(document, libraryUri, readLibraryResource), '{"name":"Published","type":"string"}');
        await assert.rejects(readWorkspaceResource(document, vscode.Uri.parse('memory://published/team/unlisted.json'), readLibraryResource), /Unsupported imported resource scheme/);
        await assert.rejects(readWorkspaceResource(document, vscode.Uri.parse('https://example.test/types.json'), readLibraryResource), /HTTP and HTTPS imports/);
    });

    test('loads immutable published and cached xRegistry URIs through the VS Code runtime', async () => {
        const values = new Map<string, unknown>();
        const secrets = new Map<string, string>();
        const context = {
            globalState: {
                get: <T>(key: string, fallback?: T): T | undefined => values.has(key) ? values.get(key) as T : fallback,
                update: async (key: string, value: unknown): Promise<void> => { values.set(key, value); }
            },
            secrets: {
                get: async (key: string): Promise<string | undefined> => secrets.get(key),
                store: async (key: string, value: string): Promise<void> => { secrets.set(key, value); },
                delete: async (key: string): Promise<void> => { secrets.delete(key); }
            }
        } as unknown as vscode.ExtensionContext;
        const originalFetch = globalThis.fetch;
        let online = true;
        let requestCount = 0;
        globalThis.fetch = async (input) => {
            requestCount += 1;
            if (!online) throw new Error('network disabled');
            const url = String(input);
            const body = url.endsWith('/model')
                ? { links: [{ href: 'https://registry.test/groups/schemas' }] }
                : url.endsWith('/')
                    ? { links: [] }
                    : url.includes('inline=versions')
                        ? { resources: [{ id: 'remote', defaultVersionId: '1', versions: [{ id: '1' }] }] }
                        : { document: { name: 'Remote', type: 'string' } };
            return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
        };
        try {
            const bundledPath = vscode.Uri.file(path.resolve(__dirname, '../../../media/libraries/financial-types.struct.json'));
            const runtime = await createVsCodeLibraryRuntime(context, bundledPath, () => true, async () => ['93.184.216.34']);
            await runtime.configureProvider({ id: 'local', kind: 'local', location: 'memory://published/local/', entries: [], trusted: true });
            const source = {
                $schema: 'https://json-structure.org/meta/core/v0/#',
                $id: 'urn:test:published',
                name: 'Published',
                type: 'string'
            };
            const published = await runtime.publish({ providerId: 'local', entryId: 'common', version: '1', document: source, sourceUri: 'file:///outside/source.struct.json' });
            source.type = 'number';
            const publishedUri = published.versions['1'].uri;
            assert.strictEqual(await readWorkspaceResource(vscode.Uri.parse('file:///workspace/main.struct.json'), vscode.Uri.parse(publishedUri), (uri) => runtime.readResource(uri)), JSON.stringify({
                $schema: 'https://json-structure.org/meta/core/v0/#',
                $id: 'urn:test:published',
                name: 'Published',
                type: 'string'
            }));

            await runtime.configureProvider({ id: 'registry', kind: 'xregistry', baseUrl: 'https://registry.test', trusted: true });
            const remote = await runtime.resolve({ providerId: 'registry', entryId: 'remote', selector: { kind: 'pinned', version: '1' }, offline: false });
            online = false;
            const requestsBeforeRead = requestCount;
            assert.strictEqual(await readWorkspaceResource(vscode.Uri.parse('file:///workspace/main.struct.json'), vscode.Uri.parse(remote.documentUri), (uri) => runtime.readResource(uri)), '{"name":"Remote","type":"string"}');
            assert.strictEqual(requestCount, requestsBeforeRead);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('rejects library hostnames resolving to private addresses before fetch', async () => {
        const values = new Map<string, unknown>();
        const secretAccesses: string[] = [];
        const context = {
            globalState: {
                get: <T>(key: string, fallback?: T): T | undefined => values.has(key) ? values.get(key) as T : fallback,
                update: async (key: string, value: unknown): Promise<void> => { values.set(key, value); }
            },
            secrets: {
                get: async (key: string): Promise<string | undefined> => { secretAccesses.push(`get:${key}`); return undefined; },
                store: async (key: string): Promise<void> => { secretAccesses.push(`store:${key}`); },
                delete: async (key: string): Promise<void> => { secretAccesses.push(`delete:${key}`); }
            }
        } as unknown as vscode.ExtensionContext;
        const bundledPath = vscode.Uri.file(path.resolve(__dirname, '../../../media/libraries/financial-types.struct.json'));
        const originalFetch = globalThis.fetch;
        let fetchCount = 0;
        globalThis.fetch = async () => { fetchCount += 1; throw new Error('must not fetch'); };
        try {
            const runtime = await createVsCodeLibraryRuntime(context, bundledPath, () => true, async () => ['127.0.0.1']);
            await assert.rejects(runtime.configureProvider({ id: 'registry', kind: 'xregistry', baseUrl: 'https://registry.test', credentialId: 'token', trusted: true }, 'must-not-store'), /private or local network/);
            assert.strictEqual(fetchCount, 0);
            assert.deepStrictEqual(secretAccesses, []);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('requires a trusted workspace before mutable library operations and non-bundled reads', async () => {
        const persistedProvider = {
            id: 'local', kind: 'local' as const, location: 'file:///workspace/libraries/', trusted: true,
            entries: [{ id: 'common', versions: [{ version: '1', documentUri: 'file:///workspace/libraries/common.json', isDefault: true }] }]
        };
        const values = new Map<string, unknown>([['jsonStructure.library.providers', [persistedProvider]]]);
        const globalWrites: string[] = [];
        const secretAccesses: string[] = [];
        const context = {
            globalState: {
                get: <T>(key: string, fallback?: T): T | undefined => values.has(key) ? values.get(key) as T : fallback,
                update: async (key: string, value: unknown): Promise<void> => { globalWrites.push(key); values.set(key, value); }
            },
            secrets: {
                get: async (key: string): Promise<string | undefined> => { secretAccesses.push(`get:${key}`); return undefined; },
                store: async (key: string): Promise<void> => { secretAccesses.push(`store:${key}`); },
                delete: async (key: string): Promise<void> => { secretAccesses.push(`delete:${key}`); }
            }
        } as unknown as vscode.ExtensionContext;
        const bundledPath = vscode.Uri.file(path.resolve(__dirname, '../../../media/libraries/financial-types.struct.json'));
        const originalFetch = globalThis.fetch;
        let fetchCount = 0;
        globalThis.fetch = async () => { fetchCount += 1; throw new Error('must not fetch'); };
        try {
            const runtime = await createVsCodeLibraryRuntime(context, bundledPath, () => false);
            const document = {
                $schema: 'https://json-structure.org/meta/core/v0/#',
                $id: 'urn:test:blocked',
                name: 'Blocked',
                definitions: {}
            };

            await assert.rejects(runtime.configureProvider({ id: 'remote', kind: 'xregistry', baseUrl: 'https://registry.test', trusted: true }), /not authorized by the host/);
            await assert.rejects(runtime.removeProvider('local'), /not authorized by the host/);
            await assert.rejects(runtime.resolve({ providerId: 'local', entryId: 'common', selector: { kind: 'pinned', version: '1' }, offline: false }), /not authorized by the host/);
            await assert.rejects(runtime.publish({ providerId: 'local', entryId: 'common', version: '2', document, sourceUri: 'file:///workspace/blocked.struct.json' }), /not authorized by the host/);
            await assert.rejects(runtime.readResource('file:///workspace/libraries/common.json'), /not authorized by the host/);

            assert.deepStrictEqual(globalWrites, []);
            assert.deepStrictEqual(secretAccesses, []);
            assert.strictEqual(fetchCount, 0);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('records conversion output byte sizes and SHA-256 hashes', () => {
        const manifest = buildOutputManifest([
            { path: 'z.json', contentBase64: Buffer.from('z').toString('base64') },
            { path: 'schema.json', contentBase64: Buffer.from('{}').toString('base64') }
        ]);
        assert.deepStrictEqual(manifest, {
            algorithm: 'sha256',
            files: [
                { path: 'schema.json', bytes: 2, sha256: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a' },
                { path: 'z.json', bytes: 1, sha256: '594e519ae499312b29433b7dd8a97ff068defcba9755b6d5d00e84c524d67b06' }
            ]
        });
    });

    test('derives review lossiness from the strongest worker warning', () => {
        assert.strictEqual(effectiveWorkerLossiness({
            lossiness: 'none',
            warnings: [{ code: 'precision', message: 'Representation changed.', lossiness: 'precision' }]
        }), 'precision');
    });

    test('copies the packaged conversion runtime with descriptor and byte parity', async () => {
        const root = path.resolve(__dirname, '../../../..');
        const source = path.join(root, 'editor', 'src', 'conversion', 'worker-runtime');
        const copied = path.join(root, 'vscode', 'media', 'conversion', 'worker-runtime');
        const sourceDescriptor = JSON.parse((await vscode.workspace.fs.readFile(vscode.Uri.file(path.join(source, 'runtime-descriptor.json')))).toString());
        const copiedDescriptor = JSON.parse((await vscode.workspace.fs.readFile(vscode.Uri.file(path.join(copied, 'runtime-descriptor.json')))).toString());
        assert.deepStrictEqual(copiedDescriptor, sourceDescriptor);
        for (const entry of sourceDescriptor.files as readonly { path: string; sha256: string }[]) {
            const relativePath = entry.path.replace(/^worker-runtime[\\/]/, '');
            const sourceBytes = await vscode.workspace.fs.readFile(vscode.Uri.file(path.join(source, relativePath)));
            const copiedBytes = await vscode.workspace.fs.readFile(vscode.Uri.file(path.join(copied, relativePath)));
            assert.deepStrictEqual(copiedBytes, sourceBytes);
            assert.strictEqual(require('crypto').createHash('sha256').update(sourceBytes).digest('hex'), entry.sha256);
        }
    });

    test('validates generated conversion identity before publication', () => {
        const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64');
        assert.doesNotThrow(() => validateGeneratedConversionFiles('json-structure', [{
            path: 'Root.struct.json',
            contentBase64: encode({ $schema: 'https://json-structure.org/meta/core/v0/#', $id: 'urn:test:root', name: 'Root', $root: '#/definitions/Root', definitions: { Root: { type: 'string' } } })
        }]));
        assert.throws(() => validateGeneratedConversionFiles('json-structure', [{ path: 'Root.struct.json', contentBase64: encode({ $schema: 'https://json-structure.org/meta/core/v0' }) }]), /non-canonical schema/);
        assert.throws(() => validateGeneratedConversionFiles('json-structure', [{ path: 'Root.struct.json', contentBase64: encode({ $schema: 'https://json-structure.org/meta/core/v0/#', $id: 'relative', name: 'Root', $root: '#/definitions/Root', definitions: { Root: { type: 'string' } } }) }]), /absolute \$id/);
        assert.throws(() => validateGeneratedConversionFiles('json-structure', [{ path: 'Root.struct.json', contentBase64: encode({ $schema: 'https://json-structure.org/meta/core/v0/#', $id: 'urn:test:root', name: 'not valid', $root: '#/definitions/Missing', definitions: {} }) }]), /valid name/);
        assert.throws(() => validateGeneratedConversionFiles('json-structure', [{ path: 'Root.struct.json', contentBase64: encode({ $schema: 'https://json-structure.org/meta/core/v0/#', $id: 'urn:test:root', name: 'Root', $root: '#/definitions/Root', definitions: { Root: { type: { $ref: '#/definitions/Missing' } } } }) }]), /unresolved reference/);
        assert.throws(() => validateGeneratedConversionFiles('json-schema', [{ path: 'schema.json', contentBase64: encode({ $schema: 'draft-07' }) }]), /unsupported dialect/);
        assert.throws(() => validateGeneratedConversionFiles('avro', [{ path: 'schema.avsc', contentBase64: encode({ name: 'Root' }) }]), /no root type/);
        assert.doesNotThrow(() => validateGeneratedConversionFiles('avro', [{ path: 'string.avsc', contentBase64: encode('string') }]));
        assert.doesNotThrow(() => validateGeneratedConversionFiles('avro', [{ path: 'union.avsc', contentBase64: encode(['null', 'string']) }]));
        assert.doesNotThrow(() => validateGeneratedConversionFiles('json-structure', [{ path: 'Validated.struct.json', contentBase64: encode({
            $schema: 'https://json-structure.org/meta/validation/v0/#', $id: 'urn:test:validated', name: 'Validated', $root: '#/definitions/Validated',
            definitions: { Validated: { type: 'string', minLength: 1 } }
        }) }]));
        assert.doesNotThrow(() => validateGeneratedConversionFiles('json-structure', [{ path: 'Composed.struct.json', contentBase64: encode({
            $schema: 'https://json-structure.org/meta/extended/v0/#', $uses: ['JSONStructureConditionalComposition'], $id: 'urn:test:composed', name: 'Composed', $root: '#/definitions/Composed',
            definitions: { Composed: { type: 'string', oneOf: [{ type: 'string' }, { type: 'boolean' }] } }
        }) }]));
        assert.throws(() => validateGeneratedConversionFiles('json-structure', [{ path: 'Empty.struct.json', contentBase64: encode({
            $schema: 'https://json-structure.org/meta/core/v0/#', $id: 'urn:test:empty', name: 'Empty', $root: '#/definitions/Empty', definitions: { Empty: { type: 'object', properties: {} } }
        }) }]), /canonical validation/);
    });

    test('cancels a VS Code conversion while destination selection is pending', async () => {
        let releaseDestination: ((value: vscode.Uri) => void) | undefined;
        const pendingDestination = new Promise<vscode.Uri>((resolve) => { releaseDestination = resolve; });
        const extensionUri = vscode.Uri.file(path.resolve(__dirname, '../../..'));
        const host = new VsCodeConversionHost(extensionUri, { selectDestination: () => pendingDestination });
        const conversion = host.convert({
            protocolVersion: 1,
            requestId: 'cancel-picker',
            kind: 'conversion',
            documentVersion: 1,
            commandId: 'import.jsonschema.to-json-structure',
            sourceName: 'schema.json',
            sourceText: '{"type":"string"}',
            options: {}
        });
        host.cancel('cancel-picker');
        releaseDestination?.(vscode.Uri.file(path.join(__dirname, 'unused-output')));
        const result = await conversion;
        assert.strictEqual(result.succeeded, false);
        assert.deepStrictEqual(result.outputs, []);
        assert.ok(result.diagnostics.some((diagnostic) => (diagnostic as { code?: string }).code === 'conversion.cancelled'));
    });

    test('normalizes cancellation while a VS Code worker is deferred', async () => {
        const root = await fs.mkdtemp(path.join(tmpdir(), 'json-structure-vscode-cancel-worker-'));
        const extensionRoot = path.join(root, 'extension');
        const runtimeRoot = path.join(extensionRoot, 'media', 'conversion', 'worker-runtime');
        const destination = vscode.Uri.file(path.join(root, 'output'));
        try {
            await fs.mkdir(runtimeRoot, { recursive: true });
            await fs.copyFile(path.resolve(__dirname, '../../../../editor/tests/fixtures/conversion-quota-worker.cjs'), path.join(runtimeRoot, 'converter-worker.cjs'));
            await fs.writeFile(path.join(runtimeRoot, 'commands-manifest.json'), JSON.stringify({
                schemaVersion: 1,
                converters: [{ id: 'fixture', displayName: 'Fixture', version: '1', sourceFormats: ['json-structure'], targetFormats: ['json-schema'], options: [] }],
                commands: [{ id: 'export.fixture', converterId: 'fixture', direction: 'export', label: 'Export fixture', sourceFormat: 'json-structure', targetFormat: 'json-schema', optionNames: [], defaultAutoOpen: false }]
            }));
            const host = new VsCodeConversionHost(vscode.Uri.file(extensionRoot), { selectDestination: async () => destination });
            const conversion = host.convert({ protocolVersion: 1, requestId: 'renderer-deferred-cancel', kind: 'conversion', documentVersion: 1, commandId: 'export.fixture', sourceName: 'hang.struct.json', sourceText: '{}', options: {} });
            await new Promise(resolve => setTimeout(resolve, 100));
            host.cancel('renderer-deferred-cancel');
            const result = await conversion;
            assert.strictEqual(result.succeeded, false);
            assert.deepStrictEqual(result.outputs, []);
            assert.ok(result.diagnostics.some((diagnostic) => (diagnostic as { code?: string }).code === 'conversion.cancelled'));
            await assert.rejects(fs.stat(path.join(destination.fsPath, 'evidence.schema.json')));
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('normalizes publication cancellation after rolling back staged outputs', async () => {
        const root = await fs.mkdtemp(path.join(tmpdir(), 'json-structure-vscode-cancel-publish-'));
        const extensionRoot = path.join(root, 'extension');
        const runtimeRoot = path.join(extensionRoot, 'media', 'conversion', 'worker-runtime');
        const destination = vscode.Uri.file(path.join(root, 'output'));
        let host: VsCodeConversionHost | undefined;
        try {
            await fs.mkdir(runtimeRoot, { recursive: true });
            await fs.copyFile(path.resolve(__dirname, '../../../../editor/tests/fixtures/conversion-quota-worker.cjs'), path.join(runtimeRoot, 'converter-worker.cjs'));
            await fs.writeFile(path.join(runtimeRoot, 'commands-manifest.json'), JSON.stringify({
                schemaVersion: 1,
                converters: [{ id: 'fixture', displayName: 'Fixture', version: '1', sourceFormats: ['json-structure'], targetFormats: ['json-schema'], options: [] }],
                commands: [{ id: 'export.fixture', converterId: 'fixture', direction: 'export', label: 'Export fixture', sourceFormat: 'json-structure', targetFormat: 'json-schema', optionNames: [], defaultAutoOpen: false }]
            }));
            const cancellingFileSystem: PublicationFileSystem = {
                stat: (uri) => vscode.workspace.fs.stat(uri),
                createDirectory: async (uri) => {
                    await vscode.workspace.fs.createDirectory(uri);
                    if (uri.fsPath.includes('.rollback-')) host?.cancel('renderer-publication-cancel');
                },
                writeFile: (uri, content) => vscode.workspace.fs.writeFile(uri, content),
                copy: (source, target, options) => vscode.workspace.fs.copy(source, target, options),
                rename: async (source, target, options) => {
                    await vscode.workspace.fs.rename(source, target, options);
                },
                delete: (uri, options) => vscode.workspace.fs.delete(uri, options)
            };
            host = new VsCodeConversionHost(vscode.Uri.file(extensionRoot), { selectDestination: async () => destination, publicationFileSystem: cancellingFileSystem });
            const result = await host.convert({ protocolVersion: 1, requestId: 'renderer-publication-cancel', kind: 'conversion', documentVersion: 1, commandId: 'export.fixture', sourceName: 'cancel.struct.json', sourceText: '{}', options: {} });
            assert.strictEqual(result.succeeded, false);
            assert.deepStrictEqual(result.outputs, []);
            assert.ok(result.diagnostics.some((diagnostic) => (diagnostic as { code?: string }).code === 'conversion.cancelled'));
            await assert.rejects(fs.stat(path.join(destination.fsPath, 'evidence.schema.json')));
            await assert.rejects(fs.stat(path.join(destination.fsPath, 'conversion-output-manifest.json')));
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('uses host UUID operation IDs and a bounded heap for VS Code workers', async () => {
        const root = await fs.mkdtemp(path.join(tmpdir(), 'json-structure-vscode-worker-'));
        const extensionRoot = path.join(root, 'extension');
        const runtimeRoot = path.join(extensionRoot, 'media', 'conversion', 'worker-runtime');
        const destination = vscode.Uri.file(path.join(root, 'output'));
        try {
            await fs.mkdir(runtimeRoot, { recursive: true });
            await fs.copyFile(path.resolve(__dirname, '../../../../editor/tests/fixtures/conversion-quota-worker.cjs'), path.join(runtimeRoot, 'converter-worker.cjs'));
            await fs.writeFile(path.join(runtimeRoot, 'commands-manifest.json'), JSON.stringify({
                schemaVersion: 1,
                converters: [{ id: 'fixture', displayName: 'Fixture', version: '1', sourceFormats: ['json-structure'], targetFormats: ['json-schema'], options: [] }],
                commands: [{ id: 'export.fixture', converterId: 'fixture', direction: 'export', label: 'Export fixture', sourceFormat: 'json-structure', targetFormat: 'json-schema', optionNames: [], defaultAutoOpen: false }]
            }));
            const host = new VsCodeConversionHost(vscode.Uri.file(extensionRoot), { selectDestination: async () => destination });
            const rendererRequestId = 'renderer-request-must-not-reach-worker';
            const result = await host.convert({
                protocolVersion: 1,
                requestId: rendererRequestId,
                kind: 'conversion',
                documentVersion: 1,
                commandId: 'export.fixture',
                sourceName: 'evidence.struct.json',
                sourceText: '{}',
                options: {}
            });
            assert.strictEqual(result.succeeded, true);
            const evidence = JSON.parse(await fs.readFile(path.join(destination.fsPath, 'evidence.schema.json'), 'utf8')) as { operationId: string; execArgv: string[] };
            assert.notStrictEqual(evidence.operationId, rendererRequestId);
            assert.match(evidence.operationId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
            assert.ok(evidence.execArgv.includes('--max-old-space-size=128'));

            const baseLimits = { maxExecutionMs: 5_000, maxOldSpaceMb: 32, maxStdoutBytes: 64 * 1024, maxStderrBytes: 1024, maxLineBytes: 64 * 1024, maxFiles: 4, maxWarnings: 4, maxFileBytes: 64 * 1024, maxAggregateFileBytes: 64 * 1024 };
            const hanging = new VsCodeConversionHost(vscode.Uri.file(extensionRoot), { selectDestination: async () => vscode.Uri.file(path.join(root, 'hang-output')), workerLimits: { ...baseLimits, maxExecutionMs: 25 } });
            await assert.rejects(hanging.convert({ protocolVersion: 1, requestId: 'renderer-hang', kind: 'conversion', documentVersion: 1, commandId: 'export.fixture', sourceName: 'hang.struct.json', sourceText: '{}', options: {} }), /execution quota/);
            await assert.rejects(fs.stat(path.join(root, 'hang-output', 'evidence.schema.json')), /ENOENT/);

            const flooding = new VsCodeConversionHost(vscode.Uri.file(extensionRoot), { selectDestination: async () => vscode.Uri.file(path.join(root, 'stdout-output')), workerLimits: { ...baseLimits, maxStdoutBytes: 128, maxLineBytes: 128 } });
            await assert.rejects(flooding.convert({ protocolVersion: 1, requestId: 'renderer-stdout', kind: 'conversion', documentVersion: 1, commandId: 'export.fixture', sourceName: 'stdout.struct.json', sourceText: '{}', options: {} }), /stdout|line/);
            await assert.rejects(fs.stat(path.join(root, 'stdout-output', 'evidence.schema.json')), /ENOENT/);
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('serializes concurrent publisher CAS writes for one provider', async () => {
        let state: PublisherState = {};
        const store = createPublisherStore({ read: () => state, write: async (next) => { await Promise.resolve(); state = next; } }, 'local', new Map());
        const entry = (version: string) => ({ id: 'common', epoch: '1', versions: { [version]: { entryId: 'common', version, uri: 'memory:source', value: {} } } });
        const results = await Promise.all([store.write(entry('1'), undefined), store.write(entry('2'), undefined)]);

        assert.deepStrictEqual(results.sort(), [false, true]);
        assert.strictEqual(Object.keys(state.local.common.versions).length, 1);
    });

    test('validates converter progress and result events', () => {
        assert.deepStrictEqual(parseWorkerEvent('{"type":"progress","operationId":"convert-1","phase":"write","completed":3,"total":4,"message":"Writing"}'), {
            type: 'progress', operationId: 'convert-1', phase: 'write', completed: 3, total: 4, message: 'Writing'
        });
        assert.deepStrictEqual(parseWorkerEvent('{"type":"result","operationId":"convert-1","lossiness":"metadata","files":[{"path":"schema.json","contentBase64":"e30="}],"warnings":[{"code":"metadata","message":"Approximated","lossiness":"metadata","targetPath":"/value","details":{"keyword":"x-source"}}]}'), {
            type: 'result', operationId: 'convert-1', lossiness: 'metadata', files: [{ path: 'schema.json', contentBase64: 'e30=' }], warnings: [{ code: 'metadata', message: 'Approximated', lossiness: 'metadata', targetPath: '/value', details: { keyword: 'x-source' } }]
        });
        assert.throws(() => parseWorkerEvent('{"type":"progress","operationId":"convert-1","phase":"write","completed":"3","total":4}'), /malformed/);
        assert.throws(() => parseWorkerEvent('{"type":"result","operationId":"convert-1","lossiness":"none","files":[{"path":1,"contentBase64":"e30="}],"warnings":[]}'), /malformed/);
        assert.throws(() => parseWorkerEvent('{"type":"result","operationId":"convert-1","files":[],"warnings":[]}'), /malformed/);
        const tiny = { maxExecutionMs: 1000, maxOldSpaceMb: 16, maxStdoutBytes: 64, maxStderrBytes: 64, maxLineBytes: 64, maxFiles: 1, maxWarnings: 1, maxFileBytes: 2, maxAggregateFileBytes: 3 };
        assert.throws(() => parseWorkerEvent('{"type":"result","operationId":"x","lossiness":"none","files":[{"path":"a","contentBase64":"YQ=="},{"path":"b","contentBase64":"Yg=="}],"warnings":[]}', tiny), /file quota/);
        assert.throws(() => parseWorkerEvent('{"type":"result","operationId":"x","lossiness":"none","files":[],"warnings":[{"code":"a","message":"a","lossiness":"metadata"},{"code":"b","message":"b","lossiness":"metadata"}]}', tiny), /warning quota/);
        assert.throws(() => parseWorkerEvent('{"type":"result","operationId":"x","lossiness":"none","files":[{"path":"a","contentBase64":"YWJj"}],"warnings":[]}', tiny), /per-file/);
        assert.throws(() => parseWorkerEvent('{"type":"result","operationId":"x","lossiness":"none","files":[{"path":"a","contentBase64":"YWI="},{"path":"b","contentBase64":"YWI="}],"warnings":[]}', { ...tiny, maxFiles: 2 }), /aggregate/);
    });

    test('validates canonical temporary parents before recursive cleanup', () => {
        const parent = vscode.Uri.file(path.join(tmpdir(), 'conversion-cleanup'));
        const destination = vscode.Uri.joinPath(parent, 'selected');
        assert.strictEqual(validateTemporaryDirectoryForCleanup(vscode.Uri.joinPath(parent, 'selected.staging-1234'), destination).fsPath, vscode.Uri.joinPath(parent, 'selected.staging-1234').fsPath);
        assert.throws(() => validateTemporaryDirectoryForCleanup(vscode.Uri.joinPath(parent, 'unrelated'), destination), /unrecognized/);
        assert.throws(() => validateTemporaryDirectoryForCleanup(vscode.Uri.file(path.join(tmpdir(), 'outside', 'selected.staging-1234')), destination), /canonical conversion parent/);
    });

    test('publishes generated files without deleting unrelated destination contents', async () => {
        const root = vscode.Uri.joinPath(vscode.Uri.file(__dirname), `conversion-${Date.now()}`);
        const destination = vscode.Uri.joinPath(root, 'selected');
        try {
            await vscode.workspace.fs.createDirectory(destination);
            await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(destination, 'unrelated.txt'), Buffer.from('keep'));
            await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(destination, 'schema.json'), Buffer.from('old'));
            await publishGeneratedFiles(vscode.workspace.fs, destination, [{ path: 'schema.json', contentBase64: Buffer.from('new').toString('base64') }], new AbortController().signal);
            assert.strictEqual(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(destination, 'unrelated.txt'))).toString(), 'keep');
            assert.strictEqual(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(destination, 'schema.json'))).toString(), 'new');
            await vscode.workspace.fs.stat(vscode.Uri.joinPath(destination, 'conversion-output-manifest.json'));
        } finally {
            await vscode.workspace.fs.delete(root, { recursive: true, useTrash: false });
        }
    });

    test('rolls back VS Code publication failures', async () => {
        const root = vscode.Uri.joinPath(vscode.Uri.file(__dirname), `conversion-rollback-${Date.now()}`);
        const destination = vscode.Uri.joinPath(root, 'selected');
        let publishedMoves = 0;
        const failingFileSystem: PublicationFileSystem = {
            stat: (uri) => vscode.workspace.fs.stat(uri),
            createDirectory: (uri) => vscode.workspace.fs.createDirectory(uri),
            writeFile: (uri, content) => vscode.workspace.fs.writeFile(uri, content),
            copy: (source, target, options) => vscode.workspace.fs.copy(source, target, options),
            rename: async (source, target, options) => {
                if (source.fsPath.includes('.staging-') && ++publishedMoves === 2) throw new Error('injected publication failure');
                await vscode.workspace.fs.rename(source, target, options);
            },
            delete: (uri, options) => vscode.workspace.fs.delete(uri, options)
        };
        try {
            await vscode.workspace.fs.createDirectory(destination);
            await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(destination, 'a.json'), Buffer.from('old'));
            await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(destination, 'unrelated.txt'), Buffer.from('keep'));
            await assert.rejects(publishGeneratedFiles(failingFileSystem, destination, [
                { path: 'a.json', contentBase64: Buffer.from('new').toString('base64') },
                { path: 'b.json', contentBase64: Buffer.from('new').toString('base64') }
            ], new AbortController().signal), /injected publication failure/);
            assert.strictEqual(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(destination, 'a.json'))).toString(), 'old');
            assert.strictEqual(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(destination, 'unrelated.txt'))).toString(), 'keep');
            await assert.rejects(Promise.resolve(vscode.workspace.fs.stat(vscode.Uri.joinPath(destination, 'b.json'))));
        } finally {
            await vscode.workspace.fs.delete(root, { recursive: true, useTrash: false });
        }
    });

    test('rolls back VS Code publication cancellation', async () => {
        const root = vscode.Uri.joinPath(vscode.Uri.file(__dirname), `conversion-cancel-${Date.now()}`);
        const destination = vscode.Uri.joinPath(root, 'selected');
        const controller = new AbortController();
        const cancellingFileSystem: PublicationFileSystem = {
            stat: (uri) => vscode.workspace.fs.stat(uri),
            createDirectory: (uri) => vscode.workspace.fs.createDirectory(uri),
            writeFile: (uri, content) => vscode.workspace.fs.writeFile(uri, content),
            copy: (source, target, options) => vscode.workspace.fs.copy(source, target, options),
            rename: async (source, target, options) => {
                await vscode.workspace.fs.rename(source, target, options);
                if (source.fsPath.includes('.staging-')) controller.abort();
            },
            delete: (uri, options) => vscode.workspace.fs.delete(uri, options)
        };
        try {
            await vscode.workspace.fs.createDirectory(destination);
            await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(destination, 'a.json'), Buffer.from('old'));
            await assert.rejects(publishGeneratedFiles(cancellingFileSystem, destination, [
                { path: 'a.json', contentBase64: Buffer.from('new').toString('base64') },
                { path: 'b.json', contentBase64: Buffer.from('new').toString('base64') }
            ], controller.signal), (error: Error) => error.name === 'AbortError');
            assert.strictEqual(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(destination, 'a.json'))).toString(), 'old');
            await assert.rejects(Promise.resolve(vscode.workspace.fs.stat(vscode.Uri.joinPath(destination, 'b.json'))));
        } finally {
            await vscode.workspace.fs.delete(root, { recursive: true, useTrash: false });
        }
    });
});
