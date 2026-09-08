import { resolveCapabilities } from '../capabilities.js';
import { isImportUriReference } from '../import-uri.js';

export type JsonObject = Record<string, unknown>;

export interface RefactoringCollision {
  readonly pointer: string;
  readonly kind: 'target-exists' | 'source-missing' | 'invalid-pointer' | 'invalid-selection';
  readonly message: string;
}

export interface RefactoringImpact {
  readonly kind: 'add' | 'remove' | 'replace' | 'rewrite-reference';
  readonly pointer: string;
  readonly from?: unknown;
  readonly to?: unknown;
}

export interface DeclarationProvenance {
  readonly sourcePointer: string;
  readonly targetPointer: string;
  readonly reason: 'selected' | 'dependency' | 'extracted' | 'shadow' | 'import';
}

export interface RefactoringPlan<T extends JsonObject = JsonObject> {
  readonly applicable: boolean;
  readonly resultingDocument: T;
  readonly preview: readonly RefactoringImpact[];
  readonly impact: readonly RefactoringImpact[];
  readonly collisions: readonly RefactoringCollision[];
  readonly provenance: readonly DeclarationProvenance[];
  readonly referenceRewrites: Readonly<Record<string, string>>;
}

export interface MoveDefinitionOptions {
  readonly sourcePointer: string;
  readonly targetNamespacePointer?: string;
  readonly targetName?: string;
}

export interface ExtractInlinePropertyOptions {
  readonly propertyPointer: string;
  readonly definitionName: string;
  readonly targetNamespacePointer?: string;
}

export interface CopyDeclarationsOptions {
  readonly sourceDocument: JsonObject;
  readonly selectedPointers: readonly string[];
  readonly targetDocument?: JsonObject;
  readonly targetNamespacePointer?: string;
}

export interface MaterializeDeclarationsOptions extends CopyDeclarationsOptions {
  readonly importPointer: string;
  readonly importSource: string;
}

export interface LocalShadowOptions {
  readonly sourcePointer: string;
  readonly targetNamespacePointer?: string;
  readonly targetName?: string;
}

export interface AddImportOptions {
  readonly destinationPointer: string;
  readonly source: string;
  readonly keyword?: '$import' | '$importdefs';
}

const CORE_TYPES = new Set([
  'string', 'number', 'integer', 'boolean', 'null',
  'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'int128', 'uint128',
  'float8', 'float', 'double', 'decimal', 'date', 'datetime', 'time', 'duration', 'uuid', 'uri', 'binary', 'jsonpointer',
  'object', 'array', 'map', 'set', 'tuple', 'choice'
]);

export function planMoveDefinition<T extends JsonObject>(document: T, options: MoveDefinitionOptions): RefactoringPlan<T> {
  const sourceSegments = parsePointer(options.sourcePointer);
  const targetNamespace = options.targetNamespacePointer ?? '/definitions';
  const targetSegments = parsePointer(targetNamespace);
  if (!sourceSegments) return failedPlan(document, invalidPointer(options.sourcePointer));
  if (!targetSegments) return failedPlan(document, invalidPointer(targetNamespace));
  if (!pointerExists(document, sourceSegments)) return failedPlan(document, missingSource(options.sourcePointer));
  if (!reusableDefinitionPointer(document, sourceSegments)) {
    return failedPlan(document, invalidSelection(options.sourcePointer, `Move source must be a reusable definition: ${options.sourcePointer}`));
  }
  if (pathStartsWith(targetSegments, sourceSegments)) {
    return failedPlan(document, invalidSelection(targetNamespace, 'A definition cannot be moved into itself or one of its descendants.'));
  }
  if (!structuralDefinitionNamespace(document, targetSegments)) return failedPlan(document, invalidPointer(targetNamespace));
  const sourceName = sourceSegments[sourceSegments.length - 1];
  const targetName = options.targetName ?? sourceName;
  const targetPointer = formatPointer([...targetSegments, targetName]);
  const sourceValue = valueAt(document, sourceSegments);
  const targetContainer = valueAt(document, targetSegments);
  if (!isObject(targetContainer)) return failedPlan(document, invalidPointer(targetNamespace));
  if (Object.prototype.hasOwnProperty.call(targetContainer, targetName)) return failedPlan(document, targetExists(targetPointer));

  const result = clone(document);
  const moved = clone(sourceValue);
  deleteAt(result, sourceSegments);
  setAt(result, [...targetSegments, targetName], moved);
  const rewrites = { [`#${options.sourcePointer}`]: `#${targetPointer}` };
  const referenceImpact = rewriteLocalReferences(result, rewrites, '', referenceTraversalFor(document));
  const impact: RefactoringImpact[] = [
    { kind: 'remove', pointer: options.sourcePointer, from: clone(sourceValue) },
    { kind: 'add', pointer: targetPointer, to: clone(moved) },
    ...referenceImpact
  ];
  return successfulPlan(result as T, impact, [], rewrites);
}

export function planExtractInlineProperty<T extends JsonObject>(document: T, options: ExtractInlinePropertyOptions): RefactoringPlan<T> {
  const propertySegments = parsePointer(options.propertyPointer);
  const namespacePointer = options.targetNamespacePointer ?? '/definitions';
  const namespaceSegments = parsePointer(namespacePointer);
  if (!propertySegments || !namespaceSegments || propertySegments.length < 2) {
    return failedPlan(document, invalidPointer(options.propertyPointer));
  }
  const property = valueAt(document, propertySegments);
  if (!isObject(property)) return failedPlan(document, missingSource(options.propertyPointer));
  const namespace = valueAt(document, namespaceSegments);
  if (!isObject(namespace)) return failedPlan(document, invalidPointer(namespacePointer));
  const targetPointer = appendPointer(namespacePointer, options.definitionName);
  if (Object.prototype.hasOwnProperty.call(namespace, options.definitionName)) return failedPlan(document, targetExists(targetPointer));

  const result = clone(document);
  const reference = { type: { $ref: `#${targetPointer}` } };
  setAt(result, [...namespaceSegments, options.definitionName], clone(property));
  setAt(result, propertySegments, reference);
  const impact: RefactoringImpact[] = [
    { kind: 'add', pointer: targetPointer, to: clone(property) },
    { kind: 'replace', pointer: options.propertyPointer, from: clone(property), to: reference }
  ];
  return successfulPlan(result as T, impact, [{ sourcePointer: options.propertyPointer, targetPointer, reason: 'extracted' }], {});
}

export function planCopyDeclarations(options: CopyDeclarationsOptions): RefactoringPlan {
  const targetNamespace = options.targetNamespacePointer ?? '/definitions';
  const targetSegments = parsePointer(targetNamespace);
  const targetDocument = options.targetDocument ?? options.sourceDocument;
  const sameDocument = targetDocument === options.sourceDocument;
  const traversal = referenceTraversalFor(options.sourceDocument);
  if (!targetSegments || !structuralDefinitionNamespace(targetDocument, targetSegments)) {
    return failedPlan(targetDocument, invalidPointer(targetNamespace));
  }

  const selected = new Set(options.selectedPointers);
  const queue = [...selected];
  const ordered: string[] = [];
  const collisions: RefactoringCollision[] = [];
  while (queue.length > 0) {
    const pointer = queue.shift()!;
    const segments = parsePointer(pointer);
    if (!segments) {
      collisions.push(invalidPointer(pointer));
      continue;
    }
    if (!pointerExists(options.sourceDocument, segments)) {
      collisions.push(missingSource(pointer));
      continue;
    }
    if (!reusableDefinitionPointer(options.sourceDocument, segments)) {
      collisions.push(invalidSelection(pointer, `Copy source must be a reusable definition: ${pointer}`));
      continue;
    }
    const declaration = valueAt(options.sourceDocument, segments) as JsonObject;
    if (ordered.includes(pointer)) continue;
    ordered.push(pointer);
    if (sameDocument && pathsEqual(segments, [...targetSegments, segments[segments.length - 1]])) continue;
    for (const dependency of collectLocalDefinitionReferences(declaration, traversal)) {
      if (!selected.has(dependency) && !ordered.includes(dependency)) queue.push(dependency);
    }
  }

  const destinations = new Map<string, string>();
  const plannedTargets = new Set<string>();
  for (const sourcePointer of ordered) {
    const segments = parsePointer(sourcePointer)!;
    const name = segments[segments.length - 1];
    const target = [...targetSegments, name];
    const targetPointer = formatPointer(target);
    destinations.set(sourcePointer, targetPointer);
    if (plannedTargets.has(targetPointer)) collisions.push(targetExists(targetPointer));
    plannedTargets.add(targetPointer);
    if (pointerExists(targetDocument, target) && !(sameDocument && pathsEqual(segments, target))) collisions.push(targetExists(targetPointer));
  }
  if (collisions.length > 0) return failedPlan(targetDocument, ...collisions);

  const result = clone(targetDocument);
  const rewrites: Record<string, string> = {};
  for (const [source, target] of destinations) {
    if (!sameDocument || !pathsEqual(parsePointer(source)!, parsePointer(target)!)) rewrites[`#${source}`] = `#${target}`;
  }
  const impact: RefactoringImpact[] = [];
  const provenance: DeclarationProvenance[] = [];
  for (const sourcePointer of ordered) {
    const targetPointer = destinations.get(sourcePointer)!;
    const target = parsePointer(targetPointer)!;
    if (sameDocument && pathsEqual(parsePointer(sourcePointer)!, target)) continue;
    const declaration = clone(valueAt(options.sourceDocument, parsePointer(sourcePointer)!)!);
    rewriteLocalReferences(declaration, rewrites, targetPointer, traversal);
    setAt(result, target, declaration);
    impact.push({ kind: 'add', pointer: targetPointer, to: clone(declaration) });
    provenance.push({ sourcePointer, targetPointer, reason: selected.has(sourcePointer) ? 'selected' : 'dependency' });
  }
  return successfulPlan(result, impact, provenance, rewrites);
}

export function planMaterializeDeclarations(options: MaterializeDeclarationsOptions): RefactoringPlan {
  const importSegments = parsePointer(options.importPointer);
  const targetDocument = options.targetDocument ?? options.sourceDocument;
  const authoredImport = importSegments ? valueAt(targetDocument, importSegments) : undefined;
  if (!importSegments) return failedPlan(targetDocument, invalidPointer(options.importPointer));
  const importContext = materializationImportContext(importSegments);
  if (!importContext || !namespaceImportPlacement(targetDocument, importContext.namespaceSegments)) {
    return failedPlan(targetDocument, invalidSelection(options.importPointer, 'Materialization requires an authored $import or $importdefs at a namespace location.'));
  }
  if (options.selectedPointers.length === 0) {
    return failedPlan(targetDocument, invalidSelection(options.importPointer, 'Materialization requires at least one declaration.'));
  }
  if (authoredImport !== options.importSource) {
    return failedPlan(targetDocument, invalidSelection(options.importPointer, `Materialization requires an authored import of '${options.importSource}' at ${options.importPointer}.`));
  }
  const copy = planCopyDeclarations(options);
  if (!copy.applicable) return copy;
  const uncopiedDependencies = collectDocumentLocalDefinitionReferences(targetDocument, referenceTraversalFor(targetDocument))
    .map((pointer) => importedSourceDependency(options.sourceDocument, pointer, importContext))
    .filter((dependency): dependency is ImportedSourceDependency => dependency !== undefined)
    .filter((dependency) => {
      return !hasAuthoredTypeDeclaration(targetDocument, dependency.targetPointer) &&
        !copy.provenance.some((entry) => entry.targetPointer === dependency.targetPointer);
    });
  if (uncopiedDependencies.length > 0) {
    const unique = [...new Map(uncopiedDependencies.map((dependency) => [dependency.targetPointer, dependency])).values()];
    return failedPlan(targetDocument, ...unique.map((dependency) => invalidSelection(
      dependency.targetPointer,
      `Materialization cannot remove '${options.importSource}'; target references uncopied source declaration ${dependency.sourcePointer || '<document root>'}.`
    )));
  }
  const result = clone(copy.resultingDocument);
  deleteAt(result, importSegments);
  const removeImport: RefactoringImpact = { kind: 'remove', pointer: options.importPointer, from: authoredImport };
  return successfulPlan(result, [...copy.impact, removeImport], copy.provenance, copy.referenceRewrites);
}

export function planAddImport<T extends JsonObject>(document: T, options: AddImportOptions): RefactoringPlan<T> {
  const destinationSegments = parsePointer(options.destinationPointer);
  const destination = destinationSegments ? valueAt(document, destinationSegments) : undefined;
  const keyword = options.keyword ?? '$importdefs';
  if (!destinationSegments || !isObject(destination)) return failedPlan(document, invalidPointer(options.destinationPointer));
  if (!namespaceImportPlacement(document, destinationSegments)) return failedPlan(document, invalidPointer(options.destinationPointer));
  if (keyword !== '$import' && keyword !== '$importdefs') return failedPlan(document, invalidSelection(options.destinationPointer, `Unsupported import keyword: ${String(keyword)}`));
  if (!isImportUriReference(options.source)) return failedPlan(document, missingSource(String(options.source)));
  const targetPointer = appendPointer(options.destinationPointer, keyword);
  if (Object.prototype.hasOwnProperty.call(destination, '$import') || Object.prototype.hasOwnProperty.call(destination, '$importdefs')) {
    return failedPlan(document, targetExists(targetPointer));
  }
  const result = clone(document);
  setAt(result, [...destinationSegments, keyword], options.source);
  return successfulPlan(result as T, [{ kind: 'add', pointer: targetPointer, to: options.source }], [{ sourcePointer: options.source, targetPointer, reason: 'import' }], {});
}

export function planLocalShadow<T extends JsonObject>(document: T, options: LocalShadowOptions): RefactoringPlan<T> {
  const sourceSegments = parsePointer(options.sourcePointer);
  const targetNamespace = options.targetNamespacePointer ?? '/definitions';
  const targetSegments = parsePointer(targetNamespace);
  const source = sourceSegments ? valueAt(document, sourceSegments) : undefined;
  if (!sourceSegments || !targetSegments || !isObject(source)) return failedPlan(document, missingSource(options.sourcePointer));
  const targetName = options.targetName ?? sourceSegments[sourceSegments.length - 1];
  const targetPointer = appendPointer(targetNamespace, targetName);
  const targetContainer = valueAt(document, targetSegments);
  if (!isObject(targetContainer)) return failedPlan(document, invalidPointer(targetNamespace));
  if (Object.prototype.hasOwnProperty.call(targetContainer, targetName)) return failedPlan(document, targetExists(targetPointer));
  const result = clone(document);
  setAt(result, [...targetSegments, targetName], clone(source));
  const impact: RefactoringImpact[] = [{ kind: 'add', pointer: targetPointer, to: clone(source) }];
  return successfulPlan(result as T, impact, [{ sourcePointer: options.sourcePointer, targetPointer, reason: 'shadow' }], {});
}

export function previewRefactoringImpact(plan: RefactoringPlan): readonly RefactoringImpact[] {
  return plan.impact;
}

function collectLocalDefinitionReferences(value: unknown, traversal: ReferenceTraversal): string[] {
  const references = new Set<string>();
  visitSchemaReferences(value, (_container, _key, candidate) => {
    for (const reference of typeof candidate === 'string' ? [candidate] : Array.isArray(candidate) ? candidate : []) {
      const pointer = localReferencePointer(reference);
      if (pointer?.startsWith('/definitions/')) references.add(pointer);
    }
  }, [], traversal);
  return [...references];
}

function rewriteLocalReferences(
  value: unknown,
  rewrites: Readonly<Record<string, string>>,
  basePointer = '',
  traversal: ReferenceTraversal = ALL_REFERENCE_POSITIONS,
): RefactoringImpact[] {
  const impact: RefactoringImpact[] = [];
  const rewrite = (container: JsonObject, key: string, candidate: unknown, path: string[]): void => {
    const rewrite = (entry: unknown): unknown => typeof entry === 'string' ? rewriteReference(entry, rewrites) : entry;
    const rewritten = Array.isArray(candidate) ? candidate.map(rewrite) : rewrite(candidate);
    if (!deepEqual(candidate, rewritten)) {
      container[key] = rewritten;
      impact.push({ kind: 'rewrite-reference', pointer: `${basePointer}${formatPointer(path)}`, from: candidate, to: rewritten });
    }
  };
  if (basePointer === '') visitDocumentReferences(value, rewrite, traversal);
  else visitSchemaReferences(value, rewrite, [], traversal);
  return impact;
}

type SchemaReferenceVisitor = (container: JsonObject, key: string, value: unknown, path: string[]) => void;

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

function visitSchemaReferences(value: unknown, visitor: SchemaReferenceVisitor, path: string[], traversal: ReferenceTraversal): void {
  if (!isObject(value)) return;
  for (const [member, nested] of Object.entries(value)) {
    const memberPath = [...path, member];
    if (member === '$ref' || member === '$root' || member === '$extends') {
      visitor(value, member, nested, memberPath);
    } else if (member === 'type') {
      visitTypeReferences(nested, visitor, memberPath, traversal);
    } else if ((CORE_SCHEMA_MEMBERS as readonly string[]).includes(member)) {
      visitSchemaReferences(nested, visitor, memberPath, traversal);
    } else if ((CORE_SCHEMA_MAP_MEMBERS as readonly string[]).includes(member) && isObject(nested)) {
      for (const [name, schema] of Object.entries(nested)) visitSchemaReferences(schema, visitor, [...memberPath, name], traversal);
    } else if (traversal.validation && (VALIDATION_SCHEMA_MEMBERS as readonly string[]).includes(member)) {
      visitSchemaReferences(nested, visitor, memberPath, traversal);
    } else if (traversal.validation && (VALIDATION_SCHEMA_MAP_MEMBERS as readonly string[]).includes(member) && isObject(nested)) {
      for (const [name, schema] of Object.entries(nested)) visitSchemaReferences(schema, visitor, [...memberPath, name], traversal);
    } else if (traversal.composition && (COMPOSITION_SCHEMA_MEMBERS as readonly string[]).includes(member)) {
      visitSchemaReferences(nested, visitor, memberPath, traversal);
    } else if (traversal.composition && (COMPOSITION_SCHEMA_ARRAY_MEMBERS as readonly string[]).includes(member) && Array.isArray(nested)) {
      nested.forEach((schema, index) => visitSchemaReferences(schema, visitor, [...memberPath, String(index)], traversal));
    } else if (traversal.relations && member === 'relations' && isObject(nested)) {
      for (const [name, relation] of Object.entries(nested)) {
        if (!isObject(relation)) continue;
        visitReferenceWrapper(relation.targettype, visitor, [...memberPath, name, 'targettype'], traversal);
        visitReferenceWrapper(relation.qualifiertype, visitor, [...memberPath, name, 'qualifiertype'], traversal);
      }
    }
  }
}

function visitTypeReferences(value: unknown, visitor: SchemaReferenceVisitor, path: string[], traversal: ReferenceTraversal): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitTypeReferences(entry, visitor, [...path, String(index)], traversal));
  } else {
    visitReferenceWrapper(value, visitor, path, traversal);
  }
}

function visitReferenceWrapper(value: unknown, visitor: SchemaReferenceVisitor, path: string[], traversal: ReferenceTraversal): void {
  if (isObject(value)) visitSchemaReferences(value, visitor, path, traversal);
}

function visitDocumentReferences(value: unknown, visitor: SchemaReferenceVisitor, traversal: ReferenceTraversal): void {
  visitSchemaReferences(value, visitor, [], traversal);
  if (!isObject(value)) return;
  const offers = value.$offers;
  if (isObject(offers)) {
    for (const [name, offer] of Object.entries(offers)) visitor(offers, name, offer, ['$offers', name]);
  }
  visitDefinitionNamespace(value.definitions, visitor, ['definitions'], traversal);
}

function visitDefinitionNamespace(value: unknown, visitor: SchemaReferenceVisitor, path: string[], traversal: ReferenceTraversal): void {
  if (!isObject(value)) return;
  for (const [name, entry] of Object.entries(value)) {
    if (name === '$import' || name === '$importdefs' || !isObject(entry)) continue;
    const entryPath = [...path, name];
    if (isSchemaDeclaration(entry, traversal)) visitSchemaReferences(entry, visitor, entryPath, traversal);
    else visitDefinitionNamespace(entry, visitor, entryPath, traversal);
  }
}

function collectDocumentLocalDefinitionReferences(value: unknown, traversal: ReferenceTraversal): string[] {
  const references = new Set<string>();
  visitDocumentReferences(value, (_container, _key, candidate) => {
    const values = typeof candidate === 'string' ? [candidate] : Array.isArray(candidate) ? candidate : [];
    for (const reference of values) {
      const pointer = typeof reference === 'string' ? localReferencePointer(reference) : undefined;
      if (pointer?.startsWith('/definitions/')) references.add(pointer);
    }
  }, traversal);
  return [...references];
}

function isSchemaDeclaration(value: JsonObject, traversal: ReferenceTraversal): boolean {
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
  readonly namespaceSegments: readonly string[];
  readonly destinationPointer: string;
}

interface ImportedSourceDependency {
  readonly sourcePointer: string;
  readonly targetPointer: string;
}

function materializationImportContext(importSegments: readonly string[]): MaterializationImportContext | undefined {
  const keyword = importSegments.at(-1);
  if (keyword !== '$import' && keyword !== '$importdefs') return undefined;
  const namespaceSegments = importSegments.slice(0, -1);
  const namespacePointer = formatPointer(namespaceSegments);
  return {
    keyword,
    namespaceSegments,
    destinationPointer: namespacePointer === '' || namespacePointer === '/definitions' ? '/definitions' : namespacePointer,
  };
}

function importedSourceDependency(
  sourceDocument: JsonObject,
  targetPointer: string,
  context: MaterializationImportContext,
): ImportedSourceDependency | undefined {
  if (targetPointer.startsWith(`${context.destinationPointer}/`)) {
    const sourcePointer = `/definitions${targetPointer.slice(context.destinationPointer.length)}`;
    return { sourcePointer, targetPointer };
  }
  if (context.keyword !== '$import' || typeof sourceDocument.name !== 'string') return undefined;
  const importedRootPointer = `${context.destinationPointer}/${escapePointerPart(sourceDocument.name)}`;
  if (targetPointer === importedRootPointer || targetPointer.startsWith(`${importedRootPointer}/`)) {
    return { sourcePointer: '', targetPointer };
  }
  return undefined;
}

function hasAuthoredTypeDeclaration(document: JsonObject, pointer: string): boolean {
  const segments = parsePointer(pointer);
  if (!segments || !pointerExists(document, segments)) return false;
  const value = valueAt(document, segments);
  return isObject(value) && validTypeValue(value.type);
}

function rewriteReference(reference: string, rewrites: Readonly<Record<string, string>>): string {
  const pointer = localReferencePointer(reference);
  if (!pointer) return reference;
  for (const [from, to] of Object.entries(rewrites)) {
    const fromPointer = localReferencePointer(from);
    const toPointer = localReferencePointer(to);
    if (fromPointer && toPointer && (pointer === fromPointer || pointer.startsWith(`${fromPointer}/`))) {
      return `#${toPointer}${pointer.slice(fromPointer.length)}`;
    }
  }
  return reference;
}

function localReferencePointer(reference: string): string | undefined {
  if (!reference.startsWith('#')) return undefined;
  try {
    const pointer = decodeURIComponent(reference.slice(1));
    return parsePointer(pointer) ? pointer : undefined;
  } catch {
    return undefined;
  }
}

function parsePointer(pointer: string): string[] | undefined {
  if (pointer === '') return [];
  if (!pointer.startsWith('/') || /~(?:[^01]|$)/.test(pointer)) return undefined;
  return pointer.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function formatPointer(parts: readonly string[]): string {
  return parts.length === 0 ? '' : `/${parts.map(escapePointerPart).join('/')}`;
}

function appendPointer(pointer: string, member: string): string {
  return `${pointer}/${escapePointerPart(member)}`;
}

function escapePointerPart(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function valueAt(root: unknown, segments: readonly string[]): unknown {
  let current = root;
  for (const segment of segments) {
    if (!isObject(current) && !Array.isArray(current)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function pointerExists(root: unknown, segments: readonly string[]): boolean {
  let current = root;
  for (const segment of segments) {
    if (!isObject(current) && !Array.isArray(current)) return false;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return false;
    current = (current as Record<string, unknown>)[segment];
  }
  return true;
}

function setAt(root: unknown, segments: readonly string[], value: unknown): void {
  const parent = valueAt(root, segments.slice(0, -1));
  if (!isObject(parent) && !Array.isArray(parent)) throw new Error(`Cannot set ${formatPointer(segments)}.`);
  (parent as Record<string, unknown>)[segments[segments.length - 1]] = value;
}

function deleteAt(root: unknown, segments: readonly string[]): void {
  const parent = valueAt(root, segments.slice(0, -1));
  if (isObject(parent)) delete parent[segments[segments.length - 1]];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function successfulPlan<T extends JsonObject>(result: T, impact: readonly RefactoringImpact[], provenance: readonly DeclarationProvenance[], rewrites: Readonly<Record<string, string>>): RefactoringPlan<T> {
  return { applicable: true, resultingDocument: result, preview: impact, impact, collisions: [], provenance, referenceRewrites: rewrites };
}

function failedPlan<T extends JsonObject>(document: T, ...collisions: RefactoringCollision[]): RefactoringPlan<T> {
  return { applicable: false, resultingDocument: clone(document), preview: [], impact: [], collisions, provenance: [], referenceRewrites: {} };
}

function invalidPointer(pointer: string): RefactoringCollision {
  return { pointer, kind: 'invalid-pointer', message: `Pointer does not identify a writable object: ${pointer}` };
}

function missingSource(pointer: string): RefactoringCollision {
  return { pointer, kind: 'source-missing', message: `Source declaration does not exist: ${pointer}` };
}

function targetExists(pointer: string): RefactoringCollision {
  return { pointer, kind: 'target-exists', message: `Target declaration already exists: ${pointer}` };
}

function invalidSelection(pointer: string, message: string): RefactoringCollision {
  return { pointer, kind: 'invalid-selection', message };
}

function namespaceImportPlacement(document: JsonObject, segments: readonly string[]): boolean {
  if (segments.length === 0) return true;
  if (segments[0] !== 'definitions') return false;
  let current: unknown = document.definitions;
  if (!isObject(current)) return false;
  if (segments.length === 1) return true;
  for (const segment of segments.slice(1)) {
    current = current[segment];
    if (!isObject(current) || isTypeDeclaration(current)) return false;
  }
  return true;
}

function structuralDefinitionNamespace(document: JsonObject, segments: readonly string[]): boolean {
  return segments.length > 0 && namespaceImportPlacement(document, segments);
}

function reusableDefinitionPointer(document: JsonObject, segments: readonly string[]): boolean {
  if (segments.length < 2 || segments[0] !== 'definitions' || !isObject(document.definitions)) return false;
  let current: unknown = document.definitions;
  for (let index = 1; index < segments.length; index++) {
    current = (current as JsonObject)[segments[index]];
    if (!isObject(current) || index < segments.length - 1 && isTypeDeclaration(current)) return false;
  }
  return isTypeDeclaration(current as JsonObject);
}

function pathStartsWith(path: readonly string[], prefix: readonly string[]): boolean {
  return path.length >= prefix.length && prefix.every((segment, index) => path[index] === segment);
}

function pathsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && pathStartsWith(left, right);
}

function isTypeDeclaration(value: JsonObject): boolean {
  return validTypeValue(value.type);
}

function validTypeValue(value: unknown): boolean {
  if (typeof value === 'string') return CORE_TYPES.has(value);
  if (typeReferenceValue(value) !== undefined) return true;
  return Array.isArray(value) && value.length > 0 && value.every((member) =>
    typeof member === 'string' ? CORE_TYPES.has(member) : validUnionObjectMember(member));
}

function validUnionObjectMember(value: unknown): boolean {
  if (typeReferenceValue(value) !== undefined) return true;
  if (!isObject(value) || typeof value.type !== 'string') return false;
  if ((value.type === 'array' || value.type === 'set') && isObject(value.items)) return validTypeValue(value.items.type);
  return value.type === 'map' && isObject(value.values) && validTypeValue(value.values.type);
}

function typeReferenceValue(value: unknown): string | undefined {
  if (!isObject(value) || !Object.keys(value).every((key) => key === '$ref' || key === 'description')) return undefined;
  return typeof value.$ref === 'string' && localReferencePointer(value.$ref) !== undefined &&
    (value.description === undefined || typeof value.description === 'string') ? value.$ref : undefined;
}
