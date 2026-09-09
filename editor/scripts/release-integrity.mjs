import { createHash } from 'node:crypto';
import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [command, rootArgument = 'release'] = process.argv.slice(2);
const root = path.resolve(rootArgument);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowlistPath = path.join(projectRoot, 'config', 'native-artifact-allowlist.json');
const allowlistDigestPath = path.join(projectRoot, 'config', 'native-artifact-allowlist.sha256');
const ALLOWLIST_DIGEST_ANCHOR = 'd44054ecf47c2ee36b6f5a1b184ea20db7f89f1041b9683e00efdc54f4eda4fc';
const NATIVE_ARTIFACT_PATTERN = /\.(?:exe|dll|pyd|dylib|so(?:\.[0-9]+)*|node|appimage|msi)$/i;
const EXTENSIONLESS_NATIVE_PATTERN = /(?:^|\/)(?:JSON Structure Editor|chrome-sandbox|python(?:3(?:\.\d+)?)?)$/i;
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.map', '.md', '.mjs', '.txt', '.xml', '.yaml', '.yml']);
const credentialPattern = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:api[_-]?key|client[_-]?secret|password|access[_-]?token)\s*[:=]\s*(?:["'][A-Za-z0-9_+/.=-]{8,}["']|(?=[A-Za-z0-9_+/.=-]{12,}(?:\s|$))(?=[A-Za-z0-9_+/.=-]*[0-9_+/\-=])[A-Za-z0-9_+/.=-]{12,})|(?:ghp|github_pat|sk_live|xox[baprs])_[A-Za-z0-9_-]{8,}/i;
const absolutePathPattern = /(?:^|[\s"'=])(?:[A-Za-z]:\\{1,2}(?:Users|build|agent|home|git)\\{1,2}[^\s"']+|\/(?:Users|home|builds|private\/var|workspace)\/[^\s"']+)/i;

const normalize = (value) => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort((left, right) => left < right ? -1 : left > right ? 1 : 0).map((key) => [key, normalize(value[key])]))
  : value;
const stable = (value) => `${JSON.stringify(normalize(value), null, 2)}\n`;
const matchesDeclaration = (relative, declaration) => {
  const expression = declaration.split(/(\*\*|\*)/).map((part) => part === '**' ? '.*' : part === '*' ? '[^/]*' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('');
  return new RegExp(`^${expression}$`, 'i').test(relative);
};

async function files(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await files(target));
    else if (entry.isSymbolicLink()) throw new Error(`release contains an unsupported symbolic link: ${target}`);
    else if (entry.isFile()) found.push(target);
  }
  return found;
}

async function loadNativeAllowlist() {
  let raw;
  let anchor;
  try {
    raw = await readFile(allowlistPath);
    anchor = (await readFile(allowlistDigestPath, 'utf8')).trim();
  } catch (error) {
    throw new Error(`checked-in native artifact allowlist is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  const digest = createHash('sha256').update(raw).digest('hex');
  if (anchor !== ALLOWLIST_DIGEST_ANCHOR || digest !== ALLOWLIST_DIGEST_ANCHOR) throw new Error('checked-in native artifact allowlist digest is not independently anchored; refuse to scan release artifacts.');
  let allowlist;
  try { allowlist = JSON.parse(raw.toString('utf8')); }
  catch (error) { throw new Error(`checked-in native artifact allowlist is invalid: ${error instanceof Error ? error.message : String(error)}`); }
  const platformPatterns = allowlist.platforms?.[process.platform];
  if (allowlist.schemaVersion !== 1 || allowlist.nativeFilePattern !== NATIVE_ARTIFACT_PATTERN.source || !Array.isArray(allowlist.patterns) || allowlist.patterns.length === 0 || !Array.isArray(platformPatterns) || platformPatterns.length === 0) throw new Error('checked-in native artifact allowlist schema, matcher, or platform declarations are invalid.');
  if ([...allowlist.patterns, ...platformPatterns].some((pattern) => typeof pattern !== 'string' || pattern.length === 0 || path.isAbsolute(pattern) || pattern.split('/').includes('..'))) throw new Error('checked-in native artifact allowlist contains an unsafe declaration.');
  return platformPatterns;
}
function isNativeArtifact(relative, fileStat) {
  return NATIVE_ARTIFACT_PATTERN.test(relative) || EXTENSIONLESS_NATIVE_PATTERN.test(relative) || (!path.extname(relative) && (fileStat.mode & 0o111) !== 0);
}


async function corpusTrustFindings(releaseRoot) {
  const coverageRoot = path.basename(releaseRoot).toLowerCase() === 'release' ? path.join(path.resolve(releaseRoot, '..'), 'coverage') : path.join(releaseRoot, 'coverage');
  try { await stat(coverageRoot); } catch { return []; }
  const baselinePath = path.join(coverageRoot, 'corpus-baseline.json');
  const integrityPath = path.join(coverageRoot, 'release-integrity.json');
  try {
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
    const integrity = JSON.parse(await readFile(integrityPath, 'utf8'));
    const artifact = integrity.artifact;
    const review = integrity.review;
    const findings = [];
    if (integrity.schemaVersion !== 1 || artifact?.path !== 'coverage/corpus-baseline.json' || artifact?.version !== baseline.version || artifact?.canonicalization !== 'json-stable-v1' || typeof artifact?.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) {
      findings.push('coverage/release-integrity.json: malformed corpus baseline trust manifest');
    } else {
      const digest = createHash('sha256').update(stable(baseline), 'utf8').digest('hex');
      if (digest !== artifact.sha256.toLowerCase()) findings.push('coverage/corpus-baseline.json: canonical SHA-256 differs from release integrity manifest');
    }
    if (review?.version !== 1 || review?.status !== 'independent-review-required' || review?.authorizedWorkflow !== 'coverage-baseline-update' || review?.tokenEnvironment !== 'JSON_STRUCTURE_BASELINE_UPDATE_TOKEN' || typeof review?.changePolicy !== 'string' || !review.changePolicy.trim() || JSON.stringify(review?.requiredMetadata) !== JSON.stringify(['reviewId', 'reason', 'approvedBy'])) {
      findings.push('coverage/release-integrity.json: incomplete independent-review metadata');
    }
    return findings;
  } catch (error) {
    return [`coverage/release-integrity.json: unable to verify corpus baseline trust (${error instanceof Error ? error.message : String(error)})`];
  }
}

async function scanRelease(releaseRoot, allowlist) {
  const artifacts = [];
  const findings = [];
  for (const file of (await files(releaseRoot)).sort()) {
    const relative = path.relative(releaseRoot, file).split(path.sep).join('/');
    if (['checksums.json', 'executables.json', 'sbom.cdx.json', 'provenance.intoto.json'].includes(relative)) continue;
    const data = await readFile(file);
    const fileStat = await stat(file);
    artifacts.push({ path: relative, size: data.byteLength, sha256: createHash('sha256').update(data).digest('hex'), sha512: createHash('sha512').update(data).digest('hex') });
    if (isNativeArtifact(relative, fileStat) && !allowlist.some((declaration) => matchesDeclaration(relative, declaration))) findings.push(`${relative}: undeclared executable`);
    if (fileStat.size <= 16 * 1024 * 1024 && textExtensions.has(path.extname(file).toLowerCase())) {
      const text = data.toString('utf8');
      if (credentialPattern.test(text)) findings.push(`${relative}: credential-like material`);
      if (absolutePathPattern.test(text)) findings.push(`${relative}: absolute build path`);
    }
  }
  return { artifacts, findings };
}

async function main() {
  if (!['scan', 'manifest', 'executables', 'attest'].includes(command)) throw new Error('usage: node scripts/release-integrity.mjs <scan|manifest|executables|attest> [release-root]');
  if (command === 'executables') for (const generated of ['builder-debug.yml', 'builder-effective-config.yaml', 'executables.json']) await rm(path.join(root, generated), { force: true });
  const allowlist = await loadNativeAllowlist();
  const { artifacts, findings } = await scanRelease(root, allowlist);
  findings.push(...await corpusTrustFindings(root));
  const nativeCount = artifacts.filter((artifact) => isNativeArtifact(artifact.path, { mode: 0 })).length;
  if (command === 'executables') {
    if (findings.length) throw new Error(findings.join('\n'));
    console.log(`checked ${nativeCount} native release files against the checked-in allowlist; no authorization was generated from the artifact`);
    return;
  }
  if (command === 'manifest' || command === 'attest') {
    await writeFile(path.join(root, 'checksums.json'), stable({ artifacts, schemaVersion: 1 }));
    console.log(`wrote checksums.json for ${artifacts.length} artifacts (${nativeCount} native files)`);
    if (command === 'attest') {
      const packageMetadata = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
      const lock = JSON.parse(await readFile(path.join(projectRoot, 'package-lock.json'), 'utf8'));
      const nodeComponents = Object.entries(lock.packages ?? {}).filter(([location, entry]) => location && entry.version).map(([location, entry]) => {
        const normalized = location.replaceAll('\\', '/');
        const name = normalized.slice(normalized.lastIndexOf('node_modules/') + 13);
        return { type: 'library', name, version: entry.version, scope: entry.dev ? 'optional' : 'required', 'bom-ref': `pkg:npm/${encodeURIComponent(name)}@${entry.version}`, purl: `pkg:npm/${encodeURIComponent(name)}@${entry.version}` };
      });
      const runtimeComponents = new Map();
      for (const artifact of artifacts.filter((entry) => /\/conversion\/worker-runtime\/structurize-runtime\/[^/]+\/runtime\.json$/i.test(entry.path))) {
        const runtime = JSON.parse(await readFile(path.join(root, artifact.path), 'utf8'));
        if (runtime.implementation !== 'avrotize' || typeof runtime.version !== 'string' || typeof runtime.interpreter?.version !== 'string' || !Array.isArray(runtime.dependencies)) throw new Error(`runtime SBOM metadata is malformed: ${artifact.path}`);
        const add = (component) => runtimeComponents.set(component['bom-ref'], component);
        add({ type: 'library', name: 'avrotize', version: runtime.version, scope: 'required', 'bom-ref': `pkg:pypi/avrotize@${runtime.version}`, purl: `pkg:pypi/avrotize@${runtime.version}`, licenses: [{ license: { name: runtime.licenses?.avrotize || 'MIT' } }], properties: [{ name: 'source.revision', value: runtime.source?.revision || '' }, { name: 'source.fingerprint', value: runtime.source?.fingerprint || '' }] });
        add({ type: 'library', name: 'CPython', version: runtime.interpreter.version, scope: 'required', 'bom-ref': `pkg:generic/cpython@${runtime.interpreter.version}`, purl: `pkg:generic/cpython@${runtime.interpreter.version}`, licenses: [{ license: { name: runtime.licenses?.cpython || 'Python Software Foundation License' } }] });
        for (const dependency of runtime.dependencies) {
          if (typeof dependency?.name !== 'string' || typeof dependency?.version !== 'string' || typeof dependency?.license !== 'string' || !dependency.license) throw new Error(`runtime dependency license metadata is malformed: ${artifact.path}`);
          add({ type: 'library', name: dependency.name, version: dependency.version, scope: 'required', 'bom-ref': `pkg:pypi/${encodeURIComponent(dependency.name)}@${dependency.version}`, purl: `pkg:pypi/${encodeURIComponent(dependency.name)}@${dependency.version}`, licenses: [{ license: { name: dependency.license } }] });
        }
      }
      const components = [...nodeComponents, ...runtimeComponents.values()].sort((left, right) => left['bom-ref'].localeCompare(right['bom-ref']));
      const rootRef = `pkg:npm/${encodeURIComponent(packageMetadata.name)}@${packageMetadata.version}`;
      const serial = createHash('sha256').update(stable({ rootRef, components })).digest('hex').slice(0, 32);
      await writeFile(path.join(root, 'sbom.cdx.json'), stable({ bomFormat: 'CycloneDX', specVersion: '1.5', serialNumber: `urn:uuid:${serial}`, version: 1, metadata: { component: { type: 'application', name: packageMetadata.name, version: packageMetadata.version, 'bom-ref': rootRef, purl: rootRef }, tools: { components: [{ type: 'application', name: 'json-structure-release-integrity', version: '1' }] } }, components }));
      const sourceDigest = process.env.GITHUB_SHA || process.env.SOURCE_DIGEST || 'unavailable';
      const invocationId = process.env.GITHUB_RUN_ID || process.env.BUILD_BUILDID || 'local';
      await writeFile(path.join(root, 'provenance.intoto.json'), stable({ _type: 'https://in-toto.io/Statement/v1', subject: artifacts.map((artifact) => ({ name: artifact.path, digest: { sha256: artifact.sha256, sha512: artifact.sha512 } })), predicateType: 'https://slsa.dev/provenance/v1', predicate: { buildDefinition: { buildType: 'json-structure-editor-release', externalParameters: { source: process.env.GITHUB_REPOSITORY || 'local', sourceDigest, runtimeManifests: artifacts.filter((artifact) => artifact.path.endsWith('/runtime.json')).map((artifact) => ({ path: artifact.path, sha256: artifact.sha256 })) } }, runDetails: { builder: { id: process.env.GITHUB_ACTIONS ? 'github-actions' : 'local' }, metadata: { invocationId }, environment: { platform: process.platform, architecture: process.arch, node: process.version, tools: { npm: process.env.npm_config_user_agent?.split(' ')[0] || 'npm' } } } } }));
      console.log(`wrote SBOM and provenance for ${components.length} Node/Python components`);
    }
  }
  if (findings.length) throw new Error(findings.join('\n'));
  console.log(`artifact scan passed for ${artifacts.length} files (${nativeCount} native files)`);
}

main().catch((error) => {
  console.error(`Release integrity failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});