import { createHash } from 'node:crypto';

export interface IntegrityEntry { path: string; sha256: string; bytes: number }
export interface OutputManifest { algorithm: 'sha256'; files: readonly IntegrityEntry[] }

export function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

export function createOutputManifest(files: Readonly<Record<string, Uint8Array>>): OutputManifest {
  const entries = Object.entries(files).sort(([left], [right]) => left.localeCompare(right)).map(([path, content]) => ({ path, sha256: sha256(content), bytes: content.byteLength }));
  return { algorithm: 'sha256', files: entries };
}

export interface PackagedRuntimeFile { path: string; sha256: string }
export interface PackagedRuntimeDescriptor {
  schemaVersion: 1;
  kind: 'packaged-executable';
  executable: string;
  files: readonly PackagedRuntimeFile[];
}

export function parsePackagedRuntimeDescriptor(value: unknown): PackagedRuntimeDescriptor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Runtime descriptor must be an object.');
  const item = value as Record<string, unknown>;
  if (item.schemaVersion !== 1 || item.kind !== 'packaged-executable') throw new Error('Only schema version 1 packaged executable runtimes are supported.');
  if (typeof item.executable !== 'string' || item.executable.trim() === '') throw new Error('Runtime executable must be a non-empty relative path.');
  if (/^(?:python(?:3|\.exe)?|py(?:\.exe)?)$/i.test(item.executable) || /(^|[\\/])python(?:3|\.exe)?$/i.test(item.executable)) throw new Error('System Python runtimes are prohibited; package a standalone executable.');
  if (/^(?:[a-z]:|[\\/])/i.test(item.executable) || item.executable.split(/[\\/]/).includes('..')) throw new Error('Runtime executable must be a safe relative path.');
  if (!Array.isArray(item.files) || item.files.length === 0) throw new Error('Runtime descriptor must contain integrity-protected files.');
  const files = item.files.map((value, index): PackagedRuntimeFile => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Runtime file ${index} must be an object.`);
    const file = value as Record<string, unknown>;
    if (typeof file.path !== 'string' || file.path.trim() === '' || /^(?:[a-z]:|[\\/])/i.test(file.path) || file.path.split(/[\\/]/).includes('..')) throw new Error(`Runtime file ${index} has an unsafe path.`);
    if (typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(file.sha256)) throw new Error(`Runtime file ${index} must have a SHA-256 hash.`);
    return { path: file.path, sha256: file.sha256.toLowerCase() };
  });
  if (!files.some(file => file.path === item.executable)) throw new Error('Runtime executable must be listed in the integrity files.');
  return { schemaVersion: 1, kind: 'packaged-executable', executable: item.executable, files };
}

export async function verifyPackagedRuntime(descriptor: PackagedRuntimeDescriptor, readFile: (path: string) => Promise<Uint8Array>): Promise<void> {
  for (const file of descriptor.files) {
    const actual = sha256(await readFile(file.path));
    if (actual !== file.sha256) throw new Error(`Runtime integrity check failed for ${file.path}.`);
  }
}