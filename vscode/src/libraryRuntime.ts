import * as vscode from 'vscode';
import {
    createBoundedHttpsTransport,
    createLibraryHostRuntime,
    type LibraryHostRuntime,
    type SerializableLibraryProviderConfig
} from '@json-structure/editor-foundation/library-host-runtime';
import { createPublisherStore, type PublisherState } from './libraryPublisherStore';
import { canonicalContainedFile } from './libraryRuntimePaths';

const providersKey = 'jsonStructure.library.providers';
const cacheKey = 'jsonStructure.library.cache';
const publisherKey = 'jsonStructure.library.publisher';
const secretPrefix = 'jsonStructure.library.secret.';
const maxResponseBytes = 4 * 1024 * 1024;

export function createVsCodeLibraryRuntime(context: vscode.ExtensionContext, bundledPath: vscode.Uri): Promise<LibraryHostRuntime> {
    const bundledRoot = vscode.Uri.joinPath(bundledPath, '..');
    const bundledProvider = {
        id: 'financial-types',
        kind: 'bundled',
        location: bundledRoot.toString(),
        entries: [{ id: 'financial-types', name: 'Financial Types', description: 'A bundled JSON Structure type library sample.', versions: [{ version: '1.0.0', documentUri: bundledPath.toString(), isDefault: true }] }]
    } as const;
    const publisherQueues = new Map<string, Promise<void>>();
    return createLibraryHostRuntime({
        requiredBundledProviders: [bundledProvider],
        cacheStore: {
            read: async () => context.globalState.get<string>(cacheKey),
            write: async (content) => context.globalState.update(cacheKey, content)
        },
        providerConfigStore: {
            read: async () => context.globalState.get<readonly SerializableLibraryProviderConfig[]>(providersKey, []),
            write: async (configs) => context.globalState.update(providersKey, configs)
        },
        secretStore: {
            getSecret: async (key) => context.secrets.get(`${secretPrefix}${key}`),
            setSecret: async (key, secret) => context.secrets.store(`${secretPrefix}${key}`, secret),
            deleteSecret: async (key) => context.secrets.delete(`${secretPrefix}${key}`)
        },
        isTrustedProvider: async (providerId) => providerId === bundledProvider.id || vscode.workspace.isTrusted,
        isTrustedOrigin: async (origin) => origin === 'null' || vscode.workspace.isTrusted && isHttps(origin),
        readJsonResource: (uri) => readLibraryJson(uri, bundledRoot),
        httpTransport: createBoundedHttpsTransport(fetch),
        resolvePublisherStore: async (providerId) => {
            const configs = context.globalState.get<readonly SerializableLibraryProviderConfig[]>(providersKey, []);
            if (!configs.some((config) => config.id === providerId && config.kind !== 'bundled' && config.kind !== 'xregistry')) return undefined;
            return createPublisherStore({
                read: () => context.globalState.get<PublisherState>(publisherKey, {}),
                write: (state) => context.globalState.update(publisherKey, state)
            }, providerId, publisherQueues);
        }
    });
}

async function readLibraryJson(value: string, bundledRoot: vscode.Uri): Promise<unknown> {
    if (isHttps(value)) {
        const response = await createBoundedHttpsTransport(fetch)({ method: 'GET', url: value, headers: { accept: 'application/json' } });
        if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
        return response.body;
    }
    const uri = vscode.Uri.parse(value, true);
    if (uri.scheme !== 'file') throw new Error('Library resources must use file or HTTPS URIs.');
    const roots = [bundledRoot, ...(vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri)];
    if (roots.some((root) => root.scheme !== 'file')) throw new Error('Library resource roots require canonical local file paths.');
    const canonicalUri = vscode.Uri.file(await canonicalContainedFile(uri.fsPath, roots.map((root) => root.fsPath)));
    const stat = await vscode.workspace.fs.stat(canonicalUri);
    if ((stat.type & vscode.FileType.File) === 0 || stat.size > maxResponseBytes) throw new Error('Library resource is not a bounded file.');
    const bytes = await vscode.workspace.fs.readFile(canonicalUri);
    if (bytes.byteLength > maxResponseBytes) throw new Error(`Library resource exceeds the ${maxResponseBytes}-byte limit.`);
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function isHttps(value: string): boolean {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
    catch { return false; }
}