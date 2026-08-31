import { resolveEffectiveMembers } from './effective-members.js';
import { ResolvedSchemaContext, type ResolvedSchemaDocument } from './resolved-schema.js';

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
}

export interface InstanceValidationResult {
  readonly status: EvaluationStatus;
  readonly diagnostics: readonly InstanceDiagnostic[];
  readonly trace: EvaluationTrace;
}

export interface CrossNavigationSelection {
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
  readonly documentUri?: string;
  readonly resolvedDocuments?: readonly ResolvedSchemaDocument[];
  readonly externalRelationResolver?: ExternalRelationResolver;
}

interface Evaluation {
  readonly status: EvaluationStatus;
  readonly diagnostics: readonly InstanceDiagnostic[];
  readonly trace: EvaluationTrace;
}

const INTEGER_TEXT = /^-?(?:0|[1-9]\d*)$/;
const UNSIGNED_INTEGER_TEXT = /^(?:0|[1-9]\d*)$/;
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

function numericParts(value: number | string): { coefficient: bigint; scale: number } | undefined {
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return undefined;
  const fraction = match[3] ?? '';
  return { coefficient: BigInt(`${match[1]}${match[2]}${fraction}`), scale: fraction.length };
}

function compareNumeric(left: number | string, right: number | string): number | undefined {
  const a = numericParts(left);
  const b = numericParts(right);
  if (!a || !b) return undefined;
  const scale = Math.max(a.scale, b.scale);
  const av = a.coefficient * 10n ** BigInt(scale - a.scale);
  const bv = b.coefficient * 10n ** BigInt(scale - b.scale);
  return av < bv ? -1 : av > bv ? 1 : 0;
}

function multipleOf(value: number | string, divisor: number | string): boolean | undefined {
  const a = numericParts(value);
  const b = numericParts(divisor);
  if (!a || !b || b.coefficient === 0n) return undefined;
  const scale = Math.max(a.scale, b.scale);
  return (a.coefficient * 10n ** BigInt(scale - a.scale)) % (b.coefficient * 10n ** BigInt(scale - b.scale)) === 0n;
}

function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
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
    case 'regex': try { new RegExp(value); return true; } catch { return false; }
    default: return undefined;
  }
}

function validScalar(value: unknown, type: string): boolean {
  if (type === 'any') return true;
  if (type === 'null') return value === null;
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer' || type === 'int32') return typeof value === 'number' && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
  if (type === 'int8') return typeof value === 'number' && Number.isInteger(value) && value >= -128 && value <= 127;
  if (type === 'uint8') return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255;
  if (type === 'int16') return typeof value === 'number' && Number.isInteger(value) && value >= -32768 && value <= 32767;
  if (type === 'uint16') return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 65535;
  if (type === 'uint32') return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4294967295;
  if (type === 'float8') return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 3.4e3;
  if (type === 'float') return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 3.4e38;
  if (type === 'double') return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1.7e308;
  if (type === 'int64') return typeof value === 'string' && INTEGER_TEXT.test(value) && BigInt(value) >= -(2n ** 63n) && BigInt(value) < 2n ** 63n;
  if (type === 'uint64') return typeof value === 'string' && UNSIGNED_INTEGER_TEXT.test(value) && BigInt(value) < 2n ** 64n;
  if (type === 'int128') return typeof value === 'string' && INTEGER_TEXT.test(value) && BigInt(value) >= -(2n ** 127n) && BigInt(value) < 2n ** 127n;
  if (type === 'uint128') return typeof value === 'string' && UNSIGNED_INTEGER_TEXT.test(value) && BigInt(value) < 2n ** 128n;
  if (type === 'decimal') return typeof value === 'string' && DECIMAL_TEXT.test(value);
  if (type === 'binary') return typeof value === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
  if (type === 'date') return typeof value === 'string' && validDate(value);
  if (type === 'datetime') return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));
  if (type === 'time') return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value);
  if (type === 'duration') return typeof value === 'string' && /^P(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/.test(value);
  if (type === 'uuid') return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  if (type === 'uri') { if (typeof value !== 'string') return false; try { new URL(value, 'https://example.invalid/'); return true; } catch { return false; } }
  if (type === 'jsonpointer') return typeof value === 'string' && (value === '' || /^(?:\/(?:[^~/]|~[01])*)+$/.test(value));
  if (type === 'object' || type === 'map' || type === 'choice') return isRecord(value);
  if (type === 'array' || type === 'set' || type === 'tuple') return Array.isArray(value);
  return false;
}

export class InstanceWorkspace {
  private readonly depthBudget: number;
  private readonly schemaContext: ResolvedSchemaContext;
  private readonly schemaOptions: Pick<InstanceWorkspaceOptions, 'documentUri' | 'resolvedDocuments'>;
  private readonly selectedAddIns: readonly string[];
  private readonly externalRelationResolver?: ExternalRelationResolver;
  private currentSelection: CrossNavigationSelection = { source: 'instance', instancePointer: '', schemaPointer: '' };
  private lastResult?: InstanceValidationResult;

  constructor(readonly schema: Readonly<Record<string, unknown>>, readonly instance: unknown, options: InstanceWorkspaceOptions = {}) {
    this.depthBudget = Math.max(0, options.depthBudget ?? 64);
    this.schemaContext = new ResolvedSchemaContext(schema, options);
    this.schemaOptions = { documentUri: options.documentUri, resolvedDocuments: options.resolvedDocuments };
    this.selectedAddIns = isRecord(instance) && Array.isArray(instance.$uses) && instance.$uses.every((entry) => typeof entry === 'string') ? instance.$uses : [];
    this.externalRelationResolver = options.externalRelationResolver;
  }

  get selection(): CrossNavigationSelection { return this.currentSelection; }

  validate(): InstanceValidationResult {
    const evaluation = this.evaluate(this.schema, this.instance, '', '', 0, new Set(), this.schemaContext.rootUri);
    this.lastResult = evaluation;
    return evaluation;
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
    const activeKey = `${schemaPointer}\u0000${instancePointer}`;
    if (active.has(activeKey)) return this.failure('instance.cycle', 'A recursive schema evaluation cycle was detected.', instancePointer, schemaPointer, '$ref', 'indeterminate');
    const nextActive = new Set(active);
    nextActive.add(activeKey);
    const evaluations: Evaluation[] = [];

    const type = schema.type;
    if (isRecord(type) && typeof type.$ref === 'string') {
      const resolved = this.schemaContext.resolve(type.$ref, documentUri);
      if (!resolved) {
        evaluations.push(this.failure('instance.ref-unresolved', `Local reference ${type.$ref} cannot be resolved.`, instancePointer, childPointer(childPointer(schemaPointer, 'type'), '$ref'), '$ref', 'indeterminate'));
      } else {
        evaluations.push(this.evaluate(this.effectiveSchema(resolved.schema, resolved.effectivePointer), instance, instancePointer, resolved.effectivePointer, depth + 1, nextActive, resolved.documentUri));
      }
    } else if (Array.isArray(type)) {
      const branches = type.map((entry, index) => this.evaluate({ type: entry }, instance, instancePointer, childPointer(childPointer(schemaPointer, 'type'), index), depth + 1, nextActive, documentUri));
      evaluations.push(this.combineAny('type', branches, instancePointer, childPointer(schemaPointer, 'type')));
    } else if (typeof type === 'string') {
      if (!validScalar(instance, type)) evaluations.push(this.failure('instance.type', `Value is not in the ${type} value space.`, instancePointer, childPointer(schemaPointer, 'type'), 'type'));
      else evaluations.push(this.result('type', 'valid', instancePointer, childPointer(schemaPointer, 'type')));
    }

    const baseStatus = statusOf(evaluations);
    if (baseStatus !== 'invalid') {
      const effectiveSchema = this.effectiveSchema(schema, schemaPointer);
      evaluations.push(...this.evaluateShape(effectiveSchema, instance, instancePointer, schemaPointer, depth, nextActive, documentUri));
      evaluations.push(...this.evaluateValueConstraints(effectiveSchema, instance, instancePointer, schemaPointer, depth, nextActive, documentUri));
      evaluations.push(...this.evaluateRelations(effectiveSchema, instance, instancePointer, schemaPointer, depth, nextActive, documentUri));
    }
    evaluations.push(...this.evaluateComposition(schema, instance, instancePointer, schemaPointer, depth, nextActive, documentUri));
    const status = statusOf(evaluations);
    return this.result('schema', status, instancePointer, schemaPointer, evaluations.map((entry) => entry.trace), evaluations.flatMap((entry) => entry.diagnostics));
  }

  private evaluateShape(schema: Readonly<Record<string, unknown>>, instance: unknown, instancePointer: string, schemaPointer: string, depth: number, active: Set<string>, documentUri: string): Evaluation[] {
    const results: Evaluation[] = [];
    const type = schema.type;
    if ((type === 'object' || schema.properties !== undefined || schema.required !== undefined) && isRecord(instance)) {
      const properties = isRecord(schema.properties) ? schema.properties : {};
      for (const [name, propertySchema] of Object.entries(properties)) {
        if (hasOwn(instance, name) && isRecord(propertySchema)) results.push(this.evaluate(propertySchema, instance[name], childPointer(instancePointer, name), childPointer(childPointer(schemaPointer, 'properties'), name), depth + 1, active, documentUri));
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
      const declared = new Set(Object.keys(properties));
      for (const [name, value] of Object.entries(instance)) {
        if (declared.has(name) || (instancePointer === '' && name === '$uses')) continue;
        if (schema.additionalProperties === false) results.push(this.failure('instance.additional-property', `Property ${name} is not declared.`, childPointer(instancePointer, name), childPointer(schemaPointer, 'additionalProperties'), 'additionalProperties'));
        else if (isRecord(schema.additionalProperties)) results.push(this.evaluate(schema.additionalProperties, value, childPointer(instancePointer, name), childPointer(schemaPointer, 'additionalProperties'), depth + 1, active, documentUri));
      }
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
        if (index < instance.length && isRecord(member)) results.push(this.evaluate(member, instance[index], childPointer(instancePointer, index), childPointer(childPointer(schemaPointer, 'properties'), name as string), depth + 1, active, documentUri));
      });
    }
    if (type === 'choice' && isRecord(instance) && isRecord(schema.choices)) results.push(this.evaluateChoice(schema, instance, instancePointer, schemaPointer, depth, active, documentUri));
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
    const results: Evaluation[] = [];
    const check = (keyword: string, valid: boolean, message: string): void => { if (!valid) results.push(this.failure(`instance.${keyword}`, message, instancePointer, childPointer(schemaPointer, keyword), keyword)); };
    if (hasOwn(schema, 'const')) check('const', deepEqual(instance, schema.const), 'Value does not equal const.');
    if (Array.isArray(schema.enum)) check('enum', schema.enum.some((value) => deepEqual(value, instance)), 'Value is not one of the enumerated values.');
    if ((typeof instance === 'number' || (typeof instance === 'string' && (INTEGER_TEXT.test(instance) || DECIMAL_TEXT.test(instance))))) {
      for (const [keyword, relation] of [['minimum', (value: number) => value >= 0], ['maximum', (value: number) => value <= 0], ['exclusiveMinimum', (value: number) => value > 0], ['exclusiveMaximum', (value: number) => value < 0]] as const) {
        const bound = schema[keyword];
        if (typeof bound === 'number' || typeof bound === 'string') { const comparison = compareNumeric(instance, bound); if (comparison === undefined) results.push(this.failure('instance.numeric-indeterminate', `Cannot compare ${keyword}.`, instancePointer, childPointer(schemaPointer, keyword), keyword, 'indeterminate')); else check(keyword, relation(comparison), `Value violates ${keyword}.`); }
      }
      if (typeof schema.multipleOf === 'number' || typeof schema.multipleOf === 'string') { const valid = multipleOf(instance, schema.multipleOf); if (valid === undefined) results.push(this.failure('instance.numeric-indeterminate', 'Cannot evaluate multipleOf.', instancePointer, childPointer(schemaPointer, 'multipleOf'), 'multipleOf', 'indeterminate')); else check('multipleOf', valid, 'Value is not a multiple of the required value.'); }
    }
    if (typeof instance === 'string') {
      if (typeof schema.minLength === 'number') check('minLength', [...instance].length >= schema.minLength, 'String is shorter than minLength.');
      if (typeof schema.maxLength === 'number') check('maxLength', [...instance].length <= schema.maxLength, 'String is longer than maxLength.');
      if (typeof schema.pattern === 'string') { try { check('pattern', new RegExp(schema.pattern, 'u').test(instance), 'String does not match pattern.'); } catch { results.push(this.failure('instance.pattern-indeterminate', 'Schema pattern is invalid.', instancePointer, childPointer(schemaPointer, 'pattern'), 'pattern', 'indeterminate')); } }
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

  private evaluateObjectConstraints(schema: Readonly<Record<string, unknown>>, instance: Readonly<Record<string, unknown>>, instancePointer: string, schemaPointer: string, depth: number, active: Set<string>, results: Evaluation[], check: (keyword: string, valid: boolean, message: string) => void, documentUri: string): void {
    const count = Object.keys(instance).length;
    if (typeof schema.minProperties === 'number') check('minProperties', count >= schema.minProperties, 'Object has fewer than minProperties properties.');
    if (typeof schema.maxProperties === 'number') check('maxProperties', count <= schema.maxProperties, 'Object has more than maxProperties properties.');
    if (typeof schema.minEntries === 'number') check('minEntries', count >= schema.minEntries, 'Map has fewer than minEntries entries.');
    if (typeof schema.maxEntries === 'number') check('maxEntries', count <= schema.maxEntries, 'Map has more than maxEntries entries.');
    if (isRecord(schema.dependentRequired)) for (const [name, dependencies] of Object.entries(schema.dependentRequired)) if (hasOwn(instance, name) && Array.isArray(dependencies)) for (const dependency of dependencies) if (typeof dependency === 'string' && !hasOwn(instance, dependency)) results.push(this.failure('instance.dependentRequired', `${name} requires ${dependency}.`, childPointer(instancePointer, dependency), childPointer(childPointer(schemaPointer, 'dependentRequired'), name), 'dependentRequired'));
    for (const [keyword, patterns] of [['patternProperties', schema.patternProperties], ['patternKeys', schema.patternKeys]] as const) if (isRecord(patterns)) for (const [pattern, memberSchema] of Object.entries(patterns)) if (isRecord(memberSchema)) { let expression: RegExp; try { expression = new RegExp(pattern, 'u'); } catch { results.push(this.failure('instance.pattern-indeterminate', `Pattern ${pattern} is invalid.`, instancePointer, childPointer(childPointer(schemaPointer, keyword), pattern), keyword, 'indeterminate')); continue; } for (const [name, value] of Object.entries(instance)) if (expression.test(name)) results.push(this.evaluate(memberSchema, value, childPointer(instancePointer, name), childPointer(childPointer(schemaPointer, keyword), pattern), depth + 1, active, documentUri)); }
    for (const [keyword, nameSchema] of [['propertyNames', schema.propertyNames], ['keyNames', schema.keyNames]] as const) if (isRecord(nameSchema)) for (const name of Object.keys(instance)) results.push(this.evaluate(nameSchema, name, childPointer(instancePointer, name), childPointer(schemaPointer, keyword), depth + 1, active, documentUri));
    if (isRecord(schema.has)) {
      const matches = Object.entries(instance).map(([name, value]) => this.evaluate(schema.has as Readonly<Record<string, unknown>>, value, childPointer(instancePointer, name), childPointer(schemaPointer, 'has'), depth + 1, active, documentUri));
      if (!matches.some((entry) => entry.status === 'valid')) results.push(matches.some((entry) => entry.status === 'indeterminate') ? this.failure('instance.has-indeterminate', 'Whether a value matches has is indeterminate.', instancePointer, childPointer(schemaPointer, 'has'), 'has', 'indeterminate') : this.failure('instance.has', 'No object value matches has.', instancePointer, childPointer(schemaPointer, 'has'), 'has'));
    }
  }

  private effectiveSchema(schema: Readonly<Record<string, unknown>>, schemaPointer: string): Readonly<Record<string, unknown>> {
    if ((schema.type !== 'object' && schema.type !== 'tuple') || !schemaPointer.startsWith('/definitions/')) return schema;
    const result = resolveEffectiveMembers(this.schema, `#${schemaPointer}`, {
      ...this.schemaOptions,
      addIns: this.selectedAddIns
    });
    if (result.members.length === 0) return schema;
    return {
      ...schema,
      properties: Object.fromEntries(result.members.map((member) => [member.name, member.schema])),
      ...(result.required.length > 0 ? { required: result.required } : { required: undefined }),
      ...(schema.type === 'tuple' ? { tuple: result.tuple } : {})
    };
  }

  private evaluateRelations(schema: Readonly<Record<string, unknown>>, instance: unknown, instancePointer: string, schemaPointer: string, depth: number, active: Set<string>, documentUri: string): Evaluation[] {
    if (!isRecord(instance) || !isRecord(schema.relations)) return [];
    const results: Evaluation[] = [];
    for (const [relationName, relationValue] of Object.entries(schema.relations)) {
      if (!hasOwn(instance, relationName) || !isRecord(relationValue)) continue;
      const relationPointer = childPointer(childPointer(schemaPointer, 'relations'), relationName);
      const targetRef = isRecord(relationValue.targettype) && typeof relationValue.targettype.$ref === 'string' ? relationValue.targettype.$ref : undefined;
      const target = targetRef ? this.schemaContext.resolve(targetRef, documentUri) : undefined;
      if (!target || !Array.isArray(target.schema.identity) || !target.schema.identity.every((name) => typeof name === 'string')) {
        results.push(this.failure('instance.relation-target', 'Relation target and ordered identity could not be resolved.', childPointer(instancePointer, relationName), childPointer(relationPointer, 'targettype'), 'relations', 'indeterminate'));
        continue;
      }
      const relationInstance = instance[relationName];
      const entries = relationValue.cardinality === 'multiple' ? relationInstance : [relationInstance];
      if (relationValue.cardinality === 'multiple' ? !Array.isArray(relationInstance) : !isRecord(relationInstance)) {
        results.push(this.failure('instance.relation-cardinality', `Relation ${relationName} requires ${relationValue.cardinality === 'multiple' ? 'an array' : 'an object'}.`, childPointer(instancePointer, relationName), childPointer(relationPointer, 'cardinality'), 'relations'));
        continue;
      }
      const identities = target.schema.identity as readonly string[];
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
          const propertySchema = isRecord(target.schema.properties) ? target.schema.properties[identities[identityIndex]!] : undefined;
          if (isRecord(propertySchema)) results.push(this.evaluate(propertySchema, identityValues[identityIndex], childPointer(childPointer(entryPointer, 'identity'), identityIndex), childPointer(childPointer(target.effectivePointer, 'properties'), identities[identityIndex]!), depth + 1, active, target.documentUri));
        }
        const qualifierRef = isRecord(relationValue.qualifiertype) && typeof relationValue.qualifiertype.$ref === 'string' ? relationValue.qualifiertype.$ref : undefined;
        if (qualifierRef) {
          const qualifier = this.schemaContext.resolve(qualifierRef, documentUri);
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
        const candidates = scopes.flatMap((scope) => this.scopeCandidates(scope));
        const matches = candidates.filter((candidate) => isRecord(candidate) && identities.every((name, identityIndex) => deepEqual(candidate[name], identityValues[identityIndex])));
        if (matches.length !== 1) results.push(this.failure(matches.length === 0 ? 'instance.relation-scope-missing' : 'instance.relation-scope-ambiguous', `Scoped relation identity matched ${matches.length} targets.`, entryPointer, childPointer(relationPointer, 'scope'), 'relations'));
      }
    }
    return results;
  }

  private scopeCandidates(scope: string): readonly unknown[] {
    const schemaLocation = this.schemaContext.resolve(scope);
    if (!schemaLocation) return [];
    const rootRef = typeof this.schema.$root === 'string' ? this.schema.$root : undefined;
    const root = rootRef ? this.schemaContext.resolve(rootRef) : undefined;
    if (!root) return [];
    const relative = schemaLocation.effectivePointer.startsWith(`${root.effectivePointer}/properties/`) ? schemaLocation.effectivePointer.slice(`${root.effectivePointer}/properties/`.length) : undefined;
    const collection = relative && isRecord(this.instance) ? this.instance[relative.replace(/~1/g, '/').replace(/~0/g, '~')] : scope === '#' ? this.instance : undefined;
    return Array.isArray(collection) ? collection : isRecord(collection) ? Object.values(collection) : [];
  }

  private evaluateComposition(schema: Readonly<Record<string, unknown>>, instance: unknown, instancePointer: string, schemaPointer: string, depth: number, active: Set<string>, documentUri: string): Evaluation[] {
    const results: Evaluation[] = [];
    for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) if (Array.isArray(schema[keyword])) {
      const branches = (schema[keyword] as readonly unknown[]).map((branch, index) => isRecord(branch) ? this.evaluate(branch, instance, instancePointer, childPointer(childPointer(schemaPointer, keyword), index), depth + 1, active, documentUri) : this.failure('instance.schema-indeterminate', 'Composition branch is not a schema.', instancePointer, childPointer(childPointer(schemaPointer, keyword), index), keyword, 'indeterminate'));
      results.push(keyword === 'allOf' ? this.combineAll(keyword, branches, instancePointer, childPointer(schemaPointer, keyword)) : keyword === 'anyOf' ? this.combineAny(keyword, branches, instancePointer, childPointer(schemaPointer, keyword)) : this.combineOne(branches, instancePointer, childPointer(schemaPointer, keyword)));
    }
    if (isRecord(schema.not)) {
      const branch = this.evaluate(schema.not, instance, instancePointer, childPointer(schemaPointer, 'not'), depth + 1, active, documentUri);
      const status = branch.status === 'valid' ? 'invalid' : branch.status === 'invalid' ? 'valid' : 'indeterminate';
      results.push(status === 'invalid' ? this.failure('instance.not', 'Value matches the prohibited schema.', instancePointer, childPointer(schemaPointer, 'not'), 'not') : this.result('not', status, instancePointer, childPointer(schemaPointer, 'not'), [branch.trace], status === 'indeterminate' ? branch.diagnostics : []));
    }
    if (isRecord(schema.if)) {
      const condition = this.evaluate(schema.if, instance, instancePointer, childPointer(schemaPointer, 'if'), depth + 1, active, documentUri);
      if (condition.status === 'indeterminate') results.push(this.result('if', 'indeterminate', instancePointer, childPointer(schemaPointer, 'if'), [condition.trace], condition.diagnostics));
      else {
        const keyword = condition.status === 'valid' ? 'then' : 'else';
        const branchSchema = schema[keyword];
        const branch = isRecord(branchSchema) ? this.evaluate(branchSchema, instance, instancePointer, childPointer(schemaPointer, keyword), depth + 1, active, documentUri) : this.result(keyword, 'valid', instancePointer, childPointer(schemaPointer, keyword));
        results.push(this.result('if', branch.status, instancePointer, childPointer(schemaPointer, 'if'), [condition.trace, branch.trace], branch.diagnostics));
      }
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