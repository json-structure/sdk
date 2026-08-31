import * as assert from 'assert';
import * as vscode from 'vscode';
import { isWithinUriRoot, validateResourceSize, validateResourceUri } from '../../customEditor';
import { isWebviewMessage } from '../../customEditorProtocol';
import { buildOutputManifest, parseWorkerEvent, publishGeneratedFiles, type PublicationFileSystem } from '../../editorServices';
import { createPublisherStore, type PublisherState } from '../../libraryPublisherStore';

suite('JSON Structure custom editor protocol', () => {
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

    test('records conversion output byte sizes and SHA-256 hashes', () => {
        const manifest = buildOutputManifest([{ path: 'schema.json', contentBase64: Buffer.from('{}').toString('base64') }]);
        assert.deepStrictEqual(manifest, {
            algorithm: 'sha256',
            files: [{ path: 'schema.json', bytes: 2, sha256: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a' }]
        });
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
        assert.throws(() => parseWorkerEvent('{"type":"progress","operationId":"convert-1","phase":"write","completed":"3","total":4}'), /malformed/);
        assert.throws(() => parseWorkerEvent('{"type":"result","operationId":"convert-1","files":[{"path":1,"contentBase64":"e30="}],"warnings":[]}'), /malformed/);
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
