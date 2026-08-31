import { Buffer } from 'node:buffer';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import type { SafeStorage } from 'electron';
import { atomicWrite } from './file-service';
import { createBoundedHttpsTransport, createLibraryHostRuntime, type LibraryHostRuntime, type SerializableLibraryProviderConfig } from '../libraries/host-runtime';
import type { LibraryPublisherStore, PublishedLibraryEntry } from '../libraries/publishing';

const maxResponseBytes = 4 * 1024 * 1024;

export interface ElectronLibraryRuntimeOptions {
  readonly userDataPath: string;
  readonly bundledRoot: string;
  readonly documentRoot: () => string | undefined;
  readonly safeStorage: Pick<SafeStorage, 'isEncryptionAvailable' | 'encryptString' | 'decryptString'>;
  readonly bundledProvider: SerializableLibraryProviderConfig & { readonly kind: 'bundled' };
  readonly fetch?: typeof fetch;
}

export async function createElectronLibraryRuntime(options: ElectronLibraryRuntimeOptions): Promise<LibraryHostRuntime> {
  await mkdir(options.userDataPath, { recursive: true });
  const providersPath = resolve(options.userDataPath, 'library-providers.json');
  const cachePath = resolve(options.userDataPath, 'library-cache.json');
  const secretsPath = resolve(options.userDataPath, 'library-secrets.json');
  const publisherPath = resolve(options.userDataPath, 'library-publisher.json');
  const publisherQueues = new Map<string, Promise<void>>();
  const readProviders = async (): Promise<readonly SerializableLibraryProviderConfig[]> => readJsonFile(providersPath, []);
  return createLibraryHostRuntime({
    requiredBundledProviders: [options.bundledProvider],
    cacheStore: { read: () => readOptionalText(cachePath), write: (content) => atomicWrite(cachePath, content) },
    providerConfigStore: { read: readProviders, write: (configs) => atomicWrite(providersPath, JSON.stringify(configs, null, 2)) },
    secretStore: encryptedSecretStore(secretsPath, options.safeStorage),
    isTrustedProvider: async () => true,
    isTrustedOrigin: async (origin) => origin === 'null' || origin.startsWith('file:') || origin.startsWith('bundle:') || isHttps(origin) || !/^[a-z][a-z0-9+.-]*:/i.test(origin),
    readJsonResource: (uri) => readJsonResource(uri, options),
    httpTransport: createBoundedHttpsTransport(options.fetch ?? fetch),
    resolvePublisherStore: async (providerId) => {
      const configs = await readProviders();
      return configs.some((config) => config.id === providerId && config.kind !== 'bundled' && config.kind !== 'xregistry')
        ? jsonPublisherStore(publisherPath, providerId, publisherQueues)
        : undefined;
    },
  });
}

function encryptedSecretStore(path: string, safeStorage: ElectronLibraryRuntimeOptions['safeStorage']) {
  const read = async (): Promise<Record<string, string>> => readJsonFile(path, {});
  const write = async (values: Record<string, string>): Promise<void> => atomicWrite(path, JSON.stringify(values, null, 2));
  return {
    async getSecret(key: string): Promise<string | undefined> {
      const encoded = (await read())[key];
      if (!encoded || !safeStorage.isEncryptionAvailable()) return undefined;
      return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
    },
    async setSecret(key: string, secret: string): Promise<void> {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable; the credential was not stored.');
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

async function readJsonResource(uri: string, options: ElectronLibraryRuntimeOptions): Promise<unknown> {
  if (isHttps(uri)) {
    const response = await createBoundedHttpsTransport(options.fetch ?? fetch)({ method: 'GET', url: uri, headers: { accept: 'application/json' } });
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

function jsonPublisherStore(path: string, providerId: string, queues: Map<string, Promise<void>>): LibraryPublisherStore {
  type State = Record<string, Record<string, PublishedLibraryEntry>>;
  return {
    async read(entryId) { return (await readJsonFile<State>(path, {}))[providerId]?.[entryId]; },
    async write(entry, expectedEpoch) {
      return serializeProviderWrite(queues, providerId, async () => {
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

function serializeProviderWrite<T>(queues: Map<string, Promise<void>>, providerId: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(providerId) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  const settled = result.then(() => undefined, () => undefined);
  queues.set(providerId, settled);
  void settled.finally(() => { if (queues.get(providerId) === settled) queues.delete(providerId); });
  return result;
}