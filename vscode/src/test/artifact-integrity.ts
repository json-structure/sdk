import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Script } from 'node:vm';
import * as path from 'node:path';

const repositoryRoot = path.resolve(__dirname, '../../..');
const editorRoot = path.join(repositoryRoot, 'editor');
const extensionManifestPath = path.join(repositoryRoot, 'vscode', 'package.json');
const rendererBundlePath = path.resolve(__dirname, '../../media/editor/editor.iife.js');
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

function assertRendererParity(checkedIn: Uint8Array | undefined, generated: Uint8Array): void {
    if (!checkedIn) { throw new Error('The checked-in VS Code renderer bundle is missing.'); }
    const checkedInBytes = Buffer.from(checkedIn);
    const generatedBytes = Buffer.from(generated);
    if (checkedInBytes.equals(generatedBytes)) { return; }
    throw new Error(`The checked-in VS Code renderer bundle is stale; source build sha256=${sha256(generatedBytes)}, checked-in sha256=${sha256(checkedInBytes)}.`);
}

function assertRendererShape(bundle: string): void {
    if (Buffer.byteLength(bundle, 'utf8') < 1024) { throw new Error('The generated VS Code renderer bundle is missing or unexpectedly small.'); }
    if (!bundle.includes(rendererReadyMarker)) { throw new Error('The generated VS Code renderer bundle is missing its readiness marker.'); }
    if (!bundle.includes('startVsCodeWebview') || !bundle.includes('acquireVsCodeApi')) { throw new Error('The generated VS Code renderer bundle does not contain the VS Code webview entry point.'); }
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

function findGeneratedRendererBytes(buildOutput: unknown, bundleFileName: string): Buffer {
    const outputs = Array.isArray(buildOutput) ? buildOutput : [buildOutput];
    for (const output of outputs) {
        if (!isRecord(output) || !Array.isArray(output.output)) { continue; }
        for (const asset of output.output) {
            if (isRecord(asset) && asset.type === 'chunk' && asset.fileName === bundleFileName && typeof asset.code === 'string') {
                return Buffer.from(asset.code, 'utf8');
            }
        }
    }
    throw new Error(`The source renderer build did not produce ${bundleFileName}.`);
}

async function buildRendererInMemory(): Promise<Buffer> {
    const rendererBuild: {
        readonly buildVscodeRenderer: (options: { write: boolean; emptyOutDir: boolean }) => Promise<unknown>;
        readonly rendererBundleFileName: string;
    } = requireFromEditor(rendererBuildModulePath);
    const buildOutput = await rendererBuild.buildVscodeRenderer({ write: false, emptyOutDir: false });
    return findGeneratedRendererBytes(buildOutput, rendererBuild.rendererBundleFileName);
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
    await assertExpectedFailure('missing asset', () => assertRendererParity(undefined, generated));
    await assertExpectedFailure('stale asset', () => assertRendererParity(Buffer.from('stale renderer bytes'), generated));
    await assertExpectedFailure('throwing asset', () => executeRendererReadiness(`${checkedInBundle}\nthrow new Error('artifact integrity throwing-asset probe');`));
}

/** Verifies source parity and executes the checked-in VS Code renderer before any rebuild can overwrite it. */
export async function assertRendererArtifactIntegrity(): Promise<void> {
    await assertDefaultCustomEditor();
    const checkedInBytes = await readFile(rendererBundlePath);
    const generatedBytes = await buildRendererInMemory();
    const checkedInBundle = checkedInBytes.toString('utf8');
    await assertFailureScenarios(generatedBytes, checkedInBundle);
    assertRendererParity(checkedInBytes, generatedBytes);
    assertRendererShape(checkedInBundle);
    await executeRendererReadiness(checkedInBundle);
}
