import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createElectronLibraryRuntime } from '../src/electron/library-runtime.js';
import { dispatchLibraryOperation } from '../src/libraries/host-runtime.js';

async function fixture(encryptionAvailable = true, fetcher: typeof fetch = fetch) {
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
    safeStorage: {
      isEncryptionAvailable: () => encryptionAvailable,
      encryptString: (value) => Buffer.from(`encrypted:${value}`),
      decryptString: (value) => value.toString().replace(/^encrypted:/, ''),
    },
    bundledProvider: {
      id: 'financial-types', kind: 'bundled', location: bundledRoot,
      entries: [{ id: 'financial-types', versions: [{ version: '1', documentUri: pathToFileURL(documentPath).toString(), isDefault: true }] }],
    },
    fetch: fetcher,
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
      .rejects.toThrow('encryption is unavailable');
    await expect(readFile(join(userDataPath, 'library-secrets.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
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
    const first = await dispatchLibraryOperation(runtime, 'publish', { providerId: 'local', entryId: 'common', version: '1', document: {}, sourceUri: 'memory:source' }) as { epoch: string };
    expect(first.epoch).toBe('1');
    await expect(dispatchLibraryOperation(runtime, 'publish', { providerId: 'local', entryId: 'common', version: '2', document: {}, sourceUri: 'memory:source', expectedEpoch: '0' })).rejects.toThrow('changed since it was read');
    expect(await readFile(join(userDataPath, 'library-publisher.json'), 'utf8')).toContain('"epoch": "1"');
  });

  it('serializes concurrent publisher CAS writes for one provider', async () => {
    const { runtime, userDataPath } = await fixture();
    await dispatchLibraryOperation(runtime, 'configureProvider', { config: { id: 'local', kind: 'local', location: pathToFileURL(userDataPath).toString(), entries: [], trusted: true } });
    const publish = (version: string) => dispatchLibraryOperation(runtime, 'publish', {
      providerId: 'local', entryId: 'common', version, document: {}, sourceUri: 'memory:source',
    });
    const results = await Promise.allSettled([publish('1'), publish('2')]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ name: 'EpochConflictError' });
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
    await expect(dispatchLibraryOperation(runtime, 'publish', { providerId: 'registry', entryId: 'common', version: '1', document: {}, sourceUri: 'memory:source' }))
      .rejects.toThrow('does not support publishing');
  });
});