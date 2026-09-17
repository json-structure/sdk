import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();
const routeNames = ['fbs2s', 'j2s', 'json2s', 'xml2s', 'a2s', 'jtd2s', 'cddl2s', 'oas2s', 'cue2s', 'thrift2s', 'smithy2s', 'capnp2s', 'raml2s', 'k2s'];

describe('Structurize runtime packaging contract', () => {
  it('pins every advertised route, native platform, and fbs2s dependency provenance', async () => {
    const lock = JSON.parse(await readFile(join(projectRoot, 'config', 'structurize-runtime.lock.json'), 'utf8'));
    expect(Object.keys(lock.routes)).toEqual(expect.arrayContaining(routeNames));
    expect(lock.python.platforms).toEqual(['win32-x64', 'linux-x64', 'darwin-x64', 'darwin-arm64']);
    expect(lock.python.patch).toBe('3.12.10');
    expect(lock.packages).toHaveLength(77);
    expect(lock.packages.every((entry: { wheels?: Record<string, { url: string; sha256: string }> }) => lock.python.platforms.every((platform: string) => entry.wheels?.[platform]?.url?.startsWith('https://files.pythonhosted.org/') && /^[a-f0-9]{64}$/.test(entry.wheels[platform].sha256)))).toBe(true);
    const fastavro = lock.packages.find((entry: { name: string }) => entry.name === 'fastavro');
    expect(fastavro).toMatchObject({ version: '1.12.2', license: 'MIT' });
    expect(lock.packages.find((entry: { name: string }) => entry.name === 'psycopg2-binary')).toMatchObject({ version: '2.9.12' });
    expect(lock.packages.find((entry: { name: string }) => entry.name === 'PyMySQL')).toMatchObject({ version: '1.2.0' });
    expect(lock.packages.find((entry: { name: string }) => entry.name === 'pymssql')).toMatchObject({ version: '2.3.13' });
    for (const platform of lock.python.platforms) expect(fastavro.wheels[platform]).toMatchObject({ url: expect.stringMatching(/^https:\/\/files\.pythonhosted\.org\//), sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(lock.routes.fbs2s.requiredPackages).toContain('fastavro');
  });

  it('uses semantic smoke instead of help-only checks and requires validated reuse metadata', async () => {
    const smoke = await readFile(join(projectRoot, 'scripts', 'structurize-runtime-smoke.mjs'), 'utf8');
    const prepare = await readFile(join(projectRoot, 'scripts', 'prepare-structurize-runtime.mjs'), 'utf8');
    const worker = await readFile(join(projectRoot, 'src', 'conversion', 'worker-runtime', 'converter-worker.cjs'), 'utf8');
    expect(smoke).toContain('STRUCTURIZE_OFFLINE_ROUTES.length');
    expect(smoke).toContain('k2s=GATED');
    expect(smoke).toContain('assertBridgeResult');
    expect(smoke).not.toContain("await run([route, '--help'])");
    expect(worker).toContain("resolve(__dirname, '..', '..', '..', 'build', 'structurize-runtime')");
    for (const marker of ['sourceFingerprint', 'dependenciesFingerprint', 'requiredFiles', 'runtimeTreeDigest', 'interpreter', 'dependencyLicenses', 'pass --force']) expect(prepare).toContain(marker);
  });

  it('fails clearly when provisioning is attempted without an explicit source checkout', async () => {
    const environment = { ...process.env };
    delete environment.STRUCTURIZE_SOURCE_ROOT;
    delete environment.STRUCTURIZE_WHEELHOUSE;
    const result = spawnSync(process.execPath, [join(projectRoot, 'scripts', 'provision-structurize-runtime.mjs')], { cwd: projectRoot, env: environment, encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('STRUCTURIZE_SOURCE_ROOT');
  });

  it('reports an unsupported platform/runtime instead of using PATH', async () => {
    const emptyRuntime = await mkdtemp(join(tmpdir(), 'json-structure-runtime-empty-'));
    try {
      const environment: NodeJS.ProcessEnv = { ...process.env, STRUCTURIZE_RUNTIME_ROOT: emptyRuntime, STRUCTURIZE_ALLOW_RUNTIME_OVERRIDE: '1', PATH: '', Path: '', PATHEXT: '' };
      delete environment.STRUCTURIZE_EXECUTABLE;
      const result = spawnSync(process.execPath, [join(projectRoot, 'src', 'conversion', 'worker-runtime', 'converter-worker.cjs')], {
        cwd: projectRoot,
        env: environment,
        input: `${JSON.stringify({ type: 'request', requestId: 'unsupported', operationId: 'unsupported', commandId: 'import.structurize.j2s', sourceName: 'schema.json', sourceBase64: Buffer.from('{}').toString('base64'), options: {}, preview: true })}\n`,
        encoding: 'utf8',
      });
      const event = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).find((candidate) => candidate.type === 'error');
      expect(event?.message).toMatch(/PATH fallback is disabled/);
    } finally {
      await rm(emptyRuntime, { recursive: true, force: true });
    }
  });

  it('rejects a partial runtime manifest before executing a conversion', async () => {
    const emptyRuntime = await mkdtemp(join(tmpdir(), 'json-structure-runtime-partial-'));
    const runtimeDirectory = join(emptyRuntime, `${process.platform}-${process.arch}`);
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(join(runtimeDirectory, 'runtime.json'), JSON.stringify({ schemaVersion: 1, kind: 'structurize-runtime', implementation: 'avrotize' }), 'utf8');
    const environment: NodeJS.ProcessEnv = { ...process.env, STRUCTURIZE_RUNTIME_ROOT: emptyRuntime, STRUCTURIZE_ALLOW_RUNTIME_OVERRIDE: '1', PATH: '', Path: '', PATHEXT: '' };
    delete environment.STRUCTURIZE_EXECUTABLE;
    try {
      const result = spawnSync(process.execPath, [join(projectRoot, 'src', 'conversion', 'worker-runtime', 'converter-worker.cjs')], {
        cwd: projectRoot,
        env: environment,
        input: `${JSON.stringify({ type: 'request', requestId: 'partial', operationId: 'partial', commandId: 'import.structurize.j2s', sourceName: 'schema.json', sourceBase64: Buffer.from('{}').toString('base64'), options: {}, preview: true })}\n`,
        encoding: 'utf8',
      });
      const event = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).find((candidate) => candidate.type === 'error');
      expect(event?.message).toMatch(/runtime targets|interpreter metadata is malformed/);
    } finally {
      await rm(emptyRuntime, { recursive: true, force: true });
    }
  });
});
