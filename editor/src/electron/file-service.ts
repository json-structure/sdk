import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface InitialFile {
  path: string;
  text: string;
}

/** Reads a user-selected file, returning null when the path is unavailable. */
export async function readFile(path: string): Promise<InitialFile | null> {
  try {
    return { path, text: await fs.readFile(path, 'utf8') };
  } catch {
    return null;
  }
}

/**
 * Writes beside the destination and renames into place so readers never observe a partial file.
 */
export async function atomicWrite(path: string, text: string): Promise<void> {
  const temporaryPath = join(dirname(path), `.${path.split(/[\\/]/).pop()}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporaryPath, text, 'utf8');
    await fs.rename(temporaryPath, path);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

export async function readResource(uri: string, safeRoot: string, maxBytes: number): Promise<{ uri: string; content: string }> {
  const parsed = new URL(uri);
  if (parsed.protocol !== 'file:') throw new Error('Only file: imports are supported by the desktop editor.');

  const [canonicalRoot, canonicalPath] = await Promise.all([
    fs.realpath(resolve(safeRoot)),
    fs.realpath(fileURLToPath(parsed)),
  ]);
  const relativePath = relative(canonicalRoot, canonicalPath);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) throw new Error('Imported resources must remain inside the opened document directory.');

  const handle = await fs.open(canonicalPath, 'r');
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error('Imported resource is not a file.');
    if (stats.size > maxBytes) throw new Error(`Imported resource exceeds the ${maxBytes}-byte limit.`);
    const content = await handle.readFile('utf8');
    if (Buffer.byteLength(content, 'utf8') > maxBytes) throw new Error(`Imported resource exceeds the ${maxBytes}-byte limit.`);
    return { uri: pathToFileURL(canonicalPath).toString(), content };
  } finally {
    await handle.close();
  }
}