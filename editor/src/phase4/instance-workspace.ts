import { OverlayContextResolver, type OverlayContext } from '../overlay-context.js';
import { compareNumeric, multipleOf } from '../numeric.js';
import { coreScalarValueValid, decimalValueIssues } from '../parser.js';
import { resolveCapabilities } from '../capabilities.js';
import { compileSafeRegex, MAX_SAFE_REGEX_INPUT_LENGTH, MAX_SAFE_REGEX_PATTERN_LENGTH, type SafeRegexCompilation } from '../safe-regex.js';
import { resolveEffectiveMembers } from './effective-members.js';
import { ResolvedSchemaContext, type ResolvedSchemaDocument, type ResolvedSchemaLocation } from './resolved-schema.js';

export type EvaluationStatus = 'valid' | 'invalid' | 'indeterminate';

export interface InstanceDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: 'error' | 'indeterminate';
  readonly instancePointer: string;
  readonly schemaPointer: string;
}

export interface EvaluationTrace {
  readonly keyword: string;
  readonly status: EvaluationStatus;
  readonly instancePointer: string;
  readonly schemaPointer: string;
  readonly message?: string;
  readonly children: readonly EvaluationTrace[];
  readonly application?: 'applied' | 'not-applied';
  readonly occurrencePath?: string;
  readonly documentVersion?: number;
  readonly instanceVersion?: number;
}

export interface InstanceValidationResult {
  readonly documentVersion?: number;
  readonly instanceVersion?: number;
  readonly status: EvaluationStatus;
  readonly diagnostics: readonly InstanceDiagnostic[];
  readonly trace: EvaluationTrace;
}

export interface CrossNavigationSelection {
  readonly occurrencePath?: string;
  readonly source: 'instance' | 'schema' | 'diagnostic';
  readonly instancePointer: string;
  readonly schemaPointer: string;
  readonly diagnosticIndex?: number;
}

export interface ExternalRelationRequest {
  readonly relationName: string;
  readonly targetDocumentUri: string;
  readonly targetPointer: string;
  readonly identity: unknown;
}

export type ExternalRelationResolver = (request: ExternalRelationRequest) => EvaluationStatus;

export interface InstanceWorkspaceOptions {
  readonly depthBudget?: number;
  readonly documentVersion?: number;
  readonly instanceVersion?: number;
  readonly documentUri?: string;
  readonly resolvedDocuments?: readonly ResolvedSchemaDocument[];
  readonly externalRelationResolver?: ExternalRelationResolver;
}

interface Evaluation {
  readonly status: EvaluationStatus;
  readonly diagnostics: readonly InstanceDiagnostic[];
  readonly trace: EvaluationTrace;
}

interface SchemaOrigin {
  readonly documentUri: string;
  readonly schemaPointer: string;
}

interface EffectiveRelation {
  readonly schema: Readonly<Record<string, unknown>>;
  readonly origin: SchemaOrigin;
}

interface EffectiveRelations {
  readonly identity?: readonly string[];
  readonly identityOrigin?: SchemaOrigin;
  readonly relations: ReadonlyMap<string, EffectiveRelation>;
}

interface EffectiveConstraintLayer {
  readonly schema: Readonly<Record<string, unknown>>;
  readonly origin: SchemaOrigin;
}

interface ScopeCandidate {
  readonly value: unknown;
  readonly instancePointer: string;
}

const INTEGER_TEXT = /^-?(?:0|[1-9]\d*)$/;
const DECIMAL_TEXT = /^-?(?:0|[1-9]\d*)\.\d+$/;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function escapePointer(value: string): string { return value.replace(/~/g, '~0').replace(/\//g, '~1'); }
function childPointer(pointer: string, value: string | number): string { return `${pointer}/${escapePointer(String(value))}`; }
function hasOwn(value: Readonly<Record<string, unknown>>, key: string): boolean { return Object.prototype.hasOwnProperty.call(value, key); }

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => deepEqual(item, right[index]));
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => hasOwn(right, key) && deepEqual(left[key], right[key]));
}

function statusOf(evaluations: readonly Evaluation[]): EvaluationStatus {
  return evaluations.some((entry) => entry.status === 'invalid') ? 'invalid' :
    evaluations.some((entry) => entry.status === 'indeterminate') ? 'indeterminate' : 'valid';
}

function validFormat(value: string, format: string): boolean | undefined {
  switch (format) {
    case 'ipv4': return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) && value.split('.').every((part) => Number(part) <= 255);
    case 'ipv6': return /^[0-9a-f:]+$/i.test(value) && value.includes(':');
    case 'email':
    case 'idn-email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
    case 'hostname':
    case 'idn-hostname': return value.length <= 253 && /^(?=.{1,253}$)(?:[\p{L}\d](?:[\p{L}\d-]{0,61}[\p{L}\d])?)(?:\.(?:[\p{L}\d](?:[\p{L}\d-]{0,61}[\p{L}\d])?))*$/u.test(value);
    case 'iri':
    case 'iri-reference': try { new URL(value, 'https://example.invalid/'); return true; } catch { return false; }
    case 'uri-template': return !/[\s]/u.test(value);
    case 'relative-json-pointer': return /^(?:0|[1-9]\d*)(?:#|(?:\/(?:[^~/]|~[01])*)*)$/.test(value);
    case 'regex': {
      const compilation = compileSafeRegex(value);
      return compilation.status === 'ready' || compilation.status === 'unsupported';
    }
    default: return undefined;
  }
}

function validScalar(value: unknown, type: string, declaration: Readonly<Record<string, unknown>>): boolean {
  if (type === 'any') return true;
  if (type === 'object' || type === 'map' || type === 'choice') return isRecord(value);
  if (type === 'array' || type === 'set' || type === 'tuple') return Array.isArray(value);
  return coreScalarValueValid(type, value, declaration);
}

function patternCompilationMessage(compilation: Exclude<SafeRegexCompilation, { readonly status: 'ready' }>): string {
  if (compilation.status === 'invalid') return 'Schema pattern is invalid.';
  if (compilation.status === 'pattern-too-long') return `Schema pattern exceeds the ${MAX_SAFE_REGEX_PATTERN_LENGTH}-code-unit safety limit.`;
  return 'Schema pattern uses ECMAScript features that the non-backtracking regular-expression engine cannot evaluate safely.';
}

export class InstanceWorkspace {
  private readonly depthBudget: number;
  private readonly schemaContext: ResolvedSchemaContext;
  private declarationMappings?: readonly ResolvedSchemaLocation[];
  private readonly overlayContexts = new Map<string, OverlayContextResolver>();
  private readonly schemaOptions: Pick<InstanceWorkspaceOptions, 'documentUri' | 'resolvedDocuments'>;
  private readonly selectedAddIns: readonly string[];
  private readonly externalRelationResolver?: ExternalRelationResolver;
  private readonly capabilities;
  private readonly effectiveSchemaCache = new Map<string, Readonly<Record<string, unknown>>>();
  private readonly authoredSchemas = new WeakMap<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>();
  private readonly propertyOrigins = new WeakMap<Readonly<Record<string, unknown>>, ReadonlyMap<string, SchemaOrigin>>();
  private readonly relationOrigins = new WeakMap<Readonly<Record<string, unknown>>, ReadonlyMap<string, SchemaOrigin>>();
  private readonly inheritedConstraintLayers = new WeakMap<Readonly<Record<string, unknown>>, readonly EffectiveConstraintLayer[]>();
  private currentSelection: CrossNavigationSelection = { source: 'instance', instancePointer: '', schemaPointer: '' };
  private lastResult?: InstanceValidationResult;
  private readonly versions: { readonly documentVersion?: number; readonly instanceVersion?: number };

  constructor(readonly schema: Readonly<Record<string, unknown>>, readonly instance: unknown, options: InstanceWorkspaceOptions = {}) {
    this.versions = { documentVersion: options.documentVersion, instanceVersion: options.instanceVersion };
    this.depthBudget = Math.max(0, options.depthBudget ?? 64);
    this.schemaContext = new ResolvedSchemaContext(schema, options);
    this.capabilities = resolveCapabilities(schema);
    this.schemaOptions = { documentUri: options.documentUri, resolvedDocuments: options.resolvedDocuments };
    this.selectedAddIns = isRecord(instance) && Array.isArray(instance.$uses) && instance.$uses.every((entry) => typeof entry === 'string') ? instance.$uses : [];
    this.externalRelationResolver = options.externalRelationResolver;
  }

  get selection(): CrossNavigationSelection { return this.currentSelection; }

  validate(): InstanceValidationResult {
    const rootRef = typeof this.schema.$root === 'string' ? this.schema.$root : undefined;
    const root = rootRef ? this.schemaContext.resolve(rootRef) : undefined;
    if (rootRef && !root) {
      const evaluation = this.failure('instance.root-unresolved', `Document root ${rootRef} cannot be resolved.`, '', '/$root', '$root', 'indeterminate');
      this.lastResult = evaluation;
      return evaluation;
    }
    const rootSchema = root ? this.effectiveSchema(root.schema, root.effectivePointer, root.documentUri) : this.schema;
    const rootPointer = root?.effectivePointer ?? '';
    const rootDocumentUri = root?.documentUri ?? this.schemaContext.rootUri;
    if (rootSchema.abstract === true) {
      const evaluation = this.failure('instance.root-abstract', 'An abstract declaration cannot be used as the instance root.', '', rootPointer, '$root');
      this.lastResult = evaluation;
      return evaluation;
    }
    const evaluation = this.evaluate(rootSchema, this.instance, '', rootPointer, 0, new Set(), rootDocumentUri);
    return this.completeEvaluation(evaluation);
  }

  /** Evaluates an exact authored schema in its original document/import context, without rebasing it to root. */
  validateAt(schemaPointer: string, documentUri = this.schemaContext.rootUri): InstanceValidationResult {
    const location = this.overlayResolver(documentUri)?.index.at(schemaPointer);
    const evaluation = location && isRecord(location.value)
      ? this.evaluate(location.value, this.instance, '', schemaPointer, 0, new Set(), documentUri)
      : this.failure('instance.schema-indeterminate', 'No authored schema exists at the requested document location.', '', schemaPointer, 'schema', 'indeterminate');
    return this.completeEvaluation(evaluation);
  }

  private completeEvaluation(evaluation: Evaluation): InstanceValidationResult {
    const annotate = (trace: EvaluationTrace, occurrencePath: string): EvaluationTrace => ({ ...trace, ...this.versions, occurrencePath, children: trace.children.map((child,index) => annotate(child, occurrencePath + '/' + index)) });
    this.lastResult = { ...evaluation, ...this.versions, trace: annotate(evaluation.trace, '') };
    return this.lastResult;
  }

  selectInstance(instancePointer: string, schemaPointer = this.currentSelection.schemaPointer): CrossNavigationSelection {
    return this.currentSelection = { source: 'instance', instancePointer, schemaPointer };
  }

  selectSchema(schemaPointer: string, instancePointer = this.currentSelection.instancePointer): CrossNavigationSelection {
    return this.currentSelection = { source: 'schema', instancePointer, schemaPointer };
  }

  selectDiagnostic(index: number): CrossNavigationSelection | undefined {
    const diagnostic = (this.lastResult ?? this.validate()).diagnostics[index];
    if (!diagnostic) return undefined;
    return this.currentSelection = { source: 'diagnostic', instancePointer: diagnostic.instancePointer, schemaPointer: diagnostic.schemaPointer, diagnosticIndex: index };
  }

  private result(keyword: string, status: EvaluationStatus, instancePointer: string, schemaPointer: string, children: readonly EvaluationTrace[] = [], diagnostics: readonly InstanceDiagnostic[] = [], message?: string): Evaluation {
    return { status, diagnostics, trace: { keyword, status, instancePointer, schemaPointer, children, ...(message === undefined ? {} : { message }) } };
  }

  private failure(code: string, message: string, instancePointer: string, schemaPointer: string, keyword: string, status: 'invalid' | 'indeterminate' = 'invalid'): Evaluation {
    return this.result(keyword, status, instancePointer, schemaPointer, [], [{ code, message, severity: status === 'invalid' ? 'error' : 'indeterminate', instancePointer, schemaPointer }], message);
  }

  private evaluate(schema: Readonly<Record<string, unknown>>, instance: unknown, instancePointer: string, schemaPointer: string, depth: number, active: Set<string>, documentUri: string): Evaluation {
    if (depth > this.depthBudget) return this.failure('instance.depth-budget', 'Evaluation depth budget was exhausted.', instancePointer, schemaPointer, 'depth', 'indeterminate');
    const activeKey = `${documentUri}\u0000${schemaPointer}\u0000${instancePointer}`;
    if (active.has(activeKey)) return this.failure('instance.cycle', 'A recursive schema evaluation cycle was detected.', instancePointer, schemaPointer, '$ref', 'indeterminate');
    const nextActive = new Set(active);
    nextActive.add(activeKey);
    const evaluations: Evaluation[] = [];

    if (typeof schema.$ref === 'string') {
      const resolved = this.schemaContext.resolve(schema.$ref, documentUri);
      if (!resolved) evaluations.push(this.failure('instance.ref-unresolved', `Local reference ${schema.$ref} cannot be resolved.`, instancePointer, childPointer(schemaPointer, '$ref'), '$ref', 'indeterminate'));
      else evaluations.push(this.evaluate(this.effectiveSchema(resolved.schema, resolved.effectivePointer, resolved.documentUri), instance, instancePointer, resolved.effectivePointer, depth + 1, nextActive, resolved.documentUri));
    }

    const type = schema.type;
    if (isRecord(type) && typeof type.$ref === 'string') {
      const resolved = this.schemaContext.resolve(type.$ref, documentUri);
      if (!resolved) {
        evaluations.push(this.failure('instance.ref-unresolved', `Local reference ${type.$ref} cannot be resolved.`, instancePointer, childPointer(childPointer(schemaPointer, 'type'), '$ref'), '$ref', 'indeterminate'));
      } else {
        evaluations.push(this.evaluate(this.effectiveSchema(resolved.schema, resolved.effectivePointer, resolved.documentUri), instance, instancePointer, resolved.effectivePointer, depth + 1, nextActive, resolved.documentUri));
      }
    } else if (Array.isArray(type)) {
      const branches = type.map((entry, index) => this.evaluate(
        isRecord(entry) && typeof entry.$ref !== 'string' ? entry : { type: entry },
        instance,
        instancePointer,
        childPointer(childPointer(schemaPointer, 'type'), index),
        depth + 1,
        nextActive,
        documentUri
      ));
      evaluations.push(this.combineAny('type', branches, instancePointer, childPointer(schemaPointer, 'type')));
    } else if (typeof type === 'string') {
      if (!validScalar(instance, type, schema)) evaluations.push(this.failure('instance.type', `Value is not in the ${type} value space.`, instancePointer, childPointer(schemaPointer, 'type'), 'type'));
      else evaluations.push(this.result('type', 'valid', instancePointer, childPointer(schemaPointer, 'type')));
    }

    const effectiveSchema = this.effectiveSchema(schema, schemaPointer, documentUri);
    const baseStatus = statusOf(evaluations);
    if (baseStatus !== 'invalid') {
      evaluations.push(...this.evaluateShape(effectiveSchema, instance, instancePointer, schemaPointer, depth, nextActive, documentUri));
      evaluations.push(...this.evaluateValueConstraints(effectiveSchema, instance, instancePointer, schemaPointer, depth, nextActive, documentUri));
      for (const layer of this.inheritedConstraintLayers.get(effectiveSchema) ?? []) {
        evaluations.push(...this.evaluateAdditionalProperties(layer.schema, effectiveSchema, instance, instancePointer, layer.origin.schemaPointer, depth, nextActive, layer.origin.documentUri));
        evaluations.push(...this.evaluateValueConstraints(layer.schema, instance, instancePointer, layer.origin.schemaPointer, depth, nextActive, layer.origin.documentUri));
      }
      if (this.capabilities.relationsActive) evaluations.push(...this.evaluateRelations(effectiveSchema, instance, instancePointer, schemaPointer, depth, nextActive, documentUri));
    }
    if (this.capabilities.conditionalCompositionActive) {
      evaluations.push(...this.evaluateComposition(schema, instance, instancePointer, schemaPointer, depth, nextActive, documentUri));
      for (const layer of this.inheritedConstraintLayers.get(effectiveSchema) ?? []) evaluations.push(...this.evaluateComposition(layer.schema, instance, instancePointer, layer.origin.schemaPointer, depth, nextActive, layer.origin.documentUri));
    }
    const status = statusOf(evaluations);
    return this.result('schema', status, instancePointer, schemaPointer, evaluations.map((entry) => entry.trace), evaluations.flatMap((entry) => entry.diagnostics));
  }

  private evaluateShape(schema: Readonly<Record<string, unknown>>, instance: unknown, instancePointer: string, schemaPointer: string, depth: number, active: Set<string>, documentUri: string): Evaluation[] {
    const results: Evaluation[] = [];
    const type = schema.type;
    if ((type === 'object' || schema.properties !== undefined || schema.required !== undefined || schema.additionalProperties !== undefined) && isRecord(instance)) {
      const properties = isRecord(schema.properties) ? schema.properties : {};
      const origins = this.propertyOrigins.get(schema);
      for (const [name, propertySchema] of Object.entries(properties)) {
        const origin = origins?.get(name);
        if (hasOwn(instance, name) && isRecord(propertySchema)) results.push(this.evaluate(propertySchema, instance[name], childPointer(instancePointer, name), origin?.schemaPointer ?? childPointer(childPointer(schemaPointer, 'properties'), name), depth + 1, active, origin?.documentUri ?? documentUri));
      }
      if (Array.isArray(schema.required)) {
        const alternatives = schema.required.every(Array.isArray);
        if (alternatives) {
          const matches = (schema.required as readonly unknown[]).filter((set) => (set as readonly unknown[]).every((name) => typeof name === 'string' && hasOwn(instance, name))).length;
          if (matches !== 1) results.push(this.failure('instance.required-alternative', `Exactly one alternative required-property set must match; ${matches} matched.`, instancePointer, childPointer(schemaPointer, 'required'), 'required'));
        } else {
          for (const name of schema.required) if (typeof name === 'string' && !hasOwn(instance, name)) results.push(this.failure('instance.required', `Required property ${name} is missing.`, childPointer(instancePointer, name), childPointer(schemaPointer, 'required'), 'required'));
        }
      }
      results.push(...this.evaluateAdditionalProperties(schema, schema, instance, instancePointer, schemaPointer, depth, active, documentUri));
    }
    if ((type === 'array' || type === 'set') && Array.isArray(instance) && isRecord(schema.items)) {
      instance.forEach((item, index) => results.push(this.evaluate(schema.items as Readonly<Record<string, unknown>>, item, childPointer(instancePointer, index), childPointer(schemaPointer, 'items'), depth + 1, active, documentUri)));
    }
    if (type === 'set' && Array.isArray(instance)) {
      for (let index = 0; index < instance.length; index++) if (instance.slice(0, index).some((item) => deepEqual(item, instance[index]))) results.push(this.failure('instance.set-duplicate', 'Set elements must be unique.', childPointer(instancePointer, index), childPointer(schemaPointer, 'type'), 'set'));
    }
    if (type === 'map' && isRecord(instance) && isRecord(schema.values)) {
      for (const [name, value] of Object.entries(instance)) results.push(this.evaluate(schema.values, value, childPointer(instancePointer, name), childPointer(schemaPointer, 'values'), depth + 1, active, documentUri));
    }
    if (type === 'tuple' && Array.isArray(instance) && Array.isArray(schema.tuple) && isRecord(schema.properties)) {
      if (instance.length !== schema.tuple.length) results.push(this.failure('instance.tuple-length', `Tuple requires ${schema.tuple.length} elements.`, instancePointer, childPointer(schemaPointer, 'tuple'), 'tuple'));
      schema.tuple.forEach((name, index) => {
        const member = typeof name === 'string' ? (schema.properties as Readonly<Record<string, unknown>>)[name] : undefined;
        const origin = typeof name === 'string' ? this.propertyOrigins.get(schema)?.get(name) : undefined;
        if (index < instance.length && isRecord(member)) results.push(this.evaluate(member, instance[index], childPointer(instancePointer, index), origin?.schemaPointer ?? childPointer(childPointer(schemaPointer, 'properties'), name as string), depth + 1, active, origin?.documentUri ?? documentUri));
      });
    }
    if (type === 'choice' && isRecord(instance) && isRecord(schema.choices)) results.push(this.evaluateChoice(schema, instance, instancePointer, schemaPointer, depth, active, documentUri));
    return results;
  }

  private overlayResolver(documentUri: string): OverlayContextResolver | undefined {
    let resolver = this.overlayContexts.get(documentUri);
    if (!resolver) {
      const document = this.schemaContext.documentFor(documentUri);
      if (!document) return undefined;
      const resolvedDocuments = [{ uri: this.schemaContext.rootUri, document: this.schema }, ...(this.schemaOptions.resolvedDocuments ?? [])].filter(entry => entry.document !== document);
      resolver = new OverlayContextResolver(document, { documentUri, resolvedDocuments, addIns: this.selectedAddIns });
      this.overlayContexts.set(documentUri, resolver);
    }
    return resolver;
  }

  private overlayLocation(schemaPointer: string, documentUri: string, schema: Readonly<Record<string, unknown>>): { readonly resolver: OverlayContextResolver; readonly pointer: string } | undefined {
    const resolver = this.overlayResolver(documentUri);
    if (!resolver) return undefined;
    const authored = this.authoredSchemas.get(schema) ?? schema;
    // Source mapping must not dereference aliases or walk effective children. Their locally authored
    // rules (including conditional descendants) stay under the declaration's original source pointer.
    // Reference evaluation can carry a namespace from ANY intermediate importing document, not only root.
    if (!this.declarationMappings) {
      const visibleFrom = new Set([this.schemaContext.rootUri, ...(this.schemaOptions.resolvedDocuments ?? []).map(document => document.uri)]);
      this.declarationMappings = [...visibleFrom].flatMap(uri => this.schemaContext.declarations(uri));
    }
    const owners = this.declarationMappings.filter(location => location.documentUri === documentUri &&
      (schemaPointer === location.effectivePointer || schemaPointer.startsWith(location.effectivePointer + '/')))
      .sort((left, right) => right.effectivePointer.length - left.effectivePointer.length);
    for (const owner of owners) {
      const pointer = owner.sourcePointer + schemaPointer.slice(owner.effectivePointer.length);
      if (resolver.index.at(pointer)?.value === authored) return { resolver, pointer };
    }
    // Identity distinguishes a direct source path from a coincidentally identical imported prefix.
    return resolver.index.at(schemaPointer)?.value === authored ? { resolver, pointer: schemaPointer } : undefined;
  }

  private overlayAt(schemaPointer: string, documentUri: string, schema: Readonly<Record<string, unknown>>): OverlayContext | undefined {
    if (!this.capabilities.conditionalCompositionActive) return undefined;
    const location = this.overlayLocation(schemaPointer, documentUri, schema);
    return location?.resolver.resolve(location.pointer);
  }

  private evaluateAdditionalProperties(constraintSchema: Readonly<Record<string, unknown>>, effectiveSchema: Readonly<Record<string, unknown>>, instance: unknown, instancePointer: string, schemaPointer: string, depth: number, active: Set<string>, documentUri: string): Evaluation[] {
    if (!isRecord(instance) || !hasOwn(constraintSchema, 'additionalProperties')) return [];
    const policy = constraintSchema.additionalProperties;
    if (policy === true) return [];
    if (policy !== false && !isRecord(policy)) return [this.failure('instance.schema-indeterminate', 'additionalProperties requires a boolean or schema policy.', instancePointer, childPointer(schemaPointer, 'additionalProperties'), 'additionalProperties', 'indeterminate')];
    const results: Evaluation[] = [];
    const properties = isRecord(effectiveSchema.properties) ? effectiveSchema.properties : {};
    // A branch-local closed policy closes the EFFECTIVE shape, not just the few properties in its delta.
    // Independently closed bases/references are still evaluated separately at their own source locations.
    const overlay = this.overlayAt(schemaPointer, documentUri, constraintSchema);
    const projected = overlay?.authoringProjection;
    const declared = new Set([...Object.keys(properties), ...Object.keys(projected?.properties ?? {}), ...(isRecord(effectiveSchema.relations) ? Object.keys(effectiveSchema.relations) : []), ...(isRecord(projected?.schema.relations) ? Object.keys(projected.schema.relations) : [])]);
    for (const [name, value] of Object.entries(instance)) {
      if (declared.has(name) || (instancePointer === '' && name === '$uses')) continue;
      if (projected?.reasons.length) {
        results.push(this.failure('instance.shape-indeterminate', 'The complete contextual member set is indeterminate: ' + projected.reasons.join('; '), childPointer(instancePointer, name), childPointer(schemaPointer, 'additionalProperties'), 'additionalProperties', 'indeterminate'));
        continue;
      }
      if (policy === false) results.push(this.failure('instance.additional-property', `Property ${name} is not declared.`, childPointer(instancePointer, name), childPointer(schemaPointer, 'additionalProperties'), 'additionalProperties'));
      else results.push(this.evaluate(policy, value, childPointer(instancePointer, name), childPointer(schemaPointer, 'additionalProperties'), depth + 1, active, documentUri));
    }
    return results;
  }

  private evaluateChoice(schema: Readonly<Record<string, unknown>>, instance: Readonly<Record<string, unknown>>, instancePointer: string, schemaPointer: string, depth: number, active: Set<string>, documentUri: string): Evaluation {
    const choices = schema.choices as Readonly<Record<string, unknown>>;
    if (typeof schema.selector === 'string') {
      const selected = instance[schema.selector];
      const branch = typeof selected === 'string' ? choices[selected] : undefined;
      if (!isRecord(branch)) return this.failure('instance.choice-selector', `Selector ${schema.selector} does not name a choice.`, childPointer(instancePointer, schema.selector), childPointer(schemaPointer, 'selector'), 'choice');
      return this.evaluate(branch, instance, instancePointer, childPointer(childPointer(schemaPointer, 'choices'), selected as string), depth + 1, active, documentUri);
    }
    const selected = Object.keys(instance).filter((name) => hasOwn(choices, name));
    if (selected.length !== 1 || Object.keys(instance).length !== 1) return this.failure('instance.choice-tag', 'Tagged choice must contain exactly one choice property.', instancePointer, childPointer(schemaPointer, 'choices'), 'choice');
    const name = selected[0]!;
    const branch = choices[name];
    return isRecord(branch) ? this.evaluate(branch, instance[name], childPointer(instancePointer, name), childPointer(childPointer(schemaPointer, 'choices'), name), depth + 1, active, documentUri) :
      this.failure('instance.choice-schema', `Choice ${name} has no evaluable schema.`, instancePointer, childPointer(childPointer(schemaPointer, 'choices'), name), 'choice', 'indeterminate');
  }

  private evaluateValueConstraints(schema: Readonly<Record<string, unknown>>, instance: unknown, instancePointer: string, schemaPointer: string, depth: number, active: Set<string>, documentUri: string): Evaluation[] {
    const results = this.evaluateContextualDecimal(schema, instance, instancePointer, schemaPointer, documentUri);
    const check = (keyword: string, valid: boolean, message: string): void => { if (!valid) results.push(this.failure(`instance.${keyword}`, message, instancePointer, childPointer(schemaPointer, keyword), keyword)); };
    if (hasOwn(schema, 'const')) check('const', deepEqual(instance, schema.const), 'Value does not equal const.');
    if (Array.isArray(schema.enum)) check('enum', schema.enum.some((value) => deepEqual(value, instance)), 'Value is not one of the enumerated values.');
    if (typeof instance === 'string' && typeof schema.maxLength === 'number') check('maxLength', [...instance].length <= schema.maxLength, 'String is longer than maxLength.');
    if (!this.capabilities.validationActive) return results;
    if ((typeof instance === 'number' || (typeof instance === 'string' && (INTEGER_TEXT.test(instance) || DECIMAL_TEXT.test(instance))))) {
      for (const [keyword, relation] of [['minimum', (value: number) => value >= 0], ['maximum', (value: number) => value <= 0], ['exclusiveMinimum', (value: number) => value > 0], ['exclusiveMaximum', (value: number) => value < 0]] as const) {
        const bound = schema[keyword];
        if (typeof bound === 'number' || typeof bound === 'string') { const comparison = compareNumeric(instance, bound); if (comparison === undefined) results.push(this.failure('instance.numeric-indeterminate', `Cannot compare ${keyword}.`, instancePointer, childPointer(schemaPointer, keyword), keyword, 'indeterminate')); else check(keyword, relation(comparison), `Value violates ${keyword}.`); }
      }
      if (typeof schema.multipleOf === 'number' || typeof schema.multipleOf === 'string') { const valid = multipleOf(instance, schema.multipleOf); if (valid === undefined) results.push(this.failure('instance.numeric-indeterminate', 'Cannot evaluate multipleOf.', instancePointer, childPointer(schemaPointer, 'multipleOf'), 'multipleOf', 'indeterminate')); else check('multipleOf', valid, 'Value is not a multiple of the required value.'); }
    }
    if (typeof instance === 'string') {
      if (typeof schema.minLength === 'number') check('minLength', [...instance].length >= schema.minLength, 'String is shorter than minLength.');
      if (typeof schema.pattern === 'string') {
        const compilation = compileSafeRegex(schema.pattern);
        if (compilation.status !== 'ready') results.push(this.failure('instance.pattern-indeterminate', patternCompilationMessage(compilation), instancePointer, childPointer(schemaPointer, 'pattern'), 'pattern', 'indeterminate'));
        else {
          const match = compilation.test(instance, true);
          if (match.status === 'indeterminate') results.push(this.failure('instance.pattern-indeterminate', match.reason === 'input-too-long' ? `Pattern input exceeds the ${MAX_SAFE_REGEX_INPUT_LENGTH}-code-unit safety limit.` : 'The non-backtracking regular-expression engine could not evaluate the pattern.', instancePointer, childPointer(schemaPointer, 'pattern'), 'pattern', 'indeterminate'));
          else check('pattern', match.status === 'matched', 'String does not match pattern.');
        }
      }
      if (typeof schema.format === 'string') { const valid = validFormat(instance, schema.format); if (valid === undefined) results.push(this.failure('instance.format-indeterminate', `Format ${schema.format} is not supported.`, instancePointer, childPointer(schemaPointer, 'format'), 'format', 'indeterminate')); else check('format', valid, `String does not match format ${schema.format}.`); }
    }
    if (Array.isArray(instance)) {
      if (typeof schema.minItems === 'number') check('minItems', instance.length >= schema.minItems, 'Array has fewer than minItems elements.');
      if (typeof schema.maxItems === 'number') check('maxItems', instance.length <= schema.maxItems, 'Array has more than maxItems elements.');
      if (schema.uniqueItems === true) check('uniqueItems', instance.every((value, index) => !instance.slice(0, index).some((other) => deepEqual(value, other))), 'Array elements are not unique.');
      if (isRecord(schema.contains)) {
        const matches = instance.map((value, index) => this.evaluate(schema.contains as Readonly<Record<string, unknown>>, value, childPointer(instancePointer, index), childPointer(schemaPointer, 'contains'), depth + 1, active, documentUri));
        const validCount = matches.filter((entry) => entry.status === 'valid').length;
        const indeterminateCount = matches.filter((entry) => entry.status === 'indeterminate').length;
        const minimum = typeof schema.minContains === 'number' ? schema.minContains : 1;
        const maximum = typeof schema.maxContains === 'number' ? schema.maxContains : Number.POSITIVE_INFINITY;
        if (validCount > maximum || validCount + indeterminateCount < minimum) check('contains', false, `Contains match count must be between ${minimum} and ${maximum}.`);
        else if (indeterminateCount > 0 && (validCount < minimum || validCount + indeterminateCount > maximum)) results.push(this.failure('instance.contains-indeterminate', 'Contains match count is indeterminate.', instancePointer, childPointer(schemaPointer, 'contains'), 'contains', 'indeterminate'));
      }
    }
    if (isRecord(instance)) this.evaluateObjectConstraints(schema, instance, instancePointer, schemaPointer, depth, active, results, check, documentUri);
    return results;
  }

  private evaluateContextualDecimal(schema: Readonly<Record<string, unknown>>, instance: unknown, instancePointer: string, schemaPointer: string, documentUri: string): Evaluation[] {
    const keywords = (['precision', 'scale'] as const).filter(keyword => hasOwn(schema, keyword));
    const firstKeyword = keywords[0];
    // Literal decimal types already use the same checks in validScalar; only inherited/reference types need this path.
    if (firstKeyword === undefined || typeof schema.type === 'string') return [];
    const location = this.overlayLocation(schemaPointer, documentUri, schema);
    const projection = location && (location.resolver.resolve(location.pointer)?.authoringProjection ?? location.resolver.projectSchema(location.pointer));
    const types = projection?.types;
    if (types?.determinate && !types.types.includes('decimal')) return [];
    if (!projection || !types?.determinate || types.types.length !== 1) return [this.failure('instance.contextual-type-indeterminate', 'Cannot determine the contextual type for decimal qualifiers.', instancePointer, childPointer(schemaPointer, firstKeyword), firstKeyword, 'indeterminate')];
    const results: Evaluation[] = [];
    const valid = new Set<string>();
    for (const keyword of keywords) {
      const value = schema[keyword];
      if (typeof value === 'number' && Number.isInteger(value) && value >= 0) valid.add(keyword);
      else results.push(this.failure('instance.schema-indeterminate', keyword + ' requires a non-negative integer.', instancePointer, childPointer(schemaPointer, keyword), keyword, 'indeterminate'));
    }
    // The other parameter is inherited; locally authored values retain their own bounds, not a serialized copied type.
    const issues = decimalValueIssues(instance, { ...projection.schema, ...schema });
    if (issues.includes('type')) results.push(this.failure('instance.decimal-representation', 'Value is not in the inherited decimal representation.', instancePointer, childPointer(schemaPointer, firstKeyword), firstKeyword));
    for (const keyword of keywords) if (issues.includes(keyword) && valid.has(keyword)) results.push(this.failure('instance.' + keyword, 'Decimal value exceeds ' + keyword + '.', instancePointer, childPointer(schemaPointer, keyword), keyword));
    return results;
  }

  private evaluateObjectConstraints(schema: Readonly<Record<string, unknown>>, instance: Readonly<Record<string, unknown>>, instancePointer: string, schemaPointer: string, depth: number, active: Set<string>, results: Evaluation[], check: (keyword: string, valid: boolean, message: string) => void, documentUri: string): void {
    const count = Object.keys(instance).length;
    if (typeof schema.minProperties === 'number') check('minProperties', count >= schema.minProperties, 'Object has fewer than minProperties properties.');
    if (typeof schema.maxProperties === 'number') check('maxProperties', count <= schema.maxProperties, 'Object has more than maxProperties properties.');
    if (typeof schema.minEntries === 'number') check('minEntries', count >= schema.minEntries, 'Map has fewer than minEntries entries.');
    if (typeof schema.maxEntries === 'number') check('maxEntries', count <= schema.maxEntries, 'Map has more than maxEntries entries.');
    if (isRecord(schema.dependentRequired)) for (const [name, dependencies] of Object.entries(schema.dependentRequired)) if (hasOwn(instance, name) && Array.isArray(dependencies)) for (const dependency of dependencies) if (typeof dependency === 'string' && !hasOwn(instance, dependency)) results.push(this.failure('instance.dependentRequired', `${name} requires ${dependency}.`, childPointer(instancePointer, dependency), childPointer(childPointer(schemaPointer, 'dependentRequired'), name), 'dependentRequired'));
    for (const [keyword, patterns] of [['patternProperties', schema.patternProperties], ['patternKeys', schema.patternKeys]] as const) if (isRecord(patterns)) for (const [pattern, memberSchema] of Object.entries(patterns)) if (isRecord(memberSchema)) {
      const compilation = compileSafeRegex(pattern);
      const patternPointer = childPointer(childPointer(schemaPointer, keyword), pattern);
      if (compilation.status !== 'ready') {
        results.push(this.failure('instance.pattern-indeterminate', patternCompilationMessage(compilation), instancePointer, patternPointer, keyword, 'indeterminate'));
        continue;
      }
      for (const [name, value] of Object.entries(instance)) {
        const match = compilation.test(name);
        if (match.status === 'indeterminate') results.push(this.failure('instance.pattern-indeterminate', match.reason === 'input-too-long' ? `Pattern input exceeds the ${MAX_SAFE_REGEX_INPUT_LENGTH}-code-unit safety limit.` : 'The non-backtracking regular-expression engine could not evaluate the pattern.', childPointer(instancePointer, name), patternPointer, keyword, 'indeterminate'));
        else if (match.status === 'matched') results.push(this.evaluate(memberSchema, value, childPointer(instancePointer, name), patternPointer, depth + 1, active, documentUri));
      }
    }
    for (const [keyword, nameSchema] of [['propertyNames', schema.propertyNames], ['keyNames', schema.keyNames]] as const) if (isRecord(nameSchema)) for (const name of Object.keys(instance)) results.push(this.evaluate(nameSchema, name, childPointer(instancePointer, name), childPointer(schemaPointer, keyword), depth + 1, active, documentUri));
    if (isRecord(schema.has)) {
      const matches = Object.entries(instance).map(([name, value]) => this.evaluate(schema.has as Readonly<Record<string, unknown>>, value, childPointer(instancePointer, name), childPointer(schemaPointer, 'has'), depth + 1, active, documentUri));
      if (!matches.some((entry) => entry.status === 'valid')) results.push(matches.some((entry) => entry.status === 'indeterminate') ? this.failure('instance.has-indeterminate', 'Whether a value matches has is indeterminate.', instancePointer, childPointer(schemaPointer, 'has'), 'has', 'indeterminate') : this.failure('instance.has', 'No object value matches has.', instancePointer, childPointer(schemaPointer, 'has'), 'has'));
    }
  }

  private effectiveSchema(schema: Readonly<Record<string, unknown>>, schemaPointer: string, documentUri: string): Readonly<Record<string, unknown>> {
    if (schema.type !== 'object' && schema.type !== 'tuple') return schema;
    const targetPointer = this.schemaContext.declarations().find((location) => location.documentUri === documentUri && location.schema === schema)?.effectivePointer ?? schemaPointer;
    const cacheKey = `${documentUri}\u0000${targetPointer}`;
    const cached = this.effectiveSchemaCache.get(cacheKey);
    if (cached) return cached;
    const result = targetPointer.startsWith('/definitions/') ? resolveEffectiveMembers(this.schema, `#${targetPointer}`, {
      ...this.schemaOptions,
      addIns: this.selectedAddIns
    }) : undefined;
    const effectiveRelations = this.resolveEffectiveRelations(schema, targetPointer, documentUri);
    const targetLocation = this.schemaContext.declarations().find((location) => location.documentUri === documentUri && location.schema === schema && location.effectivePointer === targetPointer);
    const constraintLayers = this.resolveInheritedConstraintLayers(schema, targetPointer, targetLocation?.sourcePointer ?? schemaPointer, documentUri);
    if ((!result || result.members.length === 0) && effectiveRelations.identity === undefined && effectiveRelations.relations.size === 0 && constraintLayers.length === 0) return schema;
    const authoredAlternatives = Array.isArray(schema.required) && schema.required.length > 0 && schema.required.every((entry) => Array.isArray(entry));
    const effective = {
      ...schema,
      ...(result && result.members.length > 0 ? { properties: Object.fromEntries(result.members.map((member) => [member.name, member.schema])) } : {}),
      ...(authoredAlternatives ? { required: schema.required } : result && result.required.length > 0 ? { required: result.required } : {}),
      ...(schema.type === 'tuple' && result ? { tuple: result.tuple } : {}),
      ...(effectiveRelations.identity === undefined ? {} : { identity: effectiveRelations.identity }),
      ...(effectiveRelations.relations.size === 0 ? {} : { relations: Object.fromEntries([...effectiveRelations.relations].map(([name, relation]) => [name, relation.schema])) })
    };
    this.authoredSchemas.set(effective, this.authoredSchemas.get(schema) ?? schema);
    if (result) this.propertyOrigins.set(effective, new Map(result.members.map((member) => [member.name, { documentUri: member.documentUri, schemaPointer: member.declaredAt }])));
    this.relationOrigins.set(effective, new Map([...effectiveRelations.relations].map(([name, relation]) => [name, relation.origin])));
    this.inheritedConstraintLayers.set(effective, constraintLayers);
    this.effectiveSchemaCache.set(cacheKey, effective);
    return effective;
  }

  private resolveInheritedConstraintLayers(schema: Readonly<Record<string, unknown>>, effectivePointer: string, sourcePointer: string, documentUri: string, stack: readonly string[] = [], seen = new Set<string>()): readonly EffectiveConstraintLayer[] {
    const layers: EffectiveConstraintLayer[] = [];
    const bases = typeof schema.$extends === 'string' ? [schema.$extends] : Array.isArray(schema.$extends) && schema.$extends.every((entry) => typeof entry === 'string') ? schema.$extends : [];
    for (const baseReference of bases) {
      const base = this.schemaContext.resolve(baseReference, documentUri);
      if (!base) continue;
      const identity = `${base.documentUri}\u0000${base.sourcePointer}`;
      if (stack.includes(identity)) continue;
      const basePointer = this.inheritedEffectivePointer(effectivePointer, sourcePointer, base.effectivePointer);
      layers.push(...this.resolveInheritedConstraintLayers(base.schema, basePointer, base.sourcePointer, base.documentUri, [...stack, identity], seen));
      if (seen.has(identity)) continue;
      seen.add(identity);
      layers.push({ schema: base.schema, origin: { documentUri: base.documentUri, schemaPointer: basePointer } });
    }
    return layers;
  }

  private inheritedEffectivePointer(ownerEffectivePointer: string, ownerSourcePointer: string, basePointer: string): string {
    if (ownerEffectivePointer === ownerSourcePointer || !ownerSourcePointer.startsWith('/definitions/') || !basePointer.startsWith('/definitions/')) return basePointer;
    const ownerSuffix = ownerSourcePointer.slice('/definitions'.length);
    return ownerEffectivePointer.endsWith(ownerSuffix)
      ? `${ownerEffectivePointer.slice(0, -ownerSuffix.length)}${basePointer.slice('/definitions'.length)}`
      : basePointer;
  }

  private resolveEffectiveRelations(schema: Readonly<Record<string, unknown>>, schemaPointer: string, documentUri: string, stack: readonly string[] = []): EffectiveRelations {
    const key = `${documentUri}\u0000${schemaPointer}`;
    if (stack.includes(key)) return { relations: new Map() };
    const relations = new Map<string, EffectiveRelation>();
    let identity: readonly string[] | undefined;
    let identityOrigin: SchemaOrigin | undefined;
    const bases = typeof schema.$extends === 'string' ? [schema.$extends] : Array.isArray(schema.$extends) && schema.$extends.every((entry) => typeof entry === 'string') ? schema.$extends : [];
    for (const baseReference of bases) {
      const base = this.schemaContext.resolve(baseReference, documentUri);
      if (!base) continue;
      const inherited = this.resolveEffectiveRelations(base.schema, base.effectivePointer, base.documentUri, [...stack, key]);
      if (identity === undefined && inherited.identity !== undefined) {
        identity = inherited.identity;
        identityOrigin = inherited.identityOrigin;
      }
      for (const [name, relation] of inherited.relations) if (!relations.has(name)) relations.set(name, relation);
    }
    if (Array.isArray(schema.identity) && schema.identity.every((entry) => typeof entry === 'string')) {
      identity = schema.identity;
      identityOrigin = { documentUri, schemaPointer: childPointer(schemaPointer, 'identity') };
    }
    if (isRecord(schema.relations)) for (const [name, relation] of Object.entries(schema.relations)) if (isRecord(relation)) {
      relations.set(name, { schema: relation, origin: { documentUri, schemaPointer: childPointer(childPointer(schemaPointer, 'relations'), name) } });
    }
    return { ...(identity === undefined ? {} : { identity }), ...(identityOrigin === undefined ? {} : { identityOrigin }), relations };
  }

  private evaluateRelations(schema: Readonly<Record<string, unknown>>, instance: unknown, instancePointer: string, schemaPointer: string, depth: number, active: Set<string>, documentUri: string): Evaluation[] {
    if (!isRecord(instance) || !isRecord(schema.relations)) return [];
    const results: Evaluation[] = [];
    for (const [relationName, relationValue] of Object.entries(schema.relations)) {
      if (!hasOwn(instance, relationName) || !isRecord(relationValue)) continue;
      const relationOrigin = this.relationOrigins.get(schema)?.get(relationName) ?? { documentUri, schemaPointer: childPointer(childPointer(schemaPointer, 'relations'), relationName) };
      const relationPointer = relationOrigin.schemaPointer;
      const targetRef = isRecord(relationValue.targettype) && typeof relationValue.targettype.$ref === 'string' ? relationValue.targettype.$ref : undefined;
      const target = targetRef ? this.schemaContext.resolve(targetRef, relationOrigin.documentUri) : undefined;
      const targetRelations = target ? this.resolveEffectiveRelations(target.schema, target.effectivePointer, target.documentUri) : undefined;
      if (!target || !targetRelations?.identity) {
        results.push(this.failure('instance.relation-target', 'Relation target and ordered identity could not be resolved.', childPointer(instancePointer, relationName), childPointer(relationPointer, 'targettype'), 'relations', 'indeterminate'));
        continue;
      }
      const targetSchema = this.effectiveSchema(target.schema, target.effectivePointer, target.documentUri);
      const relationInstance = instance[relationName];
      const entries = relationValue.cardinality === 'multiple' ? relationInstance : [relationInstance];
      if (relationValue.cardinality === 'multiple' ? !Array.isArray(relationInstance) : !isRecord(relationInstance)) {
        results.push(this.failure('instance.relation-cardinality', `Relation ${relationName} requires ${relationValue.cardinality === 'multiple' ? 'an array' : 'an object'}.`, childPointer(instancePointer, relationName), childPointer(relationPointer, 'cardinality'), 'relations'));
        continue;
      }
      const identities = targetRelations.identity;
      for (let index = 0; index < (entries as readonly unknown[]).length; index++) {
        const entry = (entries as readonly unknown[])[index];
        const entryPointer = relationValue.cardinality === 'multiple' ? childPointer(childPointer(instancePointer, relationName), index) : childPointer(instancePointer, relationName);
        if (!isRecord(entry) || !hasOwn(entry, 'identity')) {
          results.push(this.failure('instance.relation-identity', 'Relation entry must contain identity.', entryPointer, childPointer(relationPointer, 'targettype'), 'relations'));
          continue;
        }
        const identityValues = identities.length === 1 ? [entry.identity] : Array.isArray(entry.identity) ? entry.identity : [];
        if (identityValues.length !== identities.length) {
          results.push(this.failure('instance.relation-identity', `Relation identity requires ${identities.length} ordered value(s).`, childPointer(entryPointer, 'identity'), childPointer(relationPointer, 'targettype'), 'relations'));
          continue;
        }
        for (let identityIndex = 0; identityIndex < identities.length; identityIndex++) {
          const propertySchema = isRecord(targetSchema.properties) ? targetSchema.properties[identities[identityIndex]!] : undefined;
          const propertyOrigin = this.propertyOrigins.get(targetSchema)?.get(identities[identityIndex]!);
          if (isRecord(propertySchema)) results.push(this.evaluate(propertySchema, identityValues[identityIndex], childPointer(childPointer(entryPointer, 'identity'), identityIndex), propertyOrigin?.schemaPointer ?? childPointer(childPointer(target.effectivePointer, 'properties'), identities[identityIndex]!), depth + 1, active, propertyOrigin?.documentUri ?? target.documentUri));
        }
        const qualifierRef = isRecord(relationValue.qualifiertype) && typeof relationValue.qualifiertype.$ref === 'string' ? relationValue.qualifiertype.$ref : undefined;
        if (qualifierRef) {
          const qualifier = this.schemaContext.resolve(qualifierRef, relationOrigin.documentUri);
          if (!qualifier) results.push(this.failure('instance.relation-qualifier', 'Relation qualifier type could not be resolved.', childPointer(entryPointer, 'qualifier'), childPointer(relationPointer, 'qualifiertype'), 'relations', 'indeterminate'));
          else if (!hasOwn(entry, 'qualifier')) results.push(this.failure('instance.relation-qualifier', 'Qualified relation requires qualifier.', childPointer(entryPointer, 'qualifier'), childPointer(relationPointer, 'qualifiertype'), 'relations'));
          else results.push(this.evaluate(qualifier.schema, entry.qualifier, childPointer(entryPointer, 'qualifier'), qualifier.effectivePointer, depth + 1, active, qualifier.documentUri));
        }
        const scopes = typeof relationValue.scope === 'string' ? [relationValue.scope] : Array.isArray(relationValue.scope) && relationValue.scope.every((value) => typeof value === 'string') ? relationValue.scope : [];
        if (scopes.length === 0) {
          const status = this.externalRelationResolver?.({ relationName, targetDocumentUri: target.documentUri, targetPointer: target.sourcePointer, identity: entry.identity }) ?? 'indeterminate';
          if (status !== 'valid') results.push(this.failure(status === 'invalid' ? 'instance.relation-external-missing' : 'instance.relation-external-indeterminate', status === 'invalid' ? 'External relation target was not found.' : 'External relation resolution is indeterminate.', entryPointer, relationPointer, 'relations', status));
          continue;
        }
        const candidates = [...new Map(scopes.flatMap((scope) => this.scopeCandidates(scope, relationOrigin.documentUri)).map((candidate) => [candidate.instancePointer, candidate])).values()];
        for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
          const candidateIdentity = this.instanceIdentity(targetSchema, candidates[candidateIndex]!.value, identities);
          if (!candidateIdentity) continue;
          const duplicate = candidates.slice(0, candidateIndex).some((candidate) => {
            const previousIdentity = this.instanceIdentity(targetSchema, candidate.value, identities);
            return previousIdentity !== undefined && deepEqual(previousIdentity, candidateIdentity);
          });
          if (duplicate) results.push(this.failure('instance.identity-duplicate', 'Identity values must be unique within the declared relation scope.', candidates[candidateIndex]!.instancePointer, targetRelations.identityOrigin?.schemaPointer ?? childPointer(target.effectivePointer, 'identity'), 'identity'));
        }
        const matches = candidates.filter((candidate) => deepEqual(this.instanceIdentity(targetSchema, candidate.value, identities), identityValues));
        if (matches.length !== 1) results.push(this.failure(matches.length === 0 ? 'instance.relation-scope-missing' : 'instance.relation-scope-ambiguous', `Scoped relation identity matched ${matches.length} targets.`, entryPointer, childPointer(relationPointer, 'scope'), 'relations'));
      }
    }
    return results;
  }

  private scopeCandidates(scope: string, fromDocumentUri: string): readonly ScopeCandidate[] {
    const rootRef = typeof this.schema.$root === 'string' ? this.schema.$root : undefined;
    const root = rootRef
      ? this.schemaContext.resolve(rootRef)
      : { documentUri: this.schemaContext.rootUri, sourcePointer: '', effectivePointer: '', schema: this.schema, imports: [] };
    if (!root) return [];
    const schemaLocation = scope === '#' ? root : this.schemaContext.resolveSchema(scope, fromDocumentUri);
    if (!schemaLocation) return [];
    const candidates: ScopeCandidate[] = [];
    this.walkScope(root.schema, this.instance, '', root.effectivePointer, root.documentUri, schemaLocation.schema, candidates, new Set(), 0);
    return candidates;
  }

  private walkScope(schema: Readonly<Record<string, unknown>>, instance: unknown, instancePointer: string, schemaPointer: string, documentUri: string, targetSchema: Readonly<Record<string, unknown>>, candidates: ScopeCandidate[], active: Set<string>, depth: number): void {
    if (depth > this.depthBudget) return;
    let currentSchema = schema;
    let currentPointer = schemaPointer;
    let currentDocumentUri = documentUri;
    const targetAtLocation = currentSchema === targetSchema;
    const reference = typeof currentSchema.$ref === 'string' ? currentSchema.$ref : isRecord(currentSchema.type) && typeof currentSchema.type.$ref === 'string' ? currentSchema.type.$ref : undefined;
    if (reference) {
      const resolved = this.schemaContext.resolve(reference, currentDocumentUri);
      if (!resolved) return;
      currentSchema = resolved.schema;
      currentPointer = resolved.effectivePointer;
      currentDocumentUri = resolved.documentUri;
    }
    const activeKey = `${currentDocumentUri}\u0000${currentPointer}\u0000${instancePointer}`;
    if (active.has(activeKey)) return;
    const nextActive = new Set(active);
    nextActive.add(activeKey);
    const effective = this.effectiveSchema(currentSchema, currentPointer, currentDocumentUri);
    const type = effective.type;
    if (targetAtLocation || currentSchema === targetSchema) {
      if ((type === 'array' || type === 'set') && Array.isArray(instance)) instance.forEach((value, index) => candidates.push({ value, instancePointer: childPointer(instancePointer, index) }));
      else if (type === 'map' && isRecord(instance)) for (const [name, value] of Object.entries(instance)) candidates.push({ value, instancePointer: childPointer(instancePointer, name) });
    }
    if ((type === 'array' || type === 'set') && Array.isArray(instance) && isRecord(effective.items)) {
      instance.forEach((value, index) => this.walkScope(effective.items as Readonly<Record<string, unknown>>, value, childPointer(instancePointer, index), childPointer(currentPointer, 'items'), currentDocumentUri, targetSchema, candidates, nextActive, depth + 1));
    } else if (type === 'map' && isRecord(instance) && isRecord(effective.values)) {
      for (const [name, value] of Object.entries(instance)) this.walkScope(effective.values, value, childPointer(instancePointer, name), childPointer(currentPointer, 'values'), currentDocumentUri, targetSchema, candidates, nextActive, depth + 1);
    } else if (type === 'object' && isRecord(instance) && isRecord(effective.properties)) {
      for (const [name, propertySchema] of Object.entries(effective.properties)) if (hasOwn(instance, name) && isRecord(propertySchema)) {
        const origin = this.propertyOrigins.get(effective)?.get(name);
        this.walkScope(propertySchema, instance[name], childPointer(instancePointer, name), origin?.schemaPointer ?? childPointer(childPointer(currentPointer, 'properties'), name), origin?.documentUri ?? currentDocumentUri, targetSchema, candidates, nextActive, depth + 1);
      }
    } else if (type === 'tuple' && Array.isArray(instance) && Array.isArray(effective.tuple) && isRecord(effective.properties)) {
      const properties = effective.properties;
      effective.tuple.forEach((name, index) => {
        const propertySchema = typeof name === 'string' ? properties[name] : undefined;
        if (index >= instance.length || !isRecord(propertySchema)) return;
        const origin = this.propertyOrigins.get(effective)?.get(name as string);
        this.walkScope(propertySchema, instance[index], childPointer(instancePointer, index), origin?.schemaPointer ?? childPointer(childPointer(currentPointer, 'properties'), name as string), origin?.documentUri ?? currentDocumentUri, targetSchema, candidates, nextActive, depth + 1);
      });
    }
  }

  private instanceIdentity(schema: Readonly<Record<string, unknown>>, instance: unknown, identities: readonly string[]): readonly unknown[] | undefined {
    if (schema.type === 'tuple') {
      if (!Array.isArray(instance) || !Array.isArray(schema.tuple)) return undefined;
      const positions = new Map(schema.tuple.map((name, index) => [name, index]));
      const values = identities.map((name) => positions.get(name));
      return values.every((index): index is number => index !== undefined && index < instance.length) ? values.map((index) => instance[index]) : undefined;
    }
    if (!isRecord(instance) || !identities.every((name) => hasOwn(instance, name))) return undefined;
    return identities.map((name) => instance[name]);
  }

  private evaluateComposition(schema: Readonly<Record<string, unknown>>, instance: unknown, instancePointer: string, schemaPointer: string, depth: number, active: Set<string>, documentUri: string): Evaluation[] {
    const results: Evaluation[] = [];
    const branchAt = (keyword: string, value: unknown, pointer: string): Evaluation => isRecord(value)
      ? this.evaluate(value, instance, instancePointer, pointer, depth+1, active, documentUri)
      : this.failure('instance.schema-indeterminate', 'Authored ' + keyword + ' value is not a schema object.', instancePointer, pointer, keyword, 'indeterminate');
    for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) if (hasOwn(schema, keyword)) {
      const pointer = childPointer(schemaPointer,keyword), value = schema[keyword];
      if (!Array.isArray(value) || value.length === 0) { results.push(this.failure('instance.schema-indeterminate', keyword + ' requires a non-empty array of schemas; authored source is preserved.', instancePointer,pointer,keyword,'indeterminate')); continue; }
      const branches = value.map((branch,index) => branchAt(keyword,branch,childPointer(pointer,index)));
      results.push(keyword === 'allOf' ? this.combineAll(keyword,branches,instancePointer,pointer) : keyword === 'anyOf' ? this.combineAny(keyword,branches,instancePointer,pointer) : this.combineOne(branches,instancePointer,pointer));
    }
    if (hasOwn(schema,'not')) {
      const pointer = childPointer(schemaPointer,'not'), branch = branchAt('not',schema.not,pointer);
      const status = branch.status === 'valid' ? 'invalid' : branch.status === 'invalid' ? 'valid' : 'indeterminate';
      results.push(this.result('not',status,instancePointer,pointer,[branch.trace],status === 'invalid' ? this.failure('instance.not','Value matches the prohibited schema.',instancePointer,pointer,'not').diagnostics : status === 'indeterminate' ? branch.diagnostics : []));
    }
    if (hasOwn(schema,'if')) {
      const pointer = childPointer(schemaPointer,'if');
      const condition = branchAt('if',schema.if,pointer);
      const chosen = condition.status === 'valid' ? 'then' : condition.status === 'invalid' ? 'else' : undefined;
      const children: EvaluationTrace[] = [condition.trace];
      let branch: Evaluation | undefined;
      for (const keyword of ['then','else'] as const) if (hasOwn(schema,keyword)) {
        const branchPointer = childPointer(schemaPointer,keyword);
        if (keyword === chosen) { branch = branchAt(keyword,schema[keyword],branchPointer); children.push({...branch.trace,keyword}); }
        else children.push({ keyword, schemaPointer:branchPointer, instancePointer, status:'indeterminate', application:'not-applied', message: chosen ? 'Not applied: the other conditional branch was selected.' : 'Not applied: the condition is indeterminate.', children:[] });
      }
      results.push(this.result('if',condition.status === 'indeterminate' ? 'indeterminate' : branch?.status ?? 'valid',instancePointer,pointer,children, condition.status === 'indeterminate' ? condition.diagnostics : branch?.diagnostics ?? []));
    } else {
      for (const keyword of ['then','else'] as const) if (hasOwn(schema,keyword)) results.push(this.failure('instance.conditional-without-if', 'Standalone ' + keyword + ' has no authored if. The Conditional Composition draft does not define its evaluation; no synthetic condition is assumed.',instancePointer,childPointer(schemaPointer,keyword),keyword,'indeterminate'));
    }
    return results;
  }

  private combineAll(keyword: string, branches: readonly Evaluation[], instancePointer: string, schemaPointer: string): Evaluation {
    const status = statusOf(branches);
    return this.result(keyword, status, instancePointer, schemaPointer, branches.map((entry) => entry.trace), status === 'valid' ? [] : branches.flatMap((entry) => entry.diagnostics));
  }

  private combineAny(keyword: string, branches: readonly Evaluation[], instancePointer: string, schemaPointer: string): Evaluation {
    const status: EvaluationStatus = branches.some((entry) => entry.status === 'valid') ? 'valid' : branches.some((entry) => entry.status === 'indeterminate') ? 'indeterminate' : 'invalid';
    const diagnostics = status === 'valid' ? [] : status === 'invalid' ? [this.failure(`instance.${keyword}`, `No ${keyword} branch matched.`, instancePointer, schemaPointer, keyword).diagnostics[0]!] : branches.filter((entry) => entry.status === 'indeterminate').flatMap((entry) => entry.diagnostics);
    return this.result(keyword, status, instancePointer, schemaPointer, branches.map((entry) => entry.trace), diagnostics);
  }

  private combineOne(branches: readonly Evaluation[], instancePointer: string, schemaPointer: string): Evaluation {
    const valid = branches.filter((entry) => entry.status === 'valid').length;
    const indeterminate = branches.filter((entry) => entry.status === 'indeterminate').length;
    const status: EvaluationStatus = valid > 1 ? 'invalid' : valid === 1 ? (indeterminate > 0 ? 'indeterminate' : 'valid') : indeterminate > 0 ? 'indeterminate' : 'invalid';
    const diagnostics = status === 'valid' ? [] : status === 'invalid' ? [this.failure('instance.oneOf', `Exactly one oneOf branch must match; ${valid} matched.`, instancePointer, schemaPointer, 'oneOf').diagnostics[0]!] : branches.filter((entry) => entry.status === 'indeterminate').flatMap((entry) => entry.diagnostics);
    return this.result('oneOf', status, instancePointer, schemaPointer, branches.map((entry) => entry.trace), diagnostics);
  }
}

export function createInstanceWorkspace(schema: Readonly<Record<string, unknown>>, instance: unknown, options?: InstanceWorkspaceOptions): InstanceWorkspace {
  return new InstanceWorkspace(schema, instance, options);
}