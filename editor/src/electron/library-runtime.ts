import { Buffer } from 'node:buffer';
import { lookup } from 'node:dns/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import type { SafeStorage } from 'electron';
import { atomicWrite } from './file-service';
import {
  createBoundedHttpsTransport,
  createLibraryHostRuntime,
  requirePublicLibraryNetworkUri,
  type LibraryCredentialBindingAuthorization,
  type LibraryHostAddressResolver,
  type LibraryHostOperationAuthorization,
  type LibraryHostRuntime,
  type SerializableLibraryProviderConfig,
} from '../libraries/host-runtime';
import type { LibraryPublisherStore, PublishedLibraryEntry } from '../libraries/publishing';
import { canonicalLibraryUri, isLibraryUriWithin } from '../libraries/trust';

const maxResponseBytes = 4 * 1024 * 1024;

export interface ElectronLibraryRuntimeOptions {
  readonly userDataPath: string;
  readonly bundledRoot: string;
  readonly documentRoot: () => string | undefined;
  readonly platform?: NodeJS.Platform;
  readonly safeStorage: Pick<SafeStorage, 'isEncryptionAvailable' | 'encryptString' | 'decryptString'> & Partial<Pick<SafeStorage, 'getSelectedStorageBackend'>>;
  readonly bundledProvider: SerializableLibraryProviderConfig & { readonly kind: 'bundled' };
  readonly approve?: (request: ElectronLibraryApprovalRequest) => Promise<boolean>;
  readonly fetch?: typeof fetch;
  readonly resolveHost?: LibraryHostAddressResolver;
}

export type ElectronLibraryApprovalRequest =
  | { readonly kind: 'operation'; readonly request: LibraryHostOperationAuthorization }
  | { readonly kind: 'provider'; readonly providerId: string }
  | { readonly kind: 'origin'; readonly origin: string }
  | { readonly kind: 'uri'; readonly providerId: string; readonly uri: string }
  | { readonly kind: 'credential-binding'; readonly request: LibraryCredentialBindingAuthorization };

export async function createElectronLibraryRuntime(options: ElectronLibraryRuntimeOptions): Promise<LibraryHostRuntime> {
  await mkdir(options.userDataPath, { recursive: true });
  const providersPath = resolve(options.userDataPath, 'library-providers.json');
  const cachePath = resolve(options.userDataPath, 'library-cache.json');
  const secretsPath = resolve(options.userDataPath, 'library-secrets.json');
  const publisherPath = resolve(options.userDataPath, 'library-publisher.json');
  const publisherQueues = new Map<string, Promise<void>>();
  const readProviders = async (): Promise<readonly SerializableLibraryProviderConfig[]> => readJsonFile(providersPath, []);
  const bundledId = options.bundledProvider.id;
  const bundledLocation = canonicalLibraryUri(options.bundledProvider.location);
  const approve = async (request: ElectronLibraryApprovalRequest): Promise<boolean> => Boolean(options.approve && await options.approve(request));
  const hostOwnsUri = (providerId: string, uri: string): boolean => providerId === bundledId
    ? isLibraryUriWithin(uri, bundledLocation)
    : isHostOwnedLibraryUri(uri, providerId, options);
  const httpTransport = createBoundedHttpsTransport(options.fetch ?? fetch, options.resolveHost ?? resolveHostAddresses);
  return createLibraryHostRuntime({
    requiredBundledProviders: [options.bundledProvider],
    cacheStore: { read: () => readOptionalText(cachePath), write: (content) => atomicWrite(cachePath, content) },
    providerConfigStore: { read: readProviders, write: (configs) => atomicWrite(providersPath, JSON.stringify(configs, null, 2)) },
    secretStore: encryptedSecretStore(secretsPath, options.safeStorage, options.platform ?? process.platform),
    authorizeOperation: async (request) => !options.approve || approve({ kind: 'operation', request }),
    authorizeCredentialBinding: (request) => approve({ kind: 'credential-binding', request }),
    isTrustedProvider: async (providerId) => providerId === bundledId || !options.approve || approve({ kind: 'provider', providerId }),
    isTrustedOrigin: async (origin) => safeLibraryOrigin(origin) && (origin === 'null' || approve({ kind: 'origin', origin })),
    isTrustedUri: async (providerId, uri) => {
      if (isHttps(uri)) await requirePublicLibraryNetworkUri(uri, options.resolveHost ?? resolveHostAddresses);
      return hostOwnsUri(providerId, uri) || approve({ kind: 'uri', providerId, uri });
    },
    readJsonResource: (uri) => readJsonResource(uri, options, httpTransport),
    httpTransport,
    resolvePublisherStore: async (providerId) => jsonPublisherStore(publisherPath, providerId, publisherQueues),
  });
}

function encryptedSecretStore(path: string, safeStorage: ElectronLibraryRuntimeOptions['safeStorage'], platform: NodeJS.Platform) {
  const read = async (): Promise<Record<string, string>> => readJsonFile(path, {});
  const write = async (values: Record<string, string>): Promise<void> => atomicWrite(path, JSON.stringify(values, null, 2));
  return {
    async getSecret(key: string): Promise<string | undefined> {
      const backend = secureStorageBackend(safeStorage, platform);
      if (!backend || backend === 'basic_text') return undefined;
      const encoded = (await read())[key];
      if (!encoded) return undefined;
      try { return safeStorage.decryptString(Buffer.from(encoded, 'base64')); }
      catch { return undefined; }
    },
    async setSecret(key: string, secret: string): Promise<void> {
      const backend = secureStorageBackend(safeStorage, platform);
      if (!backend) throw new Error('OS credential encryption or its selected storage backend is unavailable; the credential was not stored.');
      if (backend === 'basic_text') throw new Error('OS credential storage selected basic_text; the credential was not stored.');
      const values = await read();
      values[key] = safeStorage.encryptString(secret).toString('base64');
      await write(values);
    },
    async deleteSecret(key: string): Promise<void> {
      const values = await read();
      if (key in values) { delete values[key]; await write(values); }
    },
  };
}

async function readJsonResource(uri: string, options: ElectronLibraryRuntimeOptions, httpTransport: ReturnType<typeof createBoundedHttpsTransport>): Promise<unknown> {
  if (isHttps(uri)) {
    const response = await httpTransport({ method: 'GET', url: uri, headers: { accept: 'application/json' } });
    if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
    return response.body;
  }
  const path = uri.startsWith('file:') ? fileURLToPath(uri) : uri;
  const roots = [options.documentRoot(), options.bundledRoot].filter((root): root is string => typeof root === 'string');
  const canonicalPath = await realpath(path);
  const canonicalRoots = await Promise.all(roots.map((root) => realpath(root)));
  if (!canonicalRoots.some((root) => isWithin(canonicalPath, root))) throw new Error('Library resources must remain under the opened document or bundled resource root.');
  const bytes = await readFile(canonicalPath);
  if (bytes.byteLength > maxResponseBytes) throw new Error(`Library resource exceeds the ${maxResponseBytes}-byte limit.`);
  return JSON.parse(bytes.toString('utf8')) as unknown;
}

const resolveHostAddresses: LibraryHostAddressResolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((result) => result.address);

function jsonPublisherStore(path: string, providerId: string, queues: Map<string, Promise<void>>): LibraryPublisherStore {
  type State = Record<string, Record<string, PublishedLibraryEntry>>;
  return {
    async read(entryId) { return (await readJsonFile<State>(path, {}))[providerId]?.[entryId]; },
    async list() { return Object.values((await readJsonFile<State>(path, {}))[providerId] ?? {}).sort((left, right) => left.id.localeCompare(right.id)); },
    async write(entry, expectedEpoch) {
      return serializePublisherWrite(queues, path, async () => {
        const state = await readJsonFile<State>(path, {});
        const current = state[providerId]?.[entry.id];
        if (current?.epoch !== expectedEpoch) return false;
        state[providerId] = { ...state[providerId], [entry.id]: entry };
        await atomicWrite(path, JSON.stringify(state, null, 2));
        return true;
      });
    },
  };
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  const text = await readOptionalText(path);
  return text === undefined || !text.trim() ? fallback : JSON.parse(text) as T;
}

function isHttps(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
}

function isWithin(path: string, root: string): boolean {
  const child = relative(resolve(root), resolve(path));
  return child === '' || !child.startsWith('..') && !isAbsolute(child);
}

function serializePublisherWrite<T>(queues: Map<string, Promise<void>>, persistenceKey: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(persistenceKey) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  const settled = result.then(() => undefined, () => undefined);
  queues.set(persistenceKey, settled);
  void settled.finally(() => { if (queues.get(persistenceKey) === settled) queues.delete(persistenceKey); });
  return result;
}

function secureStorageBackend(safeStorage: ElectronLibraryRuntimeOptions['safeStorage'], platform: NodeJS.Platform): ReturnType<SafeStorage['getSelectedStorageBackend']> | 'os_encrypted' | undefined {
  try {
    if (!safeStorage.isEncryptionAvailable()) return undefined;
    if (platform !== 'linux') return 'os_encrypted';
    if (!safeStorage.getSelectedStorageBackend) return undefined;
    return safeStorage.getSelectedStorageBackend();
  } catch {
    return undefined;
  }
}

function safeLibraryOrigin(origin: string): boolean {
  return origin === 'null' || origin.startsWith('file:') || origin.startsWith('bundle:') || isHttps(origin);
}

function isHostOwnedLibraryUri(uri: string, providerId: string, options: ElectronLibraryRuntimeOptions): boolean {
  let url: URL;
  try { url = new URL(canonicalLibraryUri(uri)); }
  catch { return false; }
  if (url.protocol === 'file:') {
    const roots = [options.userDataPath, options.documentRoot(), options.bundledRoot]
      .filter((root): root is string => typeof root === 'string')
      .map((root) => pathToFileURL(resolve(root)).href);
    return roots.some((root) => isLibraryUriWithin(url.href, root));
  }
  if (url.protocol === 'memory:') {
    const root = `memory://published/${encodeURIComponent(providerId)}/`;
    return url.hostname === 'published' && isLibraryUriWithin(url.href, root);
  }
  return false;
}