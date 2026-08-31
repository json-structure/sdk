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

const REFERENCE_MEMBERS = new Set(['$ref', '$extends', '$root', 'targettype', 'qualifiertype']);

export function planMoveDefinition<T extends JsonObject>(document: T, options: MoveDefinitionOptions): RefactoringPlan<T> {
  const sourceSegments = parsePointer(options.sourcePointer);
  const targetNamespace = options.targetNamespacePointer ?? '/definitions';
  const targetSegments = parsePointer(targetNamespace);
  if (!sourceSegments || !targetSegments || sourceSegments.length < 2) {
    return failedPlan(document, invalidPointer(options.sourcePointer));
  }
  const sourceName = sourceSegments[sourceSegments.length - 1];
  const targetName = options.targetName ?? sourceName;
  const targetPointer = appendPointer(targetNamespace, targetName);
  const sourceValue = valueAt(document, sourceSegments);
  if (sourceValue === undefined) return failedPlan(document, missingSource(options.sourcePointer));
  const targetContainer = valueAt(document, targetSegments);
  if (!isObject(targetContainer)) return failedPlan(document, invalidPointer(targetNamespace));
  if (Object.prototype.hasOwnProperty.call(targetContainer, targetName)) return failedPlan(document, targetExists(targetPointer));

  const result = clone(document);
  const moved = clone(sourceValue);
  deleteAt(result, sourceSegments);
  setAt(result, [...targetSegments, targetName], moved);
  const rewrites = { [`#${options.sourcePointer}`]: `#${targetPointer}` };
  const referenceImpact = rewriteLocalReferences(result, rewrites);
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
  if (!targetSegments || !isObject(valueAt(targetDocument, targetSegments))) {
    return failedPlan(targetDocument, invalidPointer(targetNamespace));
  }

  const selected = new Set(options.selectedPointers);
  const queue = [...selected];
  const ordered: string[] = [];
  const collisions: RefactoringCollision[] = [];
  while (queue.length > 0) {
    const pointer = queue.shift()!;
    const segments = parsePointer(pointer);
    const declaration = segments ? valueAt(options.sourceDocument, segments) : undefined;
    if (!segments || !isObject(declaration)) {
      collisions.push(segments ? missingSource(pointer) : invalidPointer(pointer));
      continue;
    }
    if (ordered.includes(pointer)) continue;
    ordered.push(pointer);
    for (const dependency of collectLocalDefinitionReferences(declaration)) {
      if (!selected.has(dependency) && !ordered.includes(dependency)) queue.push(dependency);
    }
  }

  const destinations = new Map<string, string>();
  for (const sourcePointer of ordered) {
    const segments = parsePointer(sourcePointer)!;
    const name = segments[segments.length - 1];
    const targetPointer = appendPointer(targetNamespace, name);
    destinations.set(sourcePointer, targetPointer);
    const existing = valueAt(targetDocument, [...targetSegments, name]);
    if (existing !== undefined && sourcePointer !== targetPointer) collisions.push(targetExists(targetPointer));
  }
  if (collisions.length > 0) return failedPlan(targetDocument, ...collisions);

  const result = clone(targetDocument);
  const rewrites: Record<string, string> = {};
  for (const [source, target] of destinations) rewrites[`#${source}`] = `#${target}`;
  const impact: RefactoringImpact[] = [];
  const provenance: DeclarationProvenance[] = [];
  for (const sourcePointer of ordered) {
    const targetPointer = destinations.get(sourcePointer)!;
    const target = parsePointer(targetPointer)!;
    const declaration = clone(valueAt(options.sourceDocument, parsePointer(sourcePointer)!)!);
    rewriteLocalReferences(declaration, rewrites, targetPointer);
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
  if (authoredImport !== options.importSource) {
    return failedPlan(targetDocument, {
      pointer: options.importPointer,
      kind: 'invalid-selection',
      message: `Materialization requires an authored import of '${options.importSource}' at ${options.importPointer}.`
    });
  }
  const copy = planCopyDeclarations(options);
  if (!copy.applicable) return copy;
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
  if (!options.source.trim()) return failedPlan(document, missingSource(options.source));
  const targetPointer = appendPointer(options.destinationPointer, keyword);
  if (Object.prototype.hasOwnProperty.call(destination, keyword)) return failedPlan(document, targetExists(targetPointer));
  const result = clone(document);
  setAt(result, [...destinationSegments, keyword], options.source.trim());
  return successfulPlan(result as T, [{ kind: 'add', pointer: targetPointer, to: options.source.trim() }], [{ sourcePointer: options.source.trim(), targetPointer, reason: 'import' }], {});
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

function collectLocalDefinitionReferences(value: unknown): string[] {
  const references = new Set<string>();
  visit(value, (member, candidate) => {
    if (!REFERENCE_MEMBERS.has(member)) return;
    for (const reference of typeof candidate === 'string' ? [candidate] : Array.isArray(candidate) ? candidate : []) {
      const pointer = localReferencePointer(reference);
      if (pointer?.startsWith('/definitions/')) references.add(pointer);
    }
  });
  return [...references];
}

function rewriteLocalReferences(value: unknown, rewrites: Readonly<Record<string, string>>, basePointer = ''): RefactoringImpact[] {
  const impact: RefactoringImpact[] = [];
  walk(value, [], (container, key, candidate, path) => {
    if (!REFERENCE_MEMBERS.has(key)) return;
    const rewrite = (entry: unknown): unknown => typeof entry === 'string' ? rewriteReference(entry, rewrites) : entry;
    const rewritten = Array.isArray(candidate) ? candidate.map(rewrite) : rewrite(candidate);
    if (!deepEqual(candidate, rewritten)) {
      container[key] = rewritten;
      impact.push({ kind: 'rewrite-reference', pointer: `${basePointer}${formatPointer(path)}`, from: candidate, to: rewritten });
    }
  });
  return impact;
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

function setAt(root: unknown, segments: readonly string[], value: unknown): void {
  const parent = valueAt(root, segments.slice(0, -1));
  if (!isObject(parent) && !Array.isArray(parent)) throw new Error(`Cannot set ${formatPointer(segments)}.`);
  (parent as Record<string, unknown>)[segments[segments.length - 1]] = value;
}

function deleteAt(root: unknown, segments: readonly string[]): void {
  const parent = valueAt(root, segments.slice(0, -1));
  if (isObject(parent)) delete parent[segments[segments.length - 1]];
}

function visit(value: unknown, visitor: (member: string, value: unknown) => void): void {
  if (Array.isArray(value)) {
    for (const entry of value) visit(entry, visitor);
  } else if (isObject(value)) {
    for (const [member, entry] of Object.entries(value)) {
      visitor(member, entry);
      visit(entry, visitor);
    }
  }
}

function walk(value: unknown, path: string[], visitor: (container: JsonObject, key: string, value: unknown, path: string[]) => void): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, [...path, String(index)], visitor));
  } else if (isObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      visitor(value, key, entry, [...path, key]);
      walk(value[key], [...path, key], visitor);
    }
  }
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