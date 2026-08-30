import type { Diagnostic, RecoveryState, SourceLocation, TextPosition, TextRange } from './contracts.js';
import {
  nodeId,
  type ConditionalCompositionProjection,
  type DefinitionProjection,
  type DiagnosticsProjection,
  type ImportProjection,
  type ModelNode,
  type NormalizedDocument,
  type ReferenceProjection,
  type RelationProjection,
  type SemanticPlacementProjection,
  type SemanticAnnotationsProjection,
  type UnitsProjection,
  type ValidationProjection
} from './model.js';

interface ParsedValue { value: unknown; start: number; end: number; pointer: string; keyStart?: number; keyEnd?: number; }
interface ParseOutput { value: unknown; values: ParsedValue[]; diagnostics: Diagnostic[]; recovery: RecoveryState; }

function position(text: string, offset: number): TextPosition {
  const before = text.slice(0, offset);
  const lineStart = before.lastIndexOf('\n') + 1;
  return { line: (before.match(/\n/g) ?? []).length, column: offset - lineStart, offset };
}
export function rangeFor(text: string, start: number, end: number): TextRange {
  return { start: position(text, start), end: position(text, end), startOffset: start, endOffset: end };
}
function pointerPart(value: string): string { return value.replace(/~/g, '~0').replace(/\//g, '~1'); }
function location(uri: string, pointer: string, range: TextRange): SourceLocation { return { uri, pointer, range }; }

class StrictParser {
  private index = 0;
  readonly values: ParsedValue[] = [];
  readonly diagnostics: Diagnostic[] = [];
  constructor(private readonly text: string, private readonly uri: string) {}
  parse(): ParseOutput {
    this.skip();
    let value: unknown;
    let start = this.index;
    try { value = this.readValue(''); start = (this.values[0]?.start ?? start); }
    catch (error) {
      const incomplete = this.index >= this.text.length || /unexpected end/i.test(String(error));
      this.diagnostics.push({ code: incomplete ? 'json.incomplete' : 'json.invalid', message: incomplete ? 'JSON is incomplete.' : String(error), severity: 'error', location: location(this.uri, '', rangeFor(this.text, Math.min(this.index, this.text.length), Math.min(this.index + 1, this.text.length))) });
      return { value: undefined, values: this.values, diagnostics: this.diagnostics, recovery: incomplete ? 'incomplete' : 'invalid' };
    }
    this.skip();
    if (this.index !== this.text.length) {
      this.diagnostics.push({ code: 'json.trailing', message: 'Unexpected content after the JSON value.', severity: 'error', location: location(this.uri, '', rangeFor(this.text, this.index, this.index + 1)) });
      return { value, values: this.values, diagnostics: this.diagnostics, recovery: 'invalid' };
    }
    return { value, values: this.values, diagnostics: this.diagnostics, recovery: 'valid' };
  }
  private skip(): void { while (/\s/.test(this.text[this.index] ?? '')) this.index++; }
  private readValue(pointer: string): unknown {
    this.skip(); const start = this.index; const char = this.text[this.index];
    let value: unknown;
    if (char === '{') value = this.readObject(pointer);
    else if (char === '[') value = this.readArray(pointer);
    else if (char === '"') value = this.readString();
    else if (char === '-' || /\d/.test(char ?? '')) value = this.readNumber();
    else if (this.text.startsWith('true', this.index)) { this.index += 4; value = true; }
    else if (this.text.startsWith('false', this.index)) { this.index += 5; value = false; }
    else if (this.text.startsWith('null', this.index)) { this.index += 4; value = null; }
    else throw new Error(`Unexpected token at offset ${this.index}.`);
    this.values.push({ value, start, end: this.index, pointer });
    return value;
  }
  private readObject(pointer: string): Record<string, unknown> {
    this.index++; this.skip(); const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    if (this.text[this.index] === '}') { this.index++; return result; }
    while (this.index < this.text.length) {
      this.skip(); if (this.text[this.index] !== '"') throw new Error(`Expected an object property at offset ${this.index}.`);
      const keyStart = this.index;
      const key = this.readString() as string;
      const keyEnd = this.index;
      this.skip();
      if (this.text[this.index++] !== ':') throw new Error(`Expected ':' at offset ${this.index - 1}.`);
      const childPointer = `${pointer}/${pointerPart(key)}`;
      result[key] = this.readValue(childPointer);
      const child = [...this.values].reverse().find((entry) => entry.pointer === childPointer);
      if (child) { child.keyStart = keyStart; child.keyEnd = keyEnd; }
      this.skip();
      if (this.text[this.index] === '}') { this.index++; return result; }
      if (this.text[this.index++] !== ',') throw new Error(`Expected ',' at offset ${this.index - 1}.`);
    }
    throw new Error('Unexpected end of JSON object.');
  }
  private readArray(pointer: string): unknown[] {
    this.index++; this.skip(); const result: unknown[] = [];
    if (this.text[this.index] === ']') { this.index++; return result; }
    while (this.index < this.text.length) {
      result.push(this.readValue(`${pointer}/${result.length}`)); this.skip();
      if (this.text[this.index] === ']') { this.index++; return result; }
      if (this.text[this.index++] !== ',') throw new Error(`Expected ',' at offset ${this.index - 1}.`);
    }
    throw new Error('Unexpected end of JSON array.');
  }
  private readString(): string {
    const start = this.index++; let escaped = false;
    while (this.index < this.text.length) {
      const char = this.text[this.index++];
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === '"') return JSON.parse(this.text.slice(start, this.index)) as string;
    }
    throw new Error('Unexpected end of JSON string.');
  }
  private readNumber(): number {
    const match = this.text.slice(this.index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) throw new Error(`Invalid number at offset ${this.index}.`);
    this.index += match[0].length; return Number(match[0]);
  }
}

export interface ParseResult { readonly model?: NormalizedDocument; readonly value?: unknown; readonly diagnostics: readonly Diagnostic[]; readonly recovery: RecoveryState; }
export function parseDocument(uri: string, text: string): ParseResult {
  const parsed = new StrictParser(text, uri).parse();
  if (parsed.recovery !== 'valid') return { diagnostics: parsed.diagnostics, recovery: parsed.recovery };
  const root = parsed.value as Record<string, unknown>;
  const nodes: ModelNode[] = [];
  for (const entry of parsed.values) {
    const kind = declarationKind(entry.value);
    nodes.push({
      id: nodeId(`node:${uri}:${entry.pointer}`), pointer: entry.pointer, kind,
      range: rangeFor(text, entry.start, entry.end),
      keyRange: entry.keyStart === undefined || entry.keyEnd === undefined ? undefined : rangeFor(text, entry.keyStart, entry.keyEnd),
      location: location(uri, entry.pointer, rangeFor(text, entry.start, entry.end))
    });
  }
  const duplicateDiagnostics = duplicatePointerDiagnostics(uri, text, nodes);
  const projectionDiagnostics: Diagnostic[] = [];
  const projections = buildProjections(root, uri, text, projectionDiagnostics);
  const diagnostics = [...parsed.diagnostics, ...duplicateDiagnostics, ...projectionDiagnostics];
  const model: NormalizedDocument = {
    uri,
    recovery: 'valid',
    nodes,
    rootPointer: typeof root?.$root === 'string' ? root.$root : undefined,
    unknownKeysPreserved: true,
    projections: {
      definitions: projections.definitions,
      imports: projections.imports,
      references: projections.references,
      semanticPlacements: projections.semanticPlacements,
      diagnostics: diagnostics.map<DiagnosticsProjection>((diagnostic) => ({
        code: diagnostic.code,
        severity: diagnostic.severity,
        pointer: diagnostic.location?.pointer
      }))
    }
  };
  return { model, value: parsed.value, diagnostics, recovery: 'valid' };
}

function duplicatePointerDiagnostics(uri: string, text: string, nodes: readonly ModelNode[]): Diagnostic[] {
  const byPointer = new Map<string, ModelNode[]>();
  for (const node of nodes) {
    const list = byPointer.get(node.pointer) ?? [];
    list.push(node);
    byPointer.set(node.pointer, list);
  }
  const duplicates: Diagnostic[] = [];
  for (const [pointer, list] of byPointer.entries()) {
    if (pointer === '' || list.length < 2) continue;
    duplicates.push({
      code: 'json.duplicate-pointer',
      message: `Ambiguous duplicate key for pointer ${pointer}.`,
      severity: 'error',
      location: location(uri, pointer, list[0].range ?? rangeFor(text, 0, 0)),
      related: list.slice(1).map((node) => location(uri, pointer, node.range ?? rangeFor(text, 0, 0)))
    });
  }
  return duplicates;
}

function buildProjections(
  root: Record<string, unknown>,
  uri: string,
  text: string,
  diagnostics: Diagnostic[]
): {
  definitions: DefinitionProjection[];
  imports: ImportProjection[];
  references: ReferenceProjection[];
  semanticPlacements: SemanticPlacementProjection[];
} {
  const definitions: DefinitionProjection[] = [];
  const imports: ImportProjection[] = [];
  const references: ReferenceProjection[] = [];
  const semanticPlacements: SemanticPlacementProjection[] = [];
  const semanticByPointer = new Map<string, SemanticAnnotationsProjection>();
  collectReferenceProjections(root, '', references);
  collectSemanticPlacements(root, '', uri, text, diagnostics, semanticPlacements, semanticByPointer);
  collectDefinitions(root, '', uri, text, definitions, imports, diagnostics, semanticByPointer);
  return { definitions, imports, references, semanticPlacements };
}

function collectDefinitions(
  value: unknown,
  pointer: string,
  uri: string,
  text: string,
  definitions: DefinitionProjection[],
  imports: ImportProjection[],
  diagnostics: Diagnostic[],
  semanticByPointer: ReadonlyMap<string, SemanticAnnotationsProjection>
): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const object = value as Record<string, unknown>;
  pushImportProjection(pointer, object, uri, text, imports, diagnostics);
  const defs = object.definitions;
  if (defs && typeof defs === 'object' && !Array.isArray(defs)) {
    for (const [name, declaration] of Object.entries(defs as Record<string, unknown>)) {
      const encoded = pointerPart(name);
      const declarationPointer = `${pointer}/definitions/${encoded}`;
      const projection = definitionProjection(name, pointer, declarationPointer, declaration, uri, text, diagnostics, semanticByPointer.get(declarationPointer));
      if (projection) definitions.push(projection);
      collectDefinitions(declaration, declarationPointer, uri, text, definitions, imports, diagnostics, semanticByPointer);
    }
  }
}

function definitionProjection(
  name: string,
  namespacePointer: string,
  pointer: string,
  declaration: unknown,
  uri: string,
  text: string,
  diagnostics: Diagnostic[],
  semantic: SemanticAnnotationsProjection | undefined
): DefinitionProjection | undefined {
  if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) return undefined;
  const value = declaration as Record<string, unknown>;
  const declarationCore = coreForm(value);
  if (declarationCore === 'unknown') return undefined;
  const type = declarationType(value);
  const relationItems = relationProjections(pointer, value.relations, uri, text, diagnostics);
  const units = unitsProjection(pointer, value, uri, text, diagnostics);
  const validation = validationProjection(pointer, value, type, uri, text, diagnostics);
  const composition = compositionProjection(pointer, value, uri, text, diagnostics);
  return {
    pointer,
    name,
    namespacePointer,
    type,
    coreForm: declarationCore,
    extends: extendsProjection(value.$extends),
    relations: relationItems,
    units,
    validation,
    composition,
    semantic
  };
}

function pushImportProjection(
  pointer: string,
  value: Record<string, unknown>,
  uri: string,
  text: string,
  imports: ImportProjection[],
  diagnostics: Diagnostic[]
): void {
  const importValue = value.$import;
  if (importValue !== undefined) {
    const importPointer = `${pointer}/$import`;
    if (absoluteUri(importValue)) {
      imports.push({
        pointer: importPointer,
        namespacePointer: pointer,
        keyword: '$import',
        source: importValue,
        provenance: 'import'
      });
    } else {
      pushKeywordDiagnostic(diagnostics, uri, importPointer, '$import must be an absolute URI string.', text);
    }
  }
  const importDefs = value.$importdefs;
  if (importDefs !== undefined) {
    const importDefsPointer = `${pointer}/$importdefs`;
    if (absoluteUri(importDefs)) {
      imports.push({
        pointer: importDefsPointer,
        namespacePointer: pointer,
        keyword: '$importdefs',
        source: importDefs,
        provenance: 'importdefs'
      });
    } else {
      pushKeywordDiagnostic(diagnostics, uri, importDefsPointer, '$importdefs must be an absolute URI string.', text);
    }
  }
}

function relationProjections(pointer: string, relations: unknown, uri: string, text: string, diagnostics: Diagnostic[]): RelationProjection[] {
  if (!isRecord(relations)) return [];
  const items: RelationProjection[] = [];
  for (const [name, value] of Object.entries(relations)) {
    const relationPointer = `${pointer}/relations/${pointerPart(name)}`;
    if (!isRecord(value)) {
      pushKeywordDiagnostic(diagnostics, uri, relationPointer, 'A relation must be an object.', text);
      continue;
    }
    const allowed = ['targettype', 'cardinality', 'scope', 'qualifiertype'];
    const unsupportedMembers = Object.keys(value).filter((key) => !allowed.includes(key));
    for (const member of unsupportedMembers) {
      pushKeywordDiagnostic(diagnostics, uri, `${relationPointer}/${pointerPart(member)}`, `Unsupported relation member '${member}'.`, text);
    }
    const targetRef = typeReference(value.targettype);
    if (targetRef === undefined) pushKeywordDiagnostic(diagnostics, uri, value.targettype === undefined ? relationPointer : `${relationPointer}/targettype`, 'targettype is required and must be a type reference with a string $ref.', text);
    const cardinality = enumString(value.cardinality, ['single', 'multiple']);
    if (cardinality === undefined) pushKeywordDiagnostic(diagnostics, uri, value.cardinality === undefined ? relationPointer : `${relationPointer}/cardinality`, "cardinality is required and must be 'single' or 'multiple'.", text);
    const qualifierRef = value.qualifiertype === undefined ? undefined : typeReference(value.qualifiertype);
    if (value.qualifiertype !== undefined && qualifierRef === undefined) pushKeywordDiagnostic(diagnostics, uri, `${relationPointer}/qualifiertype`, 'qualifiertype must be a type reference with a string $ref.', text);
    const scope = validScope(value.scope) ? value.scope as string | readonly string[] : undefined;
    if (value.scope !== undefined && scope === undefined) pushKeywordDiagnostic(diagnostics, uri, `${relationPointer}/scope`, 'scope must be #, #/..., or an array of those schema fragments.', text);
    if (targetRef !== undefined && cardinality !== undefined && hasOnlyKeys(value, allowed)) items.push({ pointer: relationPointer, name, targetTypeRef: targetRef, cardinality, scope, qualifierTypeRef: qualifierRef });
  }
  return items;
}
function typeReference(value: unknown): string | undefined {
  return isRecord(value) && hasOnlyKeys(value, ['$ref']) && typeof value.$ref === 'string' ? value.$ref : undefined;
}
function isSchemaFragmentPointer(value: unknown): value is string { return typeof value === 'string' && (value === '#' || value.startsWith('#/')); }
function validScope(value: unknown): boolean { return value === undefined || isSchemaFragmentPointer(value) || (Array.isArray(value) && value.length > 0 && value.every(isSchemaFragmentPointer)); }
function unitsProjection(
  pointer: string,
  value: Record<string, unknown>,
  uri: string,
  text: string,
  diagnostics: Diagnostic[]
): UnitsProjection | undefined {
  const symbol = asString(value.symbol, `${pointer}/symbol`, 'symbol', uri, text, diagnostics);
  const symbols = parseStringMap(value.symbols, `${pointer}/symbols`, 'symbols', uri, text, diagnostics);
  const unit = asString(value.unit, `${pointer}/unit`, 'unit', uri, text, diagnostics);
  const ucumUnit = asString(value.ucumUnit, `${pointer}/ucumUnit`, 'ucumUnit', uri, text, diagnostics);
  const currency = asString(value.currency, `${pointer}/currency`, 'currency', uri, text, diagnostics);
  if (symbol === undefined && symbols === undefined && unit === undefined && ucumUnit === undefined && currency === undefined) return undefined;
  return { symbol, symbols, unit, ucumUnit, currency };
}

function validationProjection(
  pointer: string,
  value: Record<string, unknown>,
  typeName: string | undefined,
  uri: string,
  text: string,
  diagnostics: Diagnostic[]
): ValidationProjection | undefined {
  const multipleOf = numericConstraint(value.multipleOf, typeName, `${pointer}/multipleOf`, 'multipleOf', uri, text, diagnostics, true);
  const projection: ValidationProjection = {
    minimum: numericConstraint(value.minimum, typeName, `${pointer}/minimum`, 'minimum', uri, text, diagnostics),
    maximum: numericConstraint(value.maximum, typeName, `${pointer}/maximum`, 'maximum', uri, text, diagnostics),
    exclusiveMinimum: numericConstraint(value.exclusiveMinimum, typeName, `${pointer}/exclusiveMinimum`, 'exclusiveMinimum', uri, text, diagnostics),
    exclusiveMaximum: numericConstraint(value.exclusiveMaximum, typeName, `${pointer}/exclusiveMaximum`, 'exclusiveMaximum', uri, text, diagnostics),
    multipleOf,
    minLength: asInteger(value.minLength, `${pointer}/minLength`, 'minLength', uri, text, diagnostics),
    maxLength: asInteger(value.maxLength, `${pointer}/maxLength`, 'maxLength', uri, text, diagnostics),
    pattern: asString(value.pattern, `${pointer}/pattern`, 'pattern', uri, text, diagnostics),
    format: asString(value.format, `${pointer}/format`, 'format', uri, text, diagnostics),
    minItems: asInteger(value.minItems, `${pointer}/minItems`, 'minItems', uri, text, diagnostics),
    maxItems: asInteger(value.maxItems, `${pointer}/maxItems`, 'maxItems', uri, text, diagnostics),
    uniqueItems: asBoolean(value.uniqueItems, `${pointer}/uniqueItems`, 'uniqueItems', uri, text, diagnostics),
    minContains: asInteger(value.minContains, `${pointer}/minContains`, 'minContains', uri, text, diagnostics),
    maxContains: asInteger(value.maxContains, `${pointer}/maxContains`, 'maxContains', uri, text, diagnostics),
    minProperties: asInteger(value.minProperties, `${pointer}/minProperties`, 'minProperties', uri, text, diagnostics),
    maxProperties: asInteger(value.maxProperties, `${pointer}/maxProperties`, 'maxProperties', uri, text, diagnostics),
    minEntries: asInteger(value.minEntries, `${pointer}/minEntries`, 'minEntries', uri, text, diagnostics),
    maxEntries: asInteger(value.maxEntries, `${pointer}/maxEntries`, 'maxEntries', uri, text, diagnostics),
    default: value.default,
    contains: asSchemaObject(value.contains, `${pointer}/contains`, 'contains', uri, text, diagnostics),
    propertyNames: asSchemaObject(value.propertyNames, `${pointer}/propertyNames`, 'propertyNames', uri, text, diagnostics),
    keyNames: asSchemaObject(value.keyNames, `${pointer}/keyNames`, 'keyNames', uri, text, diagnostics),
    has: asSchemaObject(value.has, `${pointer}/has`, 'has', uri, text, diagnostics),
    dependentRequired: dependentRequiredProjection(value.dependentRequired, `${pointer}/dependentRequired`, uri, text, diagnostics),
    patternProperties: schemaObjectMap(value.patternProperties, `${pointer}/patternProperties`, 'patternProperties', uri, text, diagnostics),
    patternKeys: schemaObjectMap(value.patternKeys, `${pointer}/patternKeys`, 'patternKeys', uri, text, diagnostics)
  };
  return hasAnyKey(projection) ? projection : undefined;
}

function compositionProjection(
  pointer: string,
  value: Record<string, unknown>,
  uri: string,
  text: string,
  diagnostics: Diagnostic[]
): ConditionalCompositionProjection | undefined {
  const projection: ConditionalCompositionProjection = {
    allOf: schemaObjectArray(value.allOf, `${pointer}/allOf`, 'allOf', uri, text, diagnostics, 1),
    anyOf: schemaObjectArray(value.anyOf, `${pointer}/anyOf`, 'anyOf', uri, text, diagnostics, 1),
    oneOf: schemaObjectArray(value.oneOf, `${pointer}/oneOf`, 'oneOf', uri, text, diagnostics, 1),
    not: asSchemaObject(value.not, `${pointer}/not`, 'not', uri, text, diagnostics),
    if: asSchemaObject(value.if, `${pointer}/if`, 'if', uri, text, diagnostics),
    then: asSchemaObject(value.then, `${pointer}/then`, 'then', uri, text, diagnostics),
    else: asSchemaObject(value.else, `${pointer}/else`, 'else', uri, text, diagnostics)
  };
  return hasAnyKey(projection) ? projection : undefined;
}

function semanticProjection(pointer: string, value: Record<string, unknown>, uri: string, text: string, diagnostics: Diagnostic[]): SemanticAnnotationsProjection | undefined {
  const read = <T>(keyword: string, validate: (candidate: unknown) => candidate is T): T | undefined => {
    const candidate = value[keyword];
    if (candidate === undefined) return undefined;
    if (validate(candidate)) return candidate;
    pushKeywordDiagnostic(diagnostics, uri, `${pointer}/${keyword}`, `${keyword} does not have the form required by JSON Structure Semantic Annotations.`, text);
    return undefined;
  };
  const projection = {
    concepts: read('concepts', isReferencedDefinitionArray),
    observedProperty: read('observedProperty', isReferencedDefinition),
    semanticRole: read('semanticRole', isSemanticRole),
    derivation: read('derivation', isDerivation),
    statistic: read('statistic', isStatistic),
    codedValues: read('codedValues', isReferencedDefinition),
    measurementConditioning: read('measurementConditioning', isMeasurementConditioning),
    referenceRole: read('referenceRole', isReferenceRole),
    phenomenonTimeRelation: read('phenomenonTimeRelation', isPhenomenonTimeRelation),
    supportPeriod: read('supportPeriod', isSupportPeriod),
    temporalReferenceSystem: read('temporalReferenceSystem', isTemporalReferenceSystem),
    cadence: read('cadence', isCadence),
    coordinateReferenceSystem: read('coordinateReferenceSystem', isCoordinateReferenceSystem),
    vectorReferenceFrames: read('vectorReferenceFrames', isVectorReferenceFrames),
    tensorReferenceFrames: read('tensorReferenceFrames', isTensorReferenceFrames),
    frameTransforms: read('frameTransforms', isFrameTransforms),
    linearReferenceSystem: read('linearReferenceSystem', isLinearReferenceSystem),
    colorSpaces: read('colorSpaces', isColorSpaces),
    audioChannels: read('audioChannels', isAudioChannels),
    spectralBands: read('spectralBands', isSpectralBands)
  };
  if (value.statistic !== undefined && value.derivation !== 'statistic') {
    pushKeywordDiagnostic(diagnostics, uri, `${pointer}/statistic`, "statistic is permitted if and only if derivation is 'statistic'.", text);
    projection.statistic = undefined;
  } else if (value.derivation === 'statistic' && value.statistic === undefined) {
    pushKeywordDiagnostic(diagnostics, uri, `${pointer}/derivation`, "derivation 'statistic' requires statistic.", text);
  }
  if (value.supportPeriod !== undefined && value.phenomenonTimeRelation !== 'interval' && value.phenomenonTimeRelation !== 'accumulation') {
    pushKeywordDiagnostic(diagnostics, uri, `${pointer}/supportPeriod`, "supportPeriod requires phenomenonTimeRelation 'interval' or 'accumulation'.", text);
    projection.supportPeriod = undefined;
  }
  const temporal = projection.temporalReferenceSystem;
  if (temporal && (value.type === 'object' || value.type === 'tuple') !== (typeof temporal.position === 'string')) {
    pushKeywordDiagnostic(diagnostics, uri, `${pointer}/temporalReferenceSystem`, 'temporalReferenceSystem position is required on object and tuple types and prohibited otherwise.', text);
    projection.temporalReferenceSystem = undefined;
  }
  return hasAnyKey(projection) ? projection : undefined;
}

const SEMANTIC_ROLES = ['observationValue','resultQuality','featureOfInterest','proximateFeatureOfInterest','ultimateFeatureOfInterest','observingProcedure','phenomenonTime','resultTime','effectiveTime','phenomenonTimeStart','phenomenonTimeEnd','effectiveTimeStart','effectiveTimeEnd','ingestionTime','scheduledTime','actualTime','forecastIssueTime','forecastLeadDuration','status'] as const;
const DERIVATIONS = ['measured','statistic','calculated','estimated','modeled'] as const;
const STATISTICS = ['mean','median','mode','minimum','maximum','sum','count','standardDeviation','variance','range'] as const;
const PHENOMENON_TIME_RELATIONS = ['instant','untilNext','interval','accumulation'] as const;
const REFERENCE_ROLES = ['position','linearElement','measure','direction'] as const;
const TRANSFORM_ENCODINGS = ['quaternion','axisAngle','eulerAngles','rotationMatrix','homogeneousMatrix'] as const;
const ROTATION_SEQUENCES = ['XYX','XYZ','XZX','XZY','YXY','YXZ','YZX','YZY','ZXY','ZXZ','ZYX','ZYZ'] as const;
function enumString<const T extends readonly string[]>(value: unknown, values: T): T[number] | undefined { return typeof value === 'string' && values.includes(value) ? value as T[number] : undefined; }
function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean { return Object.keys(value).every((key) => allowed.includes(key)); }
function distinctStrings(value: unknown, minimum = 1, maximum = Infinity): value is string[] { return Array.isArray(value) && value.length >= minimum && value.length <= maximum && value.every((entry) => typeof entry === 'string') && new Set(value).size === value.length; }
function absoluteUri(value: unknown): value is string { if (typeof value !== 'string') return false; try { return new URL(value).href.length > 0 && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value); } catch { return false; } }
function referenceValueForKind(value: Record<string, unknown>): boolean { return typeof value.kind === 'string' && (value.kind === 'type' ? typeReference(value.reference) !== undefined : absoluteUri(value.reference)); }
function isReferencedDefinition(value: unknown): value is Record<string, unknown> { return isRecord(value) && hasOnlyKeys(value, ['reference','kind']) && referenceValueForKind(value); }
function isReferencedDefinitionArray(value: unknown): value is Record<string, unknown>[] { return Array.isArray(value) && value.length > 0 && value.every(isReferencedDefinition); }
function isSemanticRole(value: unknown): value is string { return enumString(value, SEMANTIC_ROLES) !== undefined; }
function isDerivation(value: unknown): value is string { return enumString(value, DERIVATIONS) !== undefined; }
function isReferenceRole(value: unknown): value is string { return enumString(value, REFERENCE_ROLES) !== undefined; }
function isPhenomenonTimeRelation(value: unknown): value is string { return enumString(value, PHENOMENON_TIME_RELATIONS) !== undefined; }
function isStatistic(value: unknown): value is string | Record<string, unknown> {
  if (enumString(value, STATISTICS) !== undefined) return true;
  if (!isRecord(value) || !hasOnlyKeys(value, ['function','percentile','rank'])) return false;
  if (value.function === 'percentile') return typeof value.percentile === 'number' && value.percentile > 0 && value.percentile < 100 && value.rank === undefined;
  if (value.function === 'nthHighest' || value.function === 'nthLowest') return Number.isInteger(value.rank) && (value.rank as number) >= 2 && value.percentile === undefined;
  return false;
}
function isSupportPeriod(value: unknown): value is Record<string, unknown> { return isRecord(value) && hasOnlyKeys(value, ['length','anchor']) && value.length !== undefined && enumString(value.anchor, ['start','end']) !== undefined; }
function isCadence(value: unknown): value is Record<string, unknown> { return isRecord(value) && ((value.kind === 'fixed' && value.period !== undefined && hasOnlyKeys(value, ['kind','period'])) || ((value.kind === 'irregular' || value.kind === 'onChange') && hasOnlyKeys(value, ['kind']))); }
function isTemporalReferenceSystem(value: unknown): value is Record<string, unknown> { return isRecord(value) && isReferencedBase(value) && hasOnlyKeys(value, ['reference','kind','position','sortOrder']) && optionalString(value.position) && (value.sortOrder === undefined || enumString(value.sortOrder, ['forward','backward']) !== undefined); }
function isCoordinateReferenceSystem(value: unknown): value is Record<string, unknown> { return isRecord(value) && isReferencedBase(value) && hasOnlyKeys(value, ['reference','kind','coordinates']) && distinctStrings(value.coordinates); }
function isReferencedBase(value: Record<string, unknown>): boolean { return referenceValueForKind(value); }
function optionalString(value: unknown): boolean { return value === undefined || typeof value === 'string'; }
function optionalEnum(value: unknown, allowed: readonly string[]): boolean { return value === undefined || enumString(value, allowed) !== undefined; }
function isVectorReferenceFrame(value: unknown): value is Record<string, unknown> { return isRecord(value) && isReferencedBase(value) && hasOnlyKeys(value, ['reference','kind','components','variance']) && distinctStrings(value.components) && optionalEnum(value.variance, ['contravariant','covariant']); }
function isVectorReferenceFrames(value: unknown): value is Record<string, unknown>[] { return Array.isArray(value) && value.length > 0 && value.every(isVectorReferenceFrame); }
function isFrameReference(value: unknown, varianceAllowed = true): value is Record<string, unknown> { return isRecord(value) && isReferencedBase(value) && hasOnlyKeys(value, varianceAllowed ? ['reference','kind','variance'] : ['reference','kind']) && (varianceAllowed ? optionalEnum(value.variance, ['contravariant','covariant']) : value.variance === undefined); }
function isTensorComponent(value: unknown): value is Record<string, unknown> { return isRecord(value) && hasOnlyKeys(value, ['index','property']) && Array.isArray(value.index) && value.index.length >= 2 && value.index.every((entry) => Number.isInteger(entry) && entry >= 0) && typeof value.property === 'string'; }
function isTensorComponents(value: unknown): value is Record<string, unknown>[] { return Array.isArray(value) && value.length > 0 && value.every(isTensorComponent); }
function tensorRank(value: Record<string, unknown>): number | undefined {
  return Array.isArray(value.frames) ? value.frames.length : undefined;
}
function normalizedFrameReference(value: Record<string, unknown>): string | undefined {
  if (typeof value.kind !== 'string') return undefined;
  if (value.kind === 'type') {
    const ref = typeReference(value.reference);
    return ref === undefined ? undefined : `type:${ref}`;
  }
  return typeof value.reference === 'string' ? `${value.kind}:${value.reference}` : undefined;
}
function sameFrameReference(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return normalizedFrameReference(a) !== undefined && normalizedFrameReference(a) === normalizedFrameReference(b);
}
function sameFrameVariance(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const first = enumString(a.variance, ['contravariant', 'covariant']);
  const second = enumString(b.variance, ['contravariant', 'covariant']);
  return first === second;
}
function hasValidTensorSymmetry(value: Record<string, unknown>): boolean {
  if (value.symmetry === undefined) return true;
  if (!Array.isArray(value.frames) || value.frames.length !== 2) return false;
  const [first, second] = value.frames;
  return isRecord(first) && isRecord(second) && sameFrameReference(first, second) && sameFrameVariance(first, second);
}
function hasRankMatchedTensorComponents(value: Record<string, unknown>): boolean {
  if (typeof value.components === 'string') return true;
  if (!Array.isArray(value.components)) return false;
  const rank = tensorRank(value);
  if (!rank) return false;
  return value.components.every((entry) => isTensorComponent(entry) && Array.isArray(entry.index) && entry.index.length === rank);
}

function hasMatrixIndexedComponents(value: unknown, sideLength: number): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((entry) =>
    isTensorComponent(entry) &&
    Array.isArray(entry.index) &&
    entry.index.length === 2 &&
    Number.isInteger(entry.index[0]) &&
    Number.isInteger(entry.index[1]) &&
    (entry.index[0] as number) >= 0 &&
    (entry.index[1] as number) >= 0 &&
    (entry.index[0] as number) < sideLength &&
    (entry.index[1] as number) < sideLength
  );
}
function isTensorReferenceFrame(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && hasOnlyKeys(value, ['frames','components','symmetry']) &&
    Array.isArray(value.frames) && value.frames.length >= 2 && value.frames.every((entry) => isFrameReference(entry)) &&
    (typeof value.components === 'string' || isTensorComponents(value.components)) &&
    optionalEnum(value.symmetry, ['symmetric','skewSymmetric','none']) &&
    hasRankMatchedTensorComponents(value) && hasValidTensorSymmetry(value);
}
function isTensorReferenceFrames(value: unknown): value is Record<string, unknown>[] { return Array.isArray(value) && value.length > 0 && value.every(isTensorReferenceFrame); }
function isFrameTransform(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !hasOnlyKeys(value, ['from','to','encoding','components','rotationSequence','translation']) || !isFrameReference(value.from, false) || !isFrameReference(value.to, false) || enumString(value.encoding, TRANSFORM_ENCODINGS) === undefined) return false;
  const encoding = value.encoding;
  const componentsOk = encoding === 'quaternion' || encoding === 'axisAngle'
    ? distinctStrings(value.components, 4, 4)
    : encoding === 'eulerAngles'
      ? distinctStrings(value.components, 3, 3)
      : encoding === 'rotationMatrix'
        ? typeof value.components === 'string' || hasMatrixIndexedComponents(value.components, 3)
        : typeof value.components === 'string' || hasMatrixIndexedComponents(value.components, 4);
  const rotationOk = encoding === 'eulerAngles' ? enumString(value.rotationSequence, ROTATION_SEQUENCES) !== undefined : value.rotationSequence === undefined;
  const translationOk = encoding === 'homogeneousMatrix' ? value.translation === undefined : value.translation === undefined || distinctStrings(value.translation, 3, 3);
  return componentsOk && rotationOk && translationOk;
}
function isFrameTransforms(value: unknown): value is Record<string, unknown>[] { return Array.isArray(value) && value.length > 0 && value.every(isFrameTransform); }
function isLinearReferenceSystem(value: unknown): value is Record<string, unknown> { return isRecord(value) && isReferencedBase(value) && hasOnlyKeys(value, ['reference','kind','linearElement','measure','measureEnd','direction']) && typeof value.linearElement === 'string' && typeof value.measure === 'string' && optionalString(value.measureEnd) && optionalString(value.direction); }
function isColorSpace(value: unknown): value is Record<string, unknown> { return isRecord(value) && isReferencedBase(value) && hasOnlyKeys(value, ['reference','kind','codePoints','channels','alpha','alphaMode','transfer','illuminant','observer']) && distinctStrings(value.channels) && (value.codePoints === undefined || (Array.isArray(value.codePoints) && value.codePoints.length === 4 && value.codePoints.every((entry) => Number.isInteger(entry) && entry >= 0))) && optionalString(value.alpha) && (value.alpha === undefined || !(value.channels as string[]).includes(value.alpha as string)) && optionalEnum(value.alphaMode, ['straight','premultiplied']) && (value.alphaMode === undefined || value.alpha !== undefined) && optionalEnum(value.transfer, ['asDefined','linear']) && optionalString(value.illuminant) && optionalString(value.observer); }
function isColorSpaces(value: unknown): value is Record<string, unknown>[] { return Array.isArray(value) && value.length > 0 && value.every(isColorSpace); }
function isNamedOrAbsoluteUri(value: unknown, names: readonly string[]): boolean { return value === undefined || enumString(value, names) !== undefined || absoluteUri(value); }
function isAudioChannel(value: unknown): value is Record<string, unknown> { return isRecord(value) && isReferencedBase(value) && hasOnlyKeys(value, ['reference','kind','channels','levelReference','encoding']) && distinctStrings(value.channels) && isNamedOrAbsoluteUri(value.levelReference, ['fullScale','soundPressure']) && isNamedOrAbsoluteUri(value.encoding, ['linear','float','aLaw','muLaw']); }
function isAudioChannels(value: unknown): value is Record<string, unknown>[] { return Array.isArray(value) && value.length > 0 && value.every(isAudioChannel); }
function isSpectralBand(value: unknown): value is Record<string, unknown> { return isRecord(value) && isReferencedBase(value) && hasOnlyKeys(value, ['reference','kind','bands','calibration']) && distinctStrings(value.bands) && optionalString(value.calibration); }
function isSpectralBands(value: unknown): value is Record<string, unknown>[] { return Array.isArray(value) && value.length > 0 && value.every(isSpectralBand); }
function isMeasurementConditioning(value: unknown): value is Record<string, unknown> { return isRecord(value) && Object.keys(value).length > 0 && hasOnlyKeys(value, ['weighting','timeWeighting','levelReference']) && optionalString(value.weighting) && optionalString(value.timeWeighting) && optionalString(value.levelReference); }
function asBoolean(value: unknown, pointer: string, keyword: string, uri: string, text: string, diagnostics: Diagnostic[]): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  pushKeywordDiagnostic(diagnostics, uri, pointer, `${keyword} must be a boolean.`, text);
  return undefined;
}

function asInteger(value: unknown, pointer: string, keyword: string, uri: string, text: string, diagnostics: Diagnostic[]): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  pushKeywordDiagnostic(diagnostics, uri, pointer, `${keyword} must be a non-negative integer.`, text);
  return undefined;
}

function asString(value: unknown, pointer: string, keyword: string, uri: string, text: string, diagnostics: Diagnostic[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  pushKeywordDiagnostic(diagnostics, uri, pointer, `${keyword} must be a string.`, text);
  return undefined;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asSchemaObject(
  value: unknown,
  pointer: string,
  keyword: string,
  uri: string,
  text: string,
  diagnostics: Diagnostic[]
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (isRecord(value)) return value;
  pushKeywordDiagnostic(diagnostics, uri, pointer, `${keyword} must be an object.`, text);
  return undefined;
}

function schemaObjectArray(
  value: unknown,
  pointer: string,
  keyword: string,
  uri: string,
  text: string,
  diagnostics: Diagnostic[],
  minimumItems = 0
): readonly Record<string, unknown>[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value) && value.length >= minimumItems && value.every((entry) => isRecord(entry))) return value;
  const suffix = minimumItems > 0 ? ` with at least ${minimumItems} item${minimumItems === 1 ? '' : 's'}` : '';
  pushKeywordDiagnostic(diagnostics, uri, pointer, `${keyword} must be an array of objects${suffix}.`, text);
  return undefined;
}

function parseStringMap(
  value: unknown,
  pointer: string,
  keyword: string,
  uri: string,
  text: string,
  diagnostics: Diagnostic[]
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !Object.values(value).every((entry) => typeof entry === 'string')) {
    pushKeywordDiagnostic(diagnostics, uri, pointer, `${keyword} must be an object map with string values.`, text);
    return undefined;
  }
  return value as Readonly<Record<string, string>>;
}

function schemaObjectMap(
  value: unknown,
  pointer: string,
  keyword: string,
  uri: string,
  text: string,
  diagnostics: Diagnostic[]
): Readonly<Record<string, Record<string, unknown>>> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !Object.values(value).every((entry) => isRecord(entry))) {
    pushKeywordDiagnostic(diagnostics, uri, pointer, `${keyword} must be an object map of schema objects.`, text);
    return undefined;
  }
  return value as Readonly<Record<string, Record<string, unknown>>>;
}

function dependentRequiredProjection(
  value: unknown,
  pointer: string,
  uri: string,
  text: string,
  diagnostics: Diagnostic[]
): Readonly<Record<string, readonly string[]>> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    pushKeywordDiagnostic(diagnostics, uri, pointer, 'dependentRequired must be an object map of string arrays.', text);
    return undefined;
  }
  const entries = Object.entries(value);
  if (!entries.every(([, entry]) => isStringArray(entry))) {
    pushKeywordDiagnostic(diagnostics, uri, pointer, 'dependentRequired must map each key to a string array.', text);
    return undefined;
  }
  return Object.fromEntries(entries) as Readonly<Record<string, readonly string[]>>;
}

function hasAnyKey<T extends object>(value: T): boolean {
  return Object.values(value).some((entry) => entry !== undefined);
}

const NUMERIC_TYPES = new Set(['integer', 'number', 'int8', 'int16', 'int32', 'int64', 'uint8', 'uint16', 'uint32', 'uint64', 'float32', 'float64', 'decimal']);
const EXTENDED_NUMERIC_TYPES = new Set(['int64', 'uint64', 'int128', 'uint128', 'decimal', 'decimal128']);
const NUMERIC_STRING = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function declarationType(value: Record<string, unknown>): string | undefined {
  if (typeof value.type === 'string') return value.type;
  if (typeReference(value.type) !== undefined) return '$ref';
  return undefined;
}

function numericConstraint(
  value: unknown,
  typeName: string | undefined,
  pointer: string,
  keyword: string,
  uri: string,
  text: string,
  diagnostics: Diagnostic[],
  requirePositive = false
): number | string | undefined {
  if (value === undefined) return undefined;
  const declarationTypeName = typeName ?? '';
  const isNumericDeclaration = NUMERIC_TYPES.has(declarationTypeName);
  const isExtendedNumericDeclaration = EXTENDED_NUMERIC_TYPES.has(declarationTypeName);

  if (!isNumericDeclaration) {
    pushKeywordDiagnostic(diagnostics, uri, pointer, `${keyword} applies only to numeric declaration types.`, text);
    return undefined;
  }

  if (isExtendedNumericDeclaration) {
    if (typeof value !== 'string' || !NUMERIC_STRING.test(value)) {
      pushKeywordDiagnostic(diagnostics, uri, pointer, `${keyword} must be a numeric string for extended numeric types.`, text);
      return undefined;
    }
    if (requirePositive && !isPositiveNumericString(value)) {
      pushKeywordDiagnostic(diagnostics, uri, pointer, `${keyword} must be greater than 0.`, text);
      return undefined;
    }
    return value;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    pushKeywordDiagnostic(diagnostics, uri, pointer, `${keyword} must be a finite number for non-extended numeric types.`, text);
    return undefined;
  }
  if (requirePositive && value <= 0) {
    pushKeywordDiagnostic(diagnostics, uri, pointer, `${keyword} must be greater than 0.`, text);
    return undefined;
  }
  return value;
}

function isPositiveNumericString(value: string): boolean {
  if (value.startsWith('-')) return false;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric > 0;
  const normalized = value.replace(/[+\-.eE]/g, '');
  return /[1-9]/.test(normalized);
}

function keywordRange(text: string, pointer: string): TextRange {
  const parsed = new StrictParser(text, '').parse();
  const value = [...parsed.values].reverse().find((entry) => entry.pointer === pointer);
  if (value) return rangeFor(text, value.start, value.end);
  const parentPointer = pointer.slice(0, pointer.lastIndexOf('/'));
  const parent = [...parsed.values].reverse().find((entry) => entry.pointer === parentPointer);
  return parent ? rangeFor(text, parent.start, parent.end) : rangeFor(text, 0, text.length);
}
function pushKeywordDiagnostic(
  diagnostics: Diagnostic[],
  uri: string,
  pointer: string,
  message: string,
  text: string
): void {
  diagnostics.push({
    code: 'json.keyword-invalid',
    message,
    severity: 'error',
    location: location(uri, pointer, keywordRange(text, pointer))
  });
}

function coreForm(value: Record<string, unknown>): 'typed' | 'ref' | 'composed' | 'unknown' {
  if (typeof value.type === 'string' || typeReference(value.type) !== undefined) return 'typed';
  if (typeof value.$ref === 'string') return 'ref';
  if (COMPOSITION_KEYWORDS.some((keyword) => Object.prototype.hasOwnProperty.call(value, keyword))) return 'composed';
  return 'unknown';
}

const COMPOSITION_KEYWORDS = ['allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else'] as const;

function extendsProjection(value: unknown): string | readonly string[] | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) return value;
  return undefined;
}

function declarationKind(value: unknown): ModelNode['kind'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'unknown';
  const type = (value as Record<string, unknown>).type;
  if (typeReference(type) !== undefined) return 'primitive';
  if (typeof type !== 'string') return 'unknown';
  if (type === 'object') return 'object';
  if (type === 'array') return 'array';
  if (type === 'set') return 'set';
  if (type === 'map') return 'map';
  if (type === 'tuple') return 'tuple';
  if (type === 'choice') return 'choice';
  if (type === 'union') return 'union';
  if (['string', 'str', 'int32', 'float64', 'number', 'boolean', 'bool'].includes(type)) return 'primitive';
  if (NUMERIC_TYPES.has(type)) return 'primitive';
  return 'unknown';
}

function collectReferenceProjections(value: unknown, pointer: string, references: ReferenceProjection[]): void {
  const seen = new Set(references.map((entry) => `${entry.kind}|${entry.pointer}|${entry.target}`));
  const push = (entry: ReferenceProjection): void => {
    const key = `${entry.kind}|${entry.pointer}|${entry.target}`;
    if (seen.has(key)) return;
    seen.add(key);
    references.push(entry);
  };

  const visit = (candidate: unknown, currentPointer: string): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach((entry, index) => visit(entry, `${currentPointer}/${index}`));
      return;
    }
    if (!isRecord(candidate)) return;

    if (typeof candidate.$root === 'string' && currentPointer === '') {
      push({ pointer: '/$root', target: candidate.$root, kind: 'root' });
    }
    if (typeof candidate.$ref === 'string') {
      push({ pointer: `${currentPointer}/$ref`, target: candidate.$ref, kind: 'ref' });
    }
    if (typeof candidate.$extends === 'string') {
      push({ pointer: `${currentPointer}/$extends`, target: candidate.$extends, kind: 'extends' });
    } else if (Array.isArray(candidate.$extends)) {
      candidate.$extends.forEach((entry, index) => {
        if (typeof entry === 'string') push({ pointer: `${currentPointer}/$extends/${index}`, target: entry, kind: 'extends' });
      });
    }
    if (typeReference(candidate.type) !== undefined) {
      push({ pointer: `${currentPointer}/type`, target: (candidate.type as Record<string, unknown>).$ref as string, kind: 'ref' });
    }

    for (const [key, entry] of Object.entries(candidate)) visit(entry, `${currentPointer}/${pointerPart(key)}`);
  };

  visit(value, pointer);
}

function collectSemanticPlacements(
  value: unknown,
  pointer: string,
  uri: string,
  text: string,
  diagnostics: Diagnostic[],
  placements: SemanticPlacementProjection[],
  byPointer: Map<string, SemanticAnnotationsProjection>
): void {
  const visitSchema = (candidate: unknown, candidatePointer: string): void => {
    if (!isRecord(candidate)) return;

    const semantic = semanticProjection(candidatePointer, candidate, uri, text, diagnostics);
    if (semantic) {
      placements.push({ pointer: candidatePointer, annotations: semantic });
      byPointer.set(candidatePointer, semantic);
    }

    visitDefinitions(candidate.definitions, `${candidatePointer}/definitions`);
    visitSchemaMap(candidate.properties, `${candidatePointer}/properties`);
    visitSchemaValue(candidate.items, `${candidatePointer}/items`);
    visitSchemaValue(candidate.values, `${candidatePointer}/values`);
    visitSchemaMap(candidate.choices, `${candidatePointer}/choices`);
    visitSchemaValue(candidate.contains, `${candidatePointer}/contains`);
    visitSchemaValue(candidate.propertyNames, `${candidatePointer}/propertyNames`);
    visitSchemaValue(candidate.keyNames, `${candidatePointer}/keyNames`);
    visitSchemaValue(candidate.has, `${candidatePointer}/has`);
    visitSchemaMap(candidate.patternProperties, `${candidatePointer}/patternProperties`);
    visitSchemaMap(candidate.patternKeys, `${candidatePointer}/patternKeys`);
    visitSchemaArray(candidate.allOf, `${candidatePointer}/allOf`);
    visitSchemaArray(candidate.anyOf, `${candidatePointer}/anyOf`);
    visitSchemaArray(candidate.oneOf, `${candidatePointer}/oneOf`);
    visitSchemaValue(candidate.not, `${candidatePointer}/not`);
    visitSchemaValue(candidate.if, `${candidatePointer}/if`);
    visitSchemaValue(candidate.then, `${candidatePointer}/then`);
    visitSchemaValue(candidate.else, `${candidatePointer}/else`);

    if (Array.isArray(candidate.type)) visitSchemaArray(candidate.type, `${candidatePointer}/type`);
  };

  const visitDefinitions = (candidate: unknown, candidatePointer: string): void => {
    if (!isRecord(candidate)) return;
    for (const [key, entry] of Object.entries(candidate)) {
      const entryPointer = `${candidatePointer}/${pointerPart(key)}`;
      if (!isRecord(entry)) continue;
      if (looksLikeSchemaObject(entry)) {
        visitSchema(entry, entryPointer);
      } else {
        // Nested namespace containers are normative only under definitions.
        visitDefinitions(entry, entryPointer);
      }
    }
  };

  const visitSchemaMap = (candidate: unknown, candidatePointer: string): void => {
    if (!isRecord(candidate)) return;
    for (const [key, entry] of Object.entries(candidate)) visitSchema(entry, `${candidatePointer}/${pointerPart(key)}`);
  };

  const visitSchemaArray = (candidate: unknown, candidatePointer: string): void => {
    if (!Array.isArray(candidate)) return;
    candidate.forEach((entry, index) => visitSchema(entry, `${candidatePointer}/${index}`));
  };

  const visitSchemaValue = (candidate: unknown, candidatePointer: string): void => {
    if (Array.isArray(candidate)) {
      visitSchemaArray(candidate, candidatePointer);
      return;
    }
    visitSchema(candidate, candidatePointer);
  };

  visitSchema(value, pointer);
}

function looksLikeSchemaObject(value: Record<string, unknown>): boolean {
  if (typeof value.type === 'string' || Array.isArray(value.type) || isRecord(value.type)) return true;
  if (typeof value.$ref === 'string' || typeof value.$extends === 'string' || Array.isArray(value.$extends)) return true;
  const schemaBearingKeys = [
    'definitions', 'properties', 'items', 'values', 'choices',
    'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else',
    'contains', 'propertyNames', 'keyNames', 'has', 'patternProperties', 'patternKeys'
  ];
  return schemaBearingKeys.some((key) => Object.prototype.hasOwnProperty.call(value, key));
}
