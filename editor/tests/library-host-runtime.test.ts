import { describe, expect, it, vi } from 'vitest';
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

function schemaDocument(definitions: Record<string, unknown> = {}) {
  return {
    $schema: 'https://json-structure.org/meta/core/v0/#',
    $id: 'urn:test:library-document',
    name: 'LibraryDocument',
    definitions,
  };
}

function storedSecret(secrets: ReadonlyMap<string, string>, credentialId: string): string | undefined {
  return [...secrets].find(([key]) => key.includes(`:${encodeURIComponent(credentialId)}:`))?.[1];
}

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
      if (request.url.endsWith('/model')) return { status: 200, body: { links: [{ href: `${new URL(request.url).origin}/groups/schemas` }] } };
      if (request.url.endsWith('/')) return { status: 200, body: { links: [] } };
      if (request.url.includes('inline=versions')) return { status: 200, body: { resources: [{ id: 'remote', defaultVersionId: '1', versions: [{ id: '1', documentUri: 'https://registry.test/groups/schemas/remote/versions/1' }] }] } };
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
    expect(summary).toEqual({ id: 'registry', kind: 'xregistry', location: 'https://registry.test', trusted: true, credentialConfigured: true, publishSupported: false });
    expect(storedSecret(state.secrets, 'registry-token')).toBe('do-not-leak');
    expect(state.secrets.has('registry-token')).toBe(false);
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
    }, 'do-not-leak')).rejects.toThrow("Library provider 'untrusted' is not authorized");
    expect(state.secrets.has('untrusted-token')).toBe(false);
    expect(JSON.stringify(await runtime.listProviders())).not.toContain('do-not-leak');
  });

  it('rejects credential handle reuse and rebinding before secret or network access', async () => {
    const state = host();
    const secretReads = vi.spyOn(state.options.secretStore, 'getSecret');
    const runtime = await createLibraryHostRuntime(state.options);
    await runtime.configureProvider({
      id: 'first', kind: 'xregistry', baseUrl: 'https://registry.test', credentialId: 'shared-token', credentialScheme: 'Bearer', trusted: true,
    }, 'first-secret');
    const requestsBeforeAttack = state.requests.length;
    const secretReadsBeforeAttack = secretReads.mock.calls.length;

    await expect(runtime.configureProvider({
      id: 'second', kind: 'xregistry', baseUrl: 'https://registry.test', credentialId: 'shared-token', credentialScheme: 'Bearer', trusted: true,
    })).rejects.toThrow('fresh secret or native authorization');
    await expect(runtime.configureProvider({
      id: 'first', kind: 'xregistry', baseUrl: 'https://other.test', credentialId: 'shared-token', credentialScheme: 'Bearer', trusted: true,
    })).rejects.toThrow('fresh secret or native authorization');
    await expect(runtime.configureProvider({
      id: 'first', kind: 'xregistry', baseUrl: 'https://registry.test', credentialId: 'shared-token', credentialScheme: 'Basic', trusted: true,
    })).rejects.toThrow('fresh secret or native authorization');

    expect(state.requests).toHaveLength(requestsBeforeAttack);
    expect(secretReads).toHaveBeenCalledTimes(secretReadsBeforeAttack);
    expect([...state.secrets.values()]).toEqual(['first-secret']);

    await expect(runtime.configureProvider({
      id: 'second', kind: 'xregistry', baseUrl: 'https://registry.test', credentialId: 'shared-token', credentialScheme: 'Bearer', trusted: true,
    }, 'second-secret')).resolves.toMatchObject({ id: 'second', credentialConfigured: true });
    expect(state.requests.some((request) => request.url.startsWith('https://registry.test') && request.secret === 'second-secret')).toBe(true);
    expect([...state.secrets.values()].sort()).toEqual(['first-secret', 'second-secret']);
  });

  it('copies a bound credential only after explicit host-native reauthorization', async () => {
    const state = host();
    const authorizations: unknown[] = [];
    const options: LibraryHostRuntimeOptions = {
      ...state.options,
      authorizeCredentialBinding: async (request) => { authorizations.push(request); return true; },
    };
    const runtime = await createLibraryHostRuntime(options);
    await runtime.configureProvider({
      id: 'first', kind: 'xregistry', baseUrl: 'https://registry.test', credentialId: 'shared-token', trusted: true,
    }, 'native-secret');
    await runtime.configureProvider({
      id: 'second', kind: 'xregistry', baseUrl: 'https://registry.test', credentialId: 'shared-token', trusted: true,
    });

    expect(authorizations).toEqual([expect.objectContaining({
      credentialId: 'shared-token',
      source: { providerId: 'first', origin: 'https://registry.test', scheme: 'Bearer' },
      target: { providerId: 'second', origin: 'https://registry.test', scheme: 'Bearer' },
    })]);
    expect([...state.secrets.values()]).toEqual(['native-secret', 'native-secret']);
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

  it('uses provider path boundaries for trusted URI prefixes', async () => {
    const state = host([{
      id: 'bounded', kind: 'local', location: 'file:///workspace/library', entries: [
        { id: 'inside', versions: [{ version: '1', documentUri: 'file:///workspace/library/inside.json', isDefault: true }] },
        { id: 'sibling', versions: [{ version: '1', documentUri: 'file:///workspace/library-escape/sibling.json', isDefault: true }] },
      ],
    }]);
    let resourceReads = 0;
    const options: LibraryHostRuntimeOptions = {
      ...state.options,
      readJsonResource: async (uri: string) => { resourceReads += 1; return { uri }; },
    };
    const runtime = await createLibraryHostRuntime(options);
    await expect(runtime.resolve({ providerId: 'bounded', entryId: 'inside', selector: { kind: 'pinned', version: '1' }, offline: false }))
      .resolves.toMatchObject({ trust: { trusted: true } });
    const readsBeforeUntrustedResolution = resourceReads;
    await expect(runtime.resolve({ providerId: 'bounded', entryId: 'sibling', selector: { kind: 'pinned', version: '1' }, offline: false }))
      .rejects.toThrow('not trusted');
    expect(resourceReads).toBe(readsBeforeUntrustedResolution);
    const readsBeforeRejectedImport = resourceReads;
    await expect(runtime.readResource('file:///workspace/library-escape/sibling.json')).rejects.toThrow('not trusted');
    expect(resourceReads).toBe(readsBeforeRejectedImport);
  });

  it('reads bundled and verified xRegistry import URIs through exact runtime matches', async () => {
    const state = host();
    const runtime = await createLibraryHostRuntime(state.options);
    await expect(runtime.readResource('bundle:///core/1.json')).resolves.toEqual({
      uri: 'bundle:///core/1.json',
      document: { uri: 'bundle:///core/1.json' },
    });
    await expect(runtime.readResource('bundle:///core/not-listed.json')).resolves.toBeUndefined();

    await runtime.configureProvider({
      id: 'registry', kind: 'xregistry', baseUrl: 'https://registry.test', trusted: true,
    });
    const resolved = await runtime.resolve({ providerId: 'registry', entryId: 'remote', selector: { kind: 'pinned', version: '1' }, offline: false });
    expect(resolved.documentUri).toBe('https://registry.test/groups/schemas/remote/versions/1');
    const requestCount = state.requests.length;
    await expect(runtime.readResource(resolved.documentUri)).resolves.toEqual({
      uri: resolved.documentUri,
      document: { remote: true },
    });
    expect(state.requests).toHaveLength(requestCount);
    await expect(runtime.readResource('https://registry.test/unresolved.json')).resolves.toBeUndefined();
  });

  it('rejects untrusted xRegistry collection and version metadata before following it', async () => {
    const state = host();
    const options: LibraryHostRuntimeOptions = {
      ...state.options,
      httpTransport: async (request) => {
        state.requests.push({ url: request.url });
        if (request.url.endsWith('/')) return { status: 200, body: { links: [] } };
        if (request.url.endsWith('/model')) return { status: 200, body: { links: [{ href: 'https://evil.test/groups/schemas' }] } };
        throw new Error('Untrusted metadata was followed.');
      },
    };
    const runtime = await createLibraryHostRuntime(options);

    await expect(runtime.configureProvider({ id: 'registry', kind: 'xregistry', baseUrl: 'https://registry.test', trusted: true }))
      .rejects.toThrow("xRegistry provider 'registry' could not be configured");
    expect(state.requests.map((request) => request.url)).toEqual(['https://registry.test/', 'https://registry.test/model']);
  });

  it('rejects xRegistry collection metadata outside the configured base path', async () => {
    const state = host();
    const options: LibraryHostRuntimeOptions = {
      ...state.options,
      httpTransport: async (request) => {
        state.requests.push({ url: request.url });
        if (request.url.endsWith('/')) return { status: 200, body: { links: [] } };
        if (request.url.endsWith('/model')) return { status: 200, body: { links: [{ href: 'https://registry.test/api-escape/groups/schemas' }] } };
        throw new Error('Sibling collection path was followed.');
      },
    };
    const runtime = await createLibraryHostRuntime(options);

    await expect(runtime.configureProvider({ id: 'registry', kind: 'xregistry', baseUrl: 'https://registry.test/api', trusted: true }))
      .rejects.toThrow("xRegistry provider 'registry' could not be configured");
    expect(state.requests.map((request) => request.url)).toEqual(['https://registry.test/api/', 'https://registry.test/api/model']);
  });

  it('rejects xRegistry relative path segments before derived endpoint I/O', async () => {
    const state = host();
    const runtime = await createLibraryHostRuntime(state.options);
    const requestCount = state.requests.length;

    await expect(runtime.configureProvider({
      id: 'registry', kind: 'xregistry', baseUrl: 'https://registry.test/api',
      reference: { group: '..', resource: 'schemas' }, trusted: true,
    })).rejects.toThrow('relative path segment');
    expect(state.requests).toHaveLength(requestCount);

    const options: LibraryHostRuntimeOptions = {
      ...state.options,
      httpTransport: async (request) => {
        state.requests.push({ url: request.url });
        if (request.url.endsWith('/')) return { status: 200, body: { links: [] } };
        if (request.url.endsWith('/model')) return { status: 200, body: { links: [{ href: 'https://registry.test/api/groups/schemas' }] } };
        if (request.url.includes('inline=versions')) return { status: 200, body: { resources: [{ id: '..', versions: [{ id: '1' }] }] } };
        throw new Error('Relative metadata path was followed.');
      },
    };
    const metadataRuntime = await createLibraryHostRuntime(options);
    await metadataRuntime.configureProvider({ id: 'metadata', kind: 'xregistry', baseUrl: 'https://registry.test/api', trusted: true });
    await expect(metadataRuntime.listCatalog()).rejects.toThrow('relative path segment');
    expect(state.requests.at(-1)?.url).toContain('inline=versions');
  });

  it('snapshots provider manifests so caller mutation cannot rebind an authorized URI', async () => {
    const state = host();
    const reads: string[] = [];
    const options: LibraryHostRuntimeOptions = {
      ...state.options,
      readJsonResource: async (uri) => { reads.push(uri); return { uri }; },
    };
    const runtime = await createLibraryHostRuntime(options);
    const config = {
      id: 'mutable', kind: 'local' as const, location: 'file:///workspace/library/',
      entries: [{ id: 'common', versions: [{ version: '1', documentUri: 'file:///workspace/library/common.json', isDefault: true }] }],
    };
    await runtime.configureProvider(config);
    config.entries[0]!.versions[0]!.documentUri = 'file:///outside/attacker.json';

    await expect(runtime.resolve({ providerId: 'mutable', entryId: 'common', selector: { kind: 'pinned', version: '1' }, offline: false }))
      .resolves.toMatchObject({ documentUri: 'file:///workspace/library/common.json' });
    expect(reads).toEqual(['file:///workspace/library/common.json']);
  });

  it('rejects tampered publisher URIs before catalog exposure or document reads', async () => {
    const state = host([local]);
    await state.publisher.write({
      id: 'tampered',
      epoch: '1',
      versions: {
        '1': {
          entryId: 'tampered', version: '1', uri: 'file:///outside/attacker.json',
          value: schemaDocument(), provenance: { sourceUri: 'memory:attacker' },
        },
      },
    }, undefined);
    const resourceRead = vi.spyOn(state.options, 'readJsonResource');
    const runtime = await createLibraryHostRuntime(state.options);

    await expect(runtime.listCatalog()).rejects.toThrow('not immutable');
    await expect(runtime.resolve({ providerId: 'workspace', entryId: 'tampered', selector: { kind: 'pinned', version: '1' }, offline: false }))
      .rejects.toThrow('not immutable');
    expect(resourceRead).not.toHaveBeenCalled();
  });

  it('prevents provider location rebinding after publishing immutable versions', async () => {
    const state = host();
    const runtime = await createLibraryHostRuntime(state.options);
    await runtime.configureProvider({ id: 'publisher', kind: 'local', location: 'file:///workspace/one/', entries: [], trusted: true });
    const published = await runtime.publish({
      providerId: 'publisher', entryId: 'common', version: '1', document: schemaDocument(), sourceUri: 'memory:source',
    });
    const persistedBeforeAttack = state.providerJson();

    await expect(runtime.configureProvider({ id: 'publisher', kind: 'local', location: 'file:///workspace/two/', entries: [], trusted: true }))
      .rejects.toThrow('cannot change location after publishing immutable versions');
    expect(state.providerJson()).toBe(persistedBeforeAttack);
    await expect(runtime.readResource(published.versions['1']!.uri)).resolves.toMatchObject({ uri: published.versions['1']!.uri });
  });

  it('rejects denied operations before cache, publisher, secret, or network access', async () => {
    const state = host([local]);
    const cacheRead = vi.spyOn(state.options.cacheStore, 'read');
    const secretRead = vi.spyOn(state.options.secretStore, 'getSecret');
    const publisherResolve = vi.spyOn(state.options, 'resolvePublisherStore');
    const options: LibraryHostRuntimeOptions = {
      ...state.options,
      authorizeOperation: async () => false,
    };
    const runtime = await createLibraryHostRuntime(options);
    cacheRead.mockClear();
    secretRead.mockClear();
    publisherResolve.mockClear();
    const requestCount = state.requests.length;

    await expect(runtime.listProviders()).rejects.toThrow('not authorized by the host');
    await expect(runtime.listCatalog()).rejects.toThrow('not authorized by the host');
    await expect(runtime.resolve({ providerId: 'workspace', entryId: 'common', selector: { kind: 'pinned', version: '1' }, offline: false }))
      .rejects.toThrow('not authorized by the host');
    await expect(runtime.readResource('file:///workspace/library/common-1.json')).rejects.toThrow('not authorized by the host');

    expect(cacheRead).not.toHaveBeenCalled();
    expect(secretRead).not.toHaveBeenCalled();
    expect(publisherResolve).not.toHaveBeenCalled();
    expect(state.requests).toHaveLength(requestCount);
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
    const options: LibraryHostRuntimeOptions = {
      ...state.options,
      httpTransport: async (request) => {
        if (request.url.startsWith('https://failing.test')) throw new Error('discovery failed');
        if (request.url.endsWith('/model')) return { status: 200, body: { links: [{ href: 'https://working.test/groups/schemas' }] } };
        return { status: 200, body: { links: [] } };
      },
    };
    const runtime = await createLibraryHostRuntime(options);
    const failed = runtime.configureProvider({
      id: 'failing', kind: 'xregistry', baseUrl: 'https://failing.test', credentialId: 'shared-token', trusted: true,
    }, 'first-secret');
    const succeeded = runtime.configureProvider({
      id: 'working', kind: 'xregistry', baseUrl: 'https://working.test', credentialId: 'shared-token', trusted: true,
    }, 'second-secret');

    await expect(failed).rejects.toThrow("xRegistry provider 'failing'");
    await expect(succeeded).resolves.toMatchObject({ id: 'working', credentialConfigured: true });
    expect(storedSecret(state.secrets, 'shared-token')).toBe('second-secret');
  });

  it('publishes through service plans with optimistic epochs and conflict rejection', async () => {
    const state = host([local]);
    const runtime = await createLibraryHostRuntime(state.options);
    const sourceDocument = schemaDocument({ Original: { type: 'string' } });
    const first = await runtime.publish({
      providerId: 'workspace', entryId: 'common', version: '3', document: sourceDocument, sourceUri: 'memory:document', promoteDefault: true,
    });
    expect(first).toMatchObject({ epoch: '1', defaultVersion: '3' });
    const publishedUri = first.versions['3']?.uri;
    expect(publishedUri).toBe('file:///workspace/library/.published/provider-workspace/entry-common/version-3.json');
    expect(first.versions['3']?.provenance?.sourceUri).toBe('memory:document');
    (sourceDocument.definitions.Original as { type: string }).type = 'number';
    const second = await runtime.publish({
      providerId: 'workspace', entryId: 'common', version: '4', document: schemaDocument(), sourceUri: 'memory:document', expectedEpoch: first.epoch,
    });
    expect(second).toMatchObject({ epoch: '2', defaultVersion: '3' });
    expect((await runtime.listCatalog()).find((entry) => entry.providerId === 'workspace' && entry.id === 'common')?.versions).toEqual(expect.arrayContaining([
      expect.objectContaining({ version: '3', epoch: '1', isDefault: true }),
      expect.objectContaining({ version: '4', epoch: '2', isDefault: false }),
    ]));
    await expect(runtime.resolve({ providerId: 'workspace', entryId: 'common', selector: { kind: 'pinned', version: '4' }, offline: false }))
      .resolves.toMatchObject({ document: { definitions: {} }, trust: { trusted: true }, provenance: { providerId: 'workspace', entryId: 'common', version: '4', sourceUri: 'memory:document' } });
    await expect(runtime.resolve({ providerId: 'workspace', entryId: 'common', selector: { kind: 'pinned', version: '3' }, offline: false }))
      .resolves.toMatchObject({
        document: { definitions: { Original: { type: 'string' } } },
        documentUri: publishedUri,
        trust: { trusted: true },
        provenance: { sourceUri: 'memory:document' },
      });
    await expect(runtime.readResource(publishedUri!)).resolves.toEqual({
      uri: publishedUri,
      document: schemaDocument({ Original: { type: 'string' } }),
    });
    await expect(runtime.publish({
      providerId: 'workspace', entryId: 'common', version: '5', document: schemaDocument(), sourceUri: 'memory:document', expectedEpoch: '1',
    })).rejects.toBeInstanceOf(EpochConflictError);
  });

  it('rejects invalid, unresolved, and duplicate JSON Structure documents before publisher I/O', async () => {
    const state = host([local]);
    const runtime = await createLibraryHostRuntime(state.options);
    const read = vi.spyOn(state.publisher, 'read');
    const list = vi.spyOn(state.publisher, 'list');
    const write = vi.spyOn(state.publisher, 'write');

    await expect(runtime.publish({
      providerId: 'workspace', entryId: 'invalid', version: '1', document: {}, sourceUri: 'memory:invalid',
    })).rejects.toThrow('not a valid JSON Structure document');
    await expect(runtime.publish({
      providerId: 'workspace', entryId: 'unresolved', version: '1',
      document: schemaDocument({ Broken: { type: { $ref: '#/definitions/Missing' } } }), sourceUri: 'memory:unresolved',
    })).rejects.toThrow('not a valid JSON Structure document');
    await expect(runtime.publish({
      providerId: 'workspace', entryId: 'duplicate', version: '1',
      document: '{"$schema":"https://json-structure.org/meta/core/v0/#","$id":"urn:test:duplicate","name":"Duplicate","definitions":{"Same":{"type":"string"},"\\u0053ame":{"type":"number"}}}',
      sourceUri: 'memory:duplicate',
    })).rejects.toThrow('not a valid JSON Structure document');

    expect(read).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});

describe('bounded HTTPS transport', () => {
  it('follows only exact same-origin HTTPS redirects with manual redirect handling', async () => {
    const requests: Array<{ url: string; redirect?: RequestInit['redirect']; authorization: string | null }> = [];
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

  it('rejects same-origin redirects outside the authorized path before forwarding credentials again', async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input));
      return new Response(null, { status: 302, headers: { location: 'https://registry.test/api-escape/final' } });
    };

    await expect(createBoundedHttpsTransport(fetcher)(
      { method: 'GET', url: 'https://registry.test/api/start', headers: {} },
      { scheme: 'Bearer', secret: 'secret' },
    )).rejects.toThrow('authorized HTTPS path');
    expect(requests).toEqual(['https://registry.test/api/start']);
  });

  it('rejects private-network targets before fetch or credential forwarding', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const transport = createBoundedHttpsTransport(fetcher);

    for (const url of ['https://localhost/schema', 'https://127.0.0.1/schema', 'https://10.0.0.1/schema', 'https://169.254.169.254/latest/meta-data', 'https://[::1]/schema', 'https://[fd00::1]/schema', 'https://[::ffff:7f00:1]/schema', 'https://[ff02::1]/schema']) {
      await expect(transport({ method: 'GET', url, headers: {} }, { scheme: 'Bearer', secret: 'must-not-forward' }))
        .rejects.toThrow('private or local network');
    }
    expect(fetcher).not.toHaveBeenCalled();
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