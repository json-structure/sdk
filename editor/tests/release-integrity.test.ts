import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createChecksumManifest, createCycloneDxSbom, createProvenanceStatement, scanArtifacts, stableJson,
  validateCrashReport, validateTelemetryEnvelope, validateTelemetryEvent, verifyUpdateManifest, type UpdateManifest
} from '../src/release/index.js';

const roots: string[] = [];
async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'json-structure-release-'));
  roots.push(root);
  await mkdir(path.join(root, 'nested'));
  await writeFile(path.join(root, 'nested', 'app.txt'), 'release artifact\n');
  return root;
}
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('release integrity foundations', () => {
  it('creates deterministic sorted SHA-256 and SHA-512 manifests without absolute paths', async () => {
    const root = await fixture();
    const file = path.join(root, 'nested', 'app.txt');
    const first = await createChecksumManifest(root, [file]);
    const second = await createChecksumManifest(root, [file]);
    expect(stableJson(first)).toBe(stableJson(second));
    expect(first.artifacts[0]).toMatchObject({ path: 'nested/app.txt', size: 17 });
    expect(first.artifacts[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.artifacts[0]?.sha512).toMatch(/^[a-f0-9]{128}$/);
  });

  it('generates a deterministic minimal CycloneDX SBOM from package metadata and lock entries', () => {
    const sbom = createCycloneDxSbom({ name: '@json-structure/editor', version: '1.2.3' }, { packages: {
      '': { version: '1.2.3' }, 'node_modules/example': { version: '2.0.0', integrity: 'sha512-example', license: 'MIT' }
    } });
    expect(sbom).toMatchObject({ bomFormat: 'CycloneDX', specVersion: '1.5', version: 1 });
    expect(sbom.components).toHaveLength(1);
    expect(sbom.components[0]).toMatchObject({ name: 'example', version: '2.0.0', purl: 'pkg:npm/example@2.0.0' });
    expect(stableJson(sbom)).not.toContain(process.cwd());
  });

  it('creates platform, runtime, tool, source, and artifact provenance without local paths', async () => {
    const root = await fixture();
    const manifest = await createChecksumManifest(root, [path.join(root, 'nested', 'app.txt')]);
    const statement = createProvenanceStatement({
      builderId: 'github-actions', buildType: 'editor-release', invocationId: 'run-42', sourceUri: 'git+https://example.invalid/editor',
      sourceDigest: 'abc123', platform: 'linux', architecture: 'x64', nodeVersion: '22.0.0', toolVersions: { npm: '10.0.0' }, artifacts: manifest.artifacts
    });
    expect(statement).toMatchObject({ predicateType: 'https://slsa.dev/provenance/v1' });
    expect(stableJson(statement)).not.toContain(root);
    expect(() => createProvenanceStatement({ builderId: root, buildType: 'x', invocationId: 'x', sourceUri: 'x', sourceDigest: 'x', platform: 'x', architecture: 'x', nodeVersion: 'x', toolVersions: {}, artifacts: [] })).toThrow('absolute paths');
  });

  it('rejects credentials, absolute build paths, and undeclared executables', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'leak.txt'), 'client_secret=super-secret-value\nC:\\Users\\builder\\work\\app');
    await writeFile(path.join(root, 'worker.exe'), 'binary');
    expect(await scanArtifacts(root)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'leak.txt', rule: 'credential' }),
      expect.objectContaining({ path: 'leak.txt', rule: 'absolute-path' }),
      expect.objectContaining({ path: 'worker.exe', rule: 'undeclared-executable' })
    ]));
    expect((await scanArtifacts(root, ['worker.exe'])).some((finding) => finding.rule === 'undeclared-executable')).toBe(false);
  });

  it('does not treat code references or URL path segments as release leaks', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'bundle.js'), 'this.ui.inputBox.password=this.password;\nconst docs="https://example.test/Home/reference";');
    expect(await scanArtifacts(root)).toEqual([]);
  });

  it('accepts only content-free opt-in telemetry fields and privacy-preserving crash fields', () => {
    expect(validateTelemetryEnvelope({ enabled: false })).toEqual([]);
    expect(validateTelemetryEnvelope({ enabled: false, event: { schemaVersion: 1 } })).toContain('disabled telemetry must not contain an event');
    expect(validateTelemetryEvent({ schemaVersion: 1, event: 'command.completed', host: 'electron', platform: 'win32', appVersion: '1.2.3', outcome: 'success', commandCategory: 'edit' })).toEqual([]);
    expect(validateTelemetryEvent({ schemaVersion: 1, event: 'command.completed', host: 'electron', platform: 'win32', appVersion: '1.2.3', documentContent: '{"secret":true}' })).toContain('telemetry field is not allowed: documentContent');
    expect(validateCrashReport({ schemaVersion: 1, appVersion: '1.2.3', host: 'vscode', platform: 'linux', architecture: 'x64', errorCode: 'E_WORKER', process: 'worker', stackFrames: [{ module: 'worker.js', function: 'run', line: 4 }] })).toEqual([]);
    expect(validateCrashReport({ schemaVersion: 1, document: 'customer schema' })).toEqual(expect.arrayContaining(['crash report field is not allowed: document', 'invalid crash report appVersion']));
  });

  it('requires injected signature verification before verifying update artifact hashes', async () => {
    const root = await fixture();
    const hashes = await createChecksumManifest(root, [path.join(root, 'nested', 'app.txt')]);
    const manifest: UpdateManifest = { schemaVersion: 1, version: '1.2.3', channel: 'stable', publishedAt: '2026-08-31T00:00:00Z', artifacts: hashes.artifacts, signature: { algorithm: 'external', keyId: 'release-1', value: 'signed-value' } };
    let inspected = '';
    expect(await verifyUpdateManifest(manifest, root, (metadata) => { inspected = new TextDecoder().decode(metadata); return true; })).toEqual([]);
    expect(inspected).not.toContain('signed-value');
    expect(await verifyUpdateManifest(manifest, root, () => false)).toEqual(['update metadata signature is invalid']);
    await writeFile(path.join(root, 'nested', 'app.txt'), 'tampered');
    expect(await verifyUpdateManifest(manifest, root, () => true)).toEqual(expect.arrayContaining([expect.stringContaining('mismatch')]));
  });

  it('fails release verification when the corpus trust digest is stale', async () => {
    const root = await fixture();
    const coverage = path.join(root, 'coverage');
    await mkdir(coverage);
    const baseline = { version: 1 };
    const baselineText = JSON.stringify(baseline, null, 2) + '\n';
    await writeFile(path.join(coverage, 'corpus-baseline.json'), baselineText);
    const digest = createHash('sha256').update(baselineText, 'utf8').digest('hex');
    await writeFile(path.join(coverage, 'release-integrity.json'), JSON.stringify({
      schemaVersion: 1,
      artifact: { path: 'coverage/corpus-baseline.json', version: 1, canonicalization: 'json-stable-v1', sha256: digest },
      review: { version: 1, status: 'independent-review-required', changePolicy: 'separate review', authorizedWorkflow: 'coverage-baseline-update', tokenEnvironment: 'JSON_STRUCTURE_BASELINE_UPDATE_TOKEN', requiredMetadata: ['reviewId', 'reason', 'approvedBy'] }
    }, null, 2) + '\n');
    const script = path.join(process.cwd(), 'scripts', 'release-integrity.mjs');
    expect(spawnSync(process.execPath, [script, 'scan', root], { encoding: 'utf8' }).status).toBe(0);
    await writeFile(path.join(coverage, 'corpus-baseline.json'), JSON.stringify({ version: 1, changed: true }, null, 2) + '\n');
    const stale = spawnSync(process.execPath, [script, 'scan', root], { encoding: 'utf8' });
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain('canonical SHA-256 differs from release integrity manifest');
  });

  it('runs the release script contract against generated artifacts', async () => {
    const source = await readFile(path.join(process.cwd(), 'scripts', 'release-integrity.mjs'), 'utf8');
    expect(source).toContain("['scan', 'manifest', 'executables', 'attest']");
    expect(source).toContain('sbom.cdx.json');
    expect(source).toContain('provenance.intoto.json');
    expect([...source.matchAll(/from ['"]([^'"]+)['"]/g)].map((match) => match[1])).toEqual(['node:crypto', 'node:fs/promises', 'node:path', 'node:url']);

    const root = await fixture();
    const script = path.join(process.cwd(), 'scripts', 'release-integrity.mjs');
    const scan = spawnSync(process.execPath, [script, 'scan', root], { encoding: 'utf8' });
    expect(scan.status).toBe(0);
    await mkdir(path.join(root, 'win-unpacked'));
    await writeFile(path.join(root, 'win-unpacked', 'JSON Structure Editor.exe'), 'fixture');
    expect(spawnSync(process.execPath, [script, 'executables', root], { encoding: 'utf8' }).status).toBe(0);
    const nativeExtensions = ['exe', 'dll', 'pyd', 'so', 'dylib', 'node', 'AppImage', 'MSI'];
    for (const extension of nativeExtensions) await writeFile(path.join(root, `rogue.${extension}`), 'fixture');
    const rogueScan = spawnSync(process.execPath, [script, 'scan', root], { encoding: 'utf8' });
    expect(rogueScan.status).toBe(1);
    expect(rogueScan.stderr).toContain('rogue.exe: undeclared executable');
    expect(rogueScan.stderr).toContain('rogue.dll: undeclared executable');
    expect(rogueScan.stderr).toContain('rogue.pyd: undeclared executable');
    for (const extension of nativeExtensions.slice(3)) expect(rogueScan.stderr).toContain(`rogue.${extension}: undeclared executable`);
    expect(spawnSync(process.execPath, [script, 'executables', root], { encoding: 'utf8' }).status).toBe(1);
    for (const extension of nativeExtensions) await rm(path.join(root, `rogue.${extension}`));
    await rm(path.join(root, 'win-unpacked'), { recursive: true, force: true });
    const manifest = spawnSync(process.execPath, [script, 'manifest', root], { encoding: 'utf8' });
    expect(manifest.status).toBe(0);
    const checksums = JSON.parse(await readFile(path.join(root, 'checksums.json'), 'utf8'));
    expect(checksums.artifacts).toEqual([expect.objectContaining({ path: 'nested/app.txt' })]);
  });

  it('fails closed when the checked-in native allowlist is tampered', async () => {
    const root = await fixture();
    const allowlistPath = path.join(process.cwd(), 'config', 'native-artifact-allowlist.json');
    const original = await readFile(allowlistPath, 'utf8');
    try {
      await writeFile(allowlistPath, `${original}\n`);
      const result = spawnSync(process.execPath, [path.join(process.cwd(), 'scripts', 'release-integrity.mjs'), 'scan', root], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('allowlist digest is not independently anchored');
    } finally {
      await writeFile(allowlistPath, original, 'utf8');
    }
  });
});
