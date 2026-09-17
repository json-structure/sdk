import { resolveCapabilities } from '../capabilities.js';

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
  readonly documentUri: string;
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
  const traversal = referenceTraversalFor(sourceDocument);
  const selected = new Set(sourcePointers);
  const queue = [...selected];
  const closure: string[] = [];
  while (queue.length) {
    const sourcePointer = queue.shift()!;
    assertPointer(sourcePointer);
    if (closure.includes(sourcePointer)) continue;
    const declaration = readPointer(sourceDocument, sourcePointer);
    closure.push(sourcePointer);
    for (const dependency of collectLocalDefinitionReferences(declaration, traversal)) {
      if (!closure.includes(dependency)) queue.push(dependency);
    }
  }
  const mappings = new Map<string, string>();
  for (const sourcePointer of closure) {
    const name = sourcePointer === '' ? requiredDocumentName(sourceDocument) : pointerTokens(sourcePointer).at(-1)!;
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
      value: rewritePointerReferencesWithTraversal(copySourceValue(sourceDocument, sourcePointer), mappings, traversal),
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
  importSource = provenance.sourceUri,
): MaterializePlan {
  assertPointer(importPointer);
  if (sourcePointers.length === 0) throw new Error('Materialization requires at least one declaration.');
  const importContext = materializationImportContext(importPointer);
  if (!importContext) throw new Error(`Materialization requires an authored $import or $importdefs pointer, received ${importPointer}.`);
  if (readPointer(targetDocument, importPointer) !== importSource) {
    throw new Error(`Materialization requires an authored import of '${importSource}' at ${importPointer}.`);
  }
  const copy = planLibraryCopy(sourceDocument, targetDocument, sourcePointers, destinationBase, provenance);
  const uncopiedDependencies = collectDocumentLocalDefinitionReferences(targetDocument, referenceTraversalFor(targetDocument))
    .map((pointer) => importedSourceDependency(sourceDocument, pointer, importContext))
    .filter((dependency): dependency is ImportedSourceDependency => dependency !== undefined)
    .filter((dependency) =>
      !hasAuthoredTypeDeclaration(targetDocument, dependency.targetPointer) &&
      !copy.operations.some((operation) => operation.destinationPointer === dependency.targetPointer)
    );
  if (uncopiedDependencies.length > 0) {
    const pointers = [...new Set(uncopiedDependencies.map((dependency) => dependency.sourcePointer || '<document root>'))];
    throw new Error(`Materialization cannot remove '${importSource}'; target references uncopied source declarations: ${pointers.join(', ')}.`);
  }
  return { kind: 'materialize', importPointer, operations: copy.operations };
}

export function planLibraryPublish(
  entryId: string,
  version: string,
  document: unknown,
  provenance: LibraryProvenance,
  expectedEpoch?: string,
  promoteDefault = false,
  documentUri = provenance.sourceUri,
): PublishPlan {
  if (!entryId.trim()) throw new Error('Publish entry id must not be empty.');
  if (!version.trim()) throw new Error('Publish version must not be empty.');
  if (!documentUri.trim()) throw new Error('Published document URI must not be empty.');
  return {
    kind: 'publish',
    entryId: entryId.trim(),
    version: version.trim(),
    documentUri: documentUri.trim(),
    ...(typeof expectedEpoch === 'string' && expectedEpoch.trim() ? { expectedEpoch: expectedEpoch.trim() } : {}),
    promoteDefault,
    document: cloneJson(document),
    provenance,
  };
}

export function rewritePointerReferences(value: unknown, mappings: ReadonlyMap<string, string>): unknown {
  return rewritePointerReferencesWithTraversal(value, mappings, ALL_REFERENCE_POSITIONS);
}

function rewritePointerReferencesWithTraversal(value: unknown, mappings: ReadonlyMap<string, string>, traversal: ReferenceTraversal): unknown {
  if (value === undefined) return value;
  const rewritten = cloneJson(value);
  visitSchemaReferences(rewritten, (container, key, candidate) => {
    container[key] = rewriteReferenceValue(candidate, mappings);
  }, traversal);
  return rewritten;
}

function rewriteReferenceValue(value: unknown, mappings: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return rewriteReference(value, mappings);
  if (Array.isArray(value)) return value.map((entry) => typeof entry === 'string' ? rewriteReference(entry, mappings) : entry);
  return value;
}

function rewriteReference(reference: string, mappings: ReadonlyMap<string, string>): string {
  if (!reference.startsWith('#')) return reference;
  const pointer = reference.slice(1);
  for (const [source, destination] of [...mappings].sort(([left], [right]) => right.length - left.length)) {
    if (pointer === source || pointer.startsWith(`${source}/`)) return `#${destination}${pointer.slice(source.length)}`;
  }
  return reference;
}

function requiredDocumentName(document: unknown): string {
  if (!isObject(document) || typeof document.name !== 'string' || !document.name.trim()) {
    throw new Error('Copying the document root requires a document name.');
  }
  return document.name.trim();
}

function copySourceValue(sourceDocument: unknown, sourcePointer: string): unknown {
  const value = cloneJson(readPointer(sourceDocument, sourcePointer));
  if (sourcePointer !== '' || !isObject(value)) return value;
  for (const member of ['$schema', '$id', '$root', '$offers', '$uses', '$import', '$importdefs', 'definitions']) delete value[member];
  return value;
}

function collectLocalDefinitionReferences(value: unknown, traversal: ReferenceTraversal): readonly string[] {
  const references = new Set<string>();
  visitSchemaReferences(value, (_container, _key, candidate) => {
    const values = typeof candidate === 'string' ? [candidate] : Array.isArray(candidate) ? candidate : [];
    for (const reference of values) {
      if (typeof reference === 'string' && reference.startsWith('#/definitions/')) references.add(reference.slice(1));
    }
  }, traversal);
  return [...references];
}

type SchemaReferenceVisitor = (container: Record<string, unknown>, key: string, value: unknown) => void;

interface ReferenceTraversal {
  readonly validation: boolean;
  readonly composition: boolean;
  readonly relations: boolean;
}

const ALL_REFERENCE_POSITIONS: ReferenceTraversal = { validation: true, composition: true, relations: true };
const CORE_SCHEMA_MEMBERS = ['items', 'values', 'additionalProperties'] as const;
const CORE_SCHEMA_MAP_MEMBERS = ['properties', 'choices'] as const;
const VALIDATION_SCHEMA_MEMBERS = ['contains', 'propertyNames', 'keyNames', 'has'] as const;
const VALIDATION_SCHEMA_MAP_MEMBERS = ['patternProperties', 'patternKeys'] as const;
const COMPOSITION_SCHEMA_MEMBERS = ['not', 'if', 'then', 'else'] as const;
const COMPOSITION_SCHEMA_ARRAY_MEMBERS = ['allOf', 'anyOf', 'oneOf'] as const;

function visitSchemaReferences(value: unknown, visitor: SchemaReferenceVisitor, traversal: ReferenceTraversal): void {
  if (!isObject(value)) return;
  for (const [member, nested] of Object.entries(value)) {
    if (member === '$ref' || member === '$root' || member === '$extends') {
      visitor(value, member, nested);
    } else if (member === 'type') {
      visitTypeReferences(nested, visitor, traversal);
    } else if ((CORE_SCHEMA_MEMBERS as readonly string[]).includes(member)) {
      visitSchemaReferences(nested, visitor, traversal);
    } else if ((CORE_SCHEMA_MAP_MEMBERS as readonly string[]).includes(member) && isObject(nested)) {
      Object.values(nested).forEach((schema) => visitSchemaReferences(schema, visitor, traversal));
    } else if (traversal.validation && (VALIDATION_SCHEMA_MEMBERS as readonly string[]).includes(member)) {
      visitSchemaReferences(nested, visitor, traversal);
    } else if (traversal.validation && (VALIDATION_SCHEMA_MAP_MEMBERS as readonly string[]).includes(member) && isObject(nested)) {
      Object.values(nested).forEach((schema) => visitSchemaReferences(schema, visitor, traversal));
    } else if (traversal.composition && (COMPOSITION_SCHEMA_MEMBERS as readonly string[]).includes(member)) {
      visitSchemaReferences(nested, visitor, traversal);
    } else if (traversal.composition && (COMPOSITION_SCHEMA_ARRAY_MEMBERS as readonly string[]).includes(member) && Array.isArray(nested)) {
      nested.forEach((schema) => visitSchemaReferences(schema, visitor, traversal));
    } else if (traversal.relations && member === 'relations' && isObject(nested)) {
      for (const relation of Object.values(nested)) {
        if (!isObject(relation)) continue;
        visitReferenceWrapper(relation.targettype, visitor, traversal);
        visitReferenceWrapper(relation.qualifiertype, visitor, traversal);
      }
    }
  }
}

function visitTypeReferences(value: unknown, visitor: SchemaReferenceVisitor, traversal: ReferenceTraversal): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => visitTypeReferences(entry, visitor, traversal));
  } else {
    visitReferenceWrapper(value, visitor, traversal);
  }
}

function visitReferenceWrapper(value: unknown, visitor: SchemaReferenceVisitor, traversal: ReferenceTraversal): void {
  if (isObject(value)) visitSchemaReferences(value, visitor, traversal);
}

function collectDocumentLocalDefinitionReferences(value: unknown, traversal: ReferenceTraversal): readonly string[] {
  const references = new Set<string>();
  const collect = (_container: Record<string, unknown>, _key: string, candidate: unknown): void => {
    const values = typeof candidate === 'string' ? [candidate] : Array.isArray(candidate) ? candidate : [];
    for (const reference of values) {
      if (typeof reference === 'string' && reference.startsWith('#/definitions/')) references.add(reference.slice(1));
    }
  };
  visitSchemaReferences(value, collect, traversal);
  if (isObject(value)) {
    const offers = value.$offers;
    if (isObject(offers)) {
      for (const [name, offer] of Object.entries(offers)) collect(offers, name, offer);
    }
    visitDefinitionNamespace(value.definitions, collect, traversal);
  }
  return [...references];
}

function visitDefinitionNamespace(value: unknown, visitor: SchemaReferenceVisitor, traversal: ReferenceTraversal): void {
  if (!isObject(value)) return;
  for (const [name, entry] of Object.entries(value)) {
    if (name === '$import' || name === '$importdefs' || !isObject(entry)) continue;
    if (isSchemaDeclaration(entry, traversal)) visitSchemaReferences(entry, visitor, traversal);
    else visitDefinitionNamespace(entry, visitor, traversal);
  }
}

function isSchemaDeclaration(value: Record<string, unknown>, traversal: ReferenceTraversal): boolean {
  return Object.prototype.hasOwnProperty.call(value, 'type') || Object.prototype.hasOwnProperty.call(value, '$ref') ||
    Object.prototype.hasOwnProperty.call(value, '$extends') ||
    traversal.composition && [...COMPOSITION_SCHEMA_MEMBERS, ...COMPOSITION_SCHEMA_ARRAY_MEMBERS]
      .some((member) => Object.prototype.hasOwnProperty.call(value, member));
}

function referenceTraversalFor(document: unknown): ReferenceTraversal {
  if (!isObject(document) || typeof document.$schema !== 'string') return ALL_REFERENCE_POSITIONS;
  const capabilities = resolveCapabilities(document);
  return {
    validation: capabilities.validationActive,
    composition: capabilities.conditionalCompositionActive,
    relations: capabilities.relationsActive,
  };
}

interface MaterializationImportContext {
  readonly keyword: '$import' | '$importdefs';
  readonly destinationPointer: string;
}

interface ImportedSourceDependency {
  readonly sourcePointer: string;
  readonly targetPointer: string;
}

function materializationImportContext(importPointer: string): MaterializationImportContext | undefined {
  const tokens = pointerTokens(importPointer);
  const keyword = tokens.at(-1);
  if (keyword !== '$import' && keyword !== '$importdefs') return undefined;
  const namespacePointer = formatPointerTokens(tokens.slice(0, -1));
  return {
    keyword,
    destinationPointer: namespacePointer === '' || namespacePointer === '/definitions' ? '/definitions' : namespacePointer,
  };
}

function importedSourceDependency(
  sourceDocument: unknown,
  targetPointer: string,
  context: MaterializationImportContext,
): ImportedSourceDependency | undefined {
  if (context.keyword === '$import' && isObject(sourceDocument) && typeof sourceDocument.name === 'string') {
    const importedRootPointer = `${context.destinationPointer}/${escapePointerToken(sourceDocument.name)}`;
    if (targetPointer === importedRootPointer || targetPointer.startsWith(`${importedRootPointer}/`)) {
      return { sourcePointer: '', targetPointer };
    }
  }
  if (targetPointer.startsWith(`${context.destinationPointer}/`)) {
    const sourcePointer = `/definitions${targetPointer.slice(context.destinationPointer.length)}`;
    return { sourcePointer, targetPointer };
  }
  return undefined;
}

function hasAuthoredTypeDeclaration(document: unknown, pointer: string): boolean {
  if (!hasPointer(document, pointer)) return false;
  const value = readPointer(document, pointer);
  return isObject(value) && validTypeValue(value.type);
}

const CORE_TYPES = new Set([
  'string', 'number', 'integer', 'boolean', 'null',
  'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'int128', 'uint128',
  'float8', 'float', 'double', 'decimal', 'date', 'datetime', 'time', 'duration', 'uuid', 'uri', 'binary', 'jsonpointer',
  'object', 'array', 'map', 'set', 'tuple', 'choice'
]);

function validTypeValue(value: unknown): boolean {
  if (typeof value === 'string') return CORE_TYPES.has(value);
  if (typeReferenceValue(value) !== undefined) return true;
  return Array.isArray(value) && value.length > 0 && value.every((entry) =>
    typeof entry === 'string' ? CORE_TYPES.has(entry) : validUnionTypeEntry(entry));
}

function validUnionTypeEntry(value: unknown): boolean {
  if (typeReferenceValue(value) !== undefined) return true;
  if (!isObject(value) || typeof value.type !== 'string') return false;
  if ((value.type === 'array' || value.type === 'set') && isObject(value.items)) return validTypeValue(value.items.type);
  return value.type === 'map' && isObject(value.values) && validTypeValue(value.values.type);
}

function typeReferenceValue(value: unknown): string | undefined {
  return isObject(value) && typeof value.$ref === 'string' &&
    Object.keys(value).every((key) => key === '$ref' || key === 'description') &&
    (value.description === undefined || typeof value.description === 'string') ? value.$ref : undefined;
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

function formatPointerTokens(tokens: readonly string[]): string {
  return tokens.length === 0 ? '' : `/${tokens.map(escapePointerToken).join('/')}`;
}

function assertPointer(pointer: string): void {
  if (pointer !== '' && !pointer.startsWith('/')) throw new Error(`Invalid RFC 6901 pointer '${pointer}'.`);
  if (/~(?:[^01]|$)/.test(pointer)) throw new Error(`Invalid RFC 6901 escape in pointer '${pointer}'.`);
}

function cloneJson(value: unknown): unknown {
  if (value === undefined) throw new Error('Undefined values cannot be copied.');
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}