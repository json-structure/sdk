import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [command, rootArgument = 'release', ...declared] = process.argv.slice(2);
const root = path.resolve(rootArgument);
const posix = (file) => path.relative(root, file).split(path.sep).join('/');
const normalize = (value) => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort((left, right) => left < right ? -1 : left > right ? 1 : 0).map((key) => [key, normalize(value[key])]))
  : value;
const stable = (value) => `${JSON.stringify(normalize(value), null, 2)}\n`;
const matchesDeclaration = (relative, declaration) => {
  const expression = declaration.split(/(\*\*|\*)/).map((part) => part === '**' ? '.*' : part === '*' ? '[^/]*' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('');
  return new RegExp(`^${expression}$`, 'i').test(relative);
};
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.map', '.md', '.mjs', '.txt', '.xml', '.yaml', '.yml']);

async function files(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await files(target));
    else if (entry.isFile()) found.push(target);
  }
  return found;
}

async function corpusTrustFindings(releaseRoot) {
  const projectRoot = path.basename(releaseRoot).toLowerCase() === 'release' ? path.resolve(releaseRoot, '..') : releaseRoot;
  const coverageRoot = path.join(projectRoot, 'coverage');
  try { await stat(coverageRoot); } catch { return []; }
  const baselinePath = path.join(projectRoot, 'coverage', 'corpus-baseline.json');
  const integrityPath = path.join(projectRoot, 'coverage', 'release-integrity.json');
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
    return ['coverage/release-integrity.json: unable to verify corpus baseline trust (' + (error instanceof Error ? error.message : String(error)) + ')'];
  }
}

if (!['scan', 'manifest', 'executables', 'attest'].includes(command)) {
  console.error('usage: node scripts/release-integrity.mjs <scan|manifest|executables|attest> [release-root] [declared-executable ...]');
  process.exitCode = 2;
} else {
  const artifacts = [];
  const findings = [];
  if (command !== 'executables') findings.push(...await corpusTrustFindings(root));
  const executableManifestPath = path.join(root, 'executables.json');
  const executableFiles = (await files(root)).filter((file) => /\.(?:exe|dll|dylib|so|node|appimage|msi)$/i.test(file)).map(posix).sort();
  if (command === 'executables') {
    await writeFile(executableManifestPath, stable({ executables: executableFiles, schemaVersion: 1 }));
    console.log(`wrote executables.json for ${executableFiles.length} executable files`);
    process.exit(0);
  }
  const manifestAllowed = await readFile(executableManifestPath, 'utf8').then((content) => JSON.parse(content).executables, () => []);
  const allowed = (declared.length ? declared : manifestAllowed).map((entry) => entry.replaceAll('\\', '/'));
  for (const file of (await files(root)).sort()) {
    const relative = posix(file);
    if (['checksums.json', 'executables.json', 'sbom.cdx.json', 'provenance.intoto.json'].includes(relative)) continue;
    const data = await readFile(file);
    artifacts.push({ path: relative, size: data.byteLength, sha256: createHash('sha256').update(data).digest('hex'), sha512: createHash('sha512').update(data).digest('hex') });
    if (/\.(?:exe|dll|dylib|so|node|appimage|msi)$/i.test(file) && !allowed.some((declaration) => matchesDeclaration(relative, declaration))) findings.push(`${relative}: undeclared executable`);
    if ((await stat(file)).size <= 16 * 1024 * 1024 && textExtensions.has(path.extname(file).toLowerCase())) {
      const text = data.toString('utf8');
      if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:api[_-]?key|client[_-]?secret|password|access[_-]?token)\s*[:=]\s*["']?[A-Za-z0-9_+/.=-]{8,}/i.test(text)) findings.push(`${relative}: credential-like material`);
      if (/[A-Za-z]:\\(?:Users|build|agent|home|git)\\[^\s"']+|\/(?:Users|home|builds|private\/var|workspace)\/[^\s"']+/i.test(text)) findings.push(`${relative}: absolute build path`);
    }
  }
  if (command === 'manifest' || command === 'attest') {
    await writeFile(path.join(root, 'checksums.json'), stable({ artifacts, schemaVersion: 1 }));
    console.log(`wrote checksums.json for ${artifacts.length} artifacts`);
    if (command === 'attest') {
      const projectRoot = path.resolve(root, '..');
      const packageMetadata = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
      const lock = JSON.parse(await readFile(path.join(projectRoot, 'package-lock.json'), 'utf8'));
      const components = Object.entries(lock.packages ?? {}).filter(([location, entry]) => location && entry.version).map(([location, entry]) => {
        const normalized = location.replaceAll('\\', '/');
        const name = normalized.slice(normalized.lastIndexOf('node_modules/') + 13);
        return { type: 'library', name, version: entry.version, scope: entry.dev ? 'optional' : 'required', 'bom-ref': `pkg:npm/${encodeURIComponent(name)}@${entry.version}`, purl: `pkg:npm/${encodeURIComponent(name)}@${entry.version}` };
      }).sort((left, right) => left['bom-ref'].localeCompare(right['bom-ref']));
      const rootRef = `pkg:npm/${encodeURIComponent(packageMetadata.name)}@${packageMetadata.version}`;
      const serial = createHash('sha256').update(stable({ rootRef, components })).digest('hex').slice(0, 32);
      await writeFile(path.join(root, 'sbom.cdx.json'), stable({
        bomFormat: 'CycloneDX', specVersion: '1.5', serialNumber: `urn:uuid:${serial}`, version: 1,
        metadata: { component: { type: 'application', name: packageMetadata.name, version: packageMetadata.version, 'bom-ref': rootRef, purl: rootRef }, tools: { components: [{ type: 'application', name: 'json-structure-release-integrity', version: '1' }] } },
        components
      }));
      const sourceDigest = process.env.GITHUB_SHA || process.env.SOURCE_DIGEST || 'unavailable';
      const invocationId = process.env.GITHUB_RUN_ID || process.env.BUILD_BUILDID || 'local';
      await writeFile(path.join(root, 'provenance.intoto.json'), stable({
        _type: 'https://in-toto.io/Statement/v1',
        subject: artifacts.map((artifact) => ({ name: artifact.path, digest: { sha256: artifact.sha256, sha512: artifact.sha512 } })),
        predicateType: 'https://slsa.dev/provenance/v1',
        predicate: { buildDefinition: { buildType: 'json-structure-editor-release', externalParameters: { source: process.env.GITHUB_REPOSITORY || 'local', sourceDigest } }, runDetails: { builder: { id: process.env.GITHUB_ACTIONS ? 'github-actions' : 'local' }, metadata: { invocationId }, environment: { platform: process.platform, architecture: process.arch, node: process.version, tools: { npm: process.env.npm_config_user_agent?.split(' ')[0] || 'npm' } } } }
      }));
      console.log(`wrote SBOM and provenance for ${components.length} locked packages`);
    }
    if (findings.length) {
      console.error(findings.join('\n'));
      process.exitCode = 1;
    }
  } else if (findings.length) {
    console.error(findings.join('\n'));
    process.exitCode = 1;
  } else console.log(`artifact scan passed for ${artifacts.length} files`);
}