import type { Diagnostic, DocumentSnapshot, JsonPointer } from '../contracts.js';
import type { DefinitionProjection, ImportResolutionFact, ReferenceResolutionFact, ResolvedReferenceKind, ResolutionStatus } from '../model.js';
import { resolveReferences } from '../resolver.js';

export type GraphResolutionStatus = ResolutionStatus | 'external';

/** A render-ready property owned by a JSON Structure type declaration. */
export interface PropertyRow {
  readonly name: string;
  readonly pointer: JsonPointer;
  readonly type: string;
  readonly required: boolean;
  readonly requiredAlternatives?: boolean;
  readonly description?: string;
  readonly schema?: Readonly<Record<string, unknown>>;
}

/** A graph node derived from the normalized document projection. */
export interface GraphNode {
  readonly id: string;
  readonly pointer: JsonPointer;
  readonly label: string;
  readonly namespace: string;
  readonly kind: 'type' | 'namespace' | 'document' | 'target';
  readonly status?: GraphResolutionStatus;
  readonly target?: string;
  readonly documentUri?: string;
  readonly provenance?: 'import' | 'importdefs';
  readonly selectable?: boolean;
}

/** A directed graph edge derived from inheritance, references, and relations. */
export interface GraphEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly pointer?: JsonPointer;
  readonly label: string;
  readonly kind: 'root' | 'inheritance' | 'reference' | 'relation' | 'relation-qualifier' | 'import';
  readonly status?: GraphResolutionStatus;
  readonly target?: string;
  readonly targetPointer?: JsonPointer;
  readonly documentUri?: string;
  readonly provenance?: 'import' | 'importdefs';
  readonly reason?: string;
  readonly selectable?: boolean;
}

export interface GraphProjection { readonly nodes: readonly GraphNode[]; readonly edges: readonly GraphEdge[]; }

/** Returns whether a document value is an inline Core type declaration. */
export function isInlineRootSchema(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const type = (value as Record<string, unknown>).type;
  return typeof type === 'string' ? type.length > 0 : !!type && typeof type === 'object' && !Array.isArray(type) && typeof (type as Record<string, unknown>).$ref === 'string';
}

/** Filters visible reusable types by name and namespace without changing selection. */
export function filterTypes<T extends { readonly name: string; readonly namespace: string }>(definitions: readonly T[], query: string): readonly T[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return definitions;
  return definitions.filter((definition) => `${definition.namespace} ${definition.name}`.toLocaleLowerCase().includes(normalized));
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
  const requiredAlternatives = Array.isArray(definition.required) && definition.required.length > 0 && definition.required.every(Array.isArray);
  return Object.entries(definition.properties).map(([name, schema]) => ({
    name,
    pointer: `${definition.pointer}/properties/${escapePointer(name)}`,
    type: displayType(schema.type),
    required: required.has(name),
    ...(requiredAlternatives ? { requiredAlternatives: true } : {}),
    description: typeof schema.description === 'string' ? schema.description : undefined
    , schema
  }));
}

/** Projects normalized declarations and resolver facts into a render-ready graph. */
export function projectGraph(snapshot: DocumentSnapshot): GraphProjection {
  const model = snapshot.model;
  if (!model) return { nodes: [], edges: [] };
  const definitions = model.projections.definitions.filter((definition) => definition.reusable);
  const nodes: GraphNode[] = definitions.map((definition) => ({
    id: definition.pointer,
    pointer: definition.pointer,
    label: definition.name,
    namespace: namespaceLabel(definition.namespacePointer),
    kind: 'type',
    status: 'resolved',
    documentUri: model.uri,
    selectable: true
  }));
  const edges: GraphEdge[] = [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (snapshotHasInlineRoot(snapshot)) ensureDocumentNode(snapshot, nodes, nodeIds);
  for (const projection of model.projections.imports) addNamespaceNodes(nodes, nodeIds, projection.namespacePointer, model.uri);
  for (const definition of definitions) addNamespaceNodes(nodes, nodeIds, definition.namespacePointer, model.uri);
  const resolution = model.projections.resolution ?? resolveReferences(model);
  resolution.imports.forEach((fact) => projectImportFact(snapshot, fact, nodes, nodeIds, edges));
  resolution.references.forEach((fact) => projectReferenceFact(snapshot, definitions, fact, nodes, nodeIds, edges));
  return { nodes, edges };
}

function projectReferenceFact(snapshot: DocumentSnapshot, definitions: readonly DefinitionProjection[], fact: ReferenceResolutionFact, nodes: GraphNode[], nodeIds: Set<string>, edges: GraphEdge[]): void {
  const owner = fact.kind === 'root' ? ensureDocumentNode(snapshot, nodes, nodeIds) : owningNode(definitions, nodes, fact.pointer) ?? (snapshotHasInlineRoot(snapshot) ? ensureDocumentNode(snapshot, nodes, nodeIds) : undefined);
  if (!owner) return;
  const status = graphStatus(snapshot, fact.status, fact.targetDocumentUri);
  const targetId = targetNode(fact, status, nodes, nodeIds);
  edges.push({
    id: `${owner}:${edgeKind(fact.kind)}:${fact.pointer}:${targetId}`,
    from: owner, to: targetId, pointer: edgePointer(fact), label: referenceLabel(fact), kind: edgeKind(fact.kind), status,
    target: fact.target, targetPointer: fact.targetPointer, documentUri: fact.targetDocumentUri,
    provenance: fact.importOrigins.at(-1)?.provenance, reason: fact.reason
  });
}

function projectImportFact(snapshot: DocumentSnapshot, fact: ImportResolutionFact, nodes: GraphNode[], nodeIds: Set<string>, edges: GraphEdge[]): void {
  const namespace = importDestination(fact.namespacePointer);
  addNamespaceNodes(nodes, nodeIds, namespace, snapshot.uri);
  const status = graphStatus(snapshot, fact.status, fact.documentUri);
  const targets = fact.importedPointers.length ? fact.importedPointers : [`graph:import:${fact.pointer}`];
  for (const target of targets) {
    if (!nodeIds.has(target)) {
      nodes.push({
        id: target, pointer: target.startsWith('/') ? target : fact.pointer,
        label: target.startsWith('/') ? pointerLabel(target) : fact.source,
        namespace: namespaceLabel(namespace), kind: target.startsWith('/') ? 'type' : 'target', status,
        target: fact.source, documentUri: fact.documentUri, provenance: fact.provenance, selectable: false
      });
      nodeIds.add(target);
    } else if (status === 'external') {
      const index = nodes.findIndex((node) => node.id === target);
      nodes[index] = { ...nodes[index]!, status, documentUri: fact.documentUri, provenance: fact.provenance, target: fact.source };
    }
    edges.push({
      id: `${namespace}:import:${fact.pointer}:${target}`, from: namespace, to: target,
      pointer: fact.pointer, label: fact.provenance === 'import' ? '$import' : '$importdefs', kind: 'import', status,
      target: fact.source, documentUri: fact.documentUri, provenance: fact.provenance, reason: fact.reason
    });
  }
}

export function projectLegacyFacts(snapshot: DocumentSnapshot, definitions: readonly DefinitionProjection[], nodes: GraphNode[], nodeIds: Set<string>, edges: GraphEdge[]): void {
  const facts: ReferenceResolutionFact[] = snapshot.model!.projections.references.map((reference) => ({
    pointer: reference.pointer, target: reference.target, normalizedTarget: normalizeRef(reference.target), kind: reference.kind,
    status: nodeIds.has(normalizeRef(reference.target) ?? '') ? 'resolved' : 'unresolved', importOrigins: []
  }));
  for (const definition of definitions) for (const relation of definition.relations) {
    if (relation.targetTypeRef) facts.push(legacyRelationFact(relation.pointer, relation.targetTypeRef, 'relation-target', nodeIds));
    if (relation.qualifierTypeRef) facts.push(legacyRelationFact(relation.pointer, relation.qualifierTypeRef, 'relation-qualifier', nodeIds));
  }
  facts.forEach((fact) => projectReferenceFact(snapshot, definitions, fact, nodes, nodeIds, edges));
}

function legacyRelationFact(pointer: string, target: string, kind: 'relation-target' | 'relation-qualifier', nodeIds: ReadonlySet<string>): ReferenceResolutionFact {
  const suffix = kind === 'relation-target' ? 'targettype' : 'qualifiertype';
  const normalizedTarget = normalizeRef(target);
  return { pointer: `${pointer}/${suffix}/$ref`, target, normalizedTarget, kind, status: nodeIds.has(normalizedTarget ?? '') ? 'resolved' : 'unresolved', importOrigins: [] };
}

function targetNode(fact: ReferenceResolutionFact, status: GraphResolutionStatus, nodes: GraphNode[], nodeIds: Set<string>): string {
  const effectivePointer = fact.normalizedTarget;
  if (effectivePointer && nodeIds.has(effectivePointer)) {
    if (status === 'external') updateTargetNode(nodes, effectivePointer, fact, status);
    return effectivePointer;
  }
  const id = status === 'external' && effectivePointer ? effectivePointer : `graph:target:${fact.kind}:${fact.pointer}`;
  if (!nodeIds.has(id)) {
    nodes.push({
      id, pointer: effectivePointer ?? fact.pointer,
      label: pointerLabel(effectivePointer ?? fact.targetPointer ?? fact.pointer),
      namespace: effectivePointer ? namespaceLabel(effectivePointer.slice(0, effectivePointer.lastIndexOf('/'))) : status,
      kind: status === 'external' ? 'type' : 'target', status, target: fact.target,
      documentUri: fact.targetDocumentUri, provenance: fact.importOrigins.at(-1)?.provenance, selectable: false
    });
    nodeIds.add(id);
  }
  return id;
}

function updateTargetNode(nodes: GraphNode[], id: string, fact: ReferenceResolutionFact, status: GraphResolutionStatus): void {
  const index = nodes.findIndex((node) => node.id === id);
  if (index >= 0) nodes[index] = { ...nodes[index]!, status, documentUri: fact.targetDocumentUri, provenance: fact.importOrigins.at(-1)?.provenance, target: fact.target };
}

function addNamespaceNodes(nodes: GraphNode[], nodeIds: Set<string>, pointer: JsonPointer, documentUri: string): void {
  const destination = importDestination(pointer);
  if (!destination.startsWith('/definitions/')) return;
  const segments = destination.split('/').slice(2);
  for (let index = 0; index < segments.length; index++) {
    const id = `/definitions/${segments.slice(0, index + 1).join('/')}`;
    if (nodeIds.has(id)) continue;
    nodes.push({ id, pointer: id, label: pointerLabel(id), namespace: namespaceLabel(id.slice(0, id.lastIndexOf('/'))), kind: 'namespace', status: 'resolved', documentUri, selectable: true });
    nodeIds.add(id);
  }
}

function ensureDocumentNode(snapshot: DocumentSnapshot, nodes: GraphNode[], nodeIds: Set<string>): string {
  const id = 'graph:document';
  if (!nodeIds.has(id)) {
    nodes.unshift({ id, pointer: '', label: snapshot.model?.name ?? 'Document', namespace: 'document', kind: 'document', status: 'resolved', documentUri: snapshot.uri, selectable: true });
    nodeIds.add(id);
  }
  return id;
}

function owningNode(definitions: readonly DefinitionProjection[], nodes: readonly GraphNode[], pointer: JsonPointer): string | undefined {
  return [...definitions.map((definition) => definition.pointer), ...nodes.filter((node) => node.kind === 'type').map((node) => node.id)]
    .filter((candidate) => candidate !== '' && (pointer === candidate || pointer.startsWith(`${candidate}/`)))
    .sort((left, right) => right.length - left.length)[0];
}

function graphStatus(snapshot: DocumentSnapshot, status: ResolutionStatus, documentUri?: string): GraphResolutionStatus {
  return status === 'resolved' && documentUri !== undefined && documentUri !== snapshot.model?.uri ? 'external' : status;
}

function snapshotHasInlineRoot(snapshot: DocumentSnapshot): boolean {
  try { return isInlineRootSchema(JSON.parse(snapshot.text)); }
  catch { return false; }
}

function edgeKind(kind: ResolvedReferenceKind): GraphEdge['kind'] {
  if (kind === 'root') return 'root';
  if (kind === 'extends') return 'inheritance';
  if (kind === 'relation-target') return 'relation';
  if (kind === 'relation-qualifier') return 'relation-qualifier';
  return 'reference';
}

function referenceLabel(fact: ReferenceResolutionFact): string {
  if (fact.kind === 'root') return '$root';
  if (fact.kind === 'extends') return 'extends';
  const relation = fact.pointer.match(/\/relations\/([^/]+)\/(?:targettype|qualifiertype)\/\$ref$/);
  if (relation) return `${decodePointerPart(relation[1]!)}${fact.kind === 'relation-qualifier' ? ' qualifier' : ''}`;
  const path = fact.pointer.replace(/\/(?:type\/)?\$ref$/, '').split('/').filter(Boolean).map(decodePointerPart);
  const family = path.at(-2);
  const leaf = path.at(-1) ?? '$ref';
  if (family === 'properties' || family === 'choices') return leaf;
  if (family === 'patternProperties' || family === 'patternKeys') return `${family}:${leaf}`;
  if (family === 'allOf' || family === 'anyOf' || family === 'oneOf') return `${family}[${leaf}]`;
  return leaf;
}

function edgePointer(fact: ReferenceResolutionFact): JsonPointer {
  if (fact.kind === 'relation-target' || fact.kind === 'relation-qualifier') return fact.pointer.replace(/\/(?:targettype|qualifiertype)\/\$ref$/, '') as JsonPointer;
  return fact.pointer;
}

function importDestination(pointer: JsonPointer): JsonPointer {
  return pointer === '' || pointer === '/definitions' ? '/definitions' : pointer;
}

function decodePointerPart(value: string): string { return value.replace(/~1/g, '/').replace(/~0/g, '~'); }

function normalizeRef(value: string): string | undefined {
  if (!value.startsWith('#')) return undefined;
  try {
    const pointer = decodeURIComponent(value.slice(1));
    return pointer === '' || pointer.startsWith('/') ? pointer : undefined;
  } catch { return undefined; }
}

/** Returns diagnostics associated with a selected pointer or any of its descendants. */
export function diagnosticsForPointer(diagnostics: readonly Diagnostic[], pointer: JsonPointer | undefined): readonly Diagnostic[] {
  if (!pointer) return diagnostics;
  return diagnostics.filter((diagnostic) => !diagnostic.location?.pointer || diagnostic.location.pointer === pointer || diagnostic.location.pointer.startsWith(`${pointer}/`));
}

function displayType(value: unknown): string {
  if (typeof value === 'string') return value;
  const target = value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).$ref === 'string'
    ? (value as Record<string, string>).$ref : undefined;
  if (target) return pointerLabel(normalizeRef(target) ?? target);
  if (Array.isArray(value)) return value.map(displayType).join(' or ');
  return value === undefined ? 'unknown' : displayValue(value);
}

function namespaceLabel(pointer: JsonPointer): string {
  return pointer === '' ? 'root' : pointerLabel(pointer);
}

function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** A populated declaration keyword rendered by the Inspector. */
export interface InspectorField {
  readonly keyword: string;
  readonly value: string;
  readonly origin: 'authored' | 'effective';
}

/** A named group of declaration fields rendered by the Inspector. */
export interface InspectorSection {
  readonly label: string;
  readonly fields: readonly InspectorField[];
}

/** Projects all populated normalized declaration features into stable Inspector groups. */
export function projectInspectorSections(definition: DefinitionProjection | undefined): readonly InspectorSection[] {
  if (!definition) return [];
  const sections: InspectorSection[] = [];
  addSection(sections, 'Core', {
    type: definition.type, form: definition.coreForm, '$extends': definition.extends, identity: definition.identity,
    required: definition.required, items: definition.items, values: definition.values, tuple: definition.tuple, maxLength: definition.maxLength
  });
  if (definition.properties) addSection(sections, 'Properties', { properties: Object.keys(definition.properties) });
  if (definition.relations.length) addSection(sections, 'Relations', Object.fromEntries(definition.relations.map((relation) => [relation.name, {
    target: relation.targetTypeRef, cardinality: relation.cardinality, scope: relation.scope, qualifier: relation.qualifierTypeRef
  }])));
  addProjectionSection(sections, 'Validation', definition.validation, new Set(['effectiveMinContains', 'maxLength']));
  addProjectionSection(sections, 'Units', definition.units, new Set(['preferredComputationalUnit']));
  addProjectionSection(sections, 'Alternate names', definition.alternateNames, new Set(['inspection']));
  addProjectionSection(sections, 'Composition', definition.composition, new Set(['inspection']));
  addProjectionSection(sections, 'Semantic annotations', definition.semantic);
  addProjectionSection(sections, 'Binary', definition.binary, new Set(['contentEncoding']));
  addEffectiveField(sections, 'Validation', 'minContains', definition.validation?.effectiveMinContains);
  addEffectiveField(sections, 'Units', 'preferredComputationalUnit', definition.units?.preferredComputationalUnit);
  addEffectiveField(sections, 'Binary', 'contentEncoding', definition.binary?.contentEncoding);
  return sections.filter((section) => section.fields.length > 0);
}

/** Projects the authored schema at a property or inline-root pointer for Inspector display. */
export function projectSchemaInspectorSections(schema: unknown): readonly InspectorSection[] {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [];
  const value = schema as Record<string, unknown>;
  const groups: readonly [string, readonly string[]][] = [
    ['Core', ['type', 'description', '$extends', 'abstract', 'identity', 'required', 'items', 'values', 'tuple', 'choices', 'selector', 'maxLength']],
    ['Relations', ['relations']],
    ['Validation', ['const', 'enum', 'default', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'pattern', 'format', 'minItems', 'maxItems', 'uniqueItems', 'contains', 'minContains', 'maxContains']],
    ['Units', ['unit', 'ucumUnit', 'currency']],
    ['Alternate names', ['altnames']],
    ['Composition', ['allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else']],
    ['Semantic annotations', ['semanticType', 'semanticRole']],
    ['Binary', ['contentEncoding', 'contentMediaType']]
  ];
  const sections: InspectorSection[] = [];
  const consumed = new Set<string>();
  for (const [label, keywords] of groups) {
    const fields = keywords.filter((keyword) => value[keyword] !== undefined).map((keyword) => {
      consumed.add(keyword);
      return { keyword, value: displayValue(value[keyword]), origin: 'authored' as const };
    });
    if (fields.length) sections.push({ label, fields });
  }
  const remaining = Object.keys(value).filter((keyword) => !consumed.has(keyword) && keyword !== 'properties');
  if (remaining.length) sections.push({ label: 'Other', fields: remaining.map((keyword) => ({ keyword, value: displayValue(value[keyword]), origin: 'authored' as const })) });
  return sections;
}

function addProjectionSection(sections: InspectorSection[], label: string, projection: object | undefined, omitted = new Set<string>()): void {
  if (!projection) return;
  addSection(sections, label, Object.fromEntries(Object.entries(projection).filter(([keyword]) => !omitted.has(keyword))));
}

function addSection(sections: InspectorSection[], label: string, values: Readonly<Record<string, unknown>>): void {
  const fields = Object.entries(values).filter(([, value]) => value !== undefined).map(([keyword, value]) => ({ keyword, value: displayValue(value), origin: 'authored' as const }));
  if (fields.length) sections.push({ label, fields });
}

function addEffectiveField<T>(sections: InspectorSection[], label: string, keyword: string, value: { readonly explicit?: T; readonly effective: T } | undefined): void {
  if (!value) return;
  let section = sections.find((candidate) => candidate.label === label);
  const field: InspectorField = { keyword, value: displayValue(value.explicit ?? value.effective), origin: value.explicit === undefined ? 'effective' : 'authored' };
  if (!section) { sections.push({ label, fields: [field] }); return; }
  section = { ...section, fields: [...section.fields, field] };
  sections[sections.findIndex((candidate) => candidate.label === label)] = section;
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(displayValue).join(', ');
  if (value && typeof value === 'object') {
    const reference = (value as Record<string, unknown>).$ref;
    if (typeof reference === 'string') return pointerLabel(normalizeRef(reference) ?? reference);
    const keys = Object.keys(value);
    return `${keys.length} configured ${keys.length === 1 ? 'field' : 'fields'}`;
  }
  return 'Not set';
}