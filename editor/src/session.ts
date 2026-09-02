import type { Diagnostic, DocumentSnapshot, RecoveryState } from './contracts.js';
import type { NormalizedDocument } from './model.js';
import {
  coreScalarValueValid,
  deeplyUniqueJsonValues,
  effectiveCorePrimitiveType,
  parseDocument,
  semanticAnnotationBindingsValid,
  type ParseResult
} from './parser.js';
import { resolveCapabilities, type CapabilityResolution } from './capabilities.js';
import { resolveDocumentReferences, type ExternalDocumentInput } from './resolver.js';
import { ResolvedSchemaContext, type ResolvedSchemaDocument, type ResolvedSchemaLocation } from './phase4/resolved-schema.js';
import { resolveEffectiveMembers } from './phase4/effective-members.js';

/**
 * API for document session.
 */
export class DocumentSession {
  private documentUri: string;
  private lastValid?: { model: NormalizedDocument; value: unknown };
  private current: DocumentSnapshot;
  private parsedValue?: unknown;
  private externalDocuments: readonly ExternalDocumentInput[] = [];
  constructor(uri: string, text: string, documentVersion = 1) { this.documentUri = uri; this.current = this.update(text, documentVersion); }
  get uri(): string { return this.documentUri; }
  setUri(uri: string): DocumentSnapshot {
    if (uri === this.documentUri) return this.current;
    this.documentUri = uri;
    this.externalDocuments = [];
    this.lastValid = undefined;
    return this.update(this.current.text, this.current.documentVersion);
  }
  update(text: string, documentVersion: number): DocumentSnapshot {
    const result: ParseResult = parseDocument(this.uri, text);
    this.parsedValue = result.value;
    const referenceResolvedModel = result.model ? resolveDocumentReferences(result.model, this.externalDocuments) : undefined;
    const inheritanceDiagnostics = referenceResolvedModel && isRecord(result.value)
      ? resolvedCoreDiagnostics(result.value, referenceResolvedModel, this.resolvedSchemaDocuments, result.diagnostics)
      : [];
    const resolvedModel = referenceResolvedModel && inheritanceDiagnostics.length > 0
      ? {
          ...referenceResolvedModel,
          projections: {
            ...referenceResolvedModel.projections,
            diagnostics: [
              ...referenceResolvedModel.projections.diagnostics,
              ...inheritanceDiagnostics.map((diagnostic) => ({
                code: diagnostic.code,
                severity: diagnostic.severity,
                pointer: diagnostic.location?.pointer
              }))
            ]
          }
        }
      : referenceResolvedModel;
    if (resolvedModel && result.recovery === 'valid') this.lastValid = { model: resolvedModel, value: result.value };
    const recovery: RecoveryState = result.recovery;
    this.current = { uri: this.uri, text, documentVersion, recovery, diagnostics: [...result.diagnostics, ...inheritanceDiagnostics], model: resolvedModel ?? this.lastValid?.model };
    return this.current;
  }
  setExternalDocuments(documents: readonly ExternalDocumentInput[]): DocumentSnapshot {
    this.externalDocuments = documents.map(normalizeExternalDocument);
    return this.update(this.current.text, this.current.documentVersion);
  }
  snapshot(): DocumentSnapshot { return this.current; }
  get value(): unknown { return this.parsedValue ?? this.lastValid?.value; }
  get model(): NormalizedDocument | undefined { return this.current.model; }
  get resolvedSchemaDocuments(): readonly ResolvedSchemaDocument[] {
    return this.externalDocuments.flatMap((input) => {
      if ('availability' in input && input.availability !== undefined && input.availability !== 'available') return [];
      if ('value' in input && 'model' in input && input.model?.recovery === 'valid' && isRecord(input.value) &&
          !input.model.projections.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
        return [{ uri: input.uri, document: input.value }];
      }
      return [];
    });
  }
  get effectiveDeclarations(): readonly ResolvedSchemaLocation[] {
    return this.value && typeof this.value === 'object' && !Array.isArray(this.value)
      ? new ResolvedSchemaContext(this.value as Readonly<Record<string, unknown>>, { documentUri: this.uri, resolvedDocuments: this.resolvedSchemaDocuments }).declarations()
      : [];
  }
  get capabilities(): CapabilityResolution { return resolveCapabilities(this.value); }
  get diagnostics(): readonly Diagnostic[] { return this.current.diagnostics; }
}

function normalizeExternalDocument(input: ExternalDocumentInput): ExternalDocumentInput {
  if (!('value' in input) || input.availability === 'unavailable' || input.availability === 'stale' || !isRecord(input.value)) return input;
  try {
    const parsed = parseDocument(input.uri, JSON.stringify(input.value));
    if (!parsed.model || parsed.recovery !== 'valid' || parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error') || !isRecord(parsed.value)) {
      return { ...input, model: undefined, availability: 'stale' };
    }
    return { ...input, model: parsed.model, value: parsed.value, availability: 'available' };
  } catch {
    return { ...input, model: undefined, availability: 'stale' };
  }
}

function resolvedCoreDiagnostics(
  root: Readonly<Record<string, unknown>>,
  model: NormalizedDocument,
  resolvedDocuments: readonly ResolvedSchemaDocument[],
  parserDiagnostics: readonly Diagnostic[]
): Diagnostic[] {
  const context = new ResolvedSchemaContext(root, { documentUri: model.uri, resolvedDocuments });
  const existing = new Set([
    ...parserDiagnostics.map((diagnostic) => `${diagnostic.code}|${diagnostic.location?.pointer ?? ''}`),
    ...model.projections.diagnostics.map((diagnostic) => `${diagnostic.code}|${diagnostic.pointer ?? ''}`)
  ]);
  const diagnostics: Diagnostic[] = [];
  const add = (code: string, pointer: string, message: string): void => {
    const key = `${code}|${pointer}`;
    if (existing.has(key)) return;
    existing.add(key);
    const node = model.nodes.find((candidate) => candidate.pointer === pointer);
    diagnostics.push({
      code,
      message,
      severity: 'error',
      location: { uri: model.uri, pointer, range: node?.range }
    });
  };

  for (const reference of model.projections.references) {
    if (reference.kind === 'extends') continue;
    const target = context.resolve(reference.target);
    if (target?.schema.abstract === true) {
      add('core.declaration-invalid', reference.pointer, 'Abstract declarations may only be used as inheritance bases.');
    }
  }

  for (const projection of model.projections.definitions) {
    const declaration = pointerValue(root, projection.pointer);
    if (!isRecord(declaration)) continue;
    const references = typeof declaration.$extends === 'string'
      ? [declaration.$extends]
      : stringArray(declaration.$extends);
    if (references.length === 0) continue;

    const inheritedNames = new Set<string>();
    for (const [index, reference] of references.entries()) {
      const base = context.resolve(reference);
      if (!base) continue;
      const referencePointer = references.length === 1
        ? `${projection.pointer}/$extends`
        : `${projection.pointer}/$extends/${index}`;
      const compatible = declaration.type === 'choice' ? base.schema.type === 'object' : base.schema.type === declaration.type;
      if (base.schema.abstract !== true || !compatible) {
        add('core.declaration-invalid', referencePointer, '$extends must reference a compatible abstract object or tuple declaration.');
      }
      for (const name of inheritedPropertyNames(context, base, new Set())) inheritedNames.add(name);
    }

    if (!isRecord(declaration.properties)) continue;
    for (const name of Object.keys(declaration.properties)) {
      if (inheritedNames.has(name)) {
        add('core.declaration-invalid', `${projection.pointer}/properties/${escapePointerPart(name)}`, `Property '${name}' redefines an inherited property.`);
      }
    }
  }

  const locations = context.declarations();
  const resolveReference = (reference: string, from?: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> | undefined => {
    const owner = from === root ? undefined : locations.find((location) => location.schema === from);
    return context.resolve(reference, owner?.documentUri ?? context.rootUri)?.schema;
  };
  for (const projection of model.projections.definitions) {
    const declaration = pointerValue(root, projection.pointer);
    if (!isRecord(declaration)) continue;
    const primitive = effectiveCorePrimitiveType(declaration, resolveReference);
    if (primitive.determinate && Object.prototype.hasOwnProperty.call(declaration, 'enum') &&
        (primitive.type === undefined || !Array.isArray(declaration.enum) || declaration.enum.length === 0 ||
         !deeplyUniqueJsonValues(declaration.enum) || !declaration.enum.every((value) => coreScalarValueValid(primitive.type!, value, declaration)))) {
      add('core.declaration-invalid', `${projection.pointer}/enum`, 'enum requires a primitive type and a non-empty array of deeply unique values in that Core type value space.');
    }
    if (primitive.determinate && Object.prototype.hasOwnProperty.call(declaration, 'const') &&
        (primitive.type === undefined || !coreScalarValueValid(primitive.type, declaration.const, declaration))) {
      add('core.declaration-invalid', `${projection.pointer}/const`, 'const requires a primitive type and a value in that Core type value space.');
    }
    if (primitive.determinate && Object.prototype.hasOwnProperty.call(declaration, 'maxLength') && primitive.type !== 'string') {
      add('core.declaration-invalid', `${projection.pointer}/maxLength`, 'maxLength requires a string declaration and a non-negative integer value.');
    }
  }

  const capabilities = resolveCapabilities(root);
  if (capabilities.semanticAnnotationsActive) {
    addResolvedSemanticDiagnostics(root, model, resolvedDocuments, resolveReference, add);
  }
  if (capabilities.relationsActive) {
    addResolvedRelationDiagnostics(root, model, context, add);
  }
  return diagnostics;
}

function addResolvedRelationDiagnostics(
  root: Readonly<Record<string, unknown>>,
  model: NormalizedDocument,
  context: ResolvedSchemaContext,
  add: (code: string, pointer: string, message: string) => void
): void {
  for (const projection of model.projections.definitions) {
    const declaration = pointerValue(root, projection.pointer);
    if (!isRecord(declaration)) continue;
    const reference = projection.pointer === '' ? '#' : `#${projection.pointer}`;
    const propertyNames = context.effectivePropertyNames(reference);
    const relationNames = context.effectiveRelationNames(reference);
    if (propertyNames && relationNames) {
      for (const name of propertyNames) {
        if (!relationNames.has(name)) continue;
        const pointer = isRecord(declaration.relations) && Object.prototype.hasOwnProperty.call(declaration.relations, name)
          ? `${projection.pointer}/relations/${escapePointerPart(name)}`
          : isRecord(declaration.properties) && Object.prototype.hasOwnProperty.call(declaration.properties, name)
            ? `${projection.pointer}/properties/${escapePointerPart(name)}`
            : `${projection.pointer}/$extends`;
        add('json.keyword-invalid', pointer, `Effective property and relation name '${name}' collide.`);
      }
    }
    if (!isRecord(declaration.relations)) continue;
    for (const [name, relation] of Object.entries(declaration.relations)) {
      if (!isRecord(relation) || !isRecord(relation.targettype) || typeof relation.targettype.$ref !== 'string') continue;
      const targetReference = relation.targettype.$ref;
      if (!context.resolve(targetReference)) continue;
      const scopes = typeof relation.scope === 'string'
        ? [relation.scope]
        : Array.isArray(relation.scope) && relation.scope.every((scope) => typeof scope === 'string') ? relation.scope : [];
      for (const [index, scope] of scopes.entries()) {
        const scopeReference = scope === '#' && typeof root.$root === 'string' ? root.$root : scope;
        if (scopeReference === '#' || !context.resolveSchema(scopeReference)) continue;
        if (!context.collectionAccepts(scopeReference, targetReference)) {
          const relationPointer = `${projection.pointer}/relations/${escapePointerPart(name)}/scope`;
          const pointer = scopes.length === 1 ? relationPointer : `${relationPointer}/${index}`;
          add('json.keyword-invalid', pointer, 'scope must resolve to a collection whose items or values are the effective target type or a subtype.');
        }
      }
    }
  }
}

function addResolvedSemanticDiagnostics(
  root: Readonly<Record<string, unknown>>,
  model: NormalizedDocument,
  resolvedDocuments: readonly ResolvedSchemaDocument[],
  resolveReference: (reference: string, from?: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>> | undefined,
  add: (code: string, pointer: string, message: string) => void
): void {
  const bindingKeywords = [
    'temporalReferenceSystem', 'coordinateReferenceSystem', 'vectorReferenceFrames', 'tensorReferenceFrames',
    'frameTransforms', 'linearReferenceSystem', 'colorSpaces', 'audioChannels', 'spectralBands'
  ] as const;
  const singletonRoles = new Set([
    'phenomenonTime', 'resultTime', 'effectiveTime', 'phenomenonTimeStart', 'phenomenonTimeEnd',
    'effectiveTimeStart', 'effectiveTimeEnd', 'ingestionTime', 'scheduledTime', 'actualTime',
    'forecastIssueTime', 'forecastLeadDuration'
  ]);
  for (const projection of model.projections.definitions) {
    const declaration = pointerValue(root, projection.pointer);
    if (!isRecord(declaration)) continue;
    for (const keyword of bindingKeywords) {
      if (!Object.prototype.hasOwnProperty.call(declaration, keyword)) continue;
      const isolated = { ...declaration };
      for (const other of bindingKeywords) if (other !== keyword) delete isolated[other];
      if (!semanticAnnotationBindingsValid(isolated, root, resolveReference)) {
        add('json.keyword-invalid', `${projection.pointer}/${keyword}`, `${keyword} references members that are not part of the resolved effective declaration.`);
      }
    }
    if (declaration.type !== 'object' && declaration.type !== 'tuple') continue;
    const effective = resolveEffectiveMembers(root, `#${projection.pointer}`, { documentUri: model.uri, resolvedDocuments });
    if (effective.status !== 'resolved') continue;
    const byRole = new Map<string, typeof effective.members>();
    for (const member of effective.members) {
      const role = typeof member.schema.semanticRole === 'string' ? member.schema.semanticRole : undefined;
      if (!role || !singletonRoles.has(role)) continue;
      byRole.set(role, [...(byRole.get(role) ?? []), member]);
    }
    for (const [role, members] of byRole) {
      if (members.length < 2) continue;
      const localMembers = members.filter((member) => member.documentUri === model.uri);
      if (localMembers.length > 0) {
        for (const member of localMembers) add('json.keyword-invalid', `${member.declaredAt}/semanticRole`, `${role} may occur only once among effective sibling properties.`);
      } else {
        add('json.keyword-invalid', `${projection.pointer}/$extends`, `${role} occurs more than once among inherited effective properties.`);
      }
    }
  }
}

function inheritedPropertyNames(
  context: ResolvedSchemaContext,
  location: ResolvedSchemaLocation,
  seen: ReadonlySet<string>
): Set<string> {
  const identity = `${location.documentUri}#${location.sourcePointer}`;
  if (seen.has(identity)) return new Set();
  const nextSeen = new Set(seen).add(identity);
  const names = isRecord(location.schema.properties) ? new Set(Object.keys(location.schema.properties)) : new Set<string>();
  const references = typeof location.schema.$extends === 'string'
    ? [location.schema.$extends]
    : stringArray(location.schema.$extends);
  for (const reference of references) {
    const base = context.resolve(reference, location.documentUri);
    if (!base) continue;
    for (const name of inheritedPropertyNames(context, base, nextSeen)) names.add(name);
  }
  return names;
}

function pointerValue(root: unknown, pointer: string): unknown {
  if (pointer === '') return root;
  return pointer.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~')).reduce<unknown>((value, part) =>
    isRecord(value) ? value[part] : undefined, root);
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : [];
}

function escapePointerPart(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
