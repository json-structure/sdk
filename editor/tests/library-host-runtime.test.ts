import { describe, expect, it } from 'vitest';
import { createBoundedHttpsTransport, createLibraryHostRuntime, type LibraryHostRuntimeOptions, type SerializableLibraryProviderConfig } from '../src/libraries/host-runtime.js';
import { EpochConflictError, MemoryLibraryPublisherStore } from '../src/libraries/publishing.js';

const bundled = {
  id: 'core',
  kind: 'bundled',
  location: 'bundle:///core/',
  entries: [{ id: 'core-types', versions: [{ version: '1', documentUri: 'bundle:///core/1.json', isDefault: true }] }],
} as const;

const local = {
  id: 'workspace',
  kind: 'local',
  location: 'file:///workspace/library/',
  entries: [{ id: 'common', versions: [
    { version: '1', documentUri: 'file:///workspace/library/common-1.json', isDefault: false },
    { version: '2', documentUri: 'file:///workspace/library/common-2.json', isDefault: true },
  ] }],
} as const;

function host(initial: readonly SerializableLibraryProviderConfig[] = []) {
  let providerJson = JSON.stringify(initial);
  let cacheJson = '';
  const secrets = new Map<string, string>();
  const publisher = new MemoryLibraryPublisherStore();
  const requests: { url: string; secret?: string }[] = [];
  const options: LibraryHostRuntimeOptions = {
    requiredBundledProviders: [bundled],
    cacheStore: {
      read: async () => cacheJson,
      write: async (content) => { cacheJson = content; },
    },
    providerConfigStore: {
      read: async () => JSON.parse(providerJson) as SerializableLibraryProviderConfig[],
      write: async (configs) => { providerJson = JSON.stringify(configs); },
    },
    secretStore: {
      getSecret: async (key) => secrets.get(key),
      setSecret: async (key, secret) => { secrets.set(key, secret); },
      deleteSecret: async (key) => { secrets.delete(key); },
    },
    isTrustedProvider: async () => true,
    isTrustedOrigin: async () => true,
    readJsonResource: async (uri) => ({ uri }),
    httpTransport: async (request, credential) => {
      requests.push({ url: request.url, ...(credential ? { secret: credential.secret } : {}) });
      if (request.url.endsWith('/model')) return { status: 200, body: { links: [{ href: 'https://registry.test/groups/schemas' }] } };
      if (request.url.endsWith('/')) return { status: 200, body: { links: [] } };
      if (request.url.includes('inline=versions')) return { status: 200, body: { resources: [{ id: 'remote', defaultVersionId: '1', versions: [{ id: '1', documentUri: 'https://registry.test/remote/1' }] }] } };
      return { status: 200, body: { document: { remote: true }, epoch: '4' } };
    },
    resolvePublisherStore: async () => publisher,
  };
  return { options, secrets, requests, publisher, providerJson: () => providerJson, cacheJson: () => cacheJson };
}

describe('library host runtime', () => {
  it('loads persisted configs with required bundled providers and reloads them', async () => {
    const state = host([local]);
    const first = await createLibraryHostRuntime(state.options);
    expect((await first.listProviders()).map((provider) => provider.id)).toEqual(['core', 'workspace']);
    expect((await first.listCatalog()).map((entry) => `${entry.providerId}:${entry.id}`)).toEqual(['core:core-types', 'workspace:common']);

    await first.configureProvider({
      id: 'static', kind: 'static', location: 'https://static.test/catalog/',
      entries: [{ id: 'shared', versions: [{ version: '1', documentUri: 'https://static.test/catalog/shared.json', isDefault: true }] }],
      trusted: true,
    });
    const reloaded = await createLibraryHostRuntime(state.options);
    expect((await reloaded.listProviders()).map((provider) => provider.id)).toEqual(['core', 'static', 'workspace']);
    expect(state.providerJson()).not.toContain('core-types');
    await expect(reloaded.removeProvider('core')).rejects.toThrow('cannot be removed');
    await expect(reloaded.configureProvider({ ...bundled, location: 'bundle:///replacement/' })).rejects.toThrow('cannot be replaced');
  });

  it('discovers trusted HTTPS xRegistry providers with credentials kept out-of-band', async () => {
    const state = host();
    const runtime = await createLibraryHostRuntime(state.options);
    const summary = await runtime.configureProvider({
      id: 'registry', kind: 'xregistry', baseUrl: 'https://registry.test', credentialId: 'registry-token', credentialScheme: 'Bearer', trusted: true,
    }, 'do-not-leak');
    expect(summary).toEqual({ id: 'registry', kind: 'xregistry', location: 'https://registry.test', trusted: true, credentialConfigured: true, publishSupported: true });
    expect(state.secrets.get('registry-token')).toBe('do-not-leak');
    expect(state.providerJson()).not.toContain('do-not-leak');
    expect(JSON.stringify(await runtime.listProviders())).not.toContain('do-not-leak');
    expect(state.requests.some((request) => request.secret === 'do-not-leak')).toBe(true);
    await expect(runtime.configureProvider({ id: 'bad', kind: 'xregistry', baseUrl: 'http://registry.test' }, 'do-not-leak'))
      .rejects.toThrow('HTTPS');
    const untrustedOptions: LibraryHostRuntimeOptions = {
      ...state.options,
      isTrustedProvider: async (providerId) => providerId !== 'untrusted',
    };
    const untrusted = await createLibraryHostRuntime(untrustedOptions);
    await expect(untrusted.configureProvider({
      id: 'untrusted', kind: 'xregistry', baseUrl: 'https://registry.test', credentialId: 'untrusted-token', trusted: true,
    }, 'do-not-leak')).rejects.toThrow("xRegistry provider 'untrusted'");
    expect(state.secrets.has('untrusted-token')).toBe(false);
    expect(JSON.stringify(await runtime.listProviders())).not.toContain('do-not-leak');
  });

  it('returns online and offline pinned/floating labels with trust and provenance', async () => {
    const state = host([local]);
    const runtime = await createLibraryHostRuntime(state.options);
    const onlineOne = await runtime.resolve({ providerId: 'workspace', entryId: 'common', selector: { kind: 'pinned', version: '1' }, offline: false });
    expect(onlineOne).toMatchObject({
      document: { uri: 'file:///workspace/library/common-1.json' },
      resolution: { label: 'online-verified', state: { verification: 'verified' } },
      trust: { trusted: true },
      provenance: { providerId: 'workspace', entryId: 'common', version: '1' },
    });
    await runtime.resolve({ providerId: 'workspace', entryId: 'common', selector: { kind: 'pinned', version: '2' }, offline: false });
    expect(await runtime.resolve({ providerId: 'workspace', entryId: 'common', selector: { kind: 'pinned', version: '1' }, offline: true }))
      .toMatchObject({ resolution: { label: 'pinned-reproducible', state: { connectivity: 'offline', verification: 'reproducible' } } });
    expect(await runtime.resolve({ providerId: 'workspace', entryId: 'common', selector: { kind: 'floating' }, offline: true }))
      .toMatchObject({ resolution: { label: 'floating-offline-unverified', state: { connectivity: 'offline', verification: 'unverified' } } });
    expect(state.cacheJson()).toContain('common');
  });

  it('updates and removes non-bundled providers persistently', async () => {
    const state = host([local]);
    const runtime = await createLibraryHostRuntime(state.options);
    await runtime.configureProvider({ ...local, location: 'file:///other/', entries: [{ id: 'updated', versions: [] }] });
    expect((await runtime.listCatalog()).map((entry) => entry.id)).toEqual(['core-types', 'updated']);
    expect((await runtime.listProviders()).find((provider) => provider.id === 'workspace')?.location).toBe('file:///other/');
    await runtime.removeProvider('workspace');
    expect((await runtime.listProviders()).map((provider) => provider.id)).toEqual(['core']);
    expect(state.providerJson()).toBe('[]');
  });

  it('serializes concurrent provider configuration without losing updates', async () => {
    const state = host();
    let releaseFirstWrite!: () => void;
    const firstWriteBlocked = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    let signalFirstWrite!: () => void;
    const firstWriteEntered = new Promise<void>((resolve) => { signalFirstWrite = resolve; });
    let writeCount = 0;
    const originalWrite = state.options.providerConfigStore.write;
    state.options.providerConfigStore.write = async (configs) => {
      writeCount += 1;
      if (writeCount === 1) {
        signalFirstWrite();
        await firstWriteBlocked;
      }
      await originalWrite(configs);
    };
    const runtime = await createLibraryHostRuntime(state.options);
    const first = runtime.configureProvider({ id: 'first', kind: 'local', location: 'file:///first/', entries: [] });
    const second = runtime.configureProvider({ id: 'second', kind: 'local', location: 'file:///second/', entries: [] });

    await firstWriteEntered;
    expect(writeCount).toBe(1);
    releaseFirstWrite();
    await Promise.all([first, second]);

    expect((JSON.parse(state.providerJson()) as SerializableLibraryProviderConfig[]).map((config) => config.id)).toEqual(['first', 'second']);
  });

  it('completes failed secret rollback before the next concurrent mutation', async () => {
    const state = host();
    state.options.httpTransport = async (request) => {
      if (request.url.startsWith('https://failing.test')) throw new Error('discovery failed');
      if (request.url.endsWith('/model')) return { status: 200, body: { links: [{ href: 'https://working.test/groups/schemas' }] } };
      return { status: 200, body: { links: [] } };
    };
    const runtime = await createLibraryHostRuntime(state.options);
    const failed = runtime.configureProvider({
      id: 'failing', kind: 'xregistry', baseUrl: 'https://failing.test', credentialId: 'shared-token', trusted: true,
    }, 'first-secret');
    const succeeded = runtime.configureProvider({
      id: 'working', kind: 'xregistry', baseUrl: 'https://working.test', credentialId: 'shared-token', trusted: true,
    }, 'second-secret');

    await expect(failed).rejects.toThrow("xRegistry provider 'failing'");
    await expect(succeeded).resolves.toMatchObject({ id: 'working', credentialConfigured: true });
    expect(state.secrets.get('shared-token')).toBe('second-secret');
  });

  it('publishes through service plans with optimistic epochs and conflict rejection', async () => {
    const state = host([local]);
    const runtime = await createLibraryHostRuntime(state.options);
    const first = await runtime.publish({
      providerId: 'workspace', entryId: 'common', version: '3', document: { definitions: {} }, sourceUri: 'memory:document', promoteDefault: true,
    });
    expect(first).toMatchObject({ epoch: '1', defaultVersion: '3' });
    const second = await runtime.publish({
      providerId: 'workspace', entryId: 'common', version: '4', document: { definitions: {} }, sourceUri: 'memory:document', expectedEpoch: first.epoch,
    });
    expect(second).toMatchObject({ epoch: '2', defaultVersion: '3' });
    await expect(runtime.publish({
      providerId: 'workspace', entryId: 'common', version: '5', document: {}, sourceUri: 'memory:document', expectedEpoch: '1',
    })).rejects.toBeInstanceOf(EpochConflictError);
  });
});

describe('bounded HTTPS transport', () => {
  it('follows only exact same-origin HTTPS redirects with manual redirect handling', async () => {
    const requests: Array<{ url: string; redirect?: RequestRedirect; authorization: string | null }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, redirect: init?.redirect, authorization: new Headers(init?.headers).get('authorization') });
      if (url.endsWith('/start')) return new Response(null, { status: 302, headers: { location: '/final' } });
      return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const transport = createBoundedHttpsTransport(fetcher);

    await expect(transport({ method: 'GET', url: 'https://registry.test/start', headers: {} }, { scheme: 'Bearer', secret: 'secret' }))
      .resolves.toEqual({ status: 200, body: { ok: true } });
    expect(requests).toEqual([
      { url: 'https://registry.test/start', redirect: 'manual', authorization: 'Bearer secret' },
      { url: 'https://registry.test/final', redirect: 'manual', authorization: 'Bearer secret' },
    ]);
  });

  it('rejects cross-origin redirects before forwarding credentials', async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input));
      return new Response(null, { status: 302, headers: { location: 'https://other.test/final' } });
    };

    await expect(createBoundedHttpsTransport(fetcher)(
      { method: 'GET', url: 'https://registry.test/start', headers: {} },
      { scheme: 'Bearer', secret: 'secret' },
    )).rejects.toThrow('exact HTTPS origin');
    expect(requests).toEqual(['https://registry.test/start']);
  });

  it('rejects oversized declared and streamed bodies and aborts the stream', async () => {
    const declared = new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-length': String(4 * 1024 * 1024 + 1) },
    });
    await expect(createBoundedHttpsTransport(async () => declared)({ method: 'GET', url: 'https://registry.test/value', headers: {} }))
      .rejects.toThrow('4194304-byte limit');
    expect(declared.bodyUsed).toBe(false);

    let cancelled = false;
    const streamed = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4 * 1024 * 1024));
        controller.enqueue(new Uint8Array(1));
      },
      cancel() { cancelled = true; },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    await expect(createBoundedHttpsTransport(async () => streamed)({ method: 'GET', url: 'https://registry.test/value', headers: {} }))
      .rejects.toThrow('4194304-byte limit');
    expect(cancelled).toBe(true);
  });
});