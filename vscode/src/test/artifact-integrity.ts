import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Script } from 'node:vm';
import * as path from 'node:path';

const repositoryRoot = path.resolve(__dirname, '../../..');
const editorRoot = path.join(repositoryRoot, 'editor');
const extensionManifestPath = path.join(repositoryRoot, 'vscode', 'package.json');
const rendererBundlePath = path.resolve(__dirname, '../../media/editor/editor.iife.js');
const rendererStylePath = path.resolve(__dirname, '../../media/editor/editor.css');
const rendererOutputRoot = path.resolve(__dirname, '../../media/editor');
const rendererBuildModulePath = path.join(editorRoot, 'scripts/vscode-renderer-build.mjs');
const rendererReadyMarker = 'json-structure-vscode-renderer-ready-v1';
const requireFromEditor = createRequire(path.join(editorRoot, 'package.json'));
const builtInCatalogProviderIds = [
    'bundled.json-structure-units',
    'bundled.ucum',
    'bundled.iso-4217',
    'bundled.qudt-quantity-kinds',
    'bundled.cf-standard-names',
    'bundled.sosa',
    'bundled.schema-org',
    'bundled.dublin-core-terms',
    'bundled.skos-prov-o',
    'bundled.semantic-annotations',
] as const;

interface VsCodeApi {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
}

interface DomElement {
    innerHTML: string;
    getAttribute(name: string): string | null;
}

interface DomDocument {
    readonly head: DomElement;
    readonly body: DomElement;
    readonly documentElement: DomElement;
    querySelector(selector: string): DomElement | null;
}

interface DomWindow {
    readonly document: DomDocument;
    readonly MessageEvent: new (type: string, init?: { data?: unknown }) => unknown;
    acquireVsCodeApi: () => VsCodeApi;
    eval(source: string): unknown;
    dispatchEvent(event: unknown): boolean;
    close(): void;
}

interface HappyDomModule {
    readonly Window: new (options: { url: string }) => DomWindow;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object';
}

function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

function assertRendererParity(label: string, checkedIn: Uint8Array | undefined, generated: Uint8Array): void {
    if (!checkedIn) { throw new Error(`The checked-in VS Code renderer asset is missing: ${label}.`); }
    const checkedInBytes = Buffer.from(checkedIn);
    const generatedBytes = Buffer.from(generated);
    if (checkedInBytes.equals(generatedBytes)) { return; }
    throw new Error(`The checked-in VS Code renderer asset is stale: ${label}; source build sha256=${sha256(generatedBytes)}, checked-in sha256=${sha256(checkedInBytes)}.`);
}

function assertRendererShape(bundle: string): void {
    if (Buffer.byteLength(bundle, 'utf8') < 1024) { throw new Error('The generated VS Code renderer bundle is missing or unexpectedly small.'); }
    if (!bundle.includes(rendererReadyMarker)) { throw new Error('The generated VS Code renderer bundle is missing its readiness marker.'); }
    if (!bundle.includes('startVsCodeWebview') || !bundle.includes('acquireVsCodeApi')) { throw new Error('The generated VS Code renderer bundle does not contain the VS Code webview entry point.'); }
    if (!bundle.includes('data-composition-editor') || !bundle.includes('Exactly one')) { throw new Error('The generated VS Code renderer bundle does not contain inline Rules authoring.'); }
    for (const providerId of builtInCatalogProviderIds) {
        if (!bundle.includes(providerId)) { throw new Error(`The generated VS Code renderer bundle is missing offline catalog provider ${providerId}.`); }
    }
    new Script(bundle, { filename: rendererBundlePath });
}

async function assertDefaultCustomEditor(): Promise<void> {
    const manifest = JSON.parse(await readFile(extensionManifestPath, 'utf8')) as {
        contributes?: {
            customEditors?: Array<{
                viewType?: string;
                priority?: string;
                selector?: Array<{ filenamePattern?: string }>;
            }>;
        };
    };
    const editor = manifest.contributes?.customEditors?.find((candidate) => candidate.viewType === 'jsonStructure.editor');
    if (editor?.priority !== 'default') {
        throw new Error('The JSON Structure custom editor must be the default editor for *.struct.json files.');
    }
    if (!editor.selector?.some((selector) => selector.filenamePattern === '*.struct.json')) {
        throw new Error('The default JSON Structure custom editor is missing its *.struct.json selector.');
    }
}

function generatedRendererAssets(buildOutput: unknown): ReadonlyMap<string, Buffer> {
    const assets = new Map<string, Buffer>();
    const outputs = Array.isArray(buildOutput) ? buildOutput : [buildOutput];
    for (const output of outputs) {
        if (!isRecord(output) || !Array.isArray(output.output)) { continue; }
        for (const asset of output.output) {
            if (!isRecord(asset) || typeof asset.fileName !== 'string') { continue; }
            if (asset.type === 'chunk' && typeof asset.code === 'string') {
                assets.set(asset.fileName, Buffer.from(asset.code, 'utf8'));
            } else if (asset.type === 'asset' && (typeof asset.source === 'string' || asset.source instanceof Uint8Array)) {
                assets.set(asset.fileName, Buffer.from(asset.source));
            }
        }
    }
    return assets;
}

async function buildRendererInMemory(): Promise<ReadonlyMap<string, Buffer>> {
    const rendererBuild: {
        readonly buildVscodeRenderer: (options: { write: boolean; emptyOutDir: boolean }) => Promise<unknown>;
        readonly rendererBundleFileName: string;
    } = requireFromEditor(rendererBuildModulePath);
    const buildOutput = await rendererBuild.buildVscodeRenderer({ write: false, emptyOutDir: false });
    const assets = generatedRendererAssets(buildOutput);
    if (!assets.has(rendererBuild.rendererBundleFileName)) {
        throw new Error(`The source renderer build did not produce ${rendererBuild.rendererBundleFileName}.`);
    }
    return assets;
}

async function checkedInRendererFiles(directory = rendererOutputRoot, prefix = ''): Promise<readonly string[]> {
    const files: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relativePath = path.posix.join(prefix, entry.name);
        if (entry.isDirectory()) {
            files.push(...await checkedInRendererFiles(path.join(directory, entry.name), relativePath));
        } else if (entry.isFile()) {
            files.push(relativePath);
        }
    }
    return files.sort();
}

function hasReadinessMessage(messages: readonly unknown[], phase: string, requestId: string): boolean {
    return messages.some((message) => isRecord(message)
        && message.type === 'rendererReady'
        && message.phase === phase
        && message.requestId === requestId);
}

async function executeRendererReadiness(bundle: string): Promise<void> {
    const happyDom: HappyDomModule = requireFromEditor('happy-dom');
    const window = new happyDom.Window({ url: 'vscode-webview://artifact-integrity' });
    const requestId = 'artifact-integrity-readiness';
    const messages: unknown[] = [];
    window.document.head.innerHTML = `<meta name="json-structure-renderer-readiness" content="${requestId}"><meta name="json-structure-style-nonce" content="artifact-test-nonce">`;
    window.document.body.innerHTML = '<div id="editor"></div>';
    window.acquireVsCodeApi = () => ({
        postMessage: (message: unknown) => messages.push(message),
        getState: () => undefined,
        setState: () => undefined,
    });
    try {
        window.eval(bundle);
        if (window.document.documentElement.getAttribute('data-json-structure-renderer') !== rendererReadyMarker) {
            throw new Error('The VS Code renderer did not set its readiness marker in the DOM.');
        }
        const mounted = messages.find((message) => isRecord(message)
            && message.type === 'rendererReady'
            && message.phase === 'mounted'
            && message.requestId === requestId);
        if (!isRecord(mounted) || typeof mounted.protocolVersion !== 'number') {
            throw new Error('The VS Code renderer did not complete its mounted readiness handshake.');
        }
        window.dispatchEvent(new window.MessageEvent('message', {
            data: {
                type: 'rendererReadyAck',
                protocolVersion: mounted.protocolVersion,
                requestId,
            },
        }));
        if (!hasReadinessMessage(messages, 'confirmed', requestId)) {
            throw new Error('The VS Code renderer did not complete its confirmed readiness handshake.');
        }
        window.dispatchEvent(new window.MessageEvent('message', {
            data: {
                type: 'init',
                protocolVersion: mounted.protocolVersion,
                uri: 'file:///artifact-integrity/schema.struct.json',
                title: 'schema.struct.json',
                text: '{"$schema":"https://json-structure.org/meta/validation/v0/#","name":"ArtifactIntegrity","type":"string","allOf":[{"type":"string"}]}',
                documentVersion: 1,
            },
        }));
        if (!window.document.querySelector('.js-shell')) {
            throw new Error('The VS Code renderer completed its handshake without rendering the editor workbench.');
        }
        if (!window.document.querySelector('[data-composition-editor]')) {
            throw new Error('The VS Code renderer did not render Rules in the Design surface.');
        }
        if (!hasReadinessMessage(messages, 'rendered', requestId)) {
            throw new Error('The VS Code renderer did not report a rendered workbench.');
        }
    } finally {
        window.close();
    }
}

async function assertExpectedFailure(label: string, operation: () => void | Promise<void>): Promise<void> {
    try {
        await operation();
    } catch {
        return;
    }
    throw new Error(`Artifact integrity scenario did not fail as expected: ${label}.`);
}

async function assertFailureScenarios(generated: Uint8Array, checkedInBundle: string): Promise<void> {
    await assertExpectedFailure('missing asset', () => assertRendererParity(rendererBundlePath, undefined, generated));
    await assertExpectedFailure('stale asset', () => assertRendererParity(rendererBundlePath, Buffer.from('stale renderer bytes'), generated));
    await assertExpectedFailure('throwing asset', () => executeRendererReadiness(`${checkedInBundle}\nthrow new Error('artifact integrity throwing-asset probe');`));
}

/** Verifies source parity and executes the checked-in VS Code renderer before any rebuild can overwrite it. */
export async function assertRendererArtifactIntegrity(): Promise<void> {
    await assertDefaultCustomEditor();
    const checkedInBytes = await readFile(rendererBundlePath);
    const checkedInStyle = await readFile(rendererStylePath, 'utf8');
    const generatedAssets = await buildRendererInMemory();
    const generatedBytes = generatedAssets.get('editor.iife.js');
    if (!generatedBytes) { throw new Error('The generated VS Code renderer bundle is missing.'); }
    const checkedInBundle = checkedInBytes.toString('utf8');
    await assertFailureScenarios(generatedBytes, checkedInBundle);
    const generatedFiles = [...generatedAssets.keys()].sort();
    const checkedInFiles = await checkedInRendererFiles();
    if (JSON.stringify(checkedInFiles) !== JSON.stringify(generatedFiles)) {
        throw new Error(`The checked-in VS Code renderer asset set differs from the source build; generated=${generatedFiles.join(', ')}, checked-in=${checkedInFiles.join(', ')}.`);
    }
    for (const [relativePath, generated] of generatedAssets) {
        assertRendererParity(relativePath, await readFile(path.join(rendererOutputRoot, ...relativePath.split('/'))), generated);
    }
    if (!checkedInStyle.includes('.monaco-editor') || !checkedInStyle.includes('.monaco-editor .inputarea')) {
        throw new Error('The checked-in VS Code renderer stylesheet does not contain Monaco editor layout rules.');
    }
    if (checkedInBundle.includes('"/assets/') || checkedInBundle.includes("'/assets/")) {
        throw new Error('The checked-in VS Code renderer contains root-relative worker asset URLs.');
    }
    assertRendererShape(checkedInBundle);
    await executeRendererReadiness(checkedInBundle);
}
