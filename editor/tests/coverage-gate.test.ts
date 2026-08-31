import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadCoverageInputs, readJson, validateCoverage } from '../src/coverage-contract.mjs';
const projectRoot = process.cwd();
const temporaryRoots: string[] = [];
let canonical: ReturnType<typeof loadCoverageInputs>;
let canonicalLedger: any;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function validate(mutator: (state: any) => void): string[] {
  const state = { projectRoot, ...clone(canonical), ledger: clone(canonicalLedger), checkArtifacts: false };
  mutator(state);
  return validateCoverage(state);
}

function createFixture(): string {
  const fixtureRoot = mkdtempSync(path.join(projectRoot, '.json-structure-coverage-'));
  temporaryRoots.push(fixtureRoot);
  for (const directory of ['coverage', 'scripts', 'src', 'tests']) cpSync(path.join(projectRoot, directory), path.join(fixtureRoot, directory), { recursive: true });
  return fixtureRoot;
}

function runCheck(fixtureRoot: string): string {
  const result = spawnSync(process.execPath, [path.join(fixtureRoot, 'scripts', 'coverage-check.mjs')], {
    cwd: fixtureRoot,
    encoding: 'utf8',
    env: { ...process.env, JSON_STRUCTURE_SPEC_ROOT: canonical.normativeRoot as string }
  });
  expect(result.status).not.toBe(0);
  return `${result.stdout}${result.stderr}`;
}

beforeAll(() => {
  canonical = loadCoverageInputs(projectRoot);
  canonicalLedger = readJson(path.join(projectRoot, 'coverage', 'generated', 'ledger.json'));
});
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe('coverage gate scripts', { timeout: 15_000 }, () => {
  it('accepts the deterministic inventory, evidence, and generated artifacts', () => {
    expect(() => execFileSync(process.execPath, [path.join(projectRoot, 'scripts', 'coverage-check.mjs')], {
      cwd: projectRoot,
      stdio: 'pipe'
    })).not.toThrow();
  });

  it('rejects missing, extra, and duplicate ledger IDs', () => {
  const missing = validate(({ ledger }) => ledger.features.shift());
  expect(missing.some((error) => error.includes('missing normative inventory record'))).toBe(true);

  const extra = validate(({ ledger }) => ledger.features.push({ ...ledger.features[0], id: 'extra.requirement' }));
  expect(extra).toContain('extra ledger record: extra.requirement');

  const duplicate = validate(({ ledger }) => ledger.features.push(clone(ledger.features[0])));
  expect(duplicate.some((error) => error.includes('duplicate ledger ID'))).toBe(true);
  });

  it('rejects missing and unexpected generated artifacts and source-root artifacts', () => {
  const fixtureRoot = createFixture();
  unlinkSync(path.join(fixtureRoot, 'coverage', 'generated', 'gaps.json'));
  writeFileSync(path.join(fixtureRoot, 'coverage', 'generated', 'extra.json'), '{}\n');
  writeFileSync(path.join(fixtureRoot, 'coverage', 'legacy.json'), '{}\n');
  const output = runCheck(fixtureRoot);
  expect(output).toContain('missing generated spec artifact: coverage/generated/gaps.json');
    expect(output).toContain('unexpected generated spec artifact: coverage/generated/extra.json');
    expect(output).toContain('unexpected spec coverage source artifact: coverage/legacy.json');
  });
  it('rejects stale deterministic output', () => {
    const fixtureRoot = createFixture();
    const coveragePath = path.join(fixtureRoot, 'coverage', 'generated', 'COVERAGE.md');
    writeFileSync(coveragePath, `${readFileSync(coveragePath, 'utf8')}stale\n`);
    expect(runCheck(fixtureRoot)).toContain('coverage/generated/COVERAGE.md is stale');
  });
  it('rejects inventory, manifest, and ledger contract-version drift', () => {
    const errors = validate((state) => {
      state.inventory.version = 4;
      state.manifest.version = 4;
      state.ledger.policy.version = 4;
    });
    expect(errors).toEqual(expect.arrayContaining([
      'inventory version must be 5',
      'evidence manifest version must be 5',
      'ledger policy version must be 5'
    ]));
  });
  it('rejects altered specification, exact anchor, and requirement text', () => {
    const errors = validate((state) => {
      state.ledger.features[0].spec = 'Other';
      state.ledger.features[0].requirement = 'altered';
      state.records[0].normativeSources[0].anchor = '#not-a-real-heading';
    });
  expect(errors.some((error) => error.includes('source-contract drift in spec'))).toBe(true);
  expect(errors.some((error) => error.includes('source-contract drift in requirement'))).toBe(true);
  expect(errors.some((error) => error.includes('missing or stale exact normative heading anchor'))).toBe(true);
  });

  it('rejects an unreachable normative root', () => {
  const fixtureRoot = createFixture();
  const inventoryPath = path.join(fixtureRoot, 'coverage', 'inventory.json');
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
  inventory.normativeRoot = './missing-specifications';
  writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
  expect(() => loadCoverageInputs(fixtureRoot, {})).toThrow('normative specification root is unreachable');
  });

  it('rejects missing, duplicate, unknown, and unrelated evidence IDs', () => {
  const missing = validate(({ ledger }) => { ledger.features[0].evidence.editing.ids = []; });
  expect(missing.some((error) => error.includes('malformed editing evidence'))).toBe(true);

  const duplicate = validate(({ manifest }) => manifest.evidence.push(clone(manifest.evidence[0])));
  expect(duplicate.some((error) => error.includes('duplicate or malformed evidence ID'))).toBe(true);

  const unknown = validate(({ ledger }) => { ledger.features[0].evidence.editing.ids = ['unknown.evidence']; });
  expect(unknown.some((error) => error.includes('missing, duplicate, or unrelated editing evidence ID unknown.evidence'))).toBe(true);
    const unrelated = validate(({ ledger }) => { ledger.features[0].evidence.editing.ids = clone(ledger.features[1].evidence.editing.ids); });
    expect(unrelated.some((error) => error.includes('missing, duplicate, or unrelated editing evidence ID'))).toBe(true);
  });
  it('rejects evidence mapped to an unknown requirement', () => {
    const errors = validate(({ manifest }) => { manifest.evidence[0].requirements = ['unknown.requirement']; });
    expect(errors.some((error) => error.includes('evidence maps to unknown requirement unknown.requirement'))).toBe(true);
  });

  it('rejects false complete claims across dimensions and facets', () => {
  const errors = validate(({ ledger }) => { ledger.features[0].status = 'complete'; });
  expect(errors.some((error) => error.includes('false complete claim for editing'))).toBe(true);
  expect(errors.some((error) => error.includes('false complete claim for positive'))).toBe(true);
  });

  it('rejects malformed and facet-unrelated test evidence', () => {
    const malformed = validate(({ ledger }) => { ledger.features[0].evidence.tests.facets.hostParity = { status: 'later', ids: [] }; });
    expect(malformed.some((error) => error.includes('malformed hostParity test facet'))).toBe(true);

    const unrelated = validate(({ ledger }) => { ledger.features[0].evidence.tests.facets.positive.ids = clone(ledger.features[0].evidence.tests.facets.negative.ids); });
    expect(unrelated.some((error) => error.includes('missing, duplicate, or unrelated positive evidence ID'))).toBe(true);
  });
});
