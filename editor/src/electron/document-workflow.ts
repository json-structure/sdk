import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export type FileDocumentKind = 'file' | 'generated';
export type GeneratedOutputOpenKind = 'json-structure' | 'file' | 'directory';

/** Selects the host opening policy without interpreting generated content. */
export function classifyGeneratedOutputPaths(paths: readonly string[]): GeneratedOutputOpenKind {
  if (paths.length === 0) throw new Error('Generated output list must not be empty.');
  if (paths.length > 1) return 'directory';
  return paths[0]!.toLocaleLowerCase().endsWith('.struct.json') ? 'json-structure' : 'file';
}

/** Finds the directory containing a generated output set. */
export function commonGeneratedOutputDirectory(paths: readonly string[]): string {
  if (paths.length === 0) throw new Error('Generated output list must not be empty.');
  let candidate = dirname(paths[0]!);
  for (const file of paths.slice(1)) {
    while (!isContainedPath(file, candidate)) {
      const parent = dirname(candidate);
      if (parent === candidate) return candidate;
      candidate = parent;
    }
  }
  return candidate;
}

function isContainedPath(file: string, directory: string): boolean {
  const child = relative(directory, file);
  return child === '' || child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child);
}


export interface FileDocumentContext {
  readonly path: string;
  readonly uri: string;
  readonly name: string;
  readonly text: string;
  readonly kind: FileDocumentKind;
}

export interface StagedFileDocument extends FileDocumentContext {
  readonly activationToken: string;
}
export interface UntitledDocumentContext {
  readonly uri: string;
  readonly title: string;
}

export interface ConversionDocumentContext {
  readonly documentPath: string | undefined;
  readonly documentRoot: string | undefined;
  readonly documentUri: string | undefined;
}

/** Captures the approved document identity for one conversion before any asynchronous work. */
export function createConversionDocumentContext(documentPath: string | undefined, documentRoot: string | undefined): ConversionDocumentContext {
  return Object.freeze({
    documentPath,
    documentRoot,
    documentUri: documentPath ? pathToFileURL(documentPath).toString() : undefined,
  });
}

/** Allocates an identity for a new unsaved editor document without touching disk. */
export function createUntitledDocumentContext(id: string = randomUUID()): UntitledDocumentContext {
  if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error('Untitled document identity must be a simple token.');
  return { uri: `untitled:json-structure-${id}.struct.json`, title: 'Untitled JSON Structure' };
}

/** Creates the stable URI and display name carried with an opened file. */
export function createFileDocumentContext(path: string, text: string, kind: FileDocumentKind = 'file'): FileDocumentContext {
  return { path, uri: pathToFileURL(path).toString(), name: basename(path), text, kind };
}

/**
 * Keeps file selection separate from the active document until the renderer
 * accepts a replacement. This prevents a cancelled dirty-document prompt
 * from changing the resource root or save destination.
 */
export class DocumentActivationLedger {
  private readonly staged = new Map<string, FileDocumentContext>();
  private activeDocument: FileDocumentContext | undefined;

  constructor(private readonly tokenFactory: () => string = randomUUID) {}

  stage(document: FileDocumentContext): StagedFileDocument {
    this.staged.clear();
    const activationToken = this.tokenFactory();
    this.staged.set(activationToken, document);
    return { ...document, activationToken };
  }

  /** Stages only while the read request is still current, without an await between the guard and mutation. */
  stageIfCurrent(document: FileDocumentContext, expectedGeneration: number, currentGeneration: () => number): StagedFileDocument | undefined {
    if (expectedGeneration !== currentGeneration()) return undefined;
    return this.stage(document);
  }

  activate(activationToken: string): FileDocumentContext | undefined {
    const document = this.staged.get(activationToken);
    if (!document) return undefined;
    this.staged.delete(activationToken);
    this.activeDocument = document;
    return document;
  }

  discard(activationToken: string): void {
    this.staged.delete(activationToken);
  }

  activatePath(path: string): FileDocumentContext | undefined {
    const match = [...this.staged.entries()].find(([, document]) => document.path === path);
    if (!match) return undefined;
    this.staged.delete(match[0]);
    this.activeDocument = match[1];
    return match[1];
  }

  setActive(document: FileDocumentContext): void {
    this.staged.clear();
    this.activeDocument = document;
  }

  clear(): void {
    this.staged.clear();
    this.activeDocument = undefined;
  }

  get active(): FileDocumentContext | undefined {
    return this.activeDocument;
  }
}
