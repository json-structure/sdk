import { resolveCapabilities } from './capabilities.js';
import { coreScalarValueValid, deeplyUniqueJsonValues, validCoreTypeValue } from './parser.js';
import { compileSafeRegex } from './safe-regex.js';
import { compareNumeric, multipleOf } from './numeric.js';
import { InstanceWorkspace } from './phase4/instance-workspace.js';
import { resolveEffectiveMembers, type EffectiveMemberOptions } from './phase4/effective-members.js';
import { ResolvedSchemaContext } from './phase4/resolved-schema.js';
import { SchemaLocationIndex, schemaRecord, schemaPointerToken, schemaValueAt, COMPOSITION_KEYWORDS } from './schema-locations.js';
import { effectiveValidationTypes, singleEffectiveValidationType, validationKeywordIssue, VALIDATION_KEYWORDS, type EffectiveValidationTypes, type ValidationKeyword } from './validation.js';

export type OverlayClassification = 'narrowing' | 'redundant' | 'conflict' | 'expansion' | 'indeterminate';
export interface OverlaySourceLocation {
  readonly documentUri: string;
  readonly pointer: string;
}
export interface OverlayDiagnostic extends OverlaySourceLocation {
  readonly classification: OverlayClassification;
  readonly message: string;
  readonly related: readonly OverlaySourceLocation[];
}
export interface OverlayOperation { readonly enabled: boolean; readonly reason?: string; readonly warning?: string; }
export interface OverlayLayer {
  readonly layers?: readonly OverlayLayer[];
  readonly schema: Readonly<Record<string, unknown>>;
  readonly pointer: string;
  readonly documentUri: string;
}
export interface OverlayMember {
  readonly name: string;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly layers: readonly OverlayLayer[];
  readonly required: boolean;
}
export interface OverlayConstraint {
  readonly keyword: string;
  readonly value: unknown;
  readonly pointer: string;
  readonly documentUri: string;
}
/** layers is the authoritative conjunction. schema is a read-only applicability/display projection, NOT serialized source. */
export interface OverlayProjection {
  readonly schema: Readonly<Record<string, unknown>>;
  readonly layers: readonly OverlayLayer[];
  readonly types: EffectiveValidationTypes;
  readonly properties: Readonly<Record<string, OverlayMember>>;
  readonly required: readonly string[];
  readonly requiredConstraints: readonly unknown[];
  readonly items?: OverlayLayer;
  readonly values?: OverlayLayer;
  readonly choices: Readonly<Record<string, OverlayLayer>>;
  readonly tuple: readonly string[];
  readonly references: readonly string[];
  readonly constraints: readonly OverlayConstraint[];
  readonly additionalProperties: { readonly allowed: boolean | 'indeterminate'; readonly layers: readonly OverlayLayer[]; readonly reason?: string };
  readonly reasons: readonly string[];
}
export interface OverlayOperandSource { readonly pointer: string; readonly delta: unknown; }
interface OverlayEffectiveBase { readonly base: OverlayProjection; readonly delta: unknown; }
/** Operator-aware semantics. Never infer the rule result from the positive authoring projection. */
export type OverlayEffectiveExpression =
  | (OverlayEffectiveBase & { readonly operator: 'and' })
  | (OverlayEffectiveBase & { readonly operator: 'and-not' })
  | (OverlayEffectiveBase & { readonly operator: 'predicate'; readonly then?: OverlayOperandSource; readonly else?: OverlayOperandSource })
  | (OverlayEffectiveBase & { readonly operator: 'conditional-path'; readonly path: 'then' | 'else'; readonly selectedWhen: 'matches' | 'does-not-match'; readonly predicate?: OverlayOperandSource });

export interface OverlayContext {
  readonly pointer: string;
  readonly documentUri: string;
  readonly ownerPointer: string;
  readonly basePointer: string;
  readonly branchPointer: string;
  readonly base: OverlayProjection;
  readonly delta: unknown;
  /** Positive Base AND Delta member/facet view, also used to edit excluded and conditional predicates. */
  readonly authoringProjection: OverlayProjection;
  readonly effective: OverlayEffectiveExpression;
  /** Compatibility analysis of the operand match set, NOT a schema-validity or enclosing-rule verdict. */
  readonly diagnosticScope: 'operand-match';
  readonly determinate: boolean;
  readonly authorable: boolean;
  readonly reason?: string;
  readonly diagnostics: readonly OverlayDiagnostic[];
  readonly classification: OverlayClassification;
  readonly operations: {
    readonly constrain: OverlayOperation;
    readonly addProperty: OverlayOperation;
    readonly addRequired: OverlayOperation;
    readonly removeBaseRequired: OverlayOperation;
    readonly changeBase: OverlayOperation;
  };
}
export interface OverlayContextOptions extends EffectiveMemberOptions { readonly index?: SchemaLocationIndex; }
export const OVERLAY_EDITABLE_FACETS: ReadonlySet<string> = new Set(['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'format', 'enum', 'const', 'precision', 'scale', 'minProperties', 'maxProperties', 'additionalProperties', 'dependentRequired']);
const structural = new Set(['type', '$ref', '$extends', 'properties', 'items', 'values', 'choices', 'tuple', 'definitions']);
const facets = new Set<string>([...VALIDATION_KEYWORDS, 'maxLength', 'enum', 'const', 'precision', 'scale', 'required', 'additionalProperties', ...COMPOSITION_KEYWORDS]);
const lower = new Set(['minimum', 'exclusiveMinimum', 'minLength', 'minItems', 'minProperties', 'minEntries', 'minContains']);
const upper = new Set(['maximum', 'exclusiveMaximum', 'maxLength', 'maxItems', 'maxProperties', 'maxEntries', 'maxContains', 'precision', 'scale']);
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
const numeric = (value: unknown): value is number | string => typeof value === 'number' || typeof value === 'string';
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const own = <T>(map: Readonly<Record<string, T>>, key: string): T | undefined => Object.hasOwn(map, key) ? map[key] : undefined;
const without = (schema: Readonly<Record<string, unknown>>, keys: readonly string[]): Readonly<Record<string, unknown>> => Object.fromEntries(Object.entries(schema).filter(([key]) => !keys.includes(key)));
const child = (pointer: string, key: string): string => pointer + '/' + schemaPointerToken(key);
const reference = (schema: Readonly<Record<string, unknown>>): string | undefined => typeof schema.$ref === 'string' ? schema.$ref : schemaRecord(schema.type) && typeof schema.type.$ref === 'string' ? schema.type.$ref : undefined;
function guaranteedRequired(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  if (value.every(Array.isArray)) return value.length ? strings(value[0]).filter(name => value.every(set => set.includes(name))) : [];
  return strings(value);
}
function classification(diagnostics: readonly OverlayDiagnostic[]): OverlayClassification {
  return (['conflict', 'expansion', 'indeterminate', 'narrowing', 'redundant'] as const).find(kind => diagnostics.some(d => d.classification === kind)) ?? 'redundant';
}

function createOverlayDiagnostic(classification: OverlayClassification, origin: OverlaySourceLocation, message: string, related: readonly OverlaySourceLocation[] = []): OverlayDiagnostic {
  const locations = new Map<string, OverlaySourceLocation>();
  for (const { documentUri, pointer } of related) {
    if (documentUri !== origin.documentUri || pointer !== origin.pointer) locations.set(JSON.stringify([documentUri, pointer]), { documentUri, pointer });
  }
  return { classification, documentUri: origin.documentUri, pointer: origin.pointer, message, related: [...locations.values()] };
}

function diagnosticSources(base: OverlayProjection, keyword: string): readonly OverlaySourceLocation[] {
  const group = [['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'], ['minLength', 'maxLength'], ['enum', 'const'], ['required', 'maxProperties'], ['properties', 'propertyNames', 'patternProperties', 'additionalProperties']].find(keys => keys.includes(keyword)) ?? [keyword];
  const constraints = base.constraints.filter(constraint => group.includes(constraint.keyword));
  return constraints.length ? constraints : base.layers;
}

/** Conservative type-set relationships: prove simple native narrowing, never guess about overlapping shapes. */
function wireKind(type: string): string {
  if (['number', 'integer', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'float8', 'float', 'double'].includes(type)) return 'number';
  if (['array', 'set', 'tuple'].includes(type)) return 'array';
  if (['object', 'map', 'choice'].includes(type)) return 'object';
  return ['null', 'boolean', 'any'].includes(type) ? type : 'string';
}
function nativeSubset(candidate: string, base: string): boolean {
  if (candidate === base || base === 'any' || (candidate === 'integer' ? 'int32' : candidate) === (base === 'integer' ? 'int32' : base)) return true;
  if (base === 'string' && wireKind(candidate) === 'string' || base === 'number' && wireKind(candidate) === 'number') return true;
  const range = (type: string): readonly [bigint, bigint] | undefined => {
    const match = /^(u?)int(8|16|32|64|128)$/.exec(type === 'integer' ? 'int32' : type);
    if (!match) return undefined;
    const bits = BigInt(match[2]!); return match[1] ? [0n, 2n ** bits - 1n] : [-(2n ** (bits - 1n)), 2n ** (bits - 1n) - 1n];
  };
  const a = range(candidate), b = range(base);
  return !!a && !!b && wireKind(candidate) === wireKind(base) && a[0] >= b[0] && a[1] <= b[1];
}
function intersectTypes(a: readonly string[], b: readonly string[]): readonly string[] {
  if (!a.length) return b; if (!b.length) return a;
  return [...new Set(a.flatMap(left => b.flatMap(right => nativeSubset(left, right) ? [left] : nativeSubset(right, left) ? [right] : wireKind(left) === wireKind(right) ? [left] : [])))];
}
/** Safe display materialization only. Exact constraints always remain in the source-layer conjunction. */
function narrowingDisplay(base: Readonly<Record<string, unknown>>, local: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const schema: Record<string, unknown> = { ...base, ...local };
  if (Object.hasOwn(base, 'type') && Object.hasOwn(local, 'type')) {
    const a = typeof base.type === 'string' ? [base.type] : strings(base.type), b = typeof local.type === 'string' ? [local.type] : strings(local.type);
    const narrowed = intersectTypes(a, b);
    schema.type = a.length && b.length && narrowed.length ? narrowed.length === 1 ? narrowed[0] : narrowed : base.type;
  }
  for (const [keyword, value] of Object.entries(local)) {
    const prior = base[keyword];
    if ((lower.has(keyword) || upper.has(keyword)) && numeric(prior) && numeric(value)) {
      const order = compareNumeric(value, prior);
      if (order !== undefined && (lower.has(keyword) ? order < 0 : order > 0)) schema[keyword] = prior;
    }
    if (keyword === 'enum' && Array.isArray(prior) && Array.isArray(value)) schema.enum = prior.filter(item => value.some(candidate => equal(item, candidate)));
    if (keyword === 'const' && Object.hasOwn(base, 'const')) schema.const = prior;
    if (['items', 'values', 'additionalProperties'].includes(keyword) && schemaRecord(prior) && schemaRecord(value)) schema[keyword] = narrowingDisplay(prior, value);
    if (['properties', 'choices'].includes(keyword) && schemaRecord(prior) && schemaRecord(value)) schema[keyword] = Object.fromEntries([...new Set([...Object.keys(prior), ...Object.keys(value)])].map(name => [name, schemaRecord(own(prior, name)) && schemaRecord(own(value, name)) ? narrowingDisplay(own(prior, name) as Readonly<Record<string, unknown>>, own(value, name) as Readonly<Record<string, unknown>>) : own(prior, name) ?? own(value, name)]));
  }
  if (Array.isArray(base.required) || Array.isArray(local.required)) schema.required = [...new Set([...guaranteedRequired(base.required), ...guaranteedRequired(local.required)])];
  if (base.additionalProperties === false) schema.additionalProperties = false;
  if (Array.isArray(base.tuple)) schema.tuple = base.tuple;
  return schema;
}

interface ProjectionTraversal {
  readonly seen: ReadonlySet<string>;
  readonly budget: { remaining: number };
}
function projectionTraversal(): ProjectionTraversal {
  return { seen: new Set(), budget: { remaining: 2048 } };
}

/** One resolver per render/operation. Only structural ownership edges establish context; annotations never do. */
export class OverlayContextResolver {
  readonly index: SchemaLocationIndex;
  readonly resolved: ResolvedSchemaContext;
  private readonly cache = new Map<string, OverlayContext | undefined>();
  constructor(readonly document: Readonly<Record<string, unknown>>, readonly options: OverlayContextOptions = {}) {
    this.index = options.index ?? new SchemaLocationIndex();
    if (!options.index) this.index.refresh(document);
    this.resolved = new ResolvedSchemaContext(document, options);
  }

  /** Resolves a structurally owned declaration without requiring a composition parent (e.g. a qualified alias). */
  projectSchema(pointer: string): OverlayProjection | undefined {
    const location = this.index.at(pointer);
    return location && schemaRecord(location.value) ? this.project(location.value, pointer) : undefined;
  }

  resolve(pointer: string): OverlayContext | undefined {
    if (this.cache.has(pointer)) return this.cache.get(pointer);
    this.cache.set(pointer, undefined);
    const location = this.index.at(pointer);
    if (!location || location.parentPointer === undefined || !resolveCapabilities(this.document).conditionalCompositionActive) return undefined;
    const owner = this.index.at(location.parentPointer);
    if (!owner || !schemaRecord(owner.value)) return undefined;
    const parent = this.resolve(owner.pointer);
    let result: OverlayContext | undefined;
    if (location.kind === 'operand' || location.kind === 'branch') {
      const keyword = location.key.split(':')[0]!;
      // Exclude the owning rule (the whole conditional group for IF/THEN/ELSE), never another candidate's delta.
      const excluded = ['if', 'then', 'else'].includes(keyword) ? ['if', 'then', 'else'] : [keyword];
      const local = without(owner.value, excluded);
      const base = parent ? this.intersect(parent.base, local, owner.pointer) : this.project(local, owner.pointer);
      result = this.context(pointer, owner.pointer, owner.pointer, pointer, base, location.value);
    } else if (parent && location.kind !== 'definition') {
      result = this.childContext(parent, location.kind, location.key, pointer, location.value);
    }
    this.cache.set(pointer, result);
    return result;
  }

  /** A not-yet-authored inherited property can be projected before a reversible command creates its empty delta. */
  property(owner: OverlayContext, name: string, delta: unknown = schemaValueAt(this.document, child(owner.pointer + '/properties', name)) ?? {}): OverlayContext {
    return this.childContext(owner, 'property', name, child(owner.pointer + '/properties', name), delta);
  }

  withDelta(context: OverlayContext, delta: unknown): OverlayContext {
    const location = this.index.at(context.pointer);
    const parent = this.resolve(context.ownerPointer);
    if (parent && location && !['root', 'definition', 'operand', 'branch'].includes(location.kind)) return this.childContext(parent, location.kind, location.key, context.pointer, delta);
    const prefix = context.ownerPointer + '/properties/';
    if (parent && !location && context.pointer.startsWith(prefix) && !context.pointer.slice(prefix.length).includes('/')) return this.property(parent, context.pointer.slice(prefix.length).replace(/~1/g, '/').replace(/~0/g, '~'), delta);
    return this.context(context.pointer, context.ownerPointer, context.basePointer, context.branchPointer, context.base, delta, !context.determinate && context.authorable);
  }

  /** Provides only a transient schema at the exact local pointer for existing actionAvailability metadata. */
  applicabilityDocument(context: OverlayContext): Readonly<Record<string, unknown>> {
    const replace = (value: unknown, parts: readonly string[]): unknown => {
      if (!parts.length) return context.authoringProjection.schema;
      const [part, ...rest] = parts;
      const copy: Record<string, unknown> | unknown[] = Array.isArray(value) ? [...value] : { ...(schemaRecord(value) ? value : {}) };
      Object.defineProperty(copy, part!, { value: replace(schemaRecord(value) || Array.isArray(value) ? (value as Record<string, unknown>)[part!] : undefined, rest), enumerable: true, configurable: true, writable: true });
      return copy;
    };
    return replace(this.document, context.pointer.slice(1).split('/').map(t => t.replace(/~1/g, '/').replace(/~0/g, '~'))) as Readonly<Record<string, unknown>>;
  }

  private childContext(parent: OverlayContext, kind: string, key: string, pointer: string, delta: unknown): OverlayContext {
    const member = own(parent.base.properties, key);
    let layers: readonly OverlayLayer[] = [];
    let reason: string | undefined;
    let compatibility: OverlayDiagnostic | undefined;
    if (kind === 'property' || kind === 'tuple-member') {
      const property = this.propertyBase(parent.base, key); layers = property.layers;
      if (property.reason) {
        compatibility = createOverlayDiagnostic(property.blocked ? 'expansion' : 'indeterminate', { documentUri: this.resolved.rootUri, pointer }, property.reason, property.origins);
        if (property.blocked === undefined) reason = property.reason;
      }
    } else if (kind === 'items' || kind === 'values') {
      const layer = parent.base[kind]; if (layer) layers = layer.layers ?? [layer];
    } else if (kind === 'choice') {
      const layer = own(parent.base.choices, key); if (layer) layers = layer.layers ?? [layer];
    } else if (kind === 'schema-keyword') {
      layers = parent.base.constraints.flatMap(constraint => constraint.keyword === key && schemaRecord(constraint.value) ? [{ schema: constraint.value, pointer: constraint.pointer, documentUri: constraint.documentUri }] : []);
    }
    const base = layers.length ? this.projectLayers(layers) : this.project({}, parent.basePointer + (kind === 'property' ? '/additionalProperties' : '/' + key));
    const amended = reason ? { ...base, reasons: [...base.reasons, reason] } : base;
    // New members of an unrestricted open object explicitly narrow an unconstrained value with their own type.
    const explicitNewProperty = !member && !reason && (kind === 'property') && schemaRecord(delta) && Object.hasOwn(delta, 'type');
    const context = this.context(pointer, parent.pointer, layers[0]?.pointer ?? parent.basePointer, parent.branchPointer, amended, delta, explicitNewProperty);
    if (!compatibility) return context;
    const diagnostics = [...context.diagnostics, compatibility];
    return { ...context, diagnostics, classification: classification(diagnostics) };
  }

  private propertyBase(base: OverlayProjection, name: string): { layers: readonly OverlayLayer[]; origins: readonly OverlaySourceLocation[]; reason?: string; blocked?: boolean } {
    const member = own(base.properties, name);
    if (!member && !base.types.types.includes('object')) return { layers: [], origins: base.layers, reason: 'The base has no such structural member.' };
    if (!member && base.additionalProperties.allowed !== true) return { layers: base.additionalProperties.layers, origins: diagnosticSources(base, 'additionalProperties'), blocked: base.additionalProperties.allowed === false, reason: base.additionalProperties.reason ?? 'Base additional-property applicability is indeterminate.' };
    const layers = [...(member?.layers ?? base.additionalProperties.layers)];
    if (!member) {
      if (typeof base.schema.maxProperties === 'number' && base.required.length >= base.schema.maxProperties) return { layers, origins: diagnosticSources(base, 'maxProperties'), blocked: true, reason: 'Base required members already exhaust maxProperties; no additional property can be present.' };
      for (const constraint of base.constraints) if (constraint.keyword === 'propertyNames' && schemaRecord(constraint.value)) {
        const origin = this.resolved.documentFor(constraint.documentUri);
        if (!origin) return { layers, origins: [constraint], reason: 'The originating document for the property-name constraint cannot be resolved.' };
        const resolvedDocuments = [{ uri: this.resolved.rootUri, document: this.document }, ...(this.options.resolvedDocuments ?? [])].filter(entry => entry.document !== origin);
        // Display projections can contain references from multiple documents. Probe the original layer
        // so every nested reference retains the document that authored it, including transitive imports.
        const result = new InstanceWorkspace(origin, name, { ...this.options, documentUri: constraint.documentUri, resolvedDocuments }).validateAt(constraint.pointer);
        if (result.status !== 'valid') return { layers, origins: [constraint], blocked: result.status === 'invalid', reason: result.status === 'invalid' ? 'The base propertyNames constraints do not allow this property name.' : 'Base propertyNames applicability is indeterminate; use Advanced / Source.' };
      }
    }
    for (const constraint of base.constraints) if (constraint.keyword === 'patternProperties' && schemaRecord(constraint.value)) {
      for (const [pattern, schema] of Object.entries(constraint.value)) {
        const origin = { documentUri: constraint.documentUri, pointer: child(constraint.pointer, pattern) };
        if (!schemaRecord(schema)) return { layers, origins: [origin], reason: 'The base property-pattern schema is malformed.' };
        const regex = compileSafeRegex(pattern);
        if (regex.status !== 'ready') return { layers, origins: [origin], reason: 'Base property-pattern applicability cannot be determined safely.' };
        const result = regex.test(name);
        if (result.status === 'indeterminate') return { layers, origins: [origin], reason: 'Base property-pattern applicability is indeterminate.' };
        if (result.status === 'matched') layers.push({ schema, pointer: child(constraint.pointer, pattern), documentUri: constraint.documentUri });
      }
    }
    return { layers, origins: layers };
  }

  private projectLayers(layers: readonly OverlayLayer[], traversal: ProjectionTraversal = projectionTraversal()): OverlayProjection {
    if (traversal.budget.remaining-- <= 0) return this.indeterminateProjection('Overlay projection budget exhausted while resolving nested layers.');
    let result = this.empty();
    for (const layer of layers) {
      result = this.combine(result, layer.layers ? this.projectLayers(layer.layers, traversal) : this.project(layer.schema, layer.pointer, layer.documentUri, traversal), traversal);
      if (traversal.budget.remaining <= 0) break;
    }
    return result;
  }

  private indeterminateProjection(reason: string): OverlayProjection { return { ...this.empty(), reasons: [reason] }; }

  private empty(): OverlayProjection {
    return { schema: {}, layers: [], types: { types: [], determinate: false }, properties: {}, required: [], requiredConstraints: [], choices: {}, tuple: [], references: [], constraints: [], additionalProperties: { allowed: true, layers: [] }, reasons: [] };
  }

  private project(schema: Readonly<Record<string, unknown>>, pointer: string, documentUri = this.resolved.rootUri, traversal: ProjectionTraversal = projectionTraversal()): OverlayProjection {
    if (traversal.budget.remaining-- <= 0) return this.indeterminateProjection('Overlay projection budget exhausted at ' + documentUri + '#' + pointer);
    const authoredSchema = schema;
    const capabilities = this.resolved.capabilitiesFor(documentUri);
    schema = without(schema, [...(!capabilities.validationActive ? VALIDATION_KEYWORDS : []), ...(!capabilities.conditionalCompositionActive ? COMPOSITION_KEYWORDS : [])]);
    const identity = documentUri + '#' + pointer;
    if (traversal.seen.has(identity) || traversal.seen.size > 64) return this.indeterminateProjection('Reference or additional-property/inheritance cycle / resolution budget at ' + identity);
    const path: ProjectionTraversal = { seen: new Set(traversal.seen).add(identity), budget: traversal.budget };
    let result = this.empty();
    const ref = reference(schema);
    if (ref) {
      const target = this.resolved.resolve(ref, documentUri);
      result = target ? this.project(target.schema, target.sourcePointer, target.documentUri, path) : { ...result, reasons: ['Unresolved constraint reference ' + ref] };
    }
    const bases = typeof schema.$extends === 'string' ? [schema.$extends] : strings(schema.$extends);
    for (const base of bases) {
      const target = this.resolved.resolve(base, documentUri);
      if (!target) { result = { ...result, reasons: [...result.reasons, 'Unresolved base ' + base] }; continue; }
      const inherited = this.project(target.schema, target.sourcePointer, target.documentUri, path);
      // Member precedence belongs to resolveEffectiveMembers, not overlay intersection.
      result = this.combine(result, { ...inherited, properties: {}, schema: without(inherited.schema, ['properties']) }, path);
    }
    const origin = (value: Readonly<Record<string, unknown>>, suffix: string): OverlayLayer => ({ schema: value, pointer: pointer + suffix, documentUri });
    let properties: Record<string, OverlayMember> = Object.fromEntries(Object.entries(schemaRecord(schema.properties) ? schema.properties : {}).filter(([, value]) => schemaRecord(value)).map(([name, value]) => [name, { name, schema: value as Readonly<Record<string, unknown>>, layers: [origin(value as Readonly<Record<string, unknown>>, '/properties/' + schemaPointerToken(name))], required: guaranteedRequired(schema.required).includes(name) }]));
    let required = guaranteedRequired(schema.required);
    let tuple = strings(schema.tuple);
    const reasons: string[] = Object.hasOwn(schema, 'type') && !validCoreTypeValue(schema.type) ? ['The authored type value is malformed.'] : [];
    if (schema.type === 'object' || schema.type === 'tuple') {
      const sourceDocument = this.resolved.documentFor(documentUri) ?? this.document;
      const effective = resolveEffectiveMembers(sourceDocument, pointer, { ...this.options, documentUri });
      if (effective.status === 'resolved') {
        properties = Object.fromEntries(effective.members.map(member => [member.name, { name: member.name, schema: member.schema, layers: [{ schema: member.schema, pointer: member.sourcePointer, documentUri: member.documentUri }], required: member.required }]));
        required = [...new Set([...required, ...effective.required])]; tuple = [...effective.tuple];
      } else if (bases.length) reasons.push(...effective.diagnostics.map(d => d.message));
    }
    if (schema.type === 'tuple') required = [...new Set([...required, ...tuple])];
    const sourceDocument = this.resolved.documentFor(documentUri) ?? this.document;
    const ownTypes = Object.hasOwn(schema, 'type') && !ref ? effectiveValidationTypes(sourceDocument, without(schema, ['$extends'])) : this.empty().types;
    const additional = schema.additionalProperties;
    const own: OverlayProjection = {
      schema: { ...without(schema, ['$ref', '$extends', ...(ref ? ['type'] : [])]), ...(Object.keys(properties).length ? { properties: Object.fromEntries(Object.entries(properties).map(([name, member]) => [name, member.schema])) } : {}) },
      layers: [origin(authoredSchema, '')], types: ownTypes, properties, required, requiredConstraints: schema.required === undefined ? [] : [schema.required],
      ...(schemaRecord(schema.items) ? { items: origin(schema.items, '/items') } : {}), ...(schemaRecord(schema.values) ? { values: origin(schema.values, '/values') } : {}),
      choices: Object.fromEntries(Object.entries(schemaRecord(schema.choices) ? schema.choices : {}).filter(([, v]) => schemaRecord(v)).map(([name, value]) => [name, origin(value as Readonly<Record<string, unknown>>, '/choices/' + schemaPointerToken(name))])),
      tuple, references: ref ? [ref] : [],
      constraints: Object.entries(schema).filter(([key]) => facets.has(key)).map(([keyword, value]) => ({ keyword, value, pointer: child(pointer, keyword), documentUri })),
      additionalProperties: additional === false ? { allowed: false, layers: [], reason: 'The effective base is closed (additionalProperties: false).' } : schemaRecord(additional) ? { allowed: true, layers: [origin(additional, '/additionalProperties')] } : additional === undefined || additional === true ? { allowed: true, layers: [] } : { allowed: 'indeterminate', layers: [], reason: 'The base additionalProperties policy is malformed.' },
      reasons
    };
    result = this.combine(result, own, path);
    // Other ALL rules are active base constraints. ANY/ONE/NOT/conditionals stay exact, unflattened layers.
    if (Array.isArray(schema.allOf)) for (const [index, operand] of schema.allOf.entries()) if (schemaRecord(operand)) {
      result = this.combine(result, this.project(operand, pointer + '/allOf/' + index, documentUri, path), path);
      if (traversal.budget.remaining <= 0) break;
    }
    return result;
  }

  private combine(base: OverlayProjection, local: OverlayProjection, traversal: ProjectionTraversal): OverlayProjection {
    if (traversal.budget.remaining-- <= 0) return this.indeterminateProjection('Overlay projection budget exhausted while combining constraint layers.');
    const schema = narrowingDisplay(base.schema, local.schema);
    const required = [...new Set([...base.required, ...local.required])];
    const reasons = new Set([...base.reasons, ...local.reasons]);
    const properties: Record<string, OverlayMember> = Object.assign(Object.create(null) as Record<string, OverlayMember>, base.properties);
    for (const [name, member] of Object.entries(local.properties)) {
      const inherited = own(properties, name);
      const additional = !inherited && base.additionalProperties.layers.length ? this.projectLayers(base.additionalProperties.layers, traversal) : undefined;
      additional?.reasons.forEach(reason => reasons.add(reason));
      properties[name] = inherited ? { ...member, schema: narrowingDisplay(inherited.schema, member.schema), layers: [...inherited.layers, ...member.layers], required: required.includes(name) } : { ...member, ...(additional ? { schema: narrowingDisplay(additional.schema, member.schema), layers: [...base.additionalProperties.layers, ...member.layers] } : {}), required: required.includes(name) };
      if (traversal.budget.remaining <= 0) break;
    }
    const a = base.types.types, b = local.types.types;
    const types = intersectTypes(a, b);
    if (types.length) schema.type = types.length === 1 ? types[0] : types;
    else if (a.length) schema.type = base.schema.type; // Never display an incompatible type as replacing the immutable base.
    for (const [name, member] of Object.entries(properties)) properties[name] = { ...member, required: required.includes(name) };
    if (Object.keys(properties).length) schema.properties = Object.fromEntries(Object.entries(properties).map(([name, member]) => [name, member.schema]));
    if (required.length) schema.required = required;
    const additionalProperties = base.additionalProperties.allowed !== true ? base.additionalProperties : local.additionalProperties.allowed !== true ? local.additionalProperties : { allowed: true as const, layers: [...base.additionalProperties.layers, ...local.additionalProperties.layers] };
    if (additionalProperties.allowed === false) schema.additionalProperties = false;
    const memberLayer = (a: OverlayLayer | undefined, b: OverlayLayer | undefined): OverlayLayer | undefined => !a ? b : !b ? a : { ...b, schema: narrowingDisplay(a.schema, b.schema), layers: [...(a.layers ?? [a]), ...(b.layers ?? [b])] };
    const choices = Object.fromEntries([...new Set([...Object.keys(base.choices), ...Object.keys(local.choices)])].map(name => [name, memberLayer(own(base.choices, name), own(local.choices, name))!]));
    return { schema, layers: [...base.layers, ...local.layers], types: { types, determinate: types.length > 0 && reasons.size === 0 }, properties, required, requiredConstraints: [...base.requiredConstraints, ...local.requiredConstraints], items: memberLayer(base.items, local.items), values: memberLayer(base.values, local.values), choices, tuple: base.tuple.length ? base.tuple : local.tuple, references: [...new Set([...base.references, ...local.references])], constraints: [...base.constraints, ...local.constraints], additionalProperties, reasons: [...reasons] };
  }

  private intersect(base: OverlayProjection, delta: Readonly<Record<string, unknown>>, pointer: string): OverlayProjection {
    const traversal = projectionTraversal();
    return this.combine(base, this.project(delta, pointer, this.resolved.rootUri, traversal), traversal);
  }

  private effectiveExpression(pointer: string, ownerPointer: string, base: OverlayProjection, delta: unknown): OverlayEffectiveExpression {
    const location = this.index.at(pointer);
    if (!location || location.kind !== 'operand' && location.kind !== 'branch') return { operator: 'and', base, delta };
    const owner = schemaValueAt(this.document, ownerPointer);
    const source = (keyword: string): OverlayOperandSource | undefined => schemaRecord(owner) && Object.hasOwn(owner, keyword) ? { pointer: child(ownerPointer, keyword), delta: owner[keyword] } : undefined;
    if (location.key === 'not') return { operator: 'and-not', base, delta };
    if (location.key === 'if') return { operator: 'predicate', base, delta, ...(source('then') ? { then: source('then') } : {}), ...(source('else') ? { else: source('else') } : {}) };
    if (location.key === 'then' || location.key === 'else') return { operator: 'conditional-path', base, delta, path: location.key, selectedWhen: location.key === 'then' ? 'matches' : 'does-not-match', ...(source('if') ? { predicate: source('if') } : {}) };
    return { operator: 'and', base, delta };
  }

  private context(pointer: string, ownerPointer: string, basePointer: string, branchPointer: string, base: OverlayProjection, delta: unknown, explicitNewProperty = false): OverlayContext {
    const projection = schemaRecord(delta) ? this.intersect(base, delta, pointer) : base;
    const baseType = singleEffectiveValidationType(base.types);
    const projectionType = singleEffectiveValidationType(projection.types);
    const determinate = baseType !== undefined && baseType !== 'any' && !base.reasons.length;
    const authorable = schemaRecord(delta) && (determinate || explicitNewProperty && projection.types.determinate) && !projection.reasons.length && !Object.hasOwn(delta, '$ref');
    const valueTypes = base.types.types.filter((type) => type !== 'null');
    const reason = !schemaRecord(delta) ? 'Malformed delta: use Advanced / Edit Source; the authored value is preserved.' : base.reasons[0] ?? projection.reasons[0] ?? (!determinate && !explicitNewProperty ? valueTypes.length > 1 ? 'The base has multiple value types. Use an explicit Advanced narrowing action.' : 'The base is composition-only, unconstrained, or indeterminate. Use an explicit Advanced action.' : Object.hasOwn(delta, '$ref') ? 'Legacy direct reference is preserved. Use Advanced to edit it without normalization.' : undefined);
    const constrain = { enabled: authorable, ...(authorable ? {} : { reason }) };
    const object = projectionType === 'object';
    const addProperty: OverlayOperation = !authorable || !object ? { enabled: false, reason: reason ?? 'Property constraints require an object base.' } : { enabled: true, ...(base.additionalProperties.allowed !== true ? { warning: (base.additionalProperties.reason ?? 'Base openness is indeterminate.') + ' A local addition does not override it; incompatibility is diagnosed, not prohibited.' } : typeof base.schema.maxProperties === 'number' && base.required.length >= base.schema.maxProperties ? { warning: 'Base required members exhaust maxProperties. Additional members are permitted in source but cannot occur in base-admissible instances.' } : {}) };
    const diagnostics = this.diagnose(base, delta, pointer, 0);
    const resolutionReasons = new Set([...base.reasons, ...projection.reasons]);
    for (const message of resolutionReasons) diagnostics.push(createOverlayDiagnostic('indeterminate', { documentUri: this.resolved.rootUri, pointer }, message, [...base.layers, ...projection.layers]));
    if (!determinate && !explicitNewProperty && resolutionReasons.size === 0) diagnostics.push(createOverlayDiagnostic('indeterminate', { documentUri: this.resolved.rootUri, pointer }, reason ?? 'The base type is not determinate.', base.layers));
    return { pointer, documentUri: this.resolved.rootUri, ownerPointer, basePointer, branchPointer, base, delta, authoringProjection: projection, effective: this.effectiveExpression(pointer, ownerPointer, base, delta), diagnosticScope: 'operand-match', determinate, authorable, reason, diagnostics, classification: classification(diagnostics), operations: { constrain, addProperty, addRequired: authorable && object ? { enabled: true } : { enabled: false, reason: reason ?? 'Required additions need an object base.' }, removeBaseRequired: { enabled: false, reason: 'Base required members remain implicitly required. Only branch-local requirements can be removed.' }, changeBase: { enabled: false, reason: 'The owning base is read-only in this editor. Local edits never replace it.' } } };
  }

  private diagnose(base: OverlayProjection, delta: unknown, pointer: string, depth: number): OverlayDiagnostic[] {
    const diagnostics: OverlayDiagnostic[] = [];
    const add = (kind: OverlayClassification, key: string, message: string): void => { diagnostics.push(createOverlayDiagnostic(kind, { documentUri: this.resolved.rootUri, pointer: key ? child(pointer, key) : pointer }, message, diagnosticSources(base, key))); };
    if (!schemaRecord(delta)) { add('indeterminate', '', 'Malformed delta is preserved and source-addressable.'); return diagnostics; }
    if (depth > 32) { add('indeterminate', '', 'Contextual diagnostic depth budget reached.'); return diagnostics; }
    const types = base.types.types.length ? base.types : this.project(delta, pointer).types;
    const type = types.types.length === 1 ? types.types[0] : undefined;
    const validationActive = resolveCapabilities(this.document).validationActive;
    for (const [key, value] of Object.entries(delta)) {
      const prior = base.schema[key];
      if ((VALIDATION_KEYWORDS as readonly string[]).includes(key) && !validationActive) { add('redundant', key, 'Validation is inactive; this authored facet is preserved but does not constrain the base.'); continue; }
      if (key === 'type') {
        const requested = this.project(delta, pointer).types;
        if (!requested.determinate) add('indeterminate', key, 'The explicit narrowing type/reference cannot be resolved.');
        else if (!base.types.types.length || base.types.types.includes('any')) add('narrowing', key, 'Explicit value-type narrowing.');
        else if (requested.types.includes('any')) add('expansion', key, 'The unrestricted operand does not replace the base; its match set remains limited by the base.');
        else if (requested.types.every(t => base.types.types.some(b => nativeSubset(t, b)))) add(equal(requested.types, base.types.types) ? 'redundant' : 'narrowing', key, 'The base type stays implicit and unchanged by an explicit operand type.');
        else if (requested.types.some(t => base.types.types.some(b => nativeSubset(b, t)))) add('expansion', key, 'The requested type includes values outside the base.');
        else if (!requested.types.some(t => base.types.types.some(b => wireKind(t) === wireKind(b)))) add('conflict', key, 'The explicit type conflicts with the immutable base value representation.');
        else add('indeterminate', key, 'These types share a JSON representation; their intersection/implication is indeterminate.');
        continue;
      }
      if (key === 'properties' && (!schemaRecord(value) || type && !['object', 'tuple'].includes(type))) { add('conflict', key, 'Property constraints require an object/tuple base and an object map.'); continue; }
      if (key === 'properties' && schemaRecord(value)) {
        for (const [name, property] of Object.entries(value)) {
          const member = own(base.properties, name);
          const propertyPointer = child(pointer + '/properties', name);
          if (!member && base.additionalProperties.allowed !== true) { diagnostics.push(createOverlayDiagnostic('expansion', { documentUri: this.resolved.rootUri, pointer: propertyPointer }, base.additionalProperties.reason ?? 'The base does not permit additional properties.', diagnosticSources(base, 'additionalProperties'))); continue; }
          const propertyBase = this.propertyBase(base, name);
          if (propertyBase.reason) diagnostics.push(createOverlayDiagnostic(propertyBase.blocked ? 'expansion' : 'indeterminate', { documentUri: this.resolved.rootUri, pointer: propertyPointer }, propertyBase.reason, propertyBase.origins));
          diagnostics.push(...this.diagnose(this.projectLayers(propertyBase.layers), property, propertyPointer, depth + 1));
        }
        continue;
      }
      if (key === 'required') {
        if (type && type !== 'object') { add('conflict', key, 'Required additions require an object base.'); continue; }
        if (Array.isArray(value) && value.some(name => typeof name === 'string' && !own(base.properties, name) && !(schemaRecord(delta.properties) && Object.hasOwn(delta.properties, name))) && base.additionalProperties.allowed === false) { add('expansion', key, 'The requirement names a new property on a closed base.'); continue; }
        if (!Array.isArray(value) || !value.every(v => typeof v === 'string')) add('indeterminate', key, 'Legacy or malformed required sets are preserved; edit them in Advanced / Source.');
        else add(value.every(name => base.required.includes(name)) ? 'redundant' : 'narrowing', key, 'Requirements are additive; omitted base names remain implicitly required.');
        continue;
      }
      if (key === 'additionalProperties') {
        if (type && type !== 'object' || typeof value !== 'boolean' && !schemaRecord(value)) { add('conflict', key, 'additionalProperties requires an object base and a boolean or schema policy.'); continue; }
        if (base.additionalProperties.allowed === false && value !== false) add('expansion', key, 'The operand requests openness beyond a closed base; the base policy is not replaced.');
        else if (base.additionalProperties.layers.length && value === true) add('expansion', key, 'The base additional-property constraints remain in force despite this more permissive operand.');
        else if (schemaRecord(value)) diagnostics.push(...this.diagnose(this.projectLayers(base.additionalProperties.layers), value, child(pointer, key), depth + 1));
        else add(equal(value, prior) || value === true ? 'redundant' : 'narrowing', key, 'The base additional-property policy remains in force.');
        continue;
      }
      if (!facets.has(key) || structural.has(key)) continue;
      if (['precision', 'scale'].includes(key) && (!['number', 'decimal'].includes(type ?? '') || !Number.isInteger(value) || (value as number) < 0)) { add('conflict', key, key + ' requires a number/decimal base and a non-negative integer.'); continue; }
      if (key === 'enum' && (!Array.isArray(value) || !value.length || !deeplyUniqueJsonValues(value))) { add('conflict', key, 'enum requires a non-empty array of distinct primitive values.'); continue; }
      if (type && ([...VALIDATION_KEYWORDS, 'maxLength'] as readonly string[]).includes(key)) {
        const issue = validationKeywordIssue(key as ValidationKeyword, value, type);
        if (issue) { add('conflict', key, issue); continue; }
      }
      if (key === 'pattern' && typeof value === 'string' && compileSafeRegex(value).status !== 'ready') { add('indeterminate', key, 'The safe pattern evaluator cannot decide this authored expression.'); continue; }
      const numericBounds = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'].includes(key);
      const impliedBound = numericBounds && numeric(value) && base.constraints.some(c => {
        if (!numeric(c.value) || lower.has(c.keyword) !== lower.has(key) || !['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'].includes(c.keyword)) return false;
        const order = compareNumeric(c.value, value);
        return order !== undefined && (lower.has(key) ? order > 0 : order < 0) || order === 0 && (!key.startsWith('exclusive') || c.keyword.startsWith('exclusive'));
      });
      if (impliedBound) add('redundant', key, 'The base already implies this bound.');
      else if ((lower.has(key) || upper.has(key)) && numeric(value) && numeric(prior)) {
        const order = compareNumeric(value, prior);
        add(order !== undefined && (lower.has(key) ? order <= 0 : order >= 0) ? 'redundant' : 'narrowing', key, 'Base AND Delta retains the stronger bound; authored source is not normalized.');
      } else if (key === 'multipleOf' && numeric(prior) && numeric(value)) {
        add(multipleOf(prior, value) === true ? 'redundant' : 'narrowing', key, 'Both divisibility constraints remain in force.');
      } else if (key === 'enum' || key === 'const') {
        const values = key === 'enum' && Array.isArray(value) ? value : [value];
        const baseValues = Object.hasOwn(base.schema, 'const') ? [base.schema.const] : Array.isArray(base.schema.enum) ? base.schema.enum : undefined;
        if (baseValues && !values.some(v => baseValues.some(b => equal(b, v)))) add('conflict', key, 'No value satisfies both the base and delta value constraints.');
        else if (type && values.some(v => !coreScalarValueValid(type, v, base.schema))) add('conflict', key, 'A value is outside the base primitive value space.');
        else add(baseValues?.every(b => values.some(v => equal(b, v))) ? 'redundant' : 'narrowing', key, 'The effective values are the intersection with the base, not a replacement.');
      } else if ((key === 'pattern' || key === 'format') && prior !== undefined && !equal(value, prior)) {
        add('indeterminate', key, 'Both base and local string constraints apply; their combined satisfiability has not been proved.');
      } else if (COMPOSITION_KEYWORDS.includes(key as typeof COMPOSITION_KEYWORDS[number])) {
        add(equal(value, prior) ? 'redundant' : 'indeterminate', key, 'Nested rule source is preserved. General rule satisfiability is not inferred from syntax.');
      } else add(equal(value, prior) ? 'redundant' : 'narrowing', key, equal(value, prior) ? 'Already implied by the base.' : 'Additional constraint on the base value.');
    }
    const localConstraints = Object.entries(delta).filter(([key]) => validationActive || !(VALIDATION_KEYWORDS as readonly string[]).includes(key)).map(([keyword, value]) => ({ keyword, value, pointer: child(pointer, keyword), documentUri: this.resolved.rootUri }));
    const localSources = new Set<OverlaySourceLocation>(localConstraints);
    const constraints: readonly OverlayConstraint[] = [...base.constraints, ...localConstraints];
    for (const [lows, highs] of [[['minimum', 'exclusiveMinimum'], ['maximum', 'exclusiveMaximum']], [['minLength'], ['maxLength']], [['minItems'], ['maxItems']], [['minProperties'], ['maxProperties']], [['minEntries'], ['maxEntries']]]) {
      const ls = constraints.filter(c => lows!.includes(c.keyword) && numeric(c.value));
      const hs = constraints.filter(c => highs!.includes(c.keyword) && numeric(c.value));
      for (const l of ls) for (const h of hs) {
        const order = compareNumeric(l.value as number | string, h.value as number | string);
        if (order !== undefined && (order > 0 || order === 0 && (l.keyword.startsWith('exclusive') || h.keyword.startsWith('exclusive')))) diagnostics.push(createOverlayDiagnostic('conflict', localSources.has(l) ? l : h, 'No operand match satisfies both lower and upper bounds in the base context.', [l, h]));
      }
    }
    if (type === 'object') {
      const required = new Set([...base.required, ...guaranteedRequired(delta.required)]);
      for (const bound of constraints.filter(c => c.keyword === 'maxProperties' && typeof c.value === 'number')) if (required.size > (bound.value as number)) {
        const localRequired = localConstraints.find(c => c.keyword === 'required');
        const origin = localRequired && base.required.length <= (bound.value as number) ? localRequired : bound;
        diagnostics.push(createOverlayDiagnostic('conflict', origin, 'No operand match can supply all required members within maxProperties.', [bound, ...constraints.filter(c => c.keyword === 'required')]));
      }
    }
    // Finite const/enum domains are decidable by the SAME evaluator used by Validate, not a second facet engine.
    // These scalar-only probes have no structural/composition edges, so they cannot re-enter overlay resolution.
    const baseValues = Object.hasOwn(base.schema, 'const') ? [base.schema.const] : Array.isArray(base.schema.enum) ? base.schema.enum : undefined;
    const deltaValues = Object.hasOwn(delta, 'const') ? [delta.const] : Array.isArray(delta.enum) ? delta.enum : undefined;
    const candidates = baseValues ?? deltaValues;
    if (type && candidates && candidates.length > 0 && candidates.length <= 256 && !['object', 'tuple', 'map', 'set', 'array', 'choice', 'any'].includes(type)) {
      const probe = (schema: Readonly<Record<string, unknown>>, value: unknown): 'valid' | 'invalid' | 'indeterminate' => {
        const activeFacets = Object.fromEntries(Object.entries(schema).filter(([key]) => OVERLAY_EDITABLE_FACETS.has(key) && !['additionalProperties', 'dependentRequired'].includes(key) && (validationActive || !(VALIDATION_KEYWORDS as readonly string[]).includes(key))));
        return new InstanceWorkspace({ $schema: this.document.$schema, $uses: this.document.$uses, type, ...activeFacets }, value).validate().status;
      };
      const states = candidates.map(value => { const a = probe(base.schema, value), b = probe(delta, value); return a === 'invalid' || b === 'invalid' ? 'invalid' : a === 'indeterminate' || b === 'indeterminate' ? 'indeterminate' : 'valid'; });
      const key = Object.hasOwn(delta, 'const') ? 'const' : Object.hasOwn(delta, 'enum') ? 'enum' : Object.keys(delta).find(k => OVERLAY_EDITABLE_FACETS.has(k));
      if (key && states.every(s => s === 'invalid')) add('conflict', key, 'No allowed const/enum value matches the operand in the base context.');
      else if (baseValues && states.every(s => s === 'valid')) {
        for (let index = 0; index < diagnostics.length; index++) {
          const diagnostic = diagnostics[index]!;
          if ((diagnostic.classification === 'narrowing' || diagnostic.classification === 'indeterminate') && Object.keys(delta).some(k => OVERLAY_EDITABLE_FACETS.has(k) && child(pointer, k) === diagnostic.pointer)) diagnostics[index] = { ...diagnostic, classification: 'redundant', message: 'All values already allowed by the base satisfy this constraint.' };
        }
      }
    }
    if (!diagnostics.length) add('redundant', '', 'No additional constraints.');
    return diagnostics;
  }
}

export function resolveOverlayContext(document: unknown, pointer: string, options: OverlayContextOptions = {}): OverlayContext | undefined {
  return schemaRecord(document) ? new OverlayContextResolver(document, options).resolve(pointer) : undefined;
}
