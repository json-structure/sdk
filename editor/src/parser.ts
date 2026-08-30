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
import { VALIDATION_KEYWORDS, effectiveValidationTypes, validationIssues, type ValidationKeyword } from './validation.js';
import { resolveCapabilities } from './capabilities.js';

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
  if (!isRecord(parsed.value)) {
    const diagnostics = [...parsed.diagnostics, ...duplicateDiagnostics, {
      code: 'core.document-root-invalid',
      message: 'A JSON Structure document root must be an object.',
      severity: 'error' as const,
      location: location(uri, '', nodes.find((node) => node.pointer === '')?.range ?? rangeFor(text, 0, text.length))
    }];
    return { value: parsed.value, diagnostics, recovery: 'valid' };
  }
  const root = parsed.value;
  const projectionDiagnostics: Diagnostic[] = [];
  collectCoreDeclarationDiagnostics(root, uri, text, projectionDiagnostics, nodes);
  const projections = buildProjections(root, uri, text, projectionDiagnostics, nodes);
  const diagnostics = [...parsed.diagnostics, ...duplicateDiagnostics, ...projectionDiagnostics];
  const model: NormalizedDocument = {
    uri,
    documentId: typeof root?.$id === 'string' ? root.$id : undefined,
    name: typeof root?.name === 'string' ? root.name : undefined,
    recovery: 'valid',
    nodes,
    rootPointer: typeof root?.$root === 'string' ? decodePointerFragment(root.$root) : undefined,
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
      location: location(uri, pointer, list[0].keyRange ?? list[0].range ?? rangeFor(text, 0, 0)),
      related: list.slice(1).map((node) => location(uri, pointer, node.keyRange ?? node.range ?? rangeFor(text, 0, 0)))
    });
  }
  return duplicates;
}

function collectCoreDeclarationDiagnostics(
  root: Record<string, unknown>,
  uri: string,
  text: string,
  diagnostics: Diagnostic[],
  nodes: readonly ModelNode[]
): void {
  const { validationActive } = resolveCapabilities(root);
  const diagnoseName = (pointer: string, kind: 'type' | 'namespace' | 'property', name: string): void => {
    if (IDENTIFIER.test(name)) return;
    const node = nodes.find((candidate) => candidate.pointer === pointer);
    diagnostics.push({
      code: 'core.identifier-invalid',
      message: `${kind} name '${name}' must match ${IDENTIFIER.source}.`,
      severity: 'error',
      location: location(uri, pointer, node?.keyRange ?? node?.range ?? keywordRange(text, pointer))
    });
  };
  const diagnose = (pointer: string, message: string): void => {
    diagnostics.push({
      code: 'core.declaration-invalid',
      message,
      severity: 'error',
      location: location(uri, pointer, keywordRange(text, pointer))
    });
  };
  const requireHeader = (keyword: '$schema' | '$id' | 'name', valid: (value: unknown) => boolean, message: string): void => {
    if (!Object.prototype.hasOwnProperty.call(root, keyword) || !valid(root[keyword])) diagnose(`/${keyword}`, message);
  };
  const validateSchema = (schema: Record<string, unknown>, pointer: string): void => {
    if (typeof schema.$ref === 'string' && !Object.prototype.hasOwnProperty.call(schema, 'type')) {
      diagnose(pointer, 'A schema declaration must use type: {"$ref": ...}; a direct $ref object is not a schema declaration.');
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(schema, 'type')) {
      diagnose(pointer, 'A schema declaration must contain type.');
      return;
    }
    if (!validCoreTypeValue(schema.type) && coreForm(schema) === 'unknown') {
      diagnose(`${pointer}/type`, 'type must name a known Core type, be a local type reference, or be a non-empty array of those forms.');
    }
    const propertiesPresent = Object.prototype.hasOwnProperty.call(schema, 'properties');
    const propertiesApplicable = schema.type === 'object' || schema.type === 'tuple';
    if (schema.type === 'object' && !propertiesPresent) {
      diagnose(pointer, 'An object declaration must contain properties.');
    }
    if (propertiesPresent && !propertiesApplicable) {
      diagnose(`${pointer}/properties`, 'properties is permitted only on object and tuple declarations.');
      return;
    }
    if (!propertiesPresent) return;
    if (!isRecord(schema.properties)) {
      diagnose(`${pointer}/properties`, 'properties must be an object map of property schema declarations.');
      return;
    }
    if (schema.type === 'object' && Object.keys(schema.properties).length === 0) {
      diagnose(`${pointer}/properties`, 'An object declaration must contain at least one property.');
    }
    const propertiesPointer = `${pointer}/properties`;
    for (const [name, property] of Object.entries(schema.properties)) {
      const propertyPointer = `${propertiesPointer}/${pointerPart(name)}`;
      diagnoseName(propertyPointer, 'property', name);
      if (!isRecord(property)) {
        diagnose(propertyPointer, `Property '${name}' must be a schema object.`);
        continue;
      }
      validateSchema(property, propertyPointer);
    }
  };
  const validateNamespace = (namespace: Record<string, unknown>, pointer: string): void => {
    for (const [name, member] of Object.entries(namespace)) {
      if (name === '$import' || name === '$importdefs') continue;
      const memberPointer = `${pointer}/${pointerPart(name)}`;
      if (name === 'definitions') diagnose(memberPointer, 'definitions is permitted only at document root.');
      if (!isRecord(member)) {
        diagnose(memberPointer, `Definition or namespace '${name}' must be an object.`);
        continue;
      }
      const declaration = Object.prototype.hasOwnProperty.call(member, 'type') ||
        Object.prototype.hasOwnProperty.call(member, '$ref') ||
        COMPOSITION_KEYWORDS.some((keyword) => Object.prototype.hasOwnProperty.call(member, keyword));
      if (declaration) {
        diagnoseName(memberPointer, 'type', name);
        validateSchema(member, memberPointer);
      } else validateNamespace(member, memberPointer);
    }
  };

  requireHeader('$schema', (value) => typeof value === 'string' && absoluteUri(value), '$schema is required and must be an absolute URI.');
  requireHeader('$id', (value) => typeof value === 'string' && absoluteUri(value), '$id is required and must be an absolute URI.');
  requireHeader('name', (value) => typeof value === 'string' && IDENTIFIER.test(value), `name is required and must match ${IDENTIFIER.source}.`);

  if (Object.prototype.hasOwnProperty.call(root, '$root')) {
    const rootPointer = typeof root.$root === 'string' ? decodePointerFragment(root.$root) : undefined;
    if (rootPointer === undefined || !rootPointer.startsWith('/definitions/')) {
      diagnose('/$root', '$root must be a JSON Pointer URI fragment into the local definitions namespace.');
    }
    if (Object.prototype.hasOwnProperty.call(root, 'type')) diagnose('', '$root and an inline root type are mutually exclusive.');
  }
  if (Object.prototype.hasOwnProperty.call(root, 'definitions')) {
    if (!isRecord(root.definitions)) diagnose('/definitions', 'definitions must be an object map of reusable types and namespaces.');
    else validateNamespace(root.definitions, '/definitions');
  }
  if (Object.prototype.hasOwnProperty.call(root, 'type')) validateSchema(root, '');

  const visitSchema = (schema: unknown, pointer: string): void => {
    if (!isRecord(schema)) return;
    if (pointer !== '' && Object.prototype.hasOwnProperty.call(schema, '$root')) diagnose(`${pointer}/$root`, '$root is permitted only at document root.');
    if (pointer !== '' && Object.prototype.hasOwnProperty.call(schema, 'definitions')) diagnose(`${pointer}/definitions`, 'definitions is permitted only at document root.');
    if (isRecord(schema.properties)) {
      for (const [name, property] of Object.entries(schema.properties)) visitSchema(property, `${pointer}/properties/${pointerPart(name)}`);
    }
    if (isRecord(schema.additionalProperties)) visitSchema(schema.additionalProperties, `${pointer}/additionalProperties`);
    for (const keyword of ['items', 'values', 'not', 'if', 'then', 'else'] as const) {
      visitSchema(schema[keyword], `${pointer}/${keyword}`);
    }
    if (validationActive) {
      for (const keyword of ['contains', 'propertyNames', 'keyNames', 'has'] as const) visitSchema(schema[keyword], `${pointer}/${keyword}`);
      for (const keyword of ['patternProperties', 'patternKeys'] as const) {
        if (isRecord(schema[keyword])) for (const [name, value] of Object.entries(schema[keyword])) visitSchema(value, `${pointer}/${keyword}/${pointerPart(name)}`);
      }
    }
    for (const keyword of ['choices'] as const) {
      if (isRecord(schema[keyword])) for (const [name, value] of Object.entries(schema[keyword])) visitSchema(value, `${pointer}/${keyword}/${pointerPart(name)}`);
    }
    for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
      if (Array.isArray(schema[keyword])) schema[keyword].forEach((value, index) => visitSchema(value, `${pointer}/${keyword}/${index}`));
    }
  };
  visitSchema(root, '');
}

function buildProjections(
  root: Record<string, unknown>,
  uri: string,
  text: string,
  diagnostics: Diagnostic[],
  nodes: readonly ModelNode[]
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
  const { validationActive } = resolveCapabilities(root);
  const semanticByPointer = new Map<string, SemanticAnnotationsProjection>();
  collectSemanticPlacements(root, '', uri, text, diagnostics, semanticPlacements, semanticByPointer);
  collectDefinitions(root, root, '', uri, text, definitions, imports, diagnostics, semanticByPointer, nodes, validationActive);
  collectSchemaProjections(root, uri, text, definitions, diagnostics, semanticByPointer, nodes, validationActive);
  collectReferenceProjections(root, references);
  collectStructuralDiagnostics(root, root, '', uri, text, diagnostics, nodes);
  return { definitions, imports, references, semanticPlacements };
}

function collectSchemaProjections(
  root: Record<string, unknown>,
  uri: string,
  text: string,
  definitions: DefinitionProjection[],
  diagnostics: Diagnostic[],
  semanticByPointer: ReadonlyMap<string, SemanticAnnotationsProjection>,
  nodes: readonly ModelNode[],
  validationActive: boolean
): void {
  const visited = new Set(definitions.map((definition) => definition.pointer));
  const diagnosed = new Set<string>();

  const visitSchema = (candidate: unknown, pointer: string): void => {
    if (!isRecord(candidate)) return;
    if (diagnosed.has(pointer)) return;
    diagnosed.add(pointer);
    localTypeReferenceDiagnostics(pointer, candidate, uri, text, diagnostics);
    relationAndIdentityLocalDiagnostics(root, pointer, candidate, uri, text, diagnostics, nodes);
    if (!visited.has(pointer) && isSchemaDeclaration(candidate)) {
      const split = pointer.lastIndexOf('/');
      const name = pointer === '' ? '$root' : pointer.slice(split + 1).replace(/~1/g, '/').replace(/~0/g, '~');
      const namespacePointer = pointer === '' ? '' : pointer.slice(0, split);
      const projection = definitionProjection(root, name, namespacePointer, pointer, candidate, false, uri, text, diagnostics, semanticByPointer.get(pointer), nodes, validationActive);
      if (projection) definitions.push(projection);
      visited.add(pointer);
    }

    visitDefinitions(candidate.definitions, `${pointer}/definitions`);
    visitSchemaMap(candidate.properties, `${pointer}/properties`);
    if (isRecord(candidate.additionalProperties)) visitSchema(candidate.additionalProperties, `${pointer}/additionalProperties`);
    visitSchemaValue(candidate.items, `${pointer}/items`);
    visitSchemaValue(candidate.values, `${pointer}/values`);
    visitSchemaMap(candidate.choices, `${pointer}/choices`);
    if (validationActive) {
      visitSchemaValue(candidate.contains, `${pointer}/contains`);
      visitSchemaValue(candidate.propertyNames, `${pointer}/propertyNames`);
      visitSchemaValue(candidate.keyNames, `${pointer}/keyNames`);
      visitSchemaValue(candidate.has, `${pointer}/has`);
      visitSchemaMap(candidate.patternProperties, `${pointer}/patternProperties`);
      visitSchemaMap(candidate.patternKeys, `${pointer}/patternKeys`);
    }
    visitSchemaArray(candidate.allOf, `${pointer}/allOf`);
    visitSchemaArray(candidate.anyOf, `${pointer}/anyOf`);
    visitSchemaArray(candidate.oneOf, `${pointer}/oneOf`);
    visitSchemaValue(candidate.not, `${pointer}/not`);
    visitSchemaValue(candidate.if, `${pointer}/if`);
    visitSchemaValue(candidate.then, `${pointer}/then`);
    visitSchemaValue(candidate.else, `${pointer}/else`);
    if (Array.isArray(candidate.type)) visitSchemaArray(candidate.type, `${pointer}/type`);
  };

  const visitDefinitions = (candidate: unknown, pointer: string): void => {
    if (!isRecord(candidate)) return;
    for (const [key, entry] of Object.entries(candidate)) {
      if (key === '$import' || key === '$importdefs' || !isRecord(entry)) continue;
      const entryPointer = `${pointer}/${pointerPart(key)}`;
      if (looksLikeSchemaObject(entry)) visitSchema(entry, entryPointer);
      else visitDefinitions(entry, entryPointer);
    }
  };
  const visitSchemaMap = (candidate: unknown, pointer: string): void => {
    if (!isRecord(candidate)) return;
    for (const [key, entry] of Object.entries(candidate)) visitSchema(entry, `${pointer}/${pointerPart(key)}`);
  };
  const visitSchemaArray = (candidate: unknown, pointer: string): void => {
    if (!Array.isArray(candidate)) return;
    candidate.forEach((entry, index) => visitSchema(entry, `${pointer}/${index}`));
  };
  const visitSchemaValue = (candidate: unknown, pointer: string): void => {
    if (Array.isArray(candidate)) visitSchemaArray(candidate, pointer);
    else visitSchema(candidate, pointer);
  };

  visitSchema(root, '');
}

function collectDefinitions(
  root: Record<string, unknown>,
  value: unknown,
  pointer: string,
  uri: string,
  text: string,
  definitions: DefinitionProjection[],
  imports: ImportProjection[],
  diagnostics: Diagnostic[],
  semanticByPointer: ReadonlyMap<string, SemanticAnnotationsProjection>,
  nodes: readonly ModelNode[],
  validationActive: boolean
): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const object = value as Record<string, unknown>;
  if (namespacePointer(root, pointer, nodes)) pushImportProjection(pointer, object, uri, text, imports, diagnostics);
  const defs = object.definitions;
  if (defs && typeof defs === 'object' && !Array.isArray(defs)) {
    if (namespacePointer(root, `${pointer}/definitions`, nodes)) {
      pushImportProjection(`${pointer}/definitions`, defs as Record<string, unknown>, uri, text, imports, diagnostics);
    }
    for (const [name, declaration] of Object.entries(defs as Record<string, unknown>)) {
      if (name === '$import' || name === '$importdefs') continue;
      const encoded = pointerPart(name);
      const declarationPointer = `${pointer}/definitions/${encoded}`;
      const projection = definitionProjection(root, name, pointer, declarationPointer, declaration, true, uri, text, diagnostics, semanticByPointer.get(declarationPointer), nodes, validationActive);
      if (projection) definitions.push(projection);
      else collectNamespaceMembers(root, declaration, declarationPointer, uri, text, definitions, imports, diagnostics, semanticByPointer, nodes, validationActive);
      collectDefinitions(root, declaration, declarationPointer, uri, text, definitions, imports, diagnostics, semanticByPointer, nodes, validationActive);
    }
  }
}

function collectNamespaceMembers(
  root: Record<string, unknown>,
  value: unknown,
  pointer: string,
  uri: string,
  text: string,
  definitions: DefinitionProjection[],
  imports: ImportProjection[],
  diagnostics: Diagnostic[],
  semanticByPointer: ReadonlyMap<string, SemanticAnnotationsProjection>,
  nodes: readonly ModelNode[],
  validationActive: boolean
): void {
  if (!isRecord(value) || !namespacePointer(root, pointer, nodes)) return;
  for (const [name, declaration] of Object.entries(value)) {
    if (name === '$import' || name === '$importdefs' || name === 'definitions') continue;
    const declarationPointer = `${pointer}/${pointerPart(name)}`;
    const projection = definitionProjection(root, name, pointer, declarationPointer, declaration, true, uri, text, diagnostics, semanticByPointer.get(declarationPointer), nodes, validationActive);
    if (projection) definitions.push(projection);
    else collectNamespaceMembers(root, declaration, declarationPointer, uri, text, definitions, imports, diagnostics, semanticByPointer, nodes, validationActive);
    collectDefinitions(root, declaration, declarationPointer, uri, text, definitions, imports, diagnostics, semanticByPointer, nodes, validationActive);
  }
}

function definitionProjection(
  root: Record<string, unknown>,
  name: string,
  namespacePointer: string,
  pointer: string,
  declaration: unknown,
  reusable: boolean,
  uri: string,
  text: string,
  diagnostics: Diagnostic[],
  semantic: SemanticAnnotationsProjection | undefined,
  nodes: readonly ModelNode[],
  validationActive: boolean
): DefinitionProjection | undefined {
  if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) return undefined;
  const value = declaration as Record<string, unknown>;
  const declarationCore = coreForm(value);
  if (declarationCore === 'unknown') return undefined;
  const type = declarationType(value);
  if (value.type !== undefined && !validCoreTypeValue(value.type)) {
    pushKeywordDiagnostic(diagnostics, uri, `${pointer}/type`, 'type must name a known Core type, be a local type reference, or be an array of those forms.', text);
  }
  const relationItems = relationProjections(pointer, value.relations, uri, text, diagnostics);
  const units = unitsProjection(pointer, value, uri, text, diagnostics);
  const validation = validationActive ? validationProjection(root, pointer, value, uri, text, diagnostics, nodes) : undefined;
  const composition = compositionProjection(pointer, value, uri, text, diagnostics);
  const required = requiredProjection(pointer, value, type, uri, text, diagnostics);
  const properties = schemaObjectMap(value.properties, `${pointer}/properties`, 'properties', uri, text, diagnostics);
  const identity = identityProjection(pointer, value, type, properties, nodes);
  const items = collectionMemberProjection(pointer, value, type, 'items', uri, text, diagnostics);
  const values = collectionMemberProjection(pointer, value, type, 'values', uri, text, diagnostics);
  const tuple = tupleProjection(pointer, value, type, properties, uri, text, diagnostics);
  const description = asString(value.description, `${pointer}/description`, 'description', uri, text, diagnostics);
  const binary = binaryAnnotationsProjection(pointer, value, type, uri, text, diagnostics);
  return {
    pointer,
    name,
    namespacePointer,
    reusable,
    type,
    coreForm: declarationCore,
    extends: extendsProjection(value.$extends),
    identity,
    relations: relationItems,
    units,
    validation,
    composition,
    semantic,
    required,
    properties,
    items,
    values,
    tuple,
    description,
    binary
  };
}

function identityProjection(
  pointer: string,
  value: Record<string, unknown>,
  type: string | undefined,
  properties: Readonly<Record<string, Record<string, unknown>>> | undefined,
  nodes: readonly ModelNode[]
): readonly string[] | undefined {
  const identity = value.identity;
  if ((type !== 'object' && type !== 'tuple') || !Array.isArray(identity) || identity.length === 0 ||
      !identity.every((entry) => typeof entry === 'string' && entry.length > 0) ||
      new Set(identity).size !== identity.length || properties === undefined ||
      !uniquePointer(nodes, `${pointer}/identity`)) return undefined;
  return identity.every((name) => Object.prototype.hasOwnProperty.call(properties, name) &&
    uniquePointerPath(nodes, `${pointer}/properties/${pointerPart(name)}`)) ? identity as string[] : undefined;
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

  if (value.$import !== undefined && value.$importdefs !== undefined) {
    pushKeywordDiagnostic(diagnostics, uri, pointer, 'Only one of $import or $importdefs is permitted at a single namespace location.', text);
  }
}

function relationProjections(pointer: string, relations: unknown, uri: string, text: string, diagnostics: Diagnostic[]): RelationProjection[] {
  if (relations === undefined || !isRecord(relations)) return [];
  const items: RelationProjection[] = [];
  for (const [name, value] of Object.entries(relations)) {
    const relationPointer = `${pointer}/relations/${pointerPart(name)}`;
    if (!IDENTIFIER.test(name)) pushKeywordDiagnostic(diagnostics, uri, relationPointer, `relation name '${name}' is not a valid identifier.`, text);
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
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function collectStructuralDiagnostics(
  root: Record<string, unknown>,
  value: unknown,
  pointer: string,
  uri: string,
  text: string,
  diagnostics: Diagnostic[],
  nodes: readonly ModelNode[]
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectStructuralDiagnostics(root, entry, `${pointer}/${index}`, uri, text, diagnostics, nodes));
    return;
  }
  if (!isRecord(value)) return;
  importPlacementDiagnostics(root, pointer, value, uri, text, diagnostics, nodes);
  for (const [key, entry] of Object.entries(value)) {
    collectStructuralDiagnostics(root, entry, `${pointer}/${pointerPart(key)}`, uri, text, diagnostics, nodes);
  }
}

function requiredProjection(
  pointer: string,
  value: Record<string, unknown>,
  type: string | undefined,
  uri: string,
  text: string,
  diagnostics: Diagnostic[]
): readonly string[] | readonly (readonly string[])[] | undefined {
  if (value.required === undefined) return undefined;
  const properties = value.properties;
  const required = value.required;
  const simple = Array.isArray(required) && required.every((entry) => typeof entry === 'string');
  const alternatives = Array.isArray(required) && required.length > 0 && required.every((entry) => Array.isArray(entry) && entry.length > 0 && entry.every((name) => typeof name === 'string'));
  const sets = simple ? [required as string[]] : alternatives ? required as string[][] : [];
  const valid = type === 'object' && isRecord(properties) && sets.length > 0 && sets.every((set) =>
    new Set(set).size === set.length && set.every((name) => Object.prototype.hasOwnProperty.call(properties, name)));
  if (!valid) {
    pushKeywordDiagnostic(diagnostics, uri, `${pointer}/required`, 'required must be a string array or non-empty array of non-empty string arrays naming object properties.', text);
    return undefined;
  }
  return required as string[] | string[][];
}

function collectionMemberProjection(
  pointer: string,
  value: Record<string, unknown>,
  type: string | undefined,
  keyword: 'items' | 'values',
  uri: string,
  text: string,
  diagnostics: Diagnostic[]
): Record<string, unknown> | undefined {
  const candidate = value[keyword];
  const expected = keyword === 'items' ? type === 'array' || type === 'set' : type === 'map';
  if (candidate === undefined) {
    if (expected) pushKeywordDiagnostic(diagnostics, uri, pointer, `${keyword} is required for ${type} declarations.`, text);
    return undefined;
  }
  if (!expected || !isRecord(candidate) || !isSchemaDeclaration(candidate)) {
    pushKeywordDiagnostic(diagnostics, uri, `${pointer}/${keyword}`, `${keyword} must be a schema on the applicable collection declaration.`, text);
    return undefined;
  }
  return candidate;
}

function tupleProjection(
  pointer: string,
  value: Record<string, unknown>,
  type: string | undefined,
  properties: Readonly<Record<string, Record<string, unknown>>> | undefined,
  uri: string,
  text: string,
  diagnostics: Diagnostic[]
): readonly string[] | undefined {
  if (value.tuple === undefined) {
    if (type === 'tuple') pushKeywordDiagnostic(diagnostics, uri, pointer, 'tuple is required for tuple declarations.', text);
    return undefined;
  }
  const order = value.tuple;
  const valid = type === 'tuple' && Array.isArray(order) && order.every((entry) => typeof entry === 'string') &&
    new Set(order).size === order.length && properties !== undefined && order.length === Object.keys(properties).length &&
    order.every((name) => Object.prototype.hasOwnProperty.call(properties, name));
  if (!valid) {
    pushKeywordDiagnostic(diagnostics, uri, `${pointer}/tuple`, 'tuple must list every tuple property exactly once.', text);
    return undefined;
  }
  return order as string[];
}

function binaryAnnotationsProjection(pointer: string, value: Record<string, unknown>, type: string | undefined, uri: string, text: string, diagnostics: Diagnostic[]) {
  if (type !== 'binary') {
    for (const keyword of ['contentEncoding', 'contentCompression', 'contentMediaType'] as const) {
      if (value[keyword] !== undefined) pushKeywordDiagnostic(diagnostics, uri, `${pointer}/${keyword}`, `${keyword} has an invalid value or placement.`, text);
    }
    return undefined;
  }
  const projection: { contentEncoding: { explicit?: string; effective: string }; contentCompression?: string; contentMediaType?: string } = {
    contentEncoding: { effective: 'base64' }
  };
  const read = (keyword: 'contentCompression' | 'contentMediaType', valid: (candidate: unknown) => candidate is string): void => {
    const candidate = value[keyword];
    if (candidate === undefined) return;
    if (valid(candidate)) projection[keyword] = candidate;
    else pushKeywordDiagnostic(diagnostics, uri, `${pointer}/${keyword}`, `${keyword} has an invalid value or placement.`, text);
  };
  const contentEncoding = value.contentEncoding;
  if (contentEncoding !== undefined) {
    if (typeof contentEncoding === 'string' && ['base64', 'base64url', 'base16', 'base32', 'base32hex'].includes(contentEncoding)) {
      projection.contentEncoding = { explicit: contentEncoding, effective: contentEncoding };
    } else {
      pushKeywordDiagnostic(diagnostics, uri, `${pointer}/contentEncoding`, 'contentEncoding has an invalid value or placement.', text);
    }
  }
  read('contentCompression', (candidate): candidate is string => typeof candidate === 'string' && ['gzip', 'deflate', 'zlib', 'brotli'].includes(candidate));
  read('contentMediaType', (candidate): candidate is string => typeof candidate === 'string' && mediaType(candidate));
  return projection;
}

function isSchemaDeclaration(value: Record<string, unknown>): boolean {
  if (typeof value.type === 'string') return true;
  if (Array.isArray(value.type)) return true;
  return typeReference(value.type) !== undefined;
}

function mediaType(value: string): boolean {
  return /^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+(?:\s*;\s*[!#$%&'*+.^_`|~0-9A-Za-z-]+=(?:[!#$%&'*+.^_`|~0-9A-Za-z-]+|"[^"]*"))*$/.test(value);
}

function localTypeReferenceDiagnostics(pointer: string, value: Record<string, unknown>, uri: string, text: string, diagnostics: Diagnostic[]): void {
  const validate = (candidate: unknown, typePointer: string): void => {
    if (!isRecord(candidate) || !Object.prototype.hasOwnProperty.call(candidate, '$ref')) return;
    const reference = typeReference(candidate);
    if (reference === undefined || !validPointerFragment(reference)) {
      pushKeywordDiagnostic(diagnostics, uri, `${typePointer}/$ref`, '$ref is permitted in a type value with an optional string description and must be a valid JSON Pointer URI fragment.', text);
    }
  };
  if (Array.isArray(value.type)) {
    value.type.forEach((member, index) => validate(member, `${pointer}/type/${index}`));
  } else {
    validate(value.type, `${pointer}/type`);
  }
  if (pointer === '' && typeReference(value.type) !== undefined) {
    pushKeywordDiagnostic(diagnostics, uri, '/type', '$ref is not permitted inside the type of the root object.', text);
  }
}

function relationAndIdentityLocalDiagnostics(
  root: Record<string, unknown>,
  pointer: string,
  declaration: Record<string, unknown>,
  uri: string,
  text: string,
  diagnostics: Diagnostic[],
  nodes: readonly ModelNode[]
): void {
  const type = declaration.type;
  const hasIdentity = Object.prototype.hasOwnProperty.call(declaration, 'identity');
  const hasRelations = Object.prototype.hasOwnProperty.call(declaration, 'relations');
  const objectOrTuple = type === 'object' || type === 'tuple';

  if (hasIdentity && !objectOrTuple) {
    pushKeywordDiagnostic(diagnostics, uri, `${pointer}/identity`, 'identity is permitted only on object or tuple declarations.', text);
  }
  if (hasRelations && !objectOrTuple) {
    pushKeywordDiagnostic(diagnostics, uri, `${pointer}/relations`, 'relations is permitted only on object or tuple declarations.', text);
  }
  if (hasRelations && !isRecord(declaration.relations)) {
    pushKeywordDiagnostic(diagnostics, uri, `${pointer}/relations`, 'relations must be an object map of relation declarations.', text);
  }

  if (hasIdentity && objectOrTuple) {
    const identity = declaration.identity;
    if (!uniquePointer(nodes, `${pointer}/identity`) || !Array.isArray(identity) || identity.length === 0 || !identity.every((entry) => typeof entry === 'string' && entry.length > 0)) {
      pushKeywordDiagnostic(diagnostics, uri, `${pointer}/identity`, 'identity must be a non-empty array of property names.', text);
    } else {
      if (new Set(identity).size !== identity.length) {
        pushKeywordDiagnostic(diagnostics, uri, `${pointer}/identity`, 'identity must not contain duplicate property names.', text);
      }
      if (declaration.properties && isRecord(declaration.properties)) {
        for (const [index, key] of identity.entries()) {
          if (!Object.prototype.hasOwnProperty.call(declaration.properties, key) || !uniquePointer(nodes, `${pointer}/properties/${pointerPart(key)}`)) {
            pushKeywordDiagnostic(diagnostics, uri, `${pointer}/identity/${index}`, `identity references unknown property '${key}'.`, text);
          }
        }
      } else {
        pushKeywordDiagnostic(diagnostics, uri, `${pointer}/identity`, 'identity requires a properties map on the same declaration.', text);
      }
    }
  }

  if (hasRelations && isRecord(declaration.relations)) {
    const relationNames = Object.keys(declaration.relations);
    const properties = declaration.properties;
    if (isRecord(properties)) {
      for (const relationName of relationNames) {
        if (Object.prototype.hasOwnProperty.call(properties, relationName)) {
          pushKeywordDiagnostic(
            diagnostics,
            uri,
            `${pointer}/relations/${pointerPart(relationName)}`,
            `relation name '${relationName}' collides with a property name in the same declaration.`,
            text
          );
        }
      }
    }
    for (const relationName of relationNames) {
      if (!IDENTIFIER.test(relationName)) {
        pushKeywordDiagnostic(diagnostics, uri, `${pointer}/relations/${pointerPart(relationName)}`, `relation name '${relationName}' is not a valid identifier.`, text);
      }
      const relation = declaration.relations[relationName];
      if (!isRecord(relation)) continue;
      const relationPointer = `${pointer}/relations/${pointerPart(relationName)}`;
      const targetRef = typeReference(relation.targettype);
      if (typeof targetRef === 'string' && targetRef.startsWith('#/')) {
        const targetPointer = targetRef.slice(1);
        const target = pointerAtRoot(root, targetPointer);
        if (target !== undefined && uniquePointerPath(nodes, targetPointer) &&
            (!reusableTypePointer(root, targetPointer, nodes) || !localIdentityValid(target, targetPointer, nodes))) {
          pushKeywordDiagnostic(diagnostics, uri, `${relationPointer}/targettype/$ref`, 'targettype must reference a reusable object or tuple declaration with a locally valid identity.', text);
        }
      }
      const qualifierRef = relation.qualifiertype === undefined ? undefined : typeReference(relation.qualifiertype);
      if (typeof qualifierRef === 'string' && qualifierRef.startsWith('#/')) {
        const qualifier = pointerAtRoot(root, qualifierRef.slice(1));
        if (qualifier !== undefined && !reusableTypePointer(root, qualifierRef.slice(1), nodes)) {
          pushKeywordDiagnostic(diagnostics, uri, `${relationPointer}/qualifiertype/$ref`, 'qualifiertype references a local declaration path that does not resolve.', text);
        }
      }
      if (relation.scope !== undefined) {
        const scopes = typeof relation.scope === 'string' ? [relation.scope] : Array.isArray(relation.scope) ? relation.scope : [];
        for (const [index, scope] of scopes.entries()) {
          if (typeof scope !== 'string') continue;
          const path = Array.isArray(relation.scope) ? `${relationPointer}/scope/${index}` : `${relationPointer}/scope`;
          if (typeof targetRef !== 'string' || !scopeCollectionCompatible(root, scope, targetRef, nodes)) {
            pushKeywordDiagnostic(diagnostics, uri, path, 'scope must resolve to an array, set, or map whose items or values are compatible with targettype.', text);
          }
        }
      }
    }
  }
}
function pointerAtRoot(root: unknown, pointer: string): unknown {
  const parts = pointer.split('/').filter((part) => part.length > 0).map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current: unknown = root;
  for (const part of parts) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}
function uniquePointer(nodes: readonly ModelNode[], pointer: string): boolean {
  return nodes.filter((node) => node.pointer === pointer).length === 1;
}
function uniquePointerPath(nodes: readonly ModelNode[], pointer: string): boolean {
  if (pointer === '') return uniquePointer(nodes, '');
  const segments = pointer.slice(1).split('/');
  return segments.every((_, index) => uniquePointer(nodes, `/${segments.slice(0, index + 1).join('/')}`));
}
function isTypeDeclaration(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && (typeof value.type === 'string' || typeReference(value.type) !== undefined);
}
function reusableTypePointer(root: Record<string, unknown>, pointer: string, nodes: readonly ModelNode[]): boolean {
  if (!pointer.startsWith('/definitions/') || !uniquePointerPath(nodes, pointer)) return false;
  const parts = pointer.slice('/definitions/'.length).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current: unknown = root.definitions;
  if (!isRecord(current)) return false;
  for (let index = 0; index < parts.length; index++) {
    current = current[parts[index]];
    if (!isRecord(current) || (index < parts.length - 1 && isTypeDeclaration(current))) return false;
  }
  return isTypeDeclaration(current);
}
function localIdentityValid(value: unknown, pointer: string, nodes: readonly ModelNode[]): boolean {
  if (!isRecord(value) || (value.type !== 'object' && value.type !== 'tuple') || !uniquePointer(nodes, `${pointer}/identity`)) return false;
  if (!Array.isArray(value.identity) || value.identity.length === 0 || new Set(value.identity).size !== value.identity.length || !isRecord(value.properties)) return false;
  return value.identity.every((entry) => typeof entry === 'string' && Object.prototype.hasOwnProperty.call(value.properties, entry) &&
    uniquePointer(nodes, `${pointer}/properties/${pointerPart(entry)}`));
}
function schemaReference(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeReference(value.type);
}
function referenceCompatible(root: Record<string, unknown>, candidate: string, target: string, seen = new Set<string>()): boolean {
  if (candidate === target) return true;
  if (!candidate.startsWith('#/') || !target.startsWith('#/') || seen.has(candidate)) return false;
  seen.add(candidate);
  const declaration = pointerAtRoot(root, candidate.slice(1));
  if (!isRecord(declaration)) return false;
  const bases = typeof declaration.$extends === 'string' ? [declaration.$extends] : Array.isArray(declaration.$extends) ? declaration.$extends : [];
  return bases.some((base) => typeof base === 'string' && referenceCompatible(root, base, target, seen));
}
function collectionCompatible(root: Record<string, unknown>, value: unknown, targetRef: string): boolean {
  if (!isRecord(value) || !['array', 'set', 'map'].includes(String(value.type))) return false;
  const memberRef = schemaReference(value.type === 'map' ? value.values : value.items);
  return memberRef !== undefined && referenceCompatible(root, memberRef, targetRef);
}
function scopeCollectionCompatible(root: Record<string, unknown>, scope: string, targetRef: string, nodes: readonly ModelNode[]): boolean {
  if (scope === '#') {
    const rootPointer = typeof root.$root === 'string' ? decodePointerFragment(root.$root) : undefined;
    if (Object.prototype.hasOwnProperty.call(root, 'type') || rootPointer === undefined) return false;
    return reusableTypePointer(root, rootPointer, nodes) && collectionCompatible(root, pointerAtRoot(root, rootPointer), targetRef);
  }
  if (!scope.startsWith('#/') || !uniquePointerPath(nodes, scope.slice(1))) return false;
  return collectionCompatible(root, pointerAtRoot(root, scope.slice(1)), targetRef);
}
function importPlacementDiagnostics(
  root: Record<string, unknown>,
  pointer: string,
  namespace: Record<string, unknown>,
  uri: string,
  text: string,
  diagnostics: Diagnostic[],
  nodes: readonly ModelNode[]
): void {
  const importPresent = Object.prototype.hasOwnProperty.call(namespace, '$import');
  const importDefsPresent = Object.prototype.hasOwnProperty.call(namespace, '$importdefs');
  if (!importPresent && !importDefsPresent) return;
  const allowed = namespacePointer(root, pointer, nodes);
  if (!allowed) {
    if (importPresent) pushKeywordDiagnostic(diagnostics, uri, `${pointer}/$import`, '$import is only permitted at document root or namespace definitions locations.', text);
    if (importDefsPresent) pushKeywordDiagnostic(diagnostics, uri, `${pointer}/$importdefs`, '$importdefs is only permitted at document root or namespace definitions locations.', text);
  }
}
function namespacePointer(root: Record<string, unknown>, pointer: string, nodes: readonly ModelNode[]): boolean {
  if (pointer === '') return true;
  if (pointer === '/definitions') return isRecord(root.definitions) && uniquePointerPath(nodes, pointer);
  if (!pointer.startsWith('/definitions/') || !uniquePointerPath(nodes, pointer)) return false;
  const parts = pointer.slice('/definitions/'.length).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current: unknown = root.definitions;
  if (!isRecord(current)) return false;
  for (const part of parts) {
    current = current[part];
    if (!isRecord(current) || isTypeDeclaration(current)) return false;
  }
  return true;
}
function typeReference(value: unknown): string | undefined {
  return isRecord(value) && hasOnlyKeys(value, ['$ref', 'description']) && typeof value.$ref === 'string' &&
    (value.description === undefined || typeof value.description === 'string') ? value.$ref : undefined;
}
function validPointerFragment(value: string): boolean {
  if (!value.startsWith('#/')) return false;
  try {
    const decoded = decodeURIComponent(value.slice(1));
    return decoded.startsWith('/') && !/~(?:[^01]|$)/.test(decoded);
  } catch {
    return false;
  }
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
  root: Record<string, unknown>,
  pointer: string,
  value: Record<string, unknown>,
  uri: string,
  text: string,
  diagnostics: Diagnostic[],
  nodes: readonly ModelNode[]
): ValidationProjection | undefined {
  const invalid = new Set<ValidationKeyword>();
  for (const issue of validationIssues(value, effectiveValidationTypes(root, value))) {
    invalid.add(issue.keyword);
    pushKeywordDiagnostic(diagnostics, uri, `${pointer}/${pointerPart(issue.keyword)}`, issue.message, text);
  }
  const projection: Record<string, unknown> = {};
  for (const keyword of VALIDATION_KEYWORDS) {
    const keywordPointer = `${pointer}/${pointerPart(keyword)}`;
    if (nodes.filter((node) => node.pointer === keywordPointer).length > 1) invalid.add(keyword);
    if (!invalid.has(keyword) && Object.prototype.hasOwnProperty.call(value, keyword)) projection[keyword] = value[keyword];
  }
  if (!invalid.has('contains') && Object.prototype.hasOwnProperty.call(value, 'contains')) {
    projection.effectiveMinContains = {
      ...(Object.prototype.hasOwnProperty.call(value, 'minContains') && !invalid.has('minContains') ? { explicit: value.minContains as number } : {}),
      effective: !invalid.has('minContains') && typeof value.minContains === 'number' ? value.minContains : 1
    };
  }
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
function asString(value: unknown, pointer: string, keyword: string, uri: string, text: string, diagnostics: Diagnostic[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  pushKeywordDiagnostic(diagnostics, uri, pointer, `${keyword} must be a string.`, text);
  return undefined;
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

function hasAnyKey<T extends object>(value: T): boolean {
  return Object.values(value).some((entry) => entry !== undefined);
}

const NUMERIC_TYPES = new Set([
  'number', 'integer', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32',
  'int64', 'uint64', 'int128', 'uint128', 'float8', 'float', 'double', 'decimal'
]);
const CORE_TYPES = new Set([
  'string', 'number', 'integer', 'boolean', 'null',
  'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'int128', 'uint128',
  'float8', 'float', 'double', 'decimal', 'date', 'datetime', 'time', 'duration', 'uuid', 'uri', 'binary', 'jsonpointer',
  'object', 'array', 'map', 'set', 'tuple', 'any', 'choice'
]);

function validCoreTypeValue(value: unknown): boolean {
  if (typeof value === 'string') return CORE_TYPES.has(value);
  if (typeReference(value) !== undefined) return true;
  return Array.isArray(value) && value.length > 0 && value.every((member) =>
    typeof member === 'string' ? CORE_TYPES.has(member) : validCoreUnionObjectMember(member));
}

function validCoreUnionObjectMember(value: unknown): boolean {
  if (typeReference(value) !== undefined) return true;
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if ((value.type === 'array' || value.type === 'set') && isRecord(value.items)) return validCoreTypeValue(value.items.type);
  return value.type === 'map' && isRecord(value.values) && validCoreTypeValue(value.values.type);
}

function declarationType(value: Record<string, unknown>): string | undefined {
  if (typeof value.type === 'string') return value.type;
  if (typeReference(value.type) !== undefined) return '$ref';
  if (Array.isArray(value.type)) return '$union';
  return undefined;
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

function coreForm(value: Record<string, unknown>): 'typed' | 'unknown' {
  if (typeof value.type === 'string' || Array.isArray(value.type) || typeReference(value.type) !== undefined) return 'typed';
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
  if (Array.isArray(type)) return 'union';
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

function collectReferenceProjections(root: Record<string, unknown>, references: ReferenceProjection[]): void {
  const seen = new Set<string>();
  const push = (entry: ReferenceProjection): void => {
    const key = `${entry.kind}|${entry.pointer}|${entry.target}`;
    if (seen.has(key)) return;
    seen.add(key);
    references.push(entry);
  };

  const visitSchema = (candidate: unknown, currentPointer: string): void => {
    if (!isRecord(candidate)) return;

    if (typeof candidate.$root === 'string' && currentPointer === '') {
      push({ pointer: '/$root', target: candidate.$root, kind: 'root' });
    }
    if (typeof candidate.$extends === 'string') {
      push({ pointer: `${currentPointer}/$extends`, target: candidate.$extends, kind: 'extends' });
    } else if (Array.isArray(candidate.$extends)) {
      candidate.$extends.forEach((entry, index) => {
        if (typeof entry === 'string') push({ pointer: `${currentPointer}/$extends/${index}`, target: entry, kind: 'extends' });
      });
    }
    if (typeReference(candidate.type) !== undefined) {
      push({ pointer: `${currentPointer}/type/$ref`, target: (candidate.type as Record<string, unknown>).$ref as string, kind: 'ref' });
    } else if (Array.isArray(candidate.type)) {
      candidate.type.forEach((member, index) => {
        const reference = typeReference(member);
        if (reference !== undefined) push({ pointer: `${currentPointer}/type/${index}/$ref`, target: reference, kind: 'ref' });
        else if (isRecord(member)) visitSchema(member, `${currentPointer}/type/${index}`);
      });
    }
    if (isRecord(candidate.relations)) {
      for (const [name, relation] of Object.entries(candidate.relations)) {
        if (!isRecord(relation)) continue;
        const relationPointer = `${currentPointer}/relations/${pointerPart(name)}`;
        const target = typeReference(relation.targettype);
        const qualifier = typeReference(relation.qualifiertype);
        if (target !== undefined) push({ pointer: `${relationPointer}/targettype/$ref`, target, kind: 'ref' });
        if (qualifier !== undefined) push({ pointer: `${relationPointer}/qualifiertype/$ref`, target: qualifier, kind: 'ref' });
      }
    }
    visitDefinitions(candidate.definitions, `${currentPointer}/definitions`);
    visitSchemaMap(candidate.properties, `${currentPointer}/properties`);
    if (isRecord(candidate.additionalProperties)) visitSchema(candidate.additionalProperties, `${currentPointer}/additionalProperties`);
    visitSchemaValue(candidate.items, `${currentPointer}/items`);
    visitSchemaValue(candidate.values, `${currentPointer}/values`);
    visitSchemaMap(candidate.choices, `${currentPointer}/choices`);
    visitSchemaValue(candidate.contains, `${currentPointer}/contains`);
    visitSchemaValue(candidate.propertyNames, `${currentPointer}/propertyNames`);
    visitSchemaValue(candidate.keyNames, `${currentPointer}/keyNames`);
    visitSchemaValue(candidate.has, `${currentPointer}/has`);
    visitSchemaMap(candidate.patternProperties, `${currentPointer}/patternProperties`);
    visitSchemaMap(candidate.patternKeys, `${currentPointer}/patternKeys`);
    visitSchemaArray(candidate.allOf, `${currentPointer}/allOf`);
    visitSchemaArray(candidate.anyOf, `${currentPointer}/anyOf`);
    visitSchemaArray(candidate.oneOf, `${currentPointer}/oneOf`);
    visitSchemaValue(candidate.not, `${currentPointer}/not`);
    visitSchemaValue(candidate.if, `${currentPointer}/if`);
    visitSchemaValue(candidate.then, `${currentPointer}/then`);
    visitSchemaValue(candidate.else, `${currentPointer}/else`);
  };
  const visitDefinitions = (candidate: unknown, pointer: string): void => {
    if (!isRecord(candidate)) return;
    for (const [key, entry] of Object.entries(candidate)) {
      if (key === '$import' || key === '$importdefs' || !isRecord(entry)) continue;
      const entryPointer = `${pointer}/${pointerPart(key)}`;
      if (looksLikeSchemaObject(entry)) visitSchema(entry, entryPointer);
      else visitDefinitions(entry, entryPointer);
    }
  };
  const visitSchemaMap = (candidate: unknown, pointer: string): void => {
    if (!isRecord(candidate)) return;
    for (const [key, entry] of Object.entries(candidate)) visitSchema(entry, `${pointer}/${pointerPart(key)}`);
  };
  const visitSchemaArray = (candidate: unknown, pointer: string): void => {
    if (Array.isArray(candidate)) candidate.forEach((entry, index) => visitSchema(entry, `${pointer}/${index}`));
  };
  const visitSchemaValue = (candidate: unknown, pointer: string): void => {
    if (Array.isArray(candidate)) visitSchemaArray(candidate, pointer);
    else visitSchema(candidate, pointer);
  };
  visitSchema(root, '');
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

function decodePointerFragment(value: string): string | undefined {
  if (value === '#') return '';
  if (!value.startsWith('#')) return undefined;
  try {
    const decoded = decodeURIComponent(value.slice(1));
    return decoded.startsWith('/') && !/~(?:[^01]|$)/.test(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}
