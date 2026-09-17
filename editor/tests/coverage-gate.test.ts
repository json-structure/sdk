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

function validate(mutator: (state: any) => void, checkArtifacts = false): string[] {
  const state = { projectRoot, ...clone(canonical), ledger: clone(canonicalLedger), checkArtifacts };
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
describe('coverage gate scripts', { timeout: 120_000 }, () => {
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
  }, 60_000);
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

  it('fails closed when a required external corpus root is unavailable', () => {
    const errors = validate(({ inventory }) => {
      inventory.corpus.roots[0].path = '..\\missing-required-corpus-root';
    }, true);
    expect(errors.some((error) => error.includes('required corpus root is unreachable'))).toBe(true);
  });

  it('rejects inventory reclassification against the independent diagnostic baseline', () => {
    const errors = validate(({ inventory }) => {
      const pass = inventory.corpus.schemas.find((schema: { readonly expected: string }) => schema.expected === 'pass');
      if (!pass) throw new Error('fixture inventory has no pass entry');
      pass.expected = 'diagnostic';
    }, true);
    expect(errors.some((error) => error.includes('inventory disagrees with authoritative corpus baseline in expected'))).toBe(true);
  });

  it('rejects simultaneous inventory and baseline reclassification', () => {
    const errors = validate(({ inventory, corpusBaseline }) => {
      const fixture = corpusBaseline.fixtures.find((entry: { readonly expected: string }) => entry.expected === 'diagnostic');
      if (!fixture) throw new Error('baseline has no diagnostic entry');
      fixture.expected = 'pass';
      fixture.diagnostics = [];
      const inventoryEntry = inventory.corpus.schemas.find((entry: { readonly id: string }) => entry.id === fixture.id);
      if (!inventoryEntry) throw new Error('inventory has no matching entry');
      inventoryEntry.expected = 'pass';
      inventoryEntry.diagnosticCodes = [];
      inventoryEntry.diagnosticExpectations = [];
    }, true);
    expect(errors.some((error) => error.includes('canonical SHA-256 differs from trusted release integrity manifest'))).toBe(true);
  });

  it('rejects a tampered corpus baseline release anchor', () => {
    const errors = validate(({ corpusBaselineIntegrity }) => {
      corpusBaselineIntegrity.artifact.sha256 = '0'.repeat(64);
    });
    expect(errors.some((error) => error.includes('canonical SHA-256 differs from trusted release integrity manifest'))).toBe(true);
  });

  it('rejects an inconsistent release integrity manifest', () => {
    const errors = validate(({ corpusBaselineIntegrity }) => {
      corpusBaselineIntegrity.artifact.canonicalization = 'raw-json';
      corpusBaselineIntegrity.review.authorizedWorkflow = 'coverage-generation';
    });
    expect(errors).toEqual(expect.arrayContaining([
      'corpus baseline release integrity canonicalization is unsupported',
      'corpus baseline release integrity review metadata is malformed or incomplete'
    ]));
  });

  it('does not let ordinary coverage generation update corpus trust inputs', () => {
    const fixtureRoot = createFixture();
    const baselinePath = path.join(fixtureRoot, 'coverage', 'corpus-baseline.json');
    const integrityPath = path.join(fixtureRoot, 'coverage', 'release-integrity.json');
    const beforeBaseline = readFileSync(baselinePath, 'utf8');
    const beforeIntegrity = readFileSync(integrityPath, 'utf8');
    const generation = spawnSync(process.execPath, [path.join(fixtureRoot, 'scripts', 'generate-coverage.mjs')], {
      cwd: fixtureRoot,
      encoding: 'utf8',
      env: { ...process.env, JSON_STRUCTURE_SPEC_ROOT: canonical.normativeRoot as string }
    });
    expect(generation.status).toBe(0);
    expect(readFileSync(baselinePath, 'utf8')).toBe(beforeBaseline);
    expect(readFileSync(integrityPath, 'utf8')).toBe(beforeIntegrity);
  });

  it('requires an authorization token and review metadata to update the trust anchor', () => {
    const fixtureRoot = createFixture();
    const script = path.join(fixtureRoot, 'scripts', 'update-corpus-baseline-integrity.mjs');
    const withoutToken = { ...process.env };
    delete withoutToken.JSON_STRUCTURE_BASELINE_UPDATE_TOKEN;
    const unauthorized = spawnSync(process.execPath, [script, '--root', fixtureRoot, '--review-id', 'REV-1', '--reason', 'reviewed baseline update', '--approved-by', 'reviewer'], { cwd: fixtureRoot, encoding: 'utf8', env: withoutToken });
    expect(unauthorized.status).not.toBe(0);
    const authorized = spawnSync(process.execPath, [script, '--root', fixtureRoot, '--review-id', 'REV-1', '--reason', 'reviewed baseline update', '--approved-by', 'reviewer'], { cwd: fixtureRoot, encoding: 'utf8', env: { ...withoutToken, JSON_STRUCTURE_BASELINE_UPDATE_TOKEN: 'workflow-issued' } });
    expect(authorized.status).toBe(0);
    const integrity = JSON.parse(readFileSync(path.join(fixtureRoot, 'coverage', 'release-integrity.json'), 'utf8'));
    expect(integrity.review.lastApproved).toEqual({ reviewId: 'REV-1', reason: 'reviewed baseline update', approvedBy: 'reviewer' });
    const inputs = loadCoverageInputs(fixtureRoot, { ...process.env, JSON_STRUCTURE_SPEC_ROOT: canonical.normativeRoot as string });
    expect(validateCoverage({ projectRoot: fixtureRoot, ...inputs, ledger: canonicalLedger, checkArtifacts: false })).not.toContain('canonical SHA-256 differs from trusted release integrity manifest');
  });

  it('rejects tampering with an authoritative diagnostic expectation', () => {
    const errors = validate(({ corpusBaseline }) => {
      const fixture = corpusBaseline.fixtures.find((entry: { readonly expected: string }) => entry.expected === 'diagnostic');
      if (!fixture) throw new Error('baseline has no diagnostic entry');
      fixture.diagnostics[0].pointer = '/tampered';
    }, true);
    expect(errors.some((error) => error.includes('inventory diagnosticExpectations disagree with authoritative baseline'))).toBe(true);
    expect(errors.some((error) => error.includes('canonical SHA-256 differs from trusted release integrity manifest'))).toBe(true);
  });

  it('rejects tampering with a corpus fixture checksum', () => {
    const errors = validate(({ corpusBaseline }) => {
      const fixture = corpusBaseline.fixtures[0];
      fixture.sha256 = '0'.repeat(64);
    }, true);
    expect(errors.some((error) => error.includes('corpus fixture hash differs from authoritative baseline'))).toBe(true);
  });

  it('rejects corpus inventory omissions and count drift', () => {
    const errors = validate(({ inventory }) => {
      inventory.corpus.schemas.pop();
    }, true);
    expect(errors.some((error) => error.includes('unlisted corpus schema'))).toBe(true);
    expect(errors.some((error) => error.includes('corpus total drift'))).toBe(true);
  });
});
