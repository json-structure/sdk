import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const maxPrimaryDocumentBytes = 4 * 1024 * 1024;
const maxPrimaryDocumentDepth = 128;
const maxPrimaryDocumentNodes = 100_000;

export interface InitialFile {
  path: string;
  text: string;
}

/** Reads a user-selected file, returning null when the path is unavailable. */
export async function readFile(path: string): Promise<InitialFile | null> {
  let canonicalPath: string;
  try {
    canonicalPath = await fs.realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  const handle = await fs.open(canonicalPath, 'r');
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error('Primary document is not a file.');
    if (stats.size > maxPrimaryDocumentBytes) throw new Error(`Primary document exceeds the ${maxPrimaryDocumentBytes}-byte limit (received ${stats.size} bytes).`);
    const text = await handle.readFile('utf8');
    validatePrimaryDocument(text);
    return { path: canonicalPath, text };
  } finally {
    await handle.close();
  }
}

export function validatePrimaryDocument(text: string): void {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > maxPrimaryDocumentBytes) throw new Error(`Primary document exceeds the ${maxPrimaryDocumentBytes}-byte limit (received ${bytes} bytes).`);

  let depth = 0;
  let nodes = 0;
  let inString = false;
  let escaped = false;
  let inPrimitive = false;
  const addNode = (): void => {
    nodes += 1;
    if (nodes > maxPrimaryDocumentNodes) throw new Error(`Primary document exceeds the ${maxPrimaryDocumentNodes}-node structural limit.`);
  };
  for (const character of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      addNode();
      inString = true;
      inPrimitive = false;
    } else if (character === '{' || character === '[') {
      addNode();
      depth += 1;
      if (depth > maxPrimaryDocumentDepth) throw new Error(`Primary document exceeds the ${maxPrimaryDocumentDepth}-level nesting limit.`);
      inPrimitive = false;
    } else if (character === '}' || character === ']') {
      depth = Math.max(0, depth - 1);
      inPrimitive = false;
    } else if (character === ',' || character === ':' || /\s/.test(character)) {
      inPrimitive = false;
    } else if (!inPrimitive) {
      addNode();
      inPrimitive = true;
    }
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

export type LibraryResourceReader = (uri: string) => Promise<{ readonly uri: string; readonly document: unknown } | undefined>;

export async function readResource(uri: string, safeRoot: string | undefined, maxBytes: number, readLibraryResource?: LibraryResourceReader): Promise<{ uri: string; content: string }> {
  const libraryResource = await readLibraryResource?.(uri);
  if (libraryResource) {
    const content = JSON.stringify(libraryResource.document);
    if (content === undefined) throw new Error('Imported library resource is not representable as JSON.');
    if (Buffer.byteLength(content, 'utf8') > maxBytes) throw new Error(`Imported resource exceeds the ${maxBytes}-byte limit.`);
    return { uri: libraryResource.uri, content };
  }
  if (!safeRoot) throw new Error('Open a document before loading imported resources.');
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

/** Reads a user-approved conversion source with a strict byte limit. */
export async function readBoundedFile(path: string, maxBytes: number): Promise<InitialFile> {
  const handle = await fs.open(path, 'r');
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error('Conversion source is not a file.');
    if (stats.size > maxBytes) throw new Error(`Conversion source exceeds the ${maxBytes}-byte limit.`);
    const text = await handle.readFile('utf8');
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error(`Conversion source exceeds the ${maxBytes}-byte limit.`);
    return { path, text };
  } finally {
    await handle.close();
  }
}