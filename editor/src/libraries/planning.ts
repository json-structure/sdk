export interface LibraryProvenance {
  readonly providerId: string;
  readonly entryId: string;
  readonly version: string;
  readonly sourceUri: string;
  readonly sourcePointer?: string;
}

export interface ImportPlan {
  readonly kind: 'import';
  readonly keyword: '$import' | '$importdefs';
  readonly destinationPointer: string;
  readonly source: string;
  readonly provenance: LibraryProvenance;
}

export interface CopyOperation {
  readonly sourcePointer: string;
  readonly destinationPointer: string;
  readonly value: unknown;
  readonly provenance: LibraryProvenance;
}

export interface CopyPlan {
  readonly kind: 'copy';
  readonly operations: readonly CopyOperation[];
}

export interface MaterializePlan {
  readonly kind: 'materialize';
  readonly importPointer: string;
  readonly operations: readonly CopyOperation[];
}

export interface PublishPlan {
  readonly kind: 'publish';
  readonly entryId: string;
  readonly version: string;
  readonly expectedEpoch?: string;
  readonly promoteDefault: boolean;
  readonly document: unknown;
  readonly provenance: LibraryProvenance;
}

export class CopyCollisionError extends Error {
  constructor(readonly collisions: readonly string[]) {
    super(`Copy destination collision: ${collisions.join(', ')}.`);
    this.name = 'CopyCollisionError';
  }
}

export function planLibraryImport(source: string, destinationPointer: string, provenance: LibraryProvenance, keyword: '$import' | '$importdefs' = '$importdefs'): ImportPlan {
  assertPointer(destinationPointer);
  return { kind: 'import', keyword, destinationPointer, source, provenance };
}

export function planLibraryCopy(
  sourceDocument: unknown,
  targetDocument: unknown,
  sourcePointers: readonly string[],
  destinationBase: string,
  provenance: LibraryProvenance,
): CopyPlan {
  assertPointer(destinationBase);
  const selected = new Set(sourcePointers);
  const queue = [...selected];
  const closure: string[] = [];
  while (queue.length) {
    const sourcePointer = queue.shift()!;
    assertPointer(sourcePointer);
    if (closure.includes(sourcePointer)) continue;
    const declaration = readPointer(sourceDocument, sourcePointer);
    closure.push(sourcePointer);
    for (const dependency of collectLocalDefinitionReferences(declaration)) {
      if (!closure.includes(dependency)) queue.push(dependency);
    }
  }
  const mappings = new Map<string, string>();
  for (const sourcePointer of closure) {
    const name = pointerTokens(sourcePointer).at(-1);
    if (name === undefined) throw new Error('The document root cannot be copied as a named declaration.');
    mappings.set(sourcePointer, `${destinationBase}/${escapePointerToken(name)}`);
  }
  const destinations = [...mappings.values()];
  const duplicates = destinations.filter((pointer, index) => destinations.indexOf(pointer) !== index);
  const collisions = [...new Set([...duplicates, ...destinations.filter((pointer) => hasPointer(targetDocument, pointer))])];
  if (collisions.length) throw new CopyCollisionError(collisions);

  return {
    kind: 'copy',
    operations: [...mappings].map(([sourcePointer, destinationPointer]) => ({
      sourcePointer,
      destinationPointer,
      value: rewritePointerReferences(cloneJson(readPointer(sourceDocument, sourcePointer)), mappings),
      provenance: { ...provenance, sourcePointer },
    })),
  };
}

export function planLibraryMaterialization(
  sourceDocument: unknown,
  targetDocument: unknown,
  sourcePointers: readonly string[],
  destinationBase: string,
  importPointer: string,
  provenance: LibraryProvenance,
): MaterializePlan {
  assertPointer(importPointer);
  if (readPointer(targetDocument, importPointer) !== provenance.sourceUri) {
    throw new Error(`Materialization requires an authored import of '${provenance.sourceUri}' at ${importPointer}.`);
  }
  const copy = planLibraryCopy(sourceDocument, targetDocument, sourcePointers, destinationBase, provenance);
  return { kind: 'materialize', importPointer, operations: copy.operations };
}

export function planLibraryPublish(
  entryId: string,
  version: string,
  document: unknown,
  provenance: LibraryProvenance,
  expectedEpoch?: string,
  promoteDefault = false,
): PublishPlan {
  if (!entryId.trim()) throw new Error('Publish entry id must not be empty.');
  if (!version.trim()) throw new Error('Publish version must not be empty.');
  return {
    kind: 'publish',
    entryId: entryId.trim(),
    version: version.trim(),
    ...(typeof expectedEpoch === 'string' && expectedEpoch.trim() ? { expectedEpoch: expectedEpoch.trim() } : {}),
    promoteDefault,
    document: cloneJson(document),
    provenance,
  };
}

export function rewritePointerReferences(value: unknown, mappings: ReadonlyMap<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => rewritePointerReferences(item, mappings));
  if (!value || typeof value !== 'object') return value;
  const rewritten: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    rewritten[key] = isReferenceKeyword(key)
      ? rewriteReferenceValue(nested, mappings)
      : rewritePointerReferences(nested, mappings);
  }
  return rewritten;
}

function rewriteReferenceValue(value: unknown, mappings: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return rewriteReference(value, mappings);
  if (Array.isArray(value)) return value.map((entry) => typeof entry === 'string' ? rewriteReference(entry, mappings) : rewritePointerReferences(entry, mappings));
  return rewritePointerReferences(value, mappings);
}

function rewriteReference(reference: string, mappings: ReadonlyMap<string, string>): string {
  if (!reference.startsWith('#')) return reference;
  const pointer = reference.slice(1);
  for (const [source, destination] of mappings) {
    if (pointer === source || pointer.startsWith(`${source}/`)) return `#${destination}${pointer.slice(source.length)}`;
  }
  return reference;
}

function isReferenceKeyword(key: string): boolean {
  return key === '$ref' || key === '$extends' || key === '$root' || key === 'targettype' || key === 'qualifiertype';
}

function collectLocalDefinitionReferences(value: unknown): readonly string[] {
  const references = new Set<string>();
  const visit = (candidate: unknown, member?: string): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach((entry) => visit(entry, member));
      return;
    }
    if (!candidate || typeof candidate !== 'object') {
      if (member && isReferenceKeyword(member) && typeof candidate === 'string' && candidate.startsWith('#/definitions/')) references.add(candidate.slice(1));
      return;
    }
    for (const [key, nested] of Object.entries(candidate as Record<string, unknown>)) visit(nested, key);
  };
  visit(value);
  return [...references];
}

function readPointer(document: unknown, pointer: string): unknown {
  let current = document;
  for (const token of pointerTokens(pointer)) {
    if (!current || typeof current !== 'object' || !(token in current)) throw new Error(`Source pointer '${pointer}' was not found.`);
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}

function hasPointer(document: unknown, pointer: string): boolean {
  try {
    readPointer(document, pointer);
    return true;
  } catch {
    return false;
  }
}

function pointerTokens(pointer: string): string[] {
  assertPointer(pointer);
  if (!pointer) return [];
  return pointer.slice(1).split('/').map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function escapePointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

function assertPointer(pointer: string): void {
  if (pointer !== '' && !pointer.startsWith('/')) throw new Error(`Invalid RFC 6901 pointer '${pointer}'.`);
  if (/~(?:[^01]|$)/.test(pointer)) throw new Error(`Invalid RFC 6901 escape in pointer '${pointer}'.`);
}

function cloneJson(value: unknown): unknown {
  if (value === undefined) throw new Error('Undefined values cannot be copied.');
  return JSON.parse(JSON.stringify(value)) as unknown;
}