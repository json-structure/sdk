import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export type HashAlgorithm = 'sha256' | 'sha512';

export interface ArtifactHash {
  path: string;
  size: number;
  sha256: string;
  sha512: string;
}

export interface ChecksumManifest {
  schemaVersion: 1;
  artifacts: ArtifactHash[];
}

function portableRelative(root: string, file: string): string {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`artifact must be a file below the release root: ${file}`);
  }
  return relative.split(path.sep).join('/');
}

function digest(data: Uint8Array, algorithm: HashAlgorithm): string {
  return createHash(algorithm).update(data).digest('hex');
}

export function stableJson(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (candidate && typeof candidate === 'object') {
      return Object.fromEntries(Object.entries(candidate as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalize(entry)]));
    }
    return candidate;
  };
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

export async function createChecksumManifest(root: string, files: readonly string[]): Promise<ChecksumManifest> {
  const artifacts = await Promise.all(files.map(async (file): Promise<ArtifactHash> => {
    const data = await readFile(file);
    return {
      path: portableRelative(root, file),
      size: data.byteLength,
      sha256: digest(data, 'sha256'),
      sha512: digest(data, 'sha512')
    };
  }));
  artifacts.sort((left, right) => left.path.localeCompare(right.path));
  if (new Set(artifacts.map((artifact) => artifact.path)).size !== artifacts.length) throw new Error('duplicate artifact path');
  return { schemaVersion: 1, artifacts };
}

interface LockPackage {
  version?: string;
  integrity?: string;
  license?: string;
  dev?: boolean;
}

interface PackageLock {
  name?: string;
  version?: string;
  packages?: Record<string, LockPackage>;
}

interface PackageMetadata {
  name?: string;
  version?: string;
  license?: string;
}

export interface CycloneDxBom {
  bomFormat: 'CycloneDX';
  specVersion: '1.5';
  serialNumber: string;
  version: 1;
  metadata: { component: Record<string, unknown>; tools: { components: Record<string, unknown>[] } };
  components: Record<string, unknown>[];
}

function packageName(lockPath: string): string {
  const normalized = lockPath.replaceAll('\\', '/');
  const marker = 'node_modules/';
  const index = normalized.lastIndexOf(marker);
  return index < 0 ? normalized : normalized.slice(index + marker.length);
}

export function createCycloneDxSbom(packageMetadata: PackageMetadata, lock: PackageLock): CycloneDxBom {
  if (!packageMetadata.name || !packageMetadata.version) throw new Error('package metadata requires name and version');
  const components = Object.entries(lock.packages ?? {})
    .filter(([location, entry]) => location !== '' && Boolean(entry.version))
    .map(([location, entry]) => {
      const name = packageName(location);
      const component: Record<string, unknown> = {
        type: 'library', name, version: entry.version,
        scope: entry.dev ? 'optional' : 'required',
        'bom-ref': `pkg:npm/${encodeURIComponent(name)}@${entry.version}`,
        purl: `pkg:npm/${encodeURIComponent(name)}@${entry.version}`
      };
      if (entry.license) component.licenses = [{ license: { id: entry.license } }];
      if (entry.integrity) component.properties = [{ name: 'npm:integrity', value: entry.integrity }];
      return component;
    })
    .sort((left, right) => String(left['bom-ref']).localeCompare(String(right['bom-ref'])));
  const rootRef = `pkg:npm/${encodeURIComponent(packageMetadata.name)}@${packageMetadata.version}`;
  return {
    bomFormat: 'CycloneDX', specVersion: '1.5',
    serialNumber: `urn:uuid:${createHash('sha256').update(stableJson({ rootRef, components })).digest('hex').slice(0, 32)}`,
    version: 1,
    metadata: {
      component: { type: 'application', name: packageMetadata.name, version: packageMetadata.version, 'bom-ref': rootRef, purl: rootRef },
      tools: { components: [{ type: 'application', name: 'json-structure-release-integrity', version: '1' }] }
    },
    components
  };
}

export interface ProvenanceInput {
  builderId: string;
  buildType: string;
  invocationId: string;
  sourceUri: string;
  sourceDigest: string;
  platform: string;
  architecture: string;
  nodeVersion: string;
  toolVersions: Record<string, string>;
  artifacts: readonly ArtifactHash[];
}

export function createProvenanceStatement(input: ProvenanceInput): Record<string, unknown> {
  for (const value of [input.builderId, input.buildType, input.invocationId, input.sourceUri, input.platform, input.architecture, input.nodeVersion, ...Object.values(input.toolVersions)]) {
    if (/^[A-Za-z]:[\\/]|^\//.test(value)) throw new Error('provenance values must not contain absolute paths');
  }
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [...input.artifacts].sort((left, right) => left.path.localeCompare(right.path)).map((artifact) => ({
      name: artifact.path, digest: { sha256: artifact.sha256, sha512: artifact.sha512 }
    })),
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: { buildType: input.buildType, externalParameters: { source: input.sourceUri, sourceDigest: input.sourceDigest } },
      runDetails: {
        builder: { id: input.builderId }, metadata: { invocationId: input.invocationId },
        environment: { platform: input.platform, architecture: input.architecture, node: input.nodeVersion, tools: input.toolVersions }
      }
    }
  };
}

export interface ArtifactFinding {
  path: string;
  rule: 'credential' | 'absolute-path' | 'undeclared-executable';
  detail: string;
}

const NATIVE_ARTIFACT_PATTERN = /\.(?:exe|dll|pyd|dylib|so(?:\.[0-9]+)*|node|appimage|msi)$/i;
const credentialPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /(?:api[_-]?key|client[_-]?secret|password|access[_-]?token)\s*[:=]\s*(?:["'][A-Za-z0-9_+/.=-]{8,}["']|(?=[A-Za-z0-9_+/.=-]{12,}(?:\s|$))(?=[A-Za-z0-9_+/.=-]*[0-9_+/\-=])[A-Za-z0-9_+/.=-]{12,})/i,
  /(?:ghp|github_pat|sk_live|xox[baprs])_[A-Za-z0-9_-]{8,}/
];
const absolutePathPatterns = [
  /(?:^|[\s"'=])[A-Za-z]:\\{1,2}(?:Users|build|agent|home|git)\\{1,2}[^\s"']+/i,
  /(?:^|[\s"'=])\/(?:Users|home|builds|private\/var|workspace)\/[^\s"']+/i
];

function matchesDeclaration(relative: string, declaration: string): boolean {
  const expression = declaration.split(/(\*\*|\*)/).map((part) => part === '**' ? '.*' : part === '*' ? '[^/]*' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('');
  return new RegExp(`^${expression}$`, 'i').test(relative);
}

async function listFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(target));
    else if (entry.isFile()) result.push(target);
  }
  return result;
}

export async function scanArtifacts(root: string, declaredExecutables: readonly string[] = []): Promise<ArtifactFinding[]> {
  const allowed = declaredExecutables.map((entry) => entry.replaceAll('\\', '/'));
  const findings: ArtifactFinding[] = [];
  for (const file of (await listFiles(root)).sort()) {
    const relative = portableRelative(root, file);
    if (NATIVE_ARTIFACT_PATTERN.test(relative) && !allowed.some((declaration) => matchesDeclaration(relative, declaration))) {
      findings.push({ path: relative, rule: 'undeclared-executable', detail: 'executable is absent from the release allowlist' });
    }
    const fileStat = await stat(file);
    if (fileStat.size > 16 * 1024 * 1024) continue;
    const text = (await readFile(file)).toString('utf8');
    if (credentialPatterns.some((pattern) => pattern.test(text))) findings.push({ path: relative, rule: 'credential', detail: 'credential-like material detected' });
    if (absolutePathPatterns.some((pattern) => pattern.test(text))) findings.push({ path: relative, rule: 'absolute-path', detail: 'absolute build path detected' });
  }
  return findings;
}

export interface TelemetryEvent {
  schemaVersion: 1;
  event: 'application.started' | 'application.stopped' | 'command.completed' | 'operation.failed';
  host: 'electron' | 'vscode';
  platform: 'win32' | 'darwin' | 'linux';
  appVersion: string;
  durationBucket?: '<100ms' | '100ms-1s' | '1s-10s' | '>=10s';
  outcome?: 'success' | 'cancelled' | 'failure';
  commandCategory?: 'document' | 'edit' | 'validation' | 'conversion' | 'registry';
  errorCode?: string;
}

export interface TelemetryEnvelope {
  enabled: boolean;
  event?: TelemetryEvent;
}

const telemetryKeys = new Set(['schemaVersion', 'event', 'host', 'platform', 'appVersion', 'durationBucket', 'outcome', 'commandCategory', 'errorCode']);
const sensitiveValue = /(?:[A-Za-z]:\\|\/(?:Users|home)\/|https?:\/\/|-----BEGIN|\{[\s\S]*\}|\[[\s\S]*\])/i;

export function validateTelemetryEvent(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['telemetry event must be an object'];
  const event = value as Record<string, unknown>;
  const errors: string[] = [];
  for (const key of Object.keys(event)) {
    if (!telemetryKeys.has(key)) errors.push(`telemetry field is not allowed: ${key}`);
    const field = event[key];
    if (typeof field === 'string' && sensitiveValue.test(field)) errors.push(`telemetry field contains content or location data: ${key}`);
  }
  if (event.schemaVersion !== 1) errors.push('telemetry schemaVersion must be 1');
  if (!['application.started', 'application.stopped', 'command.completed', 'operation.failed'].includes(String(event.event))) errors.push('unknown telemetry event');
  if (!['electron', 'vscode'].includes(String(event.host))) errors.push('unknown telemetry host');
  if (!['win32', 'darwin', 'linux'].includes(String(event.platform))) errors.push('unknown telemetry platform');
  if (typeof event.appVersion !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(event.appVersion)) errors.push('invalid telemetry appVersion');
  return errors;
}

export function validateTelemetryEnvelope(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['telemetry envelope must be an object'];
  const envelope = value as Record<string, unknown>;
  if (Object.keys(envelope).some((key) => !['enabled', 'event'].includes(key))) return ['telemetry envelope contains unsupported fields'];
  if (typeof envelope.enabled !== 'boolean') return ['telemetry enabled must be boolean'];
  if (!envelope.enabled) return envelope.event === undefined ? [] : ['disabled telemetry must not contain an event'];
  return envelope.event === undefined ? ['enabled telemetry requires an event'] : validateTelemetryEvent(envelope.event);
}

export interface CrashReport {
  schemaVersion: 1;
  appVersion: string;
  host: 'electron' | 'vscode';
  platform: 'win32' | 'darwin' | 'linux';
  architecture: string;
  errorCode: string;
  process: 'main' | 'renderer' | 'extension' | 'worker';
  stackFrames?: { module: string; function?: string; line?: number; column?: number }[];
}

const crashKeys = new Set(['schemaVersion', 'appVersion', 'host', 'platform', 'architecture', 'errorCode', 'process', 'stackFrames']);
export function validateCrashReport(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['crash report must be an object'];
  const report = value as Record<string, unknown>;
  const errors = Object.keys(report).filter((key) => !crashKeys.has(key)).map((key) => `crash report field is not allowed: ${key}`);
  if (report.schemaVersion !== 1) errors.push('crash report schemaVersion must be 1');
  if (typeof report.appVersion !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(report.appVersion)) errors.push('invalid crash report appVersion');
  if (!['electron', 'vscode'].includes(String(report.host))) errors.push('unknown crash report host');
  if (!['win32', 'darwin', 'linux'].includes(String(report.platform))) errors.push('unknown crash report platform');
  if (typeof report.architecture !== 'string' || !report.architecture) errors.push('crash report architecture is required');
  if (typeof report.errorCode !== 'string' || !/^[A-Z][A-Z0-9_]{1,63}$/.test(report.errorCode)) errors.push('invalid crash report errorCode');
  if (!['main', 'renderer', 'extension', 'worker'].includes(String(report.process))) errors.push('unknown crash report process');
  if (report.stackFrames !== undefined && (!Array.isArray(report.stackFrames) || report.stackFrames.some((frame) => {
    if (!frame || typeof frame !== 'object') return true;
    const fields = Object.keys(frame as Record<string, unknown>);
    return fields.some((field) => !['module', 'function', 'line', 'column'].includes(field)) || fields.some((field) => {
      const entry = (frame as Record<string, unknown>)[field];
      return typeof entry === 'string' && sensitiveValue.test(entry);
    });
  }))) errors.push('crash stackFrames contain unsupported or sensitive data');
  return errors;
}

export interface UpdateManifest {
  schemaVersion: 1;
  version: string;
  channel: string;
  publishedAt: string;
  artifacts: { path: string; size: number; sha256: string; sha512: string }[];
  signature: { algorithm: string; keyId: string; value: string };
}

export type MetadataVerifier = (canonicalUnsignedMetadata: Uint8Array, signature: UpdateManifest['signature']) => boolean | Promise<boolean>;

export async function verifyUpdateManifest(manifest: UpdateManifest, artifactRoot: string, verifier: MetadataVerifier): Promise<string[]> {
  const errors: string[] = [];
  if (manifest.schemaVersion !== 1) errors.push('update manifest schemaVersion must be 1');
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version)) errors.push('invalid update version');
  if (!manifest.channel || !manifest.publishedAt || Number.isNaN(Date.parse(manifest.publishedAt))) errors.push('update channel and publishedAt are required');
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) errors.push('update artifacts are required');
  if (errors.length) return errors;
  if (!manifest.signature?.keyId || !manifest.signature?.algorithm || !manifest.signature?.value) return ['signed update metadata is required'];
  const { signature, ...unsigned } = manifest;
  if (!await verifier(new TextEncoder().encode(stableJson(unsigned)), signature)) return ['update metadata signature is invalid'];
  for (const artifact of manifest.artifacts) {
    if (path.isAbsolute(artifact.path) || artifact.path.split('/').includes('..')) {
      errors.push(`invalid update artifact path: ${artifact.path}`);
      continue;
    }
    try {
      const data = await readFile(path.join(artifactRoot, artifact.path));
      if (data.byteLength !== artifact.size) errors.push(`size mismatch: ${artifact.path}`);
      if (digest(data, 'sha256') !== artifact.sha256) errors.push(`SHA-256 mismatch: ${artifact.path}`);
      if (digest(data, 'sha512') !== artifact.sha512) errors.push(`SHA-512 mismatch: ${artifact.path}`);
    } catch {
      errors.push(`missing update artifact: ${artifact.path}`);
    }
  }
  return errors;
}