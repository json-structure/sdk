import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { DurableLibraryCache, JsonLibraryCachePersistence, MemoryLibraryCache, resolveCachedLibrary } from '../src/libraries/cache.js';
import { PolicyTrustAdapter, SecretStorageCredentialAdapter } from '../src/libraries/adapters.js';
import { normalizeLibraryEntry } from '../src/libraries/contracts.js';
import { CopyCollisionError, planLibraryCopy, planLibraryImport, planLibraryMaterialization, planLibraryPublish } from '../src/libraries/planning.js';
import { EpochConflictError, MemoryLibraryPublisherStore, publishLibraryVersion, type LibraryPublisherStore, type PublishedLibraryEntry } from '../src/libraries/publishing.js';
import { createLibraryServiceFacade } from '../src/libraries/facade.js';
import { LocalDocumentLibraryProvider, StaticDocumentLibraryProvider, XRegistryApiLibraryProvider, discoverXRegistryProvider } from '../src/libraries/providers.js';
import { LibraryService } from '../src/libraries/service.js';
import { evaluateLibraryTrust } from '../src/libraries/trust.js';

const manifest = [{
  id: 'common',
  name: 'Common types',
  versions: [
    { version: '1.0.0', documentUri: 'file:///libraries/common-1.json', isDefault: false },
    { version: '2.0.0', documentUri: 'file:///libraries/common-2.json', isDefault: true },
  ],
}] as const;

describe('Phase 6 library runtime', () => {
  it('validates declared canonical content integrity before caching', async () => {
    const value = { z: 1, nested: { b: true, a: 'first' } };
    const canonical = JSON.stringify({ nested: { a: 'first', b: true }, z: 1 });
    const digest = createHash('sha256').update(new TextEncoder().encode(canonical)).digest('hex');
    const cache = new MemoryLibraryCache();
    const matching = new StaticDocumentLibraryProvider('matching', [{
      id: 'common', versions: [{ version: '1', documentUri: 'memory:common', integrity: `sha256:${digest}`, isDefault: true }],
    }], async () => value);
    await expect(resolveCachedLibrary({ provider: matching, cache, entryId: 'common', selector: { kind: 'floating' }, offline: false }))
      .resolves.toMatchObject({ label: 'online-verified' });

    const mismatching = new StaticDocumentLibraryProvider('mismatching', [{
      id: 'common', versions: [{ version: '1', documentUri: 'memory:common', integrity: `sha256:${'0'.repeat(64)}`, isDefault: true }],
    }], async () => value);
    await expect(resolveCachedLibrary({ provider: mismatching, cache, entryId: 'common', selector: { kind: 'floating' }, offline: false }))
      .rejects.toThrow('integrity check failed');
    expect(await cache.list('mismatching', 'common')).toHaveLength(0);
  });

  it('rejects tampered and unproven pinned cache records', async () => {
    let persisted = '';
    const persistence = new JsonLibraryCachePersistence(async () => persisted, async (content) => { persisted = content; });
    const provider = new StaticDocumentLibraryProvider('static', manifest, async () => ({ trusted: true }));
    await resolveCachedLibrary({
      provider, cache: new DurableLibraryCache(persistence), entryId: 'common', selector: { kind: 'pinned', version: '1.0.0' }, offline: false,
    });
    persisted = persisted.replace('"trusted": true', '"trusted": false');
    await expect(resolveCachedLibrary({
      provider, cache: new DurableLibraryCache(persistence), entryId: 'common', selector: { kind: 'pinned', version: '1.0.0' }, offline: true,
    })).rejects.toThrow('Cached library integrity check failed');

    const legacy = new MemoryLibraryCache();
    await legacy.put({
      providerId: 'static', entryId: 'common', version: '1.0.0', storedAt: '2026-08-31T00:00:00.000Z',
      document: { entryId: 'common', version: '1.0.0', uri: 'memory:common', value: { trusted: true } },
    });
    await expect(resolveCachedLibrary({
      provider, cache: legacy, entryId: 'common', selector: { kind: 'pinned', version: '1.0.0' }, offline: true,
    })).rejects.toThrow('has no verification proof');
  });

  it('persists proof so matching pinned bytes remain reproducible offline', async () => {
    let persisted = '';
    const persistence = new JsonLibraryCachePersistence(async () => persisted, async (content) => { persisted = content; });
    const provider = new StaticDocumentLibraryProvider('static', manifest, async () => ({ stable: true }));
    await resolveCachedLibrary({
      provider, cache: new DurableLibraryCache(persistence), entryId: 'common', selector: { kind: 'pinned', version: '1.0.0' }, offline: false,
    });
    expect(persisted).toContain('"proof"');
    await expect(resolveCachedLibrary({
      provider, cache: new DurableLibraryCache(persistence), entryId: 'common', selector: { kind: 'pinned', version: '1.0.0' }, offline: true,
    })).resolves.toMatchObject({ label: 'pinned-reproducible', state: { verification: 'reproducible' } });
  });

  it('normalizes entries and rejects ambiguous versions', () => {
    expect(normalizeLibraryEntry({ id: ' x ', versions: [{ version: ' 1 ', documentUri: ' memory:x ', isDefault: true }] })).toEqual({
      id: 'x', name: 'x', versions: [{ version: '1', documentUri: 'memory:x', isDefault: true }],
    });
    expect(() => normalizeLibraryEntry({ id: 'x', versions: [
      { version: '1', documentUri: 'a', isDefault: true },
      { version: '2', documentUri: 'b', isDefault: true },
    ] })).toThrow('multiple default');
  });

  it('uses injected readers for local and static documents', async () => {
    const localRead = vi.fn(async (uri: string) => ({ uri }));
    const local = new LocalDocumentLibraryProvider('local', manifest, localRead);
    expect((await local.readDocument('common', '1.0.0')).value).toEqual({ uri: 'file:///libraries/common-1.json' });
    expect(localRead).toHaveBeenCalledWith('file:///libraries/common-1.json');

    const staticRead = vi.fn(async (entryId: string, version: string, uri: string) => ({ entryId, version, uri }));
    const staticProvider = new StaticDocumentLibraryProvider('static', manifest, staticRead);
    expect((await staticProvider.readDocument('common', '2.0.0')).value).toEqual({
      entryId: 'common', version: '2.0.0', uri: 'file:///libraries/common-2.json',
    });
  });

  it('serves pinned cache entries reproducibly and labels floating offline entries unverified', async () => {
    const provider = new StaticDocumentLibraryProvider('static', manifest, async (_entryId, version) => ({ version }));
    const cache = new MemoryLibraryCache();
    await resolveCachedLibrary({ provider, cache, entryId: 'common', selector: { kind: 'pinned', version: '1.0.0' }, offline: false });
    await resolveCachedLibrary({ provider, cache, entryId: 'common', selector: { kind: 'pinned', version: '2.0.0' }, offline: false });

    const pinned = await resolveCachedLibrary({ provider, cache, entryId: 'common', selector: { kind: 'pinned', version: '1.0.0' }, offline: true });
    expect(pinned).toMatchObject({ source: 'cache', label: 'pinned-reproducible', document: { version: '1.0.0' }, state: { selector: 'pinned', connectivity: 'offline', verification: 'reproducible' } });
    const floating = await resolveCachedLibrary({ provider, cache, entryId: 'common', selector: { kind: 'floating' }, offline: true });
    expect(floating).toMatchObject({ source: 'cache', label: 'floating-offline-unverified', document: { version: '2.0.0' }, state: { selector: 'floating', connectivity: 'offline', verification: 'unverified' } });
  });

  it('selects the last successful floating default instead of lexicographic version order', async () => {
    const versions = [{
      id: 'numbered', versions: [
        { version: '10', documentUri: 'memory:10', isDefault: false },
        { version: '9', documentUri: 'memory:9', isDefault: true },
      ],
    }] as const;
    const provider = new StaticDocumentLibraryProvider('static', versions, async (_entryId, version) => ({ version }));
    const cache = new MemoryLibraryCache();
    await resolveCachedLibrary({
      provider, cache, entryId: 'numbered', selector: { kind: 'pinned', version: '10' }, offline: false, now: () => '2026-08-31T00:00:00.000Z',
    });
    await resolveCachedLibrary({
      provider, cache, entryId: 'numbered', selector: { kind: 'floating' }, offline: false, now: () => '2026-08-31T00:00:01.000Z',
    });
    await expect(resolveCachedLibrary({ provider, cache, entryId: 'numbered', selector: { kind: 'floating' }, offline: true }))
      .resolves.toMatchObject({
        label: 'floating-offline-unverified', document: { version: '9' }, state: { verification: 'unverified' },
      });
  });

  it('evicts oldest cache records deterministically when configured limits are exceeded', async () => {
    const cache = new MemoryLibraryCache({ maxEntries: 2, maxSerializedBytes: 100_000 });
    const record = (version: string, storedAt: string) => ({
      providerId: 'static', entryId: 'common', version, storedAt,
      document: { entryId: 'common', version, uri: `memory:${version}`, value: { version } },
    });
    await cache.put(record('10', '2026-08-31T00:00:00.000Z'));
    await cache.put(record('9', '2026-08-31T00:00:00.000Z'));
    await cache.put(record('11', '2026-08-31T00:00:01.000Z'));
    expect((await cache.list('static', 'common')).map((item) => item.version)).toEqual(['11', '9']);
  });

  it('persists durable cache records through a JSON adapter', async () => {
    let persisted = '';
    const persistence = new JsonLibraryCachePersistence(
      async () => persisted,
      async (content) => { persisted = content; },
    );
    const cache = new DurableLibraryCache(persistence);
    await cache.put({
      providerId: 'static',
      entryId: 'common',
      version: '1.0.0',
      storedAt: '2026-08-31T00:00:00.000Z',
      document: { entryId: 'common', version: '1.0.0', uri: 'memory:common', value: { ok: true } },
    });
    const reloaded = new DurableLibraryCache(new JsonLibraryCachePersistence(async () => persisted, async () => undefined));
    expect(await reloaded.get('static', 'common', '1.0.0')).toMatchObject({
      document: { value: { ok: true } },
    });
  });

  it('passes credentials out-of-band and never leaks secrets through requests or errors', async () => {
    const secret = 'top-secret-token';
    const requests: unknown[] = [];
    const credentials: unknown[] = [];
    const provider = new XRegistryApiLibraryProvider({
      id: 'registry', baseUrl: 'https://registry.example.test/', group: 'schemagroups', resource: 'schemas', credentialId: 'registry-token',
      lookupCredential: async () => ({ scheme: 'Bearer', secret }),
      transport: async (request, credential) => {
        requests.push(request);
        credentials.push(credential);
        throw new Error(`transport accidentally included ${secret}`);
      },
    });
    let message = '';
    try { await provider.listEntries(); } catch (error) { message = String(error); }
    expect(JSON.stringify(requests)).not.toContain(secret);
    expect(credentials).toEqual([{ scheme: 'Bearer', secret }]);
    expect(message).not.toContain(secret);
    expect(message).toContain('xRegistry request failed');
  });

  it('normalizes xRegistry resources through an injected transport', async () => {
    const provider = new XRegistryApiLibraryProvider({
      id: 'registry', baseUrl: 'https://registry.example.test', group: 'groups', resource: 'schemas',
      transport: async () => ({ status: 200, body: { resources: [{ id: 'common', defaultVersionId: '2', versions: [
        { id: '1', documentUri: 'https://registry.example.test/common/1' },
        { id: '2', documentUri: 'https://registry.example.test/common/2' },
      ] }] } }),
    });
    expect(await provider.listEntries()).toEqual([expect.objectContaining({
      id: 'common', name: 'common', versions: [
        expect.objectContaining({ version: '1', isDefault: false }),
        expect.objectContaining({ version: '2', isDefault: true }),
      ],
    })]);
  });

  it('discovers xRegistry providers through GET / and GET /model with trust and credentials', async () => {
    const seenUrls: string[] = [];
    const seenCredentials: unknown[] = [];
    const discovered = await discoverXRegistryProvider({
      id: 'registry',
      baseUrl: 'https://registry.example.test',
      credentialId: 'cred',
      lookupCredential: async () => ({ scheme: 'Bearer', secret: 'hidden' }),
      trust: { isTrusted: async () => true },
      transport: async (request, credential) => {
        seenUrls.push(request.url);
        seenCredentials.push(credential ?? null);
        if (request.url.endsWith('/model')) {
          return {
            status: 200,
            body: {
              links: [{ href: 'https://registry.example.test/schemagroups/schemas' }],
            },
          };
        }
        if (request.url.endsWith('/')) return { status: 200, body: { links: [] } };
        if (request.url.includes('inline=versions')) {
          return {
            status: 200,
            body: { resources: [{ id: 'common', defaultVersionId: '1', versions: [{ id: '1', documentUri: 'https://registry.example.test/common/1' }] }] },
          };
        }
        return { status: 404, body: {} };
      },
    });
    expect(discovered.discovery.schemaCollections).toContain('https://registry.example.test/schemagroups/schemas');
    expect(seenUrls).toEqual(expect.arrayContaining(['https://registry.example.test/', 'https://registry.example.test/model']));
    expect(seenCredentials).toContainEqual({ scheme: 'Bearer', secret: 'hidden' });
    expect((await discovered.provider.listEntries()).map((entry) => entry.id)).toEqual(['common']);
  });

  it('plans imports and copies with provenance and RFC 6901 reference rewrites', () => {
    const provenance = { providerId: 'static', entryId: 'common', version: '2', sourceUri: 'memory:common' };
    expect(planLibraryImport('memory:common', '/definitions', provenance)).toEqual({
      kind: 'import', keyword: '$importdefs', destinationPointer: '/definitions', source: 'memory:common', provenance,
    });
    const source = { definitions: {
      'A/B': { type: 'object', properties: { next: { $ref: '#/definitions/C~0D' } } },
      'C~D': { type: 'string', $extends: '#/definitions/A~1B' },
    } };
    const plan = planLibraryCopy(source, { definitions: {} }, ['/definitions/A~1B', '/definitions/C~0D'], '/definitions', provenance);
    expect(plan.operations.map((operation) => operation.destinationPointer)).toEqual(['/definitions/A~1B', '/definitions/C~0D']);
    expect(plan.operations[0]?.value).toEqual({ type: 'object', properties: { next: { $ref: '#/definitions/C~0D' } } });
    expect(plan.operations[1]?.value).toEqual({ type: 'string', $extends: '#/definitions/A~1B' });
    expect(plan.operations[0]?.provenance.sourcePointer).toBe('/definitions/A~1B');

    const materialized = planLibraryMaterialization(
      source,
      { definitions: { $importdefs: 'memory:common' } },
      ['/definitions/A~1B'],
      '/definitions',
      '/definitions/$importdefs',
      provenance,
    );
    expect(materialized).toMatchObject({
      kind: 'materialize',
      importPointer: '/definitions/$importdefs',
      operations: [
        expect.objectContaining({ sourcePointer: '/definitions/A~1B', provenance: expect.objectContaining({ providerId: 'static', sourcePointer: '/definitions/A~1B' }) }),
        expect.objectContaining({ sourcePointer: '/definitions/C~0D', provenance: expect.objectContaining({ providerId: 'static', sourcePointer: '/definitions/C~0D' }) }),
      ],
    });

    const publishPlan = planLibraryPublish(' common ', ' 3.0.0 ', { definitions: {} }, provenance, '2', true);
    expect(publishPlan).toMatchObject({ kind: 'publish', entryId: 'common', version: '3.0.0', expectedEpoch: '2', promoteDefault: true });
  });

  it('rejects existing and intra-plan copy collisions', () => {
    const provenance = { providerId: 'static', entryId: 'common', version: '2', sourceUri: 'memory:common' };
    expect(() => planLibraryCopy({ definitions: { A: {} } }, { definitions: { A: {} } }, ['/definitions/A'], '/definitions', provenance))
      .toThrow(CopyCollisionError);
    expect(() => planLibraryCopy({ one: { A: {} }, two: { A: {} } }, {}, ['/one/A', '/two/A'], '', provenance))
      .toThrow("/A");
  });

  it('evaluates provider, origin, and integrity trust without executing host behavior', () => {
    const decision = evaluateLibraryTrust('remote', {
      entryId: 'common', version: '1', uri: 'http://untrusted.test/common', value: {},
    }, { trustedProviderIds: ['local'], trustedUriPrefixes: ['https://trusted.test/'], requireIntegrity: true });
    expect(decision.trusted).toBe(false);
    expect(decision.reasons).toHaveLength(3);
  });

  it('publishes with optimistic epochs, optional promotion, and conflict rejection', async () => {
    const store = new MemoryLibraryPublisherStore();
    const document = { entryId: 'common', version: '1', uri: 'memory:common', value: {} };
    const first = await publishLibraryVersion(store, { entryId: 'common', version: '1', document, promoteDefault: true });
    expect(first).toMatchObject({ epoch: '1', defaultVersion: '1' });
    const second = await publishLibraryVersion(store, {
      entryId: 'common', version: '2', expectedEpoch: first.epoch,
      document: { ...document, version: '2' },
    });
    expect(second).toMatchObject({ epoch: '2', defaultVersion: '1' });
    await expect(publishLibraryVersion(store, {
      entryId: 'common', version: '3', expectedEpoch: '1', document: { ...document, version: '3' },
    })).rejects.toBeInstanceOf(EpochConflictError);

    const racingStore: LibraryPublisherStore = {
      read: async () => undefined,
      write: async (_entry: PublishedLibraryEntry) => false,
    };
    await expect(publishLibraryVersion(racingStore, { entryId: 'race', version: '1', document }))
      .rejects.toBeInstanceOf(EpochConflictError);
  });

  it('adapts trust and credential checks for host wiring', async () => {
    const credentials = new SecretStorageCredentialAdapter([
      { credentialId: 'reg', scheme: 'Bearer', secretRef: 'vault/registry' },
    ], {
      getSecret: async (key: string) => key === 'vault/registry' ? 'token-value' : undefined,
    });
    expect(await credentials.get('reg')).toEqual({ scheme: 'Bearer', secret: 'token-value' });

    const trust = new PolicyTrustAdapter({
      isTrustedProvider: async (providerId: string) => providerId === 'registry',
      isTrustedOrigin: async (origin: string) => origin === 'https://registry.example.test',
    });
    expect(await trust.isTrusted('registry', 'https://registry.example.test/schemas')).toBe(true);
    expect(await trust.isTrusted('registry', 'https://other.example.test/schemas')).toBe(false);
  });

  it('provides a concrete service facade for import, copy, materialize, and publish plans with provenance', async () => {
    let persisted = '';
    const facade = createLibraryServiceFacade({
      cacheStore: {
        read: async () => persisted,
        write: async (content: string) => { persisted = content; },
      },
      secretStore: {
        getSecret: async () => 'hidden',
      },
      trustStore: {
        isTrustedProvider: async () => true,
        isTrustedOrigin: async () => true,
      },
      credentials: [{ credentialId: 'registry', scheme: 'Bearer', secretRef: 'secret/registry' }],
      providers: [{
        provider: new StaticDocumentLibraryProvider('static', manifest, async () => ({ definitions: { A: { type: 'string' } } })),
        trustPolicy: { trustedProviderIds: ['static'] },
        metadata: { kind: 'static' },
      }],
    });

    const resolution = await facade.service.resolve({ providerId: 'static', entryId: 'common', selector: { kind: 'floating' }, offline: false });
    expect(resolution.resolved.state).toMatchObject({ selector: 'floating', connectivity: 'online', verification: 'verified' });

    const importPlan = facade.service.buildImportPlan({
      resolution,
      source: resolution.resolved.document.uri,
      destinationPointer: '/definitions',
      keyword: '$importdefs',
    });
    expect(importPlan).toMatchObject({ kind: 'import', provenance: expect.objectContaining({ providerId: 'static', entryId: 'common' }) });

    const copyPlan = facade.service.buildCopyPlan({
      resolution,
      targetDocument: { definitions: {} },
      sourcePointers: ['/definitions/A'],
      destinationBase: '/definitions',
    });
    expect(copyPlan.operations).toHaveLength(1);
    expect(copyPlan.operations[0]?.provenance.sourcePointer).toBe('/definitions/A');

    const materializePlan = facade.service.buildMaterializePlan({
      resolution,
      targetDocument: { definitions: { $importdefs: resolution.resolved.document.uri } },
      sourcePointers: ['/definitions/A'],
      destinationBase: '/definitions',
      importPointer: '/definitions/$importdefs',
    });
    expect(materializePlan).toMatchObject({ kind: 'materialize', importPointer: '/definitions/$importdefs' });

    const publishPlan = facade.service.buildPublishPlan({
      providerId: 'static',
      entryId: 'common',
      version: '3.0.0',
      document: { definitions: { A: { type: 'string' } } },
      sourceUri: 'memory:composed-doc',
      expectedEpoch: undefined,
      promoteDefault: true,
    });
    expect(publishPlan).toMatchObject({ kind: 'publish', provenance: { sourceUri: 'memory:composed-doc' } });

    const published = await facade.service.publish({
      store: new MemoryLibraryPublisherStore(),
      plan: publishPlan,
    });
    expect(published).toMatchObject({ epoch: '1', defaultVersion: '3.0.0' });
    expect(persisted).toContain('common');
  });

  it('supports direct service construction for concrete host orchestration', async () => {
    const service = new LibraryService({
      cache: new MemoryLibraryCache(),
      providers: [{
        provider: new LocalDocumentLibraryProvider('local', manifest, async (uri: string) => ({ source: uri, definitions: { A: { type: 'string' } } })),
      }],
    });
    const catalog = await service.listCatalog();
    expect(catalog).toHaveLength(1);
    const resolved = await service.resolve({ providerId: 'local', entryId: 'common', selector: { kind: 'pinned', version: '1.0.0' }, offline: false });
    expect(resolved.provenance).toMatchObject({ providerId: 'local', entryId: 'common', version: '1.0.0' });
  });
});