import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createElectronLibraryRuntime } from '../src/electron/library-runtime.js';
import { readResource } from '../src/electron/file-service.js';
import { dispatchLibraryOperation } from '../src/libraries/host-runtime.js';

type TestStorageBackend = 'unknown' | 'basic_text' | 'missing' | 'throw';

function schemaDocument(name = 'LibraryDocument') {
  return {
    $schema: 'https://json-structure.org/meta/core/v0/#',
    $id: `urn:test:${name.toLowerCase()}`,
    name,
    definitions: {},
  };
}

async function fixture(encryptionAvailable = true, fetcher: typeof fetch = fetch, approve = true, backend: TestStorageBackend = 'unknown') {
  const root = await mkdtemp(join(tmpdir(), 'json-structure-library-'));
  const userDataPath = join(root, 'user-data');
  const bundledRoot = join(root, 'bundled');
  await mkdir(bundledRoot, { recursive: true });
  const documentPath = join(bundledRoot, 'financial.struct.json');
  await writeFile(documentPath, '{"definitions":{}}', 'utf8');
  const runtime = await createElectronLibraryRuntime({
    userDataPath,
    bundledRoot,
    documentRoot: () => undefined,
    platform: 'linux',
    safeStorage: {
      isEncryptionAvailable: () => encryptionAvailable,
      encryptString: (value) => Buffer.from(`encrypted:${value}`),
      decryptString: (value) => value.toString().replace(/^encrypted:/, ''),
      ...(backend === 'missing' ? {} : {
        getSelectedStorageBackend: (): 'unknown' | 'basic_text' => {
          if (backend === 'throw') throw new Error('backend unavailable');
          return backend;
        },
      }),
    },
    bundledProvider: {
      id: 'financial-types', kind: 'bundled', location: pathToFileURL(bundledRoot).toString(),
      entries: [{ id: 'financial-types', versions: [{ version: '1', documentUri: pathToFileURL(documentPath).toString(), isDefault: true }] }],
    },
    ...(approve ? { approve: async () => true } : {}),
    fetch: fetcher,
    resolveHost: async () => ['93.184.216.34'],
  });
  return { runtime, userDataPath };
}

describe('Electron library runtime adapter', () => {
  it('tolerates missing userData files and resolves the required bundled provider', async () => {
    const { runtime } = await fixture();
    await expect(dispatchLibraryOperation(runtime, 'listProviders')).resolves.toMatchObject([{ id: 'financial-types', trusted: true }]);
    await expect(dispatchLibraryOperation(runtime, 'resolve', { providerId: 'financial-types', entryId: 'financial-types', selector: { kind: 'pinned', version: '1' }, offline: false }))
      .resolves.toMatchObject({ document: { definitions: {} } });
  });

  it('rejects credential storage when OS encryption is unavailable without persisting plaintext', async () => {
    const { runtime, userDataPath } = await fixture(false);
    await expect(dispatchLibraryOperation(runtime, 'configureProvider', { config: { id: 'registry', kind: 'xregistry', baseUrl: 'https://registry.test', credentialId: 'token', trusted: true }, credentialSecret: 'never-plaintext' }))
      .rejects.toThrow('storage backend is unavailable');
    await expect(readFile(join(userDataPath, 'library-secrets.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['basic_text', 'missing', 'throw'] as const)('rejects credential persistence for %s safeStorage without creating a secret file', async (backend) => {
    const { runtime, userDataPath } = await fixture(true, fetch, true, backend);
    await expect(dispatchLibraryOperation(runtime, 'configureProvider', {
      config: { id: 'registry', kind: 'xregistry', baseUrl: 'https://registry.test', credentialId: 'token', trusted: true },
      credentialSecret: 'never-persist',
    })).rejects.toThrow(/basic_text|backend is unavailable/);
    await expect(readFile(join(userDataPath, 'library-secrets.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['win32', 'darwin'] as const)('uses native %s encryption without the Linux backend API', async (platform) => {
    const root = await mkdtemp(join(tmpdir(), 'json-structure-library-native-storage-'));
    const bundledRoot = join(root, 'bundled');
    await mkdir(bundledRoot, { recursive: true });
    const documentPath = join(bundledRoot, 'financial.struct.json');
    await writeFile(documentPath, '{"definitions":{}}', 'utf8');
    const fetcher: typeof fetch = async (input) => {
      const body = String(input).endsWith('/model') ? { links: [{ href: 'https://registry.test/groups/schemas' }] } : { links: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const runtime = await createElectronLibraryRuntime({
      userDataPath: join(root, 'user-data'),
      bundledRoot,
      documentRoot: () => undefined,
      platform,
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(`encrypted:${value}`),
        decryptString: (value) => value.toString().replace(/^encrypted:/, ''),
      },
      bundledProvider: {
        id: 'financial-types', kind: 'bundled', location: pathToFileURL(bundledRoot).toString(),
        entries: [{ id: 'financial-types', versions: [{ version: '1', documentUri: pathToFileURL(documentPath).toString(), isDefault: true }] }],
      },
      approve: async () => true,
      fetch: fetcher,
      resolveHost: async () => ['93.184.216.34'],
    });
    await expect(dispatchLibraryOperation(runtime, 'configureProvider', {
      config: { id: 'registry', kind: 'xregistry', baseUrl: 'https://registry.test', credentialId: 'token', trusted: true },
      credentialSecret: 'persist-encrypted',
    })).resolves.toMatchObject({ id: 'registry', credentialConfigured: true });
    await expect(dispatchLibraryOperation(runtime, 'listProviders')).resolves.toContainEqual(expect.objectContaining({ id: 'registry', credentialConfigured: true }));
  });

  it('rejects renderer trust assertions without main-process approval before storage or network I/O', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const { runtime, userDataPath } = await fixture(true, fetcher, false);

    await expect(dispatchLibraryOperation(runtime, 'configureProvider', {
      config: { id: 'registry', kind: 'xregistry', baseUrl: 'https://registry.test', credentialId: 'token', trusted: true },
      credentialSecret: 'must-not-store',
    })).rejects.toThrow('not authorized by the host');
    expect(fetcher).not.toHaveBeenCalled();
    await expect(readFile(join(userDataPath, 'library-providers.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(userDataPath, 'library-secrets.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects hostnames resolving to private addresses before fetch', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const root = await mkdtemp(join(tmpdir(), 'json-structure-library-dns-'));
    const bundledRoot = join(root, 'bundled');
    const documentPath = join(bundledRoot, 'financial.struct.json');
    await mkdir(bundledRoot, { recursive: true });
    await writeFile(documentPath, '{"definitions":{}}', 'utf8');
    const runtime = await createElectronLibraryRuntime({
      userDataPath: join(root, 'user-data'),
      bundledRoot,
      documentRoot: () => undefined,
      safeStorage: {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'unknown',
        encryptString: (value) => Buffer.from(value),
        decryptString: (value) => value.toString(),
      },
      bundledProvider: {
        id: 'financial-types', kind: 'bundled', location: pathToFileURL(bundledRoot).toString(),
        entries: [{ id: 'financial-types', versions: [{ version: '1', documentUri: pathToFileURL(documentPath).toString(), isDefault: true }] }],
      },
      approve: async () => true,
      fetch: fetcher,
      resolveHost: async () => ['127.0.0.1'],
    });

    await expect(runtime.configureProvider({ id: 'registry', kind: 'xregistry', baseUrl: 'https://registry.test', credentialId: 'token', trusted: true }, 'must-not-store'))
      .rejects.toThrow('private or local network');
    expect(fetcher).not.toHaveBeenCalled();
    await expect(readFile(join(root, 'user-data', 'library-secrets.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('uses bounded JSON-only HTTPS transport and keeps credentials out of provider JSON', async () => {
    const requests: { url: string; authorization?: string }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, authorization: new Headers(init?.headers).get('authorization') ?? undefined });
      const body = url.endsWith('/model') ? { links: [{ href: 'https://registry.test/groups/schemas' }] } : { links: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const { runtime, userDataPath } = await fixture(true, fetcher);
    await dispatchLibraryOperation(runtime, 'configureProvider', { config: { id: 'registry', kind: 'xregistry', baseUrl: 'https://registry.test', credentialId: 'token', credentialScheme: 'Bearer', trusted: true }, credentialSecret: 'secret-value' });
    expect(requests.some((request) => request.authorization === 'Bearer secret-value')).toBe(true);
    expect(await readFile(join(userDataPath, 'library-providers.json'), 'utf8')).not.toContain('secret-value');
    expect(await readFile(join(userDataPath, 'library-secrets.json'), 'utf8')).not.toContain('secret-value');
  });

  it('persists publisher epochs and rejects stale expectedEpoch values', async () => {
    const { runtime, userDataPath } = await fixture();
    await dispatchLibraryOperation(runtime, 'configureProvider', { config: { id: 'local', kind: 'local', location: pathToFileURL(userDataPath).toString(), entries: [], trusted: true } });
    const document = schemaDocument();
    const first = await dispatchLibraryOperation(runtime, 'publish', { providerId: 'local', entryId: 'common', version: '1', document, sourceUri: 'memory:source' }) as { epoch: string };
    expect(first.epoch).toBe('1');
    await expect(dispatchLibraryOperation(runtime, 'listCatalog')).resolves.toContainEqual(expect.objectContaining({
      providerId: 'local', id: 'common', versions: [expect.objectContaining({ version: '1', epoch: '1' })],
    }));
    await expect(dispatchLibraryOperation(runtime, 'resolve', { providerId: 'local', entryId: 'common', selector: { kind: 'pinned', version: '1' }, offline: false }))
      .resolves.toMatchObject({ document, provenance: { providerId: 'local', entryId: 'common', version: '1', sourceUri: 'memory:source' } });
    await expect(dispatchLibraryOperation(runtime, 'publish', { providerId: 'local', entryId: 'common', version: '2', document: schemaDocument('SecondDocument'), sourceUri: 'memory:source', expectedEpoch: '0' })).rejects.toThrow('changed since it was read');
    expect(await readFile(join(userDataPath, 'library-publisher.json'), 'utf8')).toContain('"epoch": "1"');
  });

  it('loads bundled and immutable published import URIs through readResource', async () => {
    const { runtime, userDataPath } = await fixture();
    const bundledEntry = (await dispatchLibraryOperation(runtime, 'listCatalog') as readonly { providerId: string; versions: readonly { documentUri: string }[] }[])[0]!;
    await expect(readResource(bundledEntry.versions[0]!.documentUri, undefined, 4 * 1024 * 1024, (uri) => runtime.readResource(uri)))
      .resolves.toMatchObject({ content: '{"definitions":{}}' });

    const location = pathToFileURL(userDataPath).toString();
    await dispatchLibraryOperation(runtime, 'configureProvider', { config: { id: 'local', kind: 'local', location, entries: [], trusted: true } });
    const source = { ...schemaDocument('Published'), type: 'string' };
    const published = await dispatchLibraryOperation(runtime, 'publish', {
      providerId: 'local', entryId: 'common', version: '1', document: source, sourceUri: 'file:///outside/source.struct.json',
    }) as { versions: Record<string, { uri: string }> };
    source.type = 'number';

    const imported = await readResource(published.versions['1']!.uri, undefined, 4 * 1024 * 1024, (uri) => runtime.readResource(uri));
    expect(JSON.parse(imported.content)).toEqual({ ...schemaDocument('Published'), type: 'string' });
    await expect(readResource('memory://unlisted/resource.json', userDataPath, 1024, (uri) => runtime.readResource(uri)))
      .rejects.toThrow('Only file:');
  });

  it('loads a cached xRegistry import URI without another network request', async () => {
    let online = true;
    let requestCount = 0;
    const fetcher: typeof fetch = async (input) => {
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
    const { runtime } = await fixture(true, fetcher);
    await dispatchLibraryOperation(runtime, 'configureProvider', { config: { id: 'registry', kind: 'xregistry', baseUrl: 'https://registry.test', trusted: true } });
    const resolved = await dispatchLibraryOperation(runtime, 'resolve', {
      providerId: 'registry', entryId: 'remote', selector: { kind: 'pinned', version: '1' }, offline: false,
    }) as { documentUri: string };
    online = false;
    const requestsBeforeRead = requestCount;

    const imported = await readResource(resolved.documentUri, undefined, 4 * 1024 * 1024, (uri) => runtime.readResource(uri));
    expect(JSON.parse(imported.content)).toEqual({ name: 'Remote', type: 'string' });
    expect(requestCount).toBe(requestsBeforeRead);
  });

  it('serializes concurrent publisher CAS writes for one provider', async () => {
    const { runtime, userDataPath } = await fixture();
    await dispatchLibraryOperation(runtime, 'configureProvider', { config: { id: 'local', kind: 'local', location: pathToFileURL(userDataPath).toString(), entries: [], trusted: true } });
    const publish = (version: string) => dispatchLibraryOperation(runtime, 'publish', {
      providerId: 'local', entryId: 'common', version, document: schemaDocument(`Version${version}`), sourceUri: 'memory:source',
    });
    const results = await Promise.allSettled([publish('1'), publish('2')]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ name: 'EpochConflictError' });
  });

  it('serializes concurrent publisher writes across providers sharing one file', async () => {
    const { runtime, userDataPath } = await fixture();
    for (const id of ['local-a', 'local-b']) {
      await dispatchLibraryOperation(runtime, 'configureProvider', { config: { id, kind: 'local', location: pathToFileURL(userDataPath).toString(), entries: [], trusted: true } });
    }
    const originalWriteFile = fs.writeFile.bind(fs);
    let signalFirstWriteStarted!: () => void;
    let releaseFirstWrite!: () => void;
    const firstWriteStarted = new Promise<void>((resolve) => { signalFirstWriteStarted = resolve; });
    const firstWriteRelease = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    let blocked = false;
    const writeSpy = vi.spyOn(fs, 'writeFile').mockImplementation(async (...args) => {
      if (!blocked && String(args[0]).includes('.library-publisher.json.')) {
        blocked = true;
        signalFirstWriteStarted();
        await firstWriteRelease;
      }
      return originalWriteFile(...args);
    });

    try {
      const first = dispatchLibraryOperation(runtime, 'publish', { providerId: 'local-a', entryId: 'first', version: '1', document: schemaDocument('First'), sourceUri: 'memory:first' });
      await firstWriteStarted;
      const second = dispatchLibraryOperation(runtime, 'publish', { providerId: 'local-b', entryId: 'second', version: '1', document: schemaDocument('Second'), sourceUri: 'memory:second' });
      releaseFirstWrite();
      await Promise.all([first, second]);
    } finally {
      writeSpy.mockRestore();
    }

    const state = JSON.parse(await readFile(join(userDataPath, 'library-publisher.json'), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(state).sort()).toEqual(['local-a', 'local-b']);
  });

  it('reports xRegistry publishing as unsupported and rejects publish requests', async () => {
    const fetcher: typeof fetch = async (input) => new Response(JSON.stringify(String(input).endsWith('/model')
      ? { links: [{ href: 'https://registry.test/groups/schemas' }] }
      : { links: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
    const { runtime } = await fixture(true, fetcher);
    await dispatchLibraryOperation(runtime, 'configureProvider', { config: { id: 'registry', kind: 'xregistry', baseUrl: 'https://registry.test', trusted: true } });

    await expect(dispatchLibraryOperation(runtime, 'listProviders')).resolves.toContainEqual(expect.objectContaining({ id: 'registry', publishSupported: false }));
    await expect(dispatchLibraryOperation(runtime, 'publish', { providerId: 'registry', entryId: 'common', version: '1', document: schemaDocument(), sourceUri: 'memory:source' }))
      .rejects.toThrow('does not support publishing');
  });
});