import type { Diagnostic, DocumentSnapshot, JsonPointer } from '../contracts.js';
import type { DefinitionProjection, RelationProjection } from '../model.js';

/** A render-ready property owned by a JSON Structure type declaration. */
export interface PropertyRow {
  readonly name: string;
  readonly pointer: JsonPointer;
  readonly type: string;
  readonly required: boolean;
  readonly description?: string;
}

/** A graph node derived from the normalized document projection. */
export interface GraphNode {
  readonly id: string;
  readonly pointer: JsonPointer;
  readonly label: string;
  readonly namespace: string;
  readonly kind: 'type' | 'namespace';
}

/** A directed graph edge derived from inheritance, references, and relations. */
export interface GraphEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly label: string;
  readonly kind: 'inheritance' | 'reference' | 'relation';
}

/** Converts a JSON pointer segment into a display label. */
export function pointerLabel(pointer: JsonPointer): string {
  if (pointer === '') return 'Document';
  const last = pointer.slice(pointer.lastIndexOf('/') + 1);
  return last.replace(/~1/g, '/').replace(/~0/g, '~') || 'Document';
}

/** Projects a type declaration's properties for the focused design grid. */
export function projectProperties(definition: DefinitionProjection | undefined): readonly PropertyRow[] {
  if (!definition?.properties) return [];
  const required = new Set(Array.isArray(definition.required) ? definition.required.flat() : []);
  return Object.entries(definition.properties).map(([name, schema]) => ({
    name,
    pointer: `${definition.pointer}/properties/${escapePointer(name)}`,
    type: displayType(schema.type),
    required: required.has(name),
    description: typeof schema.description === 'string' ? schema.description : undefined
  }));
}

/** Projects normalized definitions and their links into a small, stable graph model. */
export function projectGraph(snapshot: DocumentSnapshot): { readonly nodes: readonly GraphNode[]; readonly edges: readonly GraphEdge[] } {
  const definitions = (snapshot.model?.projections.definitions ?? []).filter((definition) => definition.reusable);
  const nodes: GraphNode[] = definitions.map((definition) => ({
    id: definition.pointer,
    pointer: definition.pointer,
    label: definition.name,
    namespace: namespaceLabel(definition.namespacePointer),
    kind: 'type'
  }));
  const known = new Set(nodes.map((node) => node.id));
  const edges: GraphEdge[] = [];
  for (const definition of definitions) {
    referenceList(definition.extends).forEach((target, index) => addEdge(edges, known, definition.pointer, target, 'extends', 'inheritance', index));
    definition.relations.forEach((relation, index) => addRelationEdge(edges, known, definition.pointer, relation, index));
  }
  for (const reference of snapshot.model?.projections.references ?? []) {
    if (reference.kind !== 'ref') continue;
    const owner = definitions.find((definition) => reference.pointer.startsWith(`${definition.pointer}/`));
    if (owner) addEdge(edges, known, owner.pointer, reference.target, pointerLabel(reference.pointer), 'reference', edges.length);
  }
  return { nodes, edges };
}

/** Returns diagnostics associated with a selected pointer or any of its descendants. */
export function diagnosticsForPointer(diagnostics: readonly Diagnostic[], pointer: JsonPointer | undefined): readonly Diagnostic[] {
  if (!pointer) return diagnostics;
  return diagnostics.filter((diagnostic) => !diagnostic.location?.pointer || diagnostic.location.pointer === pointer || diagnostic.location.pointer.startsWith(`${pointer}/`));
}

function addRelationEdge(edges: GraphEdge[], known: Set<string>, from: string, relation: RelationProjection, index: number): void {
  if (relation.targetTypeRef) addEdge(edges, known, from, relation.targetTypeRef, relation.name, 'relation', index);
}

function addEdge(edges: GraphEdge[], known: Set<string>, from: string, target: string, label: string, kind: GraphEdge['kind'], index: number): void {
  const pointer = normalizeRef(target);
  if (pointer && known.has(pointer)) edges.push({ id: `${from}:${kind}:${index}:${pointer}`, from, to: pointer, label, kind });
}

function normalizeRef(value: string): string | undefined {
  return value.startsWith('#/') ? value.slice(1) : undefined;
}

function referenceList(value: string | readonly string[] | undefined): readonly string[] {
  return typeof value === 'string' ? [value] : value ?? [];
}

function displayType(value: unknown): string {
  if (typeof value === 'string') return value;
  const target = value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).$ref === 'string'
    ? (value as Record<string, string>).$ref : undefined;
  return target ? pointerLabel(normalizeRef(target) ?? target) : value === undefined ? 'unknown' : JSON.stringify(value);
}

function namespaceLabel(pointer: JsonPointer): string {
  return pointer === '' ? 'root' : pointerLabel(pointer);
}

function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}