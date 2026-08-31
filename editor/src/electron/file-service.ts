import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

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