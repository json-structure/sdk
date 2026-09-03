import type { Diagnostic, DocumentSnapshot, RecoveryState, TextEdit } from './contracts.js';
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

const MAX_SESSION_HISTORY_ENTRIES = 128;

/** A reversible text transition owned by a document session. */
export interface SessionHistoryEntry {
  readonly beforeText: string;
  readonly afterText: string;
  readonly beforeVersion: number;
  readonly afterVersion: number;
}

/**
 * API for document session.
 */
export class DocumentSession {
  private documentUri: string;
  private lastValid?: { model: NormalizedDocument; value: unknown };
  private current: DocumentSnapshot;
  private parsedValue?: unknown;
  private history: SessionHistoryEntry[] = [];
  private historyIndex = 0;
  private savedBytes: string;

  private externalDocuments: readonly ExternalDocumentInput[] = [];
  constructor(uri: string, text: string, documentVersion = 1) { this.documentUri = uri; this.savedBytes = text; this.current = this.update(text, documentVersion); }
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
  /** Whether the current text differs byte-for-byte from the saved text. */
  get dirty(): boolean { return this.current.text !== this.savedBytes; }
  /** Whether a local design/source transition can be undone. */
  get canUndo(): boolean { return this.historyIndex > 0; }
  /** Whether an undone local transition can be redone. */
  get canRedo(): boolean { return this.historyIndex < this.history.length; }
  /** The saved bytes used by dirty tracking. */
  get savedText(): string { return this.savedBytes; }
  /** Clears local undo history when a host replaces the open document. */
  clearHistory(markCurrentSaved = false): DocumentSnapshot {
    this.history = [];
    this.historyIndex = 0;
    if (markCurrentSaved) this.savedBytes = this.current.text;
    return this.current;
  }
  /** Marks the supplied bytes (or current text) as clean without changing the document. */
  markSaved(text = this.current.text): DocumentSnapshot { if (text === this.current.text) this.savedBytes = text; return this.current; }
  /** Alias used by source-editor hosts when Monaco text equals saved bytes. */
  markClean(text = this.current.text): DocumentSnapshot { return this.markSaved(text); }
  /**
   * Commits a complete text transition and records it for session undo/redo.
   * Host adapters can use this after an optimistic apply has been confirmed.
   */
  commitText(text: string, documentVersion = this.current.documentVersion + 1): DocumentSnapshot {
    if (text === this.current.text) return this.current;
    const entry: SessionHistoryEntry = { beforeText: this.current.text, afterText: text, beforeVersion: this.current.documentVersion, afterVersion: documentVersion };
    this.history = this.history.slice(0, this.historyIndex);
    this.history.push(entry);
    this.historyIndex += 1;
    if (this.history.length > MAX_SESSION_HISTORY_ENTRIES) {
      this.history.shift();
      this.historyIndex -= 1;
    }
    return this.update(text, documentVersion);
  }
  /** Applies offset-based edits and records one reversible design transition. */
  applyTextEdits(edits: readonly TextEdit[], documentVersion = this.current.documentVersion + 1): DocumentSnapshot {
    const source = this.current.text;
    const positioned = edits.map((edit, index) => {
      const start = edit.range.startOffset;
      const end = edit.range.endOffset;
      if (start === undefined || end === undefined) throw new Error('Edit source range is unavailable.');
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > source.length) throw new Error('Edit source range is invalid.');
      if (typeof edit.newText !== 'string') throw new Error('Edit replacement text is invalid.');
      return { edit, index, start, end };
    }).sort((left, right) => left.start - right.start || left.end - right.end || left.index - right.index);
    const normalized: typeof positioned = [];
    for (const current of positioned) {
      const previous = normalized.at(-1);
      if (previous) {
        const overlaps = previous.start < current.end && current.start < previous.end;
        if (overlaps) throw new Error('Overlapping text edits are not supported.');
        if (previous.start === previous.end && current.start === current.end && previous.start === current.start) {
          normalized[normalized.length - 1] = {
            ...previous,
            edit: { ...previous.edit, newText: previous.edit.newText + current.edit.newText }
          };
          continue;
        }
      }
      normalized.push(current);
    }
    const text = [...normalized]
      .sort((left, right) => right.start - left.start || right.end - left.end || right.index - left.index)
      .reduce((value, current) => value.slice(0, current.start) + current.edit.newText + value.slice(current.end), source);
    return this.commitText(text, documentVersion);
  }
  /** Reverts the most recent local transition, if one exists. */
  undo(): DocumentSnapshot {
    if (!this.canUndo) return this.current;
    const entry = this.history[this.historyIndex - 1]!;
    this.historyIndex -= 1;
    return this.update(entry.beforeText, this.current.documentVersion + 1);
  }
  /** Reapplies the next local transition, if one exists. */
  redo(): DocumentSnapshot {
    if (!this.canRedo) return this.current;
    const entry = this.history[this.historyIndex]!;
    this.historyIndex += 1;
    return this.update(entry.afterText, this.current.documentVersion + 1);
  }
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
