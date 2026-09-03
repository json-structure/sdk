import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const CONTRACT_VERSION = 5;
export const STATUSES = Object.freeze(['complete', 'partial', 'gap', 'unsupported', 'pending']);
export const DIMENSIONS = Object.freeze(['editing', 'inspection', 'diagnostics', 'roundtrip', 'tests']);
export const TEST_FACETS = Object.freeze(['positive', 'negative', 'incomplete', 'hostParity']);
export const GENERATED_FILES = Object.freeze(['COVERAGE.md', 'gaps.json', 'ledger.json']);
export const SOURCE_FILES = Object.freeze(['corpus-baseline.json', 'evidence-manifest.json', 'inventory.json', 'performance-baseline.json', 'release-integrity.json']);
export const CORPUS_BASELINE_TRUST_FILE = 'coverage/release-integrity.json';
const TRUST_MANIFEST_VERSION = 1;
const CANONICAL_JSON_VERSION = 'json-stable-v1';

const ID_PATTERN = /^[a-z][A-Za-z0-9.-]+$/;
const ANCHOR_PATTERN = /^#[A-Za-z][A-Za-z0-9._:-]*$/;
const SOURCE_PATTERN = /^(?![/\\])(?!.*(?:^|[/\\])\.\.(?:[/\\]|$))[^:]+\.md$/;
const CORPUS_ROOT_PATHS = Object.freeze({
  'real-corpus': path.normalize('..\\..\\json-structure\\primer-and-samples'),
  'sdk-assets': path.normalize('..\\test-assets'),
  avrotize: path.normalize('..\\..\\avrotize\\test\\struct')
});

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function normalizeJson(value) {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort((left, right) => left < right ? -1 : left > right ? 1 : 0).map((key) => [key, normalizeJson(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(normalizeJson(value), null, 2)}\n`;
}

export function canonicalJsonSha256(value) {
  return crypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export function resolveNormativeRoot(projectRoot, inventory, environment = process.env) {
  const candidates = [environment.JSON_STRUCTURE_SPEC_ROOT, inventory.normativeRoot && path.resolve(projectRoot, inventory.normativeRoot)]
    .filter((candidate) => typeof candidate === 'string' && candidate.length > 0);
  for (const candidate of candidates) {
    const root = path.resolve(candidate);
    const sources = Object.values(inventory.specs ?? {});
    if (sources.length > 0 && sources.every((source) => SOURCE_PATTERN.test(source) && fs.existsSync(path.join(root, source)))) return root;
  }
  throw new Error(`normative specification root is unreachable; configure JSON_STRUCTURE_SPEC_ROOT or inventory.normativeRoot (checked: ${candidates.map((candidate) => path.resolve(candidate)).join(', ') || 'none'})`);
}

export function parseHeadingAnchors(markdown) {
  return new Set([...markdown.matchAll(/^#{1,6}\s+.+?\s+\{(#[A-Za-z][A-Za-z0-9._:-]*)\}\s*$/gm)].map((match) => match[1]));
}

const parsedEvidenceFilesCache = new Map();
const exportedSymbolResults = new WeakMap();
const testNameResults = new WeakMap();

const FALLBACK_ANCHORS = Object.freeze({
  'core.schema': '#schema-elements', 'core.type': '#data-types', 'core.compound': '#compound-types',
  'core.document': '#document-structure', 'core.rule': '#schema-declarations', 'core.keyword': '#structural-keywords',
  'core.annotation': '#type-annotation-keywords', 'alternate-names': '#keywords', 'conditional-composition': '#conditional-composition-keywords',
  import: '#import-and-importdefs-keywords', relations: '#relations', units: '#symbol-annotations', validation: '#validation-keywords',
  model: '#annotation-model', concepts: '#concepts', observation: '#observation-annotations', binding: '#coded-value-annotations',
  temporal: '#temporal-reference-annotations', spatial: '#spatial-reference-annotations', media: '#colorimetric-reference-annotations', processing: '#processing-conformance'
});
const TRAILING_QUALIFIERS = /-(?:wire|range|lexical|default|form|value|values|placement|required|resolution|evaluation|effect|types|type|only|map|array|scalar|string|boolean|presence|processing|compatibility|prohibition|invariance|unique|nonempty|contents|uri|valid|numeric|reference|keyword|closed|open)$/;

function selectAnchor(id, suffix, requirement, prefix, explicitAnchor, available) {
  if (explicitAnchor) return explicitAnchor;
  const tokens = [suffix, id.split('.').at(-1), ...[...requirement.matchAll(/`([^`]+)`/g)].map((match) => match[1])];
  for (const token of tokens) {
    let normalized = String(token).replace(/^\$/, '').replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).replace(/[^A-Za-z0-9-]/g, '-');
    while (normalized) {
      for (const candidate of [`#${normalized}`, `#${normalized}-keyword`, `#the-${normalized}-keyword`]) if (available.has(candidate)) return candidate;
      const shorter = normalized.replace(TRAILING_QUALIFIERS, '');
      if (shorter === normalized) break;
      normalized = shorter;
    }
  }
  if (prefix === 'core.rule' && suffix.startsWith('union-')) return '#unions';
  if (prefix === 'core.rule' && suffix.startsWith('identifier-')) return '#identifier-rules';
  if (prefix === 'media' && suffix.startsWith('audio-')) return '#audio-channels';
  if (prefix === 'media' && suffix.startsWith('spectral-')) return '#spectral-bands';
  if (prefix === 'media' && suffix.startsWith('color-')) return '#color-spaces';
  return FALLBACK_ANCHORS[prefix];
}

export function expandInventory(inventory, anchorsBySpec) {
  const expand = (family, policy = 'normative') => Object.entries(family.items ?? {}).map(([suffix, item]) => {
    const value = typeof item === 'string' ? { requirement: item } : item;
    const id = `${family.prefix}.${suffix}`;
    const specs = family.specs ?? [family.spec];
    const normativeSources = specs.map((spec) => ({
      spec,
      source: inventory.specs?.[spec],
      anchor: selectAnchor(id, suffix, value.requirement, family.prefix, value.anchors?.[spec] ?? value.anchor ?? family.anchors?.[spec] ?? family.anchor, anchorsBySpec.get(spec) ?? new Set())
    }));
    return {
      id, spec: specs.length === 1 ? specs[0] : specs.join(' + '), normativeSources,
      category: value.category ?? suffix, policy: value.policy ?? policy,
      reconciliation: value.reconciliation ?? family.reconciliation ?? (policy === 'shared'
        ? 'Independent anchor comparison found equivalent normative behavior in both drafts; one shared editor requirement applies to both sources.'
        : null),
      requirement: value.requirement
    };
  });
  return [
    ...(inventory.families ?? []).flatMap((family) => expand(family)),
    ...(inventory.sharedSemanticFamilies ?? []).flatMap((family) => expand({ ...family, specs: ['Characteristics', 'Semantic Annotations'] }, 'shared')),
    ...(inventory.deltas ?? []).flatMap((family) => expand(family, 'delta'))
  ];
}

function evidenceApplies(entry, requirementId, dimension, facet) {
  return entry && entry.requirements.includes(requirementId) && entry.dimensions.includes(dimension) && (!facet || entry.facet === facet);
}

function sourceFile(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function hasExportedSymbol(parsedSource, symbol) {
  const matches = [];
  const visit = (node) => {
    const exported = ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (exported && 'name' in node && node.name && ts.isIdentifier(node.name) && node.name.text === symbol) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(parsedSource);
  return matches.length === 1;
}

function hasTestName(parsedSource, testName) {
  let matches = 0;
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['it', 'test'].includes(node.expression.text)) {
      const title = node.arguments[0];
      if (title && (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title)) && title.text === testName) matches++;
    }
    ts.forEachChild(node, visit);
  };
  visit(parsedSource);
  return matches === 1;
}

function cachedHasExportedSymbol(parsedSource, symbol) {
  let results = exportedSymbolResults.get(parsedSource);
  if (!results) {
    results = new Map();
    exportedSymbolResults.set(parsedSource, results);
  }
  if (!results.has(symbol)) results.set(symbol, hasExportedSymbol(parsedSource, symbol));
  return results.get(symbol);
}

function cachedHasTestName(parsedSource, testName) {
  let results = testNameResults.get(parsedSource);
  if (!results) {
    results = new Map();
    testNameResults.set(parsedSource, results);
  }
  if (!results.has(testName)) results.set(testName, hasTestName(parsedSource, testName));
  return results.get(testName);
}
export function loadCoverageInputs(projectRoot, environment = process.env) {
  const inventory = readJson(path.join(projectRoot, 'coverage', 'inventory.json'));
  const manifest = readJson(path.join(projectRoot, 'coverage', 'evidence-manifest.json'));
  const corpusBaseline = readJson(path.join(projectRoot, 'coverage', 'corpus-baseline.json'));
  const corpusBaselineIntegrity = readJson(path.join(projectRoot, CORPUS_BASELINE_TRUST_FILE));
  const performanceBaseline = readJson(path.join(projectRoot, 'coverage', 'performance-baseline.json'));
  const normativeRoot = resolveNormativeRoot(projectRoot, inventory, environment);
  const anchorsBySpec = new Map();
  for (const [spec, source] of Object.entries(inventory.specs ?? {})) anchorsBySpec.set(spec, parseHeadingAnchors(fs.readFileSync(path.join(normativeRoot, source), 'utf8')));
  const records = expandInventory(inventory, anchorsBySpec);
  return { inventory, manifest: expandEvidenceManifest(manifest, records), corpusBaseline, corpusBaselineIntegrity, performanceBaseline, normativeRoot, anchorsBySpec, records };
}

export function expandEvidenceManifest(manifest, records) {
  const evidence = [];
  for (const rule of manifest.rules ?? []) {
    const matched = records.filter((record) => rule.requirementPrefixes?.some((prefix) => record.id.startsWith(prefix)) ?? rule.requirements?.includes(record.id));
    for (const record of matched) evidence.push({
      ...rule,
      id: `${rule.idPrefix}.${record.id}`,
      requirements: [record.id]
    });
  }
  return { ...manifest, evidence: [...(manifest.evidence ?? []), ...evidence] };
}

function corpusFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.endsWith('.struct.json')) files.push(file);
    }
  };
  visit(root);
  return files.sort();
}

function validateCorpusInventory(projectRoot, inventory, errors) {
  const corpus = inventory.corpus;
  if (corpus === undefined) return;
  if (corpus.version !== 1) errors.push('corpus inventory version must be 1');
  if (!Array.isArray(corpus.roots) || !Array.isArray(corpus.schemas)) {
    errors.push('corpus inventory must contain roots and schemas arrays');
    return;
  }
  if (!Array.isArray(corpus.required) || corpus.required.some((id) => typeof id !== 'string')) errors.push('corpus inventory required must be a string array');
  const roots = new Map();
  for (const root of corpus.roots) {
    if (typeof root?.source !== 'string' || typeof root.path !== 'string' || root.pattern !== '**/*.struct.json') {
      errors.push('corpus inventory contains a malformed root');
      continue;
    }
    if (roots.has(root.source)) errors.push(`duplicate corpus root: ${root.source}`);
    if (CORPUS_ROOT_PATHS[root.source] && path.normalize(root.path) !== CORPUS_ROOT_PATHS[root.source]) errors.push(`corpus root path is not the required real root: ${root.source}`);
    roots.set(root.source, path.resolve(projectRoot, root.path));
  }
  const missingRoots = [...roots.entries()].filter(([, root]) => !fs.existsSync(root) || !fs.statSync(root).isDirectory());
  for (const [source, root] of missingRoots) errors.push(`required corpus root is unreachable: ${source} (${root})`);
  if (missingRoots.length > 0) return;
  const listed = new Map();
  const ids = new Set();
  for (const schema of corpus.schemas) {
    if (typeof schema?.id !== 'string' || typeof schema.path !== 'string' || !roots.has(schema.source) || !['pass', 'diagnostic'].includes(schema.expected)) {
      errors.push(`malformed corpus schema entry: ${schema?.id ?? '<missing>'}`);
      continue;
    }
    if (!['valid-fixture', 'invalid-fixture', 'profile-drift', 'import-drift', 'avrotize-fixture'].includes(schema.profile)) errors.push(`${schema.id}: invalid corpus profile classification`);
    if (!Array.isArray(schema.diagnosticCodes) || !Array.isArray(schema.diagnosticExpectations)) errors.push(`${schema.id}: missing precise diagnostic expectations`);
    if (ids.has(schema.id)) errors.push(`duplicate corpus schema ID: ${schema.id}`);
    ids.add(schema.id);
    if (schema.expected === 'pass' && schema.diagnosticExpectations?.length > 0) errors.push(`${schema.id}: pass expectation cannot carry diagnostics`);
    if (schema.expected === 'diagnostic' && schema.diagnosticExpectations?.length === 0) errors.push(`${schema.id}: diagnostic expectation must name precise diagnostics`);
    if (listed.has(schema.path)) errors.push(`duplicate corpus schema path: ${schema.path}`);
    listed.set(schema.path, schema);
    const absolute = path.resolve(projectRoot, schema.path);
    if (!fs.existsSync(absolute)) errors.push(`${schema.id}: missing corpus schema ${schema.path}`);
    const relative = path.relative(roots.get(schema.source), absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) errors.push(`${schema.id}: corpus schema is outside its declared root`);
  }
  for (const [source, root] of roots) {
    const actual = new Set(corpusFiles(root).map((file) => path.relative(projectRoot, file)));
    const expected = new Set([...listed.values()].filter((schema) => schema.source === source).map((schema) => path.normalize(schema.path)));
    for (const file of actual) if (!expected.has(path.normalize(file))) errors.push(`unlisted corpus schema: ${file}`);
    for (const file of expected) if (!actual.has(file)) errors.push(`missing corpus inventory path: ${file}`);
    const declared = corpus.counts?.[source];
    if (declared !== undefined && declared !== actual.size) errors.push(`corpus count drift for ${source}: declared ${declared}, found ${actual.size}`);
  }
  if (corpus.counts?.total !== undefined && corpus.counts.total !== corpus.schemas.length) errors.push(`corpus total drift: declared ${corpus.counts.total}, listed ${corpus.schemas.length}`);
  if (corpus.counts?.expected) for (const expected of ['pass', 'diagnostic']) {
    const count = corpus.schemas.filter((schema) => schema.expected === expected).length;
    if (corpus.counts.expected[expected] !== count) errors.push(`corpus expected count drift for ${expected}: declared ${corpus.counts.expected[expected]}, listed ${count}`);
  }
  for (const id of Array.isArray(corpus.required) ? corpus.required : []) if (!corpus.schemas.some((schema) => schema.id === id)) errors.push(`missing required corpus schema: ${id}`);
}
function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function validatePerformanceBaseline(projectRoot, baseline, errors) {
  if (!baseline || baseline.version !== 1 || typeof baseline.review !== 'object' || typeof baseline.review.changePolicy !== 'string' || baseline.review.changePolicy.trim() === '' || typeof baseline.methodology !== 'object' || !baseline.fixture || typeof baseline.fixture.path !== 'string' || typeof baseline.fixture.sha256 !== 'string' || !baseline.measurement) {
    errors.push('performance baseline is malformed');
    return;
  }
  const expectedPath = path.normalize('..\\..\\avrotize\\test\\jsons\\kubernetes-definitions-ref.struct.json');
  if (baseline.fixture.source !== 'avrotize') errors.push('performance baseline must use the avrotize fixture source');
  if (path.normalize(baseline.fixture.path) !== expectedPath) errors.push(`performance baseline must use supplied real fixture ${expectedPath}`);
  if (!/^[a-f0-9]{64}$/i.test(baseline.fixture.sha256)) errors.push('performance baseline fixture hash is malformed');
  const fixturePath = path.resolve(projectRoot, baseline.fixture.path);
  if (!fs.existsSync(fixturePath)) errors.push(`performance baseline fixture is unreachable: ${fixturePath}`);
  else if (sha256File(fixturePath) !== baseline.fixture.sha256) errors.push('performance baseline fixture hash differs from supplied fixture');
  for (const field of ['sourceBytes', 'nodeCount', 'definitionCount', 'diagnosticCount', 'jsonTraversalCount', 'modelTraversalCount', 'operationCount', 'allocationCount']) {
    if (!Number.isInteger(baseline.measurement[field]) || baseline.measurement[field] < 0) errors.push(`performance baseline measurement ${field} is malformed`);
  }
  for (const [field, expected] of Object.entries({ maxSourceBytes: 600000, maxDefinitions: 5000, maxOperationCount: 8000000, maxAllocationCount: 250000, maxWallClockMs: 15000 })) {
    if (baseline.budget?.[field] !== expected) errors.push(`performance baseline budget drift in ${field}`);
  }
  if (typeof baseline.methodology.parseProjection !== 'string' || typeof baseline.methodology.conversion !== 'string' || typeof baseline.methodology.render !== 'string') errors.push('performance baseline methodology must separate parse/projection, conversion, and render');
}

function validateCorpusBaselineIntegrity(projectRoot, baseline, integrity, errors) {
  if (!integrity || integrity.schemaVersion !== TRUST_MANIFEST_VERSION || typeof integrity.review !== 'object' || !integrity.artifact || typeof integrity.artifact !== 'object') {
    errors.push('corpus baseline release integrity manifest is malformed');
    return;
  }
  const review = integrity.review;
  if (review.version !== TRUST_MANIFEST_VERSION || review.status !== 'independent-review-required' || typeof review.changePolicy !== 'string' || review.changePolicy.trim() === '' || review.authorizedWorkflow !== 'coverage-baseline-update' || review.tokenEnvironment !== 'JSON_STRUCTURE_BASELINE_UPDATE_TOKEN' || JSON.stringify(review.requiredMetadata) !== JSON.stringify(['reviewId', 'reason', 'approvedBy'])) {
    errors.push('corpus baseline release integrity review metadata is malformed or incomplete');
  }
  const artifact = integrity.artifact;
  if (artifact.path !== 'coverage/corpus-baseline.json') errors.push('corpus baseline release integrity artifact path is invalid');
  if (artifact.version !== baseline?.version) errors.push('corpus baseline release integrity version is inconsistent with the baseline');
  if (artifact.canonicalization !== CANONICAL_JSON_VERSION) errors.push('corpus baseline release integrity canonicalization is unsupported');
  if (typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) {
    errors.push('corpus baseline release integrity SHA-256 is malformed');
  } else {
    const trustedDigest = artifact.sha256.toLowerCase();
    if (canonicalJsonSha256(baseline) !== trustedDigest) errors.push('corpus baseline canonical SHA-256 differs from trusted release integrity manifest');
    const baselinePath = path.join(projectRoot, 'coverage', 'corpus-baseline.json');
    if (artifact.path === 'coverage/corpus-baseline.json' && fs.existsSync(baselinePath)) {
      try {
        if (canonicalJsonSha256(readJson(baselinePath)) !== trustedDigest) errors.push('on-disk corpus baseline canonical SHA-256 differs from trusted release integrity manifest');
      } catch {
        errors.push('on-disk corpus baseline is not valid JSON for trust verification');
      }
    }
  }
}

function validateCorpusBaseline(projectRoot, inventory, baseline, errors) {
  if (!baseline || baseline.version !== 1 || typeof baseline.review !== 'object' || typeof baseline.review.changePolicy !== 'string' || baseline.review.changePolicy.trim() === '' || typeof baseline.methodology !== 'string' || baseline.methodology.trim() === '' || !Array.isArray(baseline.roots) || !Array.isArray(baseline.fixtures)) {
    errors.push('corpus diagnostic baseline must contain version 1 roots and fixtures');
    return;
  }
  const inventoryRoots = new Map((inventory.corpus?.roots ?? []).map((root) => [root.source, root]));
  const baselineRoots = new Map();
  for (const root of baseline.roots) {
    if (typeof root?.source !== 'string' || typeof root.path !== 'string' || root.pattern !== '**/*.struct.json' || baselineRoots.has(root.source)) {
      errors.push('corpus diagnostic baseline contains a malformed or duplicate root');
      continue;
    }
    baselineRoots.set(root.source, root);
    const inventoryRoot = inventoryRoots.get(root.source);
    if (!inventoryRoot || inventoryRoot.path !== root.path || inventoryRoot.pattern !== root.pattern) errors.push(`corpus baseline root drift: ${root.source}`);
  }
  for (const source of inventoryRoots.keys()) if (!baselineRoots.has(source)) errors.push(`corpus baseline is missing root: ${source}`);
  if ([...inventoryRoots.values()].some((root) => !fs.existsSync(path.resolve(projectRoot, root.path)))) return;
  const inventoryById = new Map((inventory.corpus?.schemas ?? []).map((schema) => [schema.id, schema]));
  const baselineById = new Map();
  const expectedCategories = new Set(['valid-fixture', 'invalid-fixture', 'profile-drift', 'import-drift', 'avrotize-fixture']);
  for (const fixture of baseline.fixtures) {
    if (typeof fixture?.id !== 'string' || typeof fixture.source !== 'string' || typeof fixture.path !== 'string' || !['pass', 'diagnostic'].includes(fixture.expected) || !Array.isArray(fixture.diagnostics) || !expectedCategories.has(fixture.category) || typeof fixture.justification !== 'string' || fixture.justification.trim() === '' || !/^[a-f0-9]{64}$/i.test(fixture.sha256)) {
      errors.push(`malformed corpus baseline fixture: ${fixture?.id ?? '<missing>'}`);
      continue;
    }
    if (baselineById.has(fixture.id)) errors.push(`duplicate corpus baseline fixture: ${fixture.id}`);
    baselineById.set(fixture.id, fixture);
    const inventoryEntry = inventoryById.get(fixture.id);
    if (!inventoryEntry) {
      errors.push(`corpus baseline fixture is not inventoried: ${fixture.id}`);
      continue;
    }
    for (const field of ['source', 'path', 'expected', 'profile']) {
      const baselineValue = field === 'profile' ? fixture.category : fixture[field];
      if (inventoryEntry[field] !== baselineValue) errors.push(`${fixture.id}: inventory disagrees with authoritative corpus baseline in ${field}`);
    }
    const absolute = path.resolve(projectRoot, fixture.path);
    if (!fs.existsSync(absolute)) errors.push(`${fixture.id}: missing corpus baseline fixture ${fixture.path}`);
    else if (sha256File(absolute) !== fixture.sha256) errors.push(`${fixture.id}: corpus fixture hash differs from authoritative baseline`);
    const seenDiagnostics = new Set();
    for (const diagnostic of fixture.diagnostics) {
      if (typeof diagnostic?.code !== 'string' || typeof diagnostic.pointer !== 'string' || (!diagnostic.pointer.startsWith('/') && diagnostic.pointer !== '')) errors.push(`${fixture.id}: malformed authoritative diagnostic`);
      const key = `${diagnostic?.code ?? ''}@${diagnostic?.pointer ?? ''}`;
      if (seenDiagnostics.has(key)) errors.push(`${fixture.id}: duplicate authoritative diagnostic ${key}`);
      seenDiagnostics.add(key);
    }
    const baselineCodes = [...new Set(fixture.diagnostics.map((diagnostic) => diagnostic.code))];
    const baselineExpectations = fixture.diagnostics.map((diagnostic) => `${diagnostic.code}@${diagnostic.pointer}`);
    if (JSON.stringify(inventoryEntry.diagnosticCodes) !== JSON.stringify(baselineCodes)) errors.push(`${fixture.id}: inventory diagnosticCodes disagree with authoritative baseline`);
    if (JSON.stringify(inventoryEntry.diagnosticExpectations) !== JSON.stringify(baselineExpectations)) errors.push(`${fixture.id}: inventory diagnosticExpectations disagree with authoritative baseline`);
    if (fixture.expected === 'pass' && fixture.diagnostics.length !== 0) errors.push(`${fixture.id}: authoritative pass baseline cannot contain diagnostics`);
    if (fixture.expected === 'diagnostic' && fixture.diagnostics.length === 0) errors.push(`${fixture.id}: authoritative diagnostic baseline must name precise diagnostics`);
  }
  for (const id of inventoryById.keys()) if (!baselineById.has(id)) errors.push(`corpus inventory fixture has no authoritative baseline: ${id}`);
  const counts = baseline.counts;
  if (!counts || counts.total !== baseline.fixtures.length || counts.total !== inventoryById.size) errors.push('corpus diagnostic baseline total count drift');
  for (const expected of ['pass', 'diagnostic']) {
    const actual = baseline.fixtures.filter((fixture) => fixture.expected === expected).length;
    if (counts?.expected?.[expected] !== actual) errors.push(`corpus diagnostic baseline expected count drift for ${expected}`);
  }
}

export function validateCoverage({ projectRoot, inventory, manifest, records, ledger, anchorsBySpec, corpusBaseline, corpusBaselineIntegrity, performanceBaseline, checkArtifacts = true }) {
  const errors = [];
  validateCorpusBaselineIntegrity(projectRoot, corpusBaseline, corpusBaselineIntegrity, errors);
  if (checkArtifacts) {
    validateCorpusInventory(projectRoot, inventory, errors);
    validateCorpusBaseline(projectRoot, inventory, corpusBaseline, errors);
    validatePerformanceBaseline(projectRoot, performanceBaseline, errors);
  }
  if (inventory.version !== CONTRACT_VERSION) errors.push(`inventory version must be ${CONTRACT_VERSION}`);
  if (manifest.version !== CONTRACT_VERSION) errors.push(`evidence manifest version must be ${CONTRACT_VERSION}`);
  if (ledger.policy?.version !== CONTRACT_VERSION) errors.push(`ledger policy version must be ${CONTRACT_VERSION}`);
  const recordIds = new Set();
  for (const record of records) {
    if (!ID_PATTERN.test(record.id) || recordIds.has(record.id)) errors.push(`duplicate or malformed inventory ID: ${record.id}`);
    recordIds.add(record.id);
    if (typeof record.requirement !== 'string' || !record.requirement.trim()) errors.push(`${record.id}: malformed requirement`);
    if (!['normative', 'shared', 'delta'].includes(record.policy)) errors.push(`${record.id}: invalid policy`);
    if (record.policy === 'shared' && record.normativeSources.length !== 2) errors.push(`${record.id}: shared concept requires two independently anchored sources`);
    if ((record.policy === 'shared' || record.policy === 'delta') && !record.reconciliation) errors.push(`${record.id}: missing reconciliation metadata`);
    for (const source of record.normativeSources) if (!SOURCE_PATTERN.test(source.source ?? '') || !ANCHOR_PATTERN.test(source.anchor ?? '') || !anchorsBySpec?.get(source.spec)?.has(source.anchor)) errors.push(`${record.id}: missing or stale exact normative heading anchor for ${source.spec}: ${source.anchor ?? '<missing>'}`);
  }
  const evidence = new Map();
  for (const entry of manifest.evidence ?? []) {
    if (!ID_PATTERN.test(entry.id ?? '') || evidence.has(entry.id)) errors.push(`duplicate or malformed evidence ID: ${entry.id ?? '<missing>'}`);
    evidence.set(entry.id, entry);
    if (!['implementation', 'rationale', 'test'].includes(entry.kind)) errors.push(`${entry.id}: invalid evidence kind`);
    if (!Array.isArray(entry.requirements) || entry.requirements.length === 0) errors.push(`${entry.id}: missing evidence requirements`);
    for (const requirement of entry.requirements ?? []) if (!recordIds.has(requirement)) errors.push(`${entry.id}: evidence maps to unknown requirement ${requirement}`);
    if (!Array.isArray(entry.dimensions) || entry.dimensions.some((dimension) => !DIMENSIONS.includes(dimension))) errors.push(`${entry.id}: invalid evidence dimensions`);
    if (entry.kind === 'test' && (!TEST_FACETS.includes(entry.facet) || typeof entry.file !== 'string' || typeof entry.test !== 'string')) errors.push(`${entry.id}: malformed executable test reference`);
    if (entry.file) {
      const file = path.join(projectRoot, entry.file);
      if (!fs.existsSync(file)) errors.push(`${entry.id}: missing evidence artifact ${entry.file}`);
      else {
        const text = fs.readFileSync(file, 'utf8');
        const cached = parsedEvidenceFilesCache.get(file);
        const parsedSource = cached?.text === text ? cached.source : sourceFile(file, text);
        if (!cached || cached.text !== text) parsedEvidenceFilesCache.set(file, { text, source: parsedSource });
        if (entry.test && !cachedHasTestName(parsedSource, entry.test)) errors.push(`${entry.id}: executable test name is missing or ambiguous in ${entry.file}`);
        if (entry.symbol && !cachedHasExportedSymbol(parsedSource, entry.symbol)) errors.push(`${entry.id}: exported implementation symbol is missing or ambiguous in ${entry.file}`);
      }
    }
  }
  const ledgerIds = new Set();
  for (const feature of ledger.features ?? []) {
    if (ledgerIds.has(feature.id)) errors.push(`duplicate ledger ID: ${feature.id}`);
    ledgerIds.add(feature.id);
    const expected = records.find((record) => record.id === feature.id);
    if (!expected) errors.push(`extra ledger record: ${feature.id}`);
    else for (const field of ['spec', 'normativeSources', 'category', 'policy', 'reconciliation', 'requirement']) if (JSON.stringify(feature[field] ?? null) !== JSON.stringify(expected[field] ?? null)) errors.push(`${feature.id}: source-contract drift in ${field}`);
    if (!STATUSES.includes(feature.status)) errors.push(`${feature.id}: invalid status`);
    for (const dimension of DIMENSIONS) {
      const claim = feature.evidence?.[dimension];
      if (!claim || !STATUSES.includes(claim.status) || !Array.isArray(claim.ids) || claim.ids.length === 0) errors.push(`${feature.id}: malformed ${dimension} evidence`);
      for (const id of claim?.ids ?? []) if (!evidenceApplies(evidence.get(id), feature.id, dimension)) errors.push(`${feature.id}: missing, duplicate, or unrelated ${dimension} evidence ID ${id}`);
      if (claim?.status === 'partial' && !(claim.ids ?? []).some((id) => ['implementation', 'test'].includes(evidence.get(id)?.kind))) errors.push(`${feature.id}: partial ${dimension} lacks concrete evidence`);
      if (claim?.status === 'gap' && !(claim.ids ?? []).some((id) => evidence.get(id)?.kind === 'rationale')) errors.push(`${feature.id}: gap ${dimension} lacks rationale evidence`);
      if (feature.status === 'complete' && claim?.status !== 'complete') errors.push(`${feature.id}: false complete claim for ${dimension}`);
    }
    for (const facet of TEST_FACETS) {
      const claim = feature.evidence?.tests?.facets?.[facet];
      if (!claim || !STATUSES.includes(claim.status) || !Array.isArray(claim.ids) || claim.ids.length === 0) errors.push(`${feature.id}: malformed ${facet} test facet`);
      for (const id of claim?.ids ?? []) if (!evidenceApplies(evidence.get(id), feature.id, 'tests', facet)) errors.push(`${feature.id}: missing, duplicate, or unrelated ${facet} evidence ID ${id}`);
      if (claim?.status === 'partial' && !(claim.ids ?? []).some((id) => evidence.get(id)?.kind === 'test')) errors.push(`${feature.id}: partial ${facet} lacks executable test evidence`);
      if (feature.status === 'complete' && claim?.status !== 'complete') errors.push(`${feature.id}: false complete claim for ${facet}`);
    }
  }
  for (const id of recordIds) if (!ledgerIds.has(id)) errors.push(`missing normative inventory record: ${id}`);
  if (checkArtifacts) {
    const coverageRoot = path.join(projectRoot, 'coverage');
    const rootFiles = fs.readdirSync(coverageRoot, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name);
    for (const file of rootFiles) if (!SOURCE_FILES.includes(file)) errors.push(`unexpected spec coverage source artifact: coverage/${file}`);
    const generatedRoot = path.join(coverageRoot, 'generated');
    const generatedFiles = fs.existsSync(generatedRoot) ? fs.readdirSync(generatedRoot, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name) : [];
    for (const file of GENERATED_FILES) if (!generatedFiles.includes(file)) errors.push(`missing generated spec artifact: coverage/generated/${file}`);
    for (const file of generatedFiles) if (!GENERATED_FILES.includes(file)) errors.push(`unexpected generated spec artifact: coverage/generated/${file}`);
  }
  return errors;
}