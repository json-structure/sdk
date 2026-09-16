import { SchemaLocationIndex, type PointerTransformation } from './schema-locations.js';
import type { DocumentVersion, TextEdit, TextRange } from './contracts.js';
import type { DocumentSession } from './session.js';
import {
  compositionArrayValueValid,
  compositionSchemaValueValid,
  conditionalCompositionGroupValid,
  type CompositionArrayKeyword,
  type CompositionKeywordMap,
  type ConditionalBranchKeyword,
  type ConditionalCompositionGroup
} from './composition.js';
import {
  coreScalarValueValid,
  deeplyUniqueJsonValues,
  effectiveCorePrimitiveType,
  parseDocument,
  rangeFor,
  SEMANTIC_ANNOTATION_KEYWORDS,
  semanticAnnotationCandidateValid,
  semanticAnnotationSetValid,
  type SemanticAnnotationKeyword,
  type SemanticAnnotationKeywordMap
} from './parser.js';
import { effectiveValidationTypes, VALIDATION_KEYWORDS, validationIssues, validationValueIsSchemaBacked, type ValidationKeyword, type ValidationKeywordMap } from './validation.js';
import { unitsValueValid, type UnitsKeyword, type UnitsKeywordMap } from './units.js';
import { alternateNamesPlacementValid, alternateNamesValueValid, type AlternateNamesKeyword, type AlternateNamesKeywordMap } from './alternate-names.js';
import { ResolvedSchemaContext } from './phase4/resolved-schema.js';
import { isImportUriReference } from './import-uri.js';

/**
 * Type alias for schema type value.
 */
export type SchemaTypeValue = string | Readonly<Record<string, unknown>> | readonly (string | Readonly<Record<string, unknown>>)[];
/**
 * Defines the property schema shape.
 */
export interface PropertySchema { readonly type: SchemaTypeValue; readonly [keyword: string]: unknown; }
/**
 * Type alias for required properties.
 */
export type RequiredProperties = readonly string[] | readonly (readonly string[])[];
/**
 * Defines the binary annotations shape.
 */
export interface BinaryAnnotations {
  readonly contentEncoding?: 'base64' | 'base64url' | 'base16' | 'base32' | 'base32hex';
  readonly contentCompression?: 'gzip' | 'deflate' | 'zlib' | 'brotli';
  readonly contentMediaType?: string;
}
/**
 * Type alias for binary annotation keyword.
 */
export type BinaryAnnotationKeyword = keyof BinaryAnnotations;
/**
 * Type alias for relation cardinality.
 */
export type RelationCardinality = 'single' | 'multiple';
/**
 * Type alias for relation scope.
 */
export type RelationScope = string | readonly string[];
/**
 * Type alias for import keyword.
 */
export type ImportKeyword = '$import' | '$importdefs';
/**
 * Defines the relation schema shape.
 */
export interface RelationSchema {
  readonly targetTypeRef: string;
  readonly cardinality: RelationCardinality;
  readonly scope?: RelationScope;
  readonly qualifierTypeRef?: string;
}
/**
 * Defines the command result shape.
 */
export interface CommandResult { readonly edits: readonly TextEdit[]; readonly inverseEdits: readonly TextEdit[]; readonly pointerTransforms?: readonly PointerTransformation[]; }
/**
 * Defines the command context shape.
 */
export interface CommandContext { readonly session: DocumentSession; readonly documentVersion: DocumentVersion; }
/**
 * Defines the editor command shape.
 */
export interface EditorCommand { canExecute(context: CommandContext): boolean; execute(context: CommandContext): CommandResult; }
function pointerValue(root: unknown, pointer: string): unknown {
  if (pointer === '') return root;
  return pointer.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~')).reduce<unknown>((value, part) => value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined, root);
}
function objectRange(session: DocumentSession, pointer: string): TextRange | undefined {
  const node = session.model?.nodes.find((candidate) => candidate.pointer === pointer);
  return node?.range;
}
function propertyContext(session: DocumentSession, propertyPointer: string): {
  owner: Record<string, unknown>; properties: Record<string, unknown>; propertyName: string; keyRange: TextRange; valueRange: TextRange;
} | undefined {
  const split = propertyPointer.lastIndexOf('/');
  if (split < 0) return undefined;
  const propertiesPointer = propertyPointer.slice(0, split);
  if (propertiesPointer === '' || !propertiesPointer.endsWith('/properties')) return undefined;
  const ownerPointer = propertiesPointer.slice(0, -'/properties'.length);
  const owner = pointerValue(session.value, ownerPointer);
  const properties = pointerValue(session.value, propertiesPointer);
  const propertyName = decodePointerPart(propertyPointer.slice(split + 1));
  const nodes = session.model?.nodes.filter((candidate) => candidate.pointer === propertyPointer) ?? [];
  const node = nodes[0];
  if (!owner || typeof owner !== 'object' || Array.isArray(owner) || !properties || typeof properties !== 'object' || Array.isArray(properties) ||
      !Object.prototype.hasOwnProperty.call(properties, propertyName) || !hasUniquePointerPath(session, propertyPointer) || nodes.length !== 1 || !node?.keyRange || !node.range) return undefined;
  return { owner: owner as Record<string, unknown>, properties: properties as Record<string, unknown>, propertyName, keyRange: node.keyRange, valueRange: node.range };
}
function choiceContext(session: DocumentSession, choicePointer: string): {
  ownerPointer: string; owner: Record<string, unknown>; choices: Record<string, unknown>; choiceName: string; keyRange: TextRange; valueRange: TextRange;
} | undefined {
  const split = choicePointer.lastIndexOf('/');
  if (split < 0) return undefined;
  const choicesPointer = choicePointer.slice(0, split);
  if (choicesPointer === '' || !choicesPointer.endsWith('/choices')) return undefined;
  const ownerPointer = choicesPointer.slice(0, -'/choices'.length);
  const owner = pointerValue(session.value, ownerPointer);
  const choices = pointerValue(session.value, choicesPointer);
  const choiceName = decodePointerPart(choicePointer.slice(split + 1));
  const nodes = session.model?.nodes.filter((candidate) => candidate.pointer === choicePointer) ?? [];
  const node = nodes[0];
  if (!isObjectLike(owner) || owner.type !== 'choice' || !isObjectLike(choices) ||
    !Object.prototype.hasOwnProperty.call(choices, choiceName) || !hasUniquePointerPath(session, choicePointer) ||
    hasDuplicatePointerDiagnostic(session, choicePointer) || nodes.length !== 1 || !node?.keyRange || !node.range) return undefined;
  return { ownerPointer, owner, choices, choiceName, keyRange: node.keyRange, valueRange: node.range };
}
function hasUniquePointerPath(session: DocumentSession, pointer: string): boolean {
  if (pointer === '') return session.model?.nodes.filter((candidate) => candidate.pointer === '').length === 1;
  const segments = pointer.slice(1).split('/');
  for (let length = 1; length <= segments.length; length++) {
    const ancestor = `/${segments.slice(0, length).join('/')}`;
    if (session.model?.nodes.filter((candidate) => candidate.pointer === ancestor).length !== 1) return false;
  }
  return true;
}
function hasDuplicatePointerDiagnostic(session: DocumentSession, pointer: string): boolean {
  return session.snapshot().diagnostics.some((diagnostic) => diagnostic.code === 'json.duplicate-pointer' && diagnostic.location?.pointer === pointer);
}
function schemaOwnedReferencePointers(session: DocumentSession): ReadonlySet<string> {
  const pointers = new Set((session.model?.projections.references ?? []).map((reference) => reference.pointer));
  const offers = pointerValue(session.value, '/$offers');
  if (isObjectLike(offers)) {
    for (const [name, value] of Object.entries(offers)) {
      const pointer = `/$offers/${encodePointerPart(name)}`;
      if (typeof value === 'string') pointers.add(pointer);
      else if (isStringArray(value)) value.forEach((_entry, index) => pointers.add(`${pointer}/${index}`));
    }
  }
  for (const definition of session.model?.projections.definitions ?? []) {
    for (const relation of definition.relations) {
      if (typeof relation.scope === 'string') pointers.add(`${relation.pointer}/scope`);
      else if (Array.isArray(relation.scope)) relation.scope.forEach((_entry, index) => pointers.add(`${relation.pointer}/scope/${index}`));
    }
  }
  return pointers;
}
function pointerReferenceMatches(value: string, pointer: string): boolean {
  const authored = value.startsWith('#') ? value.slice(1) : value;
  let normalized = authored;
  try { normalized = decodeURIComponent(authored); } catch { return false; }
  return normalized === pointer || normalized.startsWith(`${pointer}/`);
}
function rewritePointerReference(value: string, from: string, to: string): string {
  const prefix = value.startsWith('#') ? '#' : '';
  const authored = prefix ? value.slice(1) : value;
  let normalized = authored;
  try { normalized = decodeURIComponent(authored); } catch { return value; }
  return pointerReferenceMatches(value, from) ? `${prefix}${to}${normalized.slice(from.length)}` : value;
}
function referenceSites(session: DocumentSession, pointer: string, excludePointer?: string): readonly { readonly pointer: string; readonly range: TextRange; readonly value: string }[] {
  const excludedPrefix = excludePointer ? `${excludePointer}/` : undefined;
  const ownedPointers = schemaOwnedReferencePointers(session);
  return (session.model?.nodes ?? []).flatMap((node) => {
    if (!node.range || !ownedPointers.has(node.pointer) ||
      excludePointer && (node.pointer === excludePointer || node.pointer.startsWith(excludedPrefix!))) return [];
    const value = pointerValue(session.value, node.pointer);
    return typeof value === 'string' && pointerReferenceMatches(value, pointer)
      ? [{ pointer: node.pointer, range: node.range, value }]
      : [];
  });
}
function referenceRewriteEdits(session: DocumentSession, from: string, to: string, excludePointer?: string): readonly TextEdit[] {
  return referenceSites(session, from, excludePointer).map((site) => ({
    range: site.range,
    newText: JSON.stringify(rewritePointerReference(site.value, from, to))
  }));
}
function definitionsContext(session: DocumentSession, definitionPointer: string): {
  namespacePointer: string;
  definitionsPointer: string;
  definitions: Record<string, unknown>;
  definitionName: string;
  keyRange: TextRange;
  valueRange: TextRange;
} | undefined {
  const split = definitionPointer.lastIndexOf('/');
  if (split < 0) return undefined;
  const definitionsPointer = definitionPointer.slice(0, split);
  if (definitionsPointer === '' ||
    !definitionsPointer.endsWith('/definitions') && !namespaceImportPlacement(session, definitionsPointer)) return undefined;
  const namespacePointer = definitionsPointer.endsWith('/definitions')
    ? definitionsContextNamespace(definitionsPointer)
    : definitionsPointer;
  const definitions = pointerValue(session.value, definitionsPointer);
  const definitionName = decodePointerPart(definitionPointer.slice(split + 1));
  const nodes = session.model?.nodes.filter((candidate) => candidate.pointer === definitionPointer) ?? [];
  const node = nodes[0];
  if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions) ||
      !Object.prototype.hasOwnProperty.call(definitions, definitionName) ||
      !hasUniquePointerPath(session, definitionsPointer) || hasDuplicatePointerDiagnostic(session, definitionPointer) ||
      nodes.length !== 1 || !node?.keyRange || !node.range) return undefined;
  return { namespacePointer, definitionsPointer, definitions: definitions as Record<string, unknown>, definitionName, keyRange: node.keyRange, valueRange: node.range };
}
function definitionsContextNamespace(definitionsPointer: string): string {
  return definitionsPointer === '/definitions' ? '' : definitionsPointer.slice(0, -'/definitions'.length);
}
function namespaceContext(session: DocumentSession, namespacePointer: string): {
  parentPointer: string;
  namespaceName: string;
  namespace: Record<string, unknown>;
  keyRange: TextRange;
  valueRange: TextRange;
} | undefined {
  if (!namespacePointer.startsWith('/definitions/')) return undefined;
  const split = namespacePointer.lastIndexOf('/');
  const parentPointer = namespacePointer.slice(0, split);
  const namespaceName = decodePointerPart(namespacePointer.slice(split + 1));
  const parent = pointerValue(session.value, parentPointer);
  const namespace = pointerValue(session.value, namespacePointer);
  const nodes = session.model?.nodes.filter((candidate) => candidate.pointer === namespacePointer) ?? [];
  const node = nodes[0];
  if (!isNamespaceObject(parent) || !isNamespaceObject(namespace) || isTypeDeclaration(namespace) ||
    !Object.prototype.hasOwnProperty.call(parent, namespaceName) || !hasUniquePointerPath(session, namespacePointer) ||
    hasDuplicatePointerDiagnostic(session, namespacePointer) || nodes.length !== 1 || !node?.keyRange || !node.range) return undefined;
  return { parentPointer, namespaceName, namespace, keyRange: node.keyRange, valueRange: node.range };
}
function namespaceContainsDeclarations(namespace: Record<string, unknown>): boolean {
  return Object.entries(namespace).some(([key, value]) => {
    if (key === 'definitions') return isObjectLike(value) && Object.keys(value).length > 0;
    return key === '$import' || key === '$importdefs' || isObjectLike(value);
  });
}
function isNamespaceObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}
function definitionReferenceSites(session: DocumentSession, definitionPointer: string): string[] {
  return referenceSites(session, definitionPointer, definitionPointer).map((site) => site.pointer);
}
function canSetRoot(session: DocumentSession, rootPointer: string): boolean {
  const root = pointerValue(session.value, '');
  const target = effectiveDeclarationForReference(session, `#${rootPointer}`)?.schema;
  return isObjectLike(root) && !Object.prototype.hasOwnProperty.call(root, 'type') &&
    (!Object.prototype.hasOwnProperty.call(root, '$root') || objectMemberContext(session, '', '$root') !== undefined) &&
    target !== undefined && target.abstract !== true;
}
function sourceOffsets(range: TextRange, message: string): { start: number; end: number } {
  if (range.startOffset === undefined || range.endOffset === undefined) throw new Error(message);
  return { start: range.startOffset, end: range.endOffset };
}

function applyTextEdits(source: string, edits: readonly TextEdit[]): string {
  return [...edits]
    .sort((left, right) => {
      const leftOffsets = sourceOffsets(left.range, 'Edit source range is unavailable.');
      const rightOffsets = sourceOffsets(right.range, 'Edit source range is unavailable.');
      return rightOffsets.start - leftOffsets.start || rightOffsets.end - leftOffsets.end;
    })
    .reduce((text, edit) => {
      const offsets = sourceOffsets(edit.range, 'Edit source range is unavailable.');
      return text.slice(0, offsets.start) + edit.newText + text.slice(offsets.end);
    }, source);
}

function commandResultForEdits(source: string, edits: readonly TextEdit[]): CommandResult {
  const positioned = edits.map((edit, index) => {
    const offsets = sourceOffsets(edit.range, 'Edit source range is unavailable.');
    if (!Number.isInteger(offsets.start) || !Number.isInteger(offsets.end) || offsets.start < 0 || offsets.end < offsets.start || offsets.end > source.length) throw new Error('Edit source range is invalid.');
    return { edit, index, offsets };
  }).sort((left, right) => left.offsets.start - right.offsets.start || left.offsets.end - right.offsets.end || left.index - right.index);
  const normalized: TextEdit[] = [];
  for (const current of positioned) {
    const previous = normalized.at(-1);
    const currentOffsets = current.offsets;
    if (previous) {
      const previousOffsets = sourceOffsets(previous.range, 'Edit source range is unavailable.');
      const overlaps = previousOffsets.start < currentOffsets.end && currentOffsets.start < previousOffsets.end;
      if (overlaps) throw new Error('Overlapping text edits are not supported.');
      if (previousOffsets.start === previousOffsets.end && currentOffsets.start === currentOffsets.end && previousOffsets.start === currentOffsets.start) {
        normalized[normalized.length - 1] = { range: previous.range, newText: previous.newText + current.edit.newText };
        continue;
      }
    }
    normalized.push(current.edit);
  }
  const ascending = normalized;
  const changed = applyTextEdits(source, ascending);
  let delta = 0;
  const inverseEdits = ascending.map((edit) => {
    const offsets = sourceOffsets(edit.range, 'Edit source range is unavailable.');
    const start = offsets.start + delta;
    const oldText = source.slice(offsets.start, offsets.end);
    delta += edit.newText.length - oldText.length;
    return { range: rangeFor(changed, start, start + edit.newText.length), newText: oldText };
  });
  const mergedInverseEdits: TextEdit[] = [];
  for (const edit of inverseEdits) {
    const previous = mergedInverseEdits.at(-1);
    if (previous && previous.range.startOffset === edit.range.startOffset) {
      const end = Math.max(previous.range.endOffset!, edit.range.endOffset!);
      mergedInverseEdits[mergedInverseEdits.length - 1] = {
        range: rangeFor(changed, edit.range.startOffset!, end),
        newText: previous.newText + edit.newText
      };
    } else mergedInverseEdits.push(edit);
  }
  return { edits: ascending, inverseEdits: mergedInverseEdits };
}

function namespaceContentPointer(namespacePointer: string): string {
  return namespacePointer === '' || namespacePointer === '/definitions' ? '/definitions' : namespacePointer;
}
function isObjectLike(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function isObjectOrTupleDeclaration(value: Record<string, unknown>): boolean {
  return value.type === 'object' || value.type === 'tuple';
}
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CORE_TYPES = new Set([
  'any', 'string', 'number', 'integer', 'boolean', 'null',
  'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'int128', 'uint128',
  'float8', 'float', 'double', 'decimal', 'date', 'datetime', 'time', 'duration', 'uuid', 'uri', 'binary', 'jsonpointer',
  'object', 'array', 'map', 'set', 'tuple', 'choice'
]);
export const CORE_DOCUMENT_MEMBERS = [
  '$schema', '$id', 'name', 'description', '$uses', '$offers', '$root', 'definitions', 'type', 'enum', 'const',
  'abstract', '$extends', 'properties', 'required', 'additionalProperties', 'items', 'values', 'tuple', 'choices',
  'selector', 'precision', 'scale', 'maxLength'
] as const;
export type CoreDocumentMember = typeof CORE_DOCUMENT_MEMBERS[number];
const CORE_DOCUMENT_MEMBER_SET = new Set<string>(CORE_DOCUMENT_MEMBERS);
const REQUIRED_DOCUMENT_HEADERS = new Set(['$schema', '$id', 'name']);
const COLLECTION_TYPE_NAMES = new Set(['array', 'set', 'map']);

function isTypeDeclaration(value: unknown): value is Record<string, unknown> {
  return isObjectLike(value) && validTypeValue(value.type);
}

function typeReferenceValue(value: unknown): string | undefined {
  return isObjectLike(value) && Object.keys(value).every((key) => key === '$ref' || key === 'description') &&
    typeof value.$ref === 'string' && validPointerFragment(value.$ref) &&
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

function validTypeValue(value: unknown): boolean {
  if (typeof value === 'string') return CORE_TYPES.has(value);
  if (typeReferenceValue(value) !== undefined) return true;
  return Array.isArray(value) && value.length > 0 &&
    new Set(value.map((member) => JSON.stringify(member))).size === value.length &&
    value.every((member) => typeof member === 'string' ? CORE_TYPES.has(member) : validUnionObjectMember(member));
}

function validUnionObjectMember(value: unknown): boolean {
  if (typeReferenceValue(value) !== undefined) return true;
  if (!isObjectLike(value) || typeof value.type !== 'string') return false;
  if ((value.type === 'array' || value.type === 'set') && isObjectLike(value.items)) return validTypeValue(value.items.type);
  return value.type === 'map' && isObjectLike(value.values) && validTypeValue(value.values.type);
}

function reusableDeclarationPointer(session: DocumentSession, pointer: string): boolean {
  if (!pointer.startsWith('/definitions/')) return false;
  const parts = pointer.slice('/definitions/'.length).split('/').map(decodePointerPart);
  if (parts.length === 0 || parts.some((part) => part.length === 0)) return false;
  let current = pointerValue(session.value, '/definitions');
  if (!isObjectLike(current) || !resolvesUniquePointer(session, '/definitions')) return false;
  for (let index = 0; index < parts.length; index++) {
    current = current[parts[index]];
    const currentPointer = `/definitions/${parts.slice(0, index + 1).map(encodePointerPart).join('/')}`;
    if (!isObjectLike(current) || !resolvesUniquePointer(session, currentPointer)) return false;
    if (index < parts.length - 1 && isTypeDeclaration(current)) return false;
  }
  return isTypeDeclaration(current);
}

function namespaceImportPlacement(session: DocumentSession, pointer: string): boolean {
  if (pointer === '') return true;
  if (pointer === '/definitions') return isObjectLike(pointerValue(session.value, pointer)) && resolvesUniquePointer(session, pointer);
  if (!pointer.startsWith('/definitions/')) return false;
  const parts = pointer.slice('/definitions/'.length).split('/').map(decodePointerPart);
  let current = pointerValue(session.value, '/definitions');
  if (!isObjectLike(current) || !resolvesUniquePointer(session, '/definitions')) return false;
  for (let index = 0; index < parts.length; index++) {
    current = current[parts[index]];
    const currentPointer = `/definitions/${parts.slice(0, index + 1).map(encodePointerPart).join('/')}`;
    if (!isObjectLike(current) || isTypeDeclaration(current) || !resolvesUniquePointer(session, currentPointer)) return false;
  }
  return true;
}
function encodePointerPart(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}
function objectMemberPointer(objectPointer: string, member: string): string {
  return `${objectPointer}/${encodePointerPart(member)}`;
}
function objectMemberContext(
  session: DocumentSession,
  objectPointer: string,
  memberName: string
): { memberPointer: string; keyRange: TextRange; valueRange: TextRange } | undefined {
  const memberPointer = objectMemberPointer(objectPointer, memberName);
  const nodes = session.model?.nodes.filter((candidate) => candidate.pointer === memberPointer) ?? [];
  const node = nodes[0];
  if (!hasUniquePointerPath(session, memberPointer) || hasDuplicatePointerDiagnostic(session, memberPointer) || nodes.length !== 1 || !node?.keyRange || !node.range) return undefined;
  return { memberPointer, keyRange: node.keyRange, valueRange: node.range };
}
function relationValue(schema: RelationSchema): Record<string, unknown> {
  return {
    targettype: { $ref: schema.targetTypeRef },
    cardinality: schema.cardinality,
    ...(schema.scope === undefined ? {} : { scope: schema.scope }),
    ...(schema.qualifierTypeRef === undefined ? {} : { qualifiertype: { $ref: schema.qualifierTypeRef } })
  };
}
function relationSchemaValid(schema: RelationSchema): boolean {
  if (!schema.targetTypeRef || !cardinalityValid(schema.cardinality)) return false;
  if (schema.scope !== undefined && !validRelationScope(schema.scope)) return false;
  if (schema.qualifierTypeRef !== undefined && schema.qualifierTypeRef.length === 0) return false;
  return true;
}
function cardinalityValid(value: unknown): value is RelationCardinality {
  return value === 'single' || value === 'multiple';
}
function relationScopeEntry(value: unknown): value is string {
  return typeof value === 'string' && (value === '#' || value.startsWith('#/'));
}
function validRelationScope(value: unknown): value is RelationScope {
  return relationScopeEntry(value) || (Array.isArray(value) && value.length > 0 && value.every(relationScopeEntry));
}
function absoluteUri(value: string): boolean {
  try {
    return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) && new URL(value).href.length > 0;
  } catch {
    return false;
  }
}
function isLocalPointerRef(value: string): boolean {
  return value.startsWith('#/');
}
function decodeLocalPointerFragment(value: string): string | undefined {
  if (!value.startsWith('#')) return undefined;
  try {
    const decoded = decodeURIComponent(value.slice(1));
    return decoded.startsWith('/') && !/~(?:[^01]|$)/.test(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}
function resolvesUniquePointer(session: DocumentSession, pointer: string): boolean {
  const direct = session.model?.nodes.filter((candidate) => candidate.pointer === pointer).length ?? 0;
  return direct === 1 && hasUniquePointerPath(session, pointer) && !hasDuplicatePointerDiagnostic(session, pointer);
}
function referenceResolvesLocally(session: DocumentSession, reference: string): boolean {
  return effectiveDeclarationForReference(session, reference) !== undefined;
}
function scopeResolvesLocally(session: DocumentSession, scope: RelationScope | undefined): boolean {
  if (scope === undefined) return true;
  const entries = typeof scope === 'string' ? [scope] : scope;
  const context = resolvedSchemaContext(session);
  return entries.every((entry) => effectiveScopeReference(session, entry) !== undefined &&
    context.resolveSchema(effectiveScopeReference(session, entry)!) !== undefined);
}
function localTargetTypeHasIdentity(session: DocumentSession, reference: string): boolean {
  const context = resolvedSchemaContext(session);
  const declaration = context.resolve(reference);
  const concrete = declaration && context.dereference(declaration);
  return !!concrete && concrete.schema.abstract !== true && isObjectOrTupleDeclaration(concrete.schema) &&
    context.effectiveIdentity(reference) !== undefined;
}
function localQualifierIsReusable(session: DocumentSession, reference: string): boolean {
  const declaration = effectiveDeclarationForReference(session, reference);
  return declaration !== undefined && declaration.schema.abstract !== true;
}
function relationTypeReference(value: unknown): string | undefined {
  return isObjectLike(value) && Object.keys(value).length === 1 && typeof value.$ref === 'string' ? value.$ref : undefined;
}
function relationScopeCompatible(session: DocumentSession, scope: RelationScope | undefined, targetRef: string): boolean {
  if (scope === undefined) return true;
  const entries = typeof scope === 'string' ? [scope] : scope;
  const context = resolvedSchemaContext(session);
  return entries.every((entry) => {
    const reference = effectiveScopeReference(session, entry);
    return reference !== undefined && context.collectionAccepts(reference, targetRef);
  });
}

function resolvedSchemaContext(session: DocumentSession): ResolvedSchemaContext {
  return new ResolvedSchemaContext(session.value as Readonly<Record<string, unknown>>, {
    documentUri: session.uri,
    resolvedDocuments: session.resolvedSchemaDocuments
  });
}

function effectiveScopeReference(session: DocumentSession, scope: string): string | undefined {
  if (scope !== '#') return isLocalPointerRef(scope) ? scope : undefined;
  const root = pointerValue(session.value, '');
  if (!isObjectLike(root) || Object.prototype.hasOwnProperty.call(root, 'type') || typeof root.$root !== 'string') return undefined;
  return decodeLocalPointerFragment(root.$root) === undefined ? undefined : root.$root;
}

function effectiveMemberNames(session: DocumentSession, pointer: string, keyword: 'properties' | 'relations'): ReadonlySet<string> {
  if (keyword === 'relations' && !session.capabilities.relationsActive) return new Set();
  const context = resolvedSchemaContext(session);
  const reference = pointer === '' ? '#' : `#${pointer}`;
  return (keyword === 'properties' ? context.effectivePropertyNames(reference) : context.effectiveRelationNames(reference)) ?? new Set();
}

function effectiveDeclarationForReference(session: DocumentSession, reference: string) {
  const pointer = decodeLocalPointerFragment(reference);
  if (pointer === undefined || !pointer.startsWith('/definitions/')) return undefined;
  const declaration = session.effectiveDeclarations.find((candidate) => candidate.effectivePointer === pointer);
  if (!declaration) return undefined;
  if (declaration.documentUri === session.uri && declaration.imports.length === 0 && !reusableDeclarationPointer(session, pointer)) return undefined;
  return declaration;
}
function concreteReusableReference(session: DocumentSession, reference: string): boolean {
  const target = effectiveDeclarationForReference(session, reference)?.schema;
  return target !== undefined && target.abstract !== true;
}
function rebaseImportedReference(
  location: ReturnType<typeof effectiveDeclarationForReference> extends infer T ? Exclude<T, undefined> : never,
  reference: string
): string {
  const pointer = decodeLocalPointerFragment(reference);
  if (pointer === undefined || !pointer.startsWith('/definitions/') || location.imports.length === 0 || !location.sourcePointer.startsWith('/definitions/')) return reference;
  const sourceSuffix = location.sourcePointer.slice('/definitions'.length);
  if (!location.effectivePointer.endsWith(sourceSuffix)) return reference;
  const destination = location.effectivePointer.slice(0, -sourceSuffix.length);
  return `#${destination}${pointer.slice('/definitions'.length)}`;
}
function effectiveReferenceResolver(session: DocumentSession) {
  return (reference: string, from?: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> | undefined => {
    const owner = from === undefined ? undefined : session.effectiveDeclarations.find((candidate) => candidate.schema === from);
    const effectiveReference = owner ? rebaseImportedReference(owner, reference) : reference;
    return effectiveDeclarationForReference(session, effectiveReference)?.schema;
  };
}
function coreValueMembersValid(session: DocumentSession, declaration: Readonly<Record<string, unknown>>): boolean {
  const primitive = effectiveCorePrimitiveType(declaration, effectiveReferenceResolver(session));
  if (Object.prototype.hasOwnProperty.call(declaration, 'enum')) {
    if (!Array.isArray(declaration.enum) || declaration.enum.length === 0 || !deeplyUniqueJsonValues(declaration.enum)) return false;
    if (!primitive.determinate || primitive.type === undefined || !declaration.enum.every((value) => coreScalarValueValid(primitive.type!, value, declaration))) return false;
  }
  if (Object.prototype.hasOwnProperty.call(declaration, 'const') &&
      (!primitive.determinate || primitive.type === undefined || !coreScalarValueValid(primitive.type, declaration.const, declaration))) return false;
  if (Object.prototype.hasOwnProperty.call(declaration, 'maxLength') &&
      (typeof declaration.maxLength !== 'number' || !Number.isInteger(declaration.maxLength) || declaration.maxLength < 0 ||
       primitive.determinate && primitive.type !== 'string')) return false;
  return true;
}
function inheritedPropertyNames(
  session: DocumentSession,
  references: readonly string[],
  seen = new Set<string>()
): Set<string> {
  const names = new Set<string>();
  for (const reference of references) {
    const location = effectiveDeclarationForReference(session, reference);
    if (!location || seen.has(location.effectivePointer)) continue;
    const nextSeen = new Set(seen).add(location.effectivePointer);
    if (isObjectLike(location.schema.properties)) for (const name of Object.keys(location.schema.properties)) names.add(name);
    const bases = typeof location.schema.$extends === 'string' ? [location.schema.$extends] :
      isStringArray(location.schema.$extends) ? location.schema.$extends : [];
    const rebased = bases.map((base) => rebaseImportedReference(location, base));
    for (const name of inheritedPropertyNames(session, rebased, nextSeen)) names.add(name);
  }
  return names;
}
function declarationInheritedPropertyNames(session: DocumentSession, declaration: Readonly<Record<string, unknown>>): Set<string> {
  const references = typeof declaration.$extends === 'string' ? [declaration.$extends] :
    isStringArray(declaration.$extends) ? declaration.$extends : [];
  return inheritedPropertyNames(session, references);
}
function inheritanceValueValid(session: DocumentSession, declaration: Readonly<Record<string, unknown>>, value: unknown): boolean {
  const references = typeof value === 'string' ? [value] : isStringArray(value) && value.length > 0 ? value : [];
  if (references.length === 0 || new Set(references).size !== references.length || !['object', 'tuple', 'choice'].includes(String(declaration.type))) return false;
  for (const reference of references) {
    const base = effectiveDeclarationForReference(session, reference)?.schema;
    if (!base || base.abstract !== true) return false;
    if (declaration.type === 'choice' ? base.type !== 'object' : base.type !== declaration.type) return false;
  }
  const inheritedNames = inheritedPropertyNames(session, references);
  return !isObjectLike(declaration.properties) || Object.keys(declaration.properties).every((name) => !inheritedNames.has(name));
}
function identityHasInboundRelation(session: DocumentSession, targetPointer: string): boolean {
  const root = session.value;
  if (!isObjectLike(root)) return true;
  const withoutIdentity = JSON.parse(JSON.stringify(root)) as Record<string, unknown>;
  const changedTarget = pointerValue(withoutIdentity, targetPointer);
  if (!isObjectLike(changedTarget)) return true;
  delete changedTarget.identity;
  const before = resolvedSchemaContext(session);
  const after = new ResolvedSchemaContext(withoutIdentity, {
    documentUri: session.uri,
    resolvedDocuments: session.resolvedSchemaDocuments
  });
  for (const schema of session.model?.projections.definitions ?? []) {
    const declaration = pointerValue(session.value, schema.pointer);
    if (!isObjectLike(declaration) || !isObjectOrTupleDeclaration(declaration) || !isObjectLike(declaration.relations)) continue;
    const relationsPointer = `${schema.pointer}/relations`;
    for (const [relationName, relation] of Object.entries(declaration.relations)) {
      if (!isObjectLike(relation)) continue;
      const targetTypePointer = `${relationsPointer}/${encodePointerPart(relationName)}/targettype`;
      if (!Object.prototype.hasOwnProperty.call(relation, 'targettype')) continue;
      if (!hasUniquePointerPath(session, targetTypePointer) || hasDuplicatePointerDiagnostic(session, targetTypePointer)) return true;
      const targetType = relation.targettype;
      if (!isObjectLike(targetType) || !Object.prototype.hasOwnProperty.call(targetType, '$ref')) continue;
      const referencePointer = `${targetTypePointer}/$ref`;
      if (!hasUniquePointerPath(session, referencePointer) || hasDuplicatePointerDiagnostic(session, referencePointer)) return true;
      const reference = pointerValue(session.value, referencePointer);
      if (typeof reference !== 'string') continue;
      const beforeIdentity = before.effectiveIdentity(reference);
      const afterIdentity = after.effectiveIdentity(reference);
      if (beforeIdentity !== undefined && JSON.stringify(beforeIdentity) !== JSON.stringify(afterIdentity)) return true;
    }
  }
  return false;
}
function relationOwnerContext(session: DocumentSession, ownerPointer: string): {
  owner: Record<string, unknown>;
  relations?: Record<string, unknown>;
  properties?: Record<string, unknown>;
} | undefined {
  const owner = pointerValue(session.value, ownerPointer);
  if (!isObjectLike(owner) || !isObjectOrTupleDeclaration(owner) || !hasUniquePointerPath(session, ownerPointer) || hasDuplicatePointerDiagnostic(session, ownerPointer)) return undefined;
  const relations = owner.relations;
  if (relations !== undefined && (!isObjectLike(relations) || !hasUniquePointerPath(session, `${ownerPointer}/relations`) || hasDuplicatePointerDiagnostic(session, `${ownerPointer}/relations`))) return undefined;
  const properties = owner.properties;
  if (properties !== undefined && (!isObjectLike(properties) || !hasUniquePointerPath(session, `${ownerPointer}/properties`) || hasDuplicatePointerDiagnostic(session, `${ownerPointer}/properties`))) return undefined;
  return { owner, relations: relations as Record<string, unknown> | undefined, properties: properties as Record<string, unknown> | undefined };
}
function relationContext(session: DocumentSession, relationPointer: string): {
  ownerPointer: string;
  relationName: string;
  owner: Record<string, unknown>;
  relations: Record<string, unknown>;
  keyRange: TextRange;
  valueRange: TextRange;
} | undefined {
  const split = relationPointer.lastIndexOf('/');
  if (split < 0) return undefined;
  const relationsPointer = relationPointer.slice(0, split);
  if (!relationsPointer.endsWith('/relations')) return undefined;
  const ownerPointer = relationsPointer.slice(0, -'/relations'.length);
  const relationName = decodePointerPart(relationPointer.slice(split + 1));
  const ownerContext = relationOwnerContext(session, ownerPointer);
  if (!ownerContext?.relations || !Object.prototype.hasOwnProperty.call(ownerContext.relations, relationName)) return undefined;
  const member = objectMemberContext(session, relationsPointer, relationName);
  if (!member || !isObjectLike(ownerContext.relations[relationName])) return undefined;
  return {
    ownerPointer,
    relationName,
    owner: ownerContext.owner,
    relations: ownerContext.relations,
    keyRange: member.keyRange,
    valueRange: member.valueRange
  };
}
function hasOtherImportKeyword(namespace: Record<string, unknown>, keyword: ImportKeyword): boolean {
  return keyword === '$import'
    ? Object.prototype.hasOwnProperty.call(namespace, '$importdefs')
    : Object.prototype.hasOwnProperty.call(namespace, '$import');
}
function deleteMemberCommandResult(source: string, containerRange: TextRange, keyRange: TextRange, valueRange: TextRange): CommandResult {
  const valueOffsets = sourceOffsets(valueRange, 'Member source range is unavailable.');
  const containerOffsets = sourceOffsets(containerRange, 'Container source range is unavailable.');
  const keyOffsets = sourceOffsets(keyRange, 'Member name source range is unavailable.');
  const keyStart = keyOffsets.start;
  if (keyStart <= containerOffsets.start) throw new Error('Member source range is unavailable.');

  let start = keyStart;
  let end = valueOffsets.end;
  let before = keyStart - 1;
  while (before > containerOffsets.start && /\s/.test(source[before] ?? '')) before--;
  if (source[before] === ',') start = before;
  else {
    let after = valueOffsets.end;
    while (after < containerOffsets.end && /\s/.test(source[after] ?? '')) after++;
    if (source[after] === ',') end = after + 1;
  }

  const oldText = source.slice(start, end);
  const edit: TextEdit = { range: rangeFor(source, start, end), newText: '' };
  const editedSource = source.slice(0, start) + source.slice(end);
  const inverse: TextEdit = { range: rangeFor(editedSource, start, start), newText: oldText };
  return { edits: [edit], inverseEdits: [inverse] };
}
function addMemberCommandResult(source: string, containerRange: TextRange, key: string, value: unknown): CommandResult {
  const offsets = sourceOffsets(containerRange, 'Container source range is unavailable.');
  const close = offsets.end - 1;
  const body = source.slice(offsets.start + 1, close);
  const multiline = body.includes('\n');
  const indent = multiline ? (body.match(/\n([ \t]*)\S/)?.[1] ?? '  ') : '';
  const entry = `"${escapeJson(key)}":${multiline ? ' ' : ''}${JSON.stringify(value)}`;
  const insertion = body.trim() === ''
    ? (multiline ? `\n${indent}${entry}\n${indent.slice(0, Math.max(0, indent.length - 2))}` : entry)
    : (multiline ? `,\n${indent}${entry}` : `,${entry}`);
  const edit: TextEdit = { range: rangeFor(source, close, close), newText: insertion };
  const editedSource = source.slice(0, close) + insertion + source.slice(close);
  const inverse: TextEdit = { range: rangeFor(editedSource, close, close + insertion.length), newText: '' };
  return { edits: [edit], inverseEdits: [inverse] };
}
function addMembersCommandResult(source: string, containerRange: TextRange, members: Readonly<Record<string, unknown>>): CommandResult {
  const offsets = sourceOffsets(containerRange, 'Container source range is unavailable.');
  const close = offsets.end - 1;
  const body = source.slice(offsets.start + 1, close);
  const multiline = body.includes('\n');
  const indent = multiline ? (body.match(/\n([ \t]*)\S/)?.[1] ?? '  ') : '';
  const entries = Object.entries(members).map(([key, value]) => `"${escapeJson(key)}":${multiline ? ' ' : ''}${JSON.stringify(value)}`);
  const joined = entries.join(multiline ? `,\n${indent}` : ',');
  const insertion = body.trim() === ''
    ? (multiline ? `\n${indent}${joined}\n${indent.slice(0, Math.max(0, indent.length - 2))}` : joined)
    : (multiline ? `,\n${indent}${joined}` : `,${joined}`);
  const edit: TextEdit = { range: rangeFor(source, close, close), newText: insertion };
  const editedSource = source.slice(0, close) + insertion + source.slice(close);
  const inverse: TextEdit = { range: rangeFor(editedSource, close, close + insertion.length), newText: '' };
  return { edits: [edit], inverseEdits: [inverse] };
}
function replaceMemberCommandResult(source: string, valueRange: TextRange, value: unknown): CommandResult {
  const offsets = sourceOffsets(valueRange, 'Member source range is unavailable.');
  const oldText = source.slice(offsets.start, offsets.end);
  const newText = JSON.stringify(value);
  const edit: TextEdit = { range: valueRange, newText };
  const editedSource = source.slice(0, offsets.start) + newText + source.slice(offsets.end);
  const inverse: TextEdit = { range: rangeFor(editedSource, offsets.start, offsets.start + newText.length), newText: oldText };
  return { edits: [edit], inverseEdits: [inverse] };
}
function setMemberCommandResult(session: DocumentSession, targetPointer: string, keyword: string, value: unknown): CommandResult {
  const source = session.snapshot().text;
  const member = objectMemberContext(session, targetPointer, keyword);
  if (member) return replaceMemberCommandResult(source, member.valueRange, value);
  const targetRange = objectRange(session, targetPointer);
  if (!targetRange) throw new Error('Target source range is unavailable.');
  return addMemberCommandResult(source, targetRange, keyword, value);
}
function removeMemberCommandResult(session: DocumentSession, targetPointer: string, keyword: string): CommandResult {
  const source = session.snapshot().text;
  const member = objectMemberContext(session, targetPointer, keyword);
  if (!member) return { edits: [], inverseEdits: [] };
  const targetRange = objectRange(session, targetPointer);
  if (!targetRange) throw new Error('Target source range is unavailable.');
  return deleteMemberCommandResult(source, targetRange, member.keyRange, member.valueRange);
}
const REMOVE_MEMBER = Symbol('remove-member');
type MemberMutation = unknown | typeof REMOVE_MEMBER;
function memberMutationEdits(session: DocumentSession, targetPointer: string, mutations: ReadonlyMap<string, MemberMutation>): readonly TextEdit[] {
  const source = session.snapshot().text;
  const edits: TextEdit[] = [];
  const additions: Record<string, unknown> = {};
  const removals: string[] = [];
  for (const [keyword, value] of mutations) {
    const member = objectMemberContext(session, targetPointer, keyword);
    if (value === REMOVE_MEMBER) {
      if (member) removals.push(keyword);
      continue;
    }
    if (member) edits.push({ range: member.valueRange, newText: JSON.stringify(value) });
    else additions[keyword] = value;
  }
  if (removals.length > 0) edits.push(...removeMembersCommandResult(session, targetPointer, removals).edits);
  if (Object.keys(additions).length > 0) {
    const targetRange = objectRange(session, targetPointer);
    if (!targetRange) throw new Error('Target source range is unavailable.');
    edits.push(...addMembersCommandResult(source, targetRange, additions).edits);
  }
  return edits;
}
function renamedPropertyList(value: unknown, oldName: string, newName: string | undefined): unknown {
  if (!Array.isArray(value)) return value;
  const rewritten = value.map((entry) => {
    if (Array.isArray(entry)) return entry.filter((name) => newName !== undefined || name !== oldName).map((name) => name === oldName ? newName : name);
    return entry === oldName ? newName : entry;
  }).filter((entry) => entry !== undefined);
  return value.every(Array.isArray) ? rewritten.filter((entry) => Array.isArray(entry) && entry.length > 0) : rewritten;
}
function rewriteStringArray(value: unknown, oldName: string, newName: string | undefined): unknown {
  if (!Array.isArray(value)) return value;
  const rewritten = value.flatMap((entry) => entry === oldName ? newName === undefined ? [] : [newName] : [entry]);
  return rewritten.length > 0 ? rewritten : undefined;
}
function rewritePropertyBoundAnnotation(keyword: string, value: unknown, oldName: string, newName: string | undefined): unknown {
  if (!isObjectLike(value) && !Array.isArray(value)) return value;
  const clone: unknown = JSON.parse(JSON.stringify(value));
  const rewriteScalar = (record: Record<string, unknown>, key: string, required = false): boolean => {
    if (record[key] !== oldName) return true;
    if (newName === undefined) {
      if (required) return false;
      delete record[key];
    } else record[key] = newName;
    return true;
  };
  const rewriteArray = (record: Record<string, unknown>, key: string, required = true): boolean => {
    if (!Array.isArray(record[key])) return true;
    const next = rewriteStringArray(record[key], oldName, newName);
    if (next === undefined) {
      if (required) return false;
      delete record[key];
    } else record[key] = next;
    return true;
  };
  if (keyword === 'temporalReferenceSystem' && isObjectLike(clone)) return rewriteScalar(clone, 'position', true) ? clone : undefined;
  if (keyword === 'coordinateReferenceSystem' && isObjectLike(clone)) return rewriteArray(clone, 'coordinates') ? clone : undefined;
  if (keyword === 'vectorReferenceFrames' && Array.isArray(clone)) {
    return clone.every((entry) => isObjectLike(entry) && rewriteArray(entry, 'components')) ? clone : undefined;
  }
  if (keyword === 'tensorReferenceFrames' && Array.isArray(clone)) {
    for (const frame of clone) {
      if (!isObjectLike(frame)) continue;
      if (frame.components === oldName) {
        if (newName === undefined) return undefined;
        frame.components = newName;
      } else if (Array.isArray(frame.components)) {
        const next = frame.components.filter((entry) => !(newName === undefined && isObjectLike(entry) && entry.property === oldName));
        for (const entry of next) if (isObjectLike(entry) && entry.property === oldName) entry.property = newName;
        if (next.length === 0) return undefined;
        frame.components = next;
      }
    }
    return clone;
  }
  if (keyword === 'frameTransforms' && Array.isArray(clone)) {
    for (const transform of clone) {
      if (!isObjectLike(transform)) continue;
      if (transform.components === oldName) {
        if (newName === undefined) return undefined;
        transform.components = newName;
      } else if (!rewriteArray(transform, 'components')) return undefined;
      if (!rewriteArray(transform, 'translation', false)) return undefined;
    }
    return clone;
  }
  if (keyword === 'linearReferenceSystem' && isObjectLike(clone)) {
    return ['linearElement', 'measure', 'measureEnd', 'direction'].every((key) => rewriteScalar(clone, key, key === 'linearElement' || key === 'measure')) ? clone : undefined;
  }
  if (keyword === 'colorSpaces' && Array.isArray(clone)) {
    return clone.every((entry) => isObjectLike(entry) && rewriteArray(entry, 'channels') && rewriteScalar(entry, 'alpha')) ? clone : undefined;
  }
  if (keyword === 'audioChannels' && Array.isArray(clone)) {
    return clone.every((entry) => isObjectLike(entry) && rewriteArray(entry, 'channels')) ? clone : undefined;
  }
  if (keyword === 'spectralBands' && Array.isArray(clone)) {
    return clone.every((entry) => isObjectLike(entry) && rewriteArray(entry, 'bands')) ? clone : undefined;
  }
  return value;
}
function propertyOwnerMutations(owner: Record<string, unknown>, oldName: string, newName: string | undefined): ReadonlyMap<string, MemberMutation> {
  const mutations = new Map<string, MemberMutation>();
  for (const keyword of ['required', 'identity', 'tuple'] as const) {
    if (!Object.prototype.hasOwnProperty.call(owner, keyword)) continue;
    const next = renamedPropertyList(owner[keyword], oldName, newName);
    if (JSON.stringify(next) !== JSON.stringify(owner[keyword])) mutations.set(keyword, Array.isArray(next) && next.length === 0 && keyword !== 'tuple' ? REMOVE_MEMBER : next);
  }
  if (isObjectLike(owner.dependentRequired)) {
    const next: Record<string, unknown> = {};
    for (const [name, required] of Object.entries(owner.dependentRequired)) {
      if (newName === undefined && name === oldName) continue;
      const key = name === oldName ? newName! : name;
      const rewritten = renamedPropertyList(required, oldName, newName);
      const unique = Array.isArray(rewritten) ? [...new Set(rewritten)] : rewritten;
      const existing = next[key];
      next[key] = Array.isArray(existing) && Array.isArray(unique)
        ? [...new Set([...existing, ...unique])]
        : unique;
    }
    if (JSON.stringify(next) !== JSON.stringify(owner.dependentRequired)) mutations.set('dependentRequired', Object.keys(next).length ? next : REMOVE_MEMBER);
  }
  for (const keyword of [
    'temporalReferenceSystem', 'coordinateReferenceSystem', 'vectorReferenceFrames', 'tensorReferenceFrames',
    'frameTransforms', 'linearReferenceSystem', 'colorSpaces', 'audioChannels', 'spectralBands'
  ]) {
    if (!Object.prototype.hasOwnProperty.call(owner, keyword)) continue;
    const next = rewritePropertyBoundAnnotation(keyword, owner[keyword], oldName, newName);
    if (JSON.stringify(next) !== JSON.stringify(owner[keyword])) mutations.set(keyword, next === undefined ? REMOVE_MEMBER : next);
  }
  return mutations;
}
function memberMutationsHaveSource(session: DocumentSession, targetPointer: string, mutations: ReadonlyMap<string, MemberMutation>): boolean {
  return [...mutations.keys()].every((keyword) =>
    !Object.prototype.hasOwnProperty.call(pointerValue(session.value, targetPointer) as Record<string, unknown>, keyword) ||
    objectMemberContext(session, targetPointer, keyword) !== undefined);
}
function scopeDeletionEdits(session: DocumentSession, deletedPointer: string): readonly TextEdit[] {
  const edits: TextEdit[] = [];
  const deletedSubtree = `${deletedPointer}/`;
  for (const node of session.model?.nodes ?? []) {
    if (!node.pointer.endsWith('/scope') || node.pointer === deletedPointer || node.pointer.startsWith(deletedSubtree) || !node.range) continue;
    const value = pointerValue(session.value, node.pointer);
    const values = typeof value === 'string' ? [value] : isStringArray(value) ? value : [];
    const next = values.filter((entry) => !pointerReferenceMatches(entry, deletedPointer));
    if (next.length === values.length) continue;
    const relationPointer = node.pointer.slice(0, -'/scope'.length);
    if (next.length === 0) edits.push(...removeMemberCommandResult(session, relationPointer, 'scope').edits);
    else edits.push({ range: node.range, newText: JSON.stringify(typeof value === 'string' ? next[0] : next) });
  }
  return edits;
}function removeMembersCommandResult(session: DocumentSession, targetPointer: string, keywords: readonly string[]): CommandResult {
  const source = session.snapshot().text;
  const targetRange = objectRange(session, targetPointer);
  if (!targetRange) throw new Error('Target source range is unavailable.');
  const targetOffsets = sourceOffsets(targetRange, 'Target source range is unavailable.');
  const selected = new Set(keywords);
  const members = (session.model?.nodes ?? [])
    .filter((node) => node.keyRange && node.range && node.pointer.lastIndexOf('/') === targetPointer.length)
    .map((node) => ({
      name: decodePointerPart(node.pointer.slice(targetPointer.length + 1)),
      keyStart: sourceOffsets(node.keyRange!, 'Member name source range is unavailable.').start,
      valueEnd: sourceOffsets(node.range!, 'Member source range is unavailable.').end
    }))
    .sort((left, right) => left.keyStart - right.keyStart);
  const edits: TextEdit[] = [];
  for (let index = 0; index < members.length;) {
    if (!selected.has(members[index].name)) { index++; continue; }
    const first = index;
    while (index + 1 < members.length && selected.has(members[index + 1].name)) index++;
    const last = index;
    const start = first > 0 ? members[first - 1].valueEnd : members[first].keyStart;
    const end = first > 0
      ? members[last].valueEnd
      : last + 1 < members.length ? members[last + 1].keyStart : targetOffsets.end - 1;
    edits.push({ range: rangeFor(source, start, end), newText: '' });
    index++;
  }
  const ascending = edits.map((edit) => ({ edit, offsets: sourceOffsets(edit.range, 'Member source range is unavailable.') }))
    .sort((left, right) => left.offsets.start - right.offsets.start);
  let removed = 0;
  const inverseEdits = ascending.map(({ offsets }) => {
    const start = offsets.start - removed;
    const oldText = source.slice(offsets.start, offsets.end);
    removed += offsets.end - offsets.start;
    return { range: rangeFor(source, start, start), newText: oldText };
  });
  return { edits, inverseEdits };
}
function editableDeclaration(session: DocumentSession, pointer: string): Record<string, unknown> | undefined {
  const value = pointerValue(session.value, pointer);
  return isObjectLike(value) && hasUniquePointerPath(session, pointer) && !hasDuplicatePointerDiagnostic(session, pointer) &&
    isTypeDeclaration(value) ? value : undefined;
}
function editableCoreObject(session: DocumentSession, pointer: string): Record<string, unknown> | undefined {
  const value = pointerValue(session.value, pointer);
  if (!isObjectLike(value) || !hasUniquePointerPath(session, pointer) || hasDuplicatePointerDiagnostic(session, pointer)) return undefined;
  if (pointer === '') return value;
  return editableCompositionTarget(session, pointer);
}
function coreMemberValueValid(keyword: CoreDocumentMember, value: unknown): boolean {
  switch (keyword) {
    case '$schema': case '$id': return typeof value === 'string' && absoluteUri(value);
    case 'name': return typeof value === 'string' && IDENTIFIER.test(value);
    case 'description': case 'selector': return typeof value === 'string';
    case '$uses': return isStringArray(value) && new Set(value).size === value.length;
    case '$offers': return isObjectLike(value) && Object.values(value).every((entry) =>
      typeof entry === 'string' && validPointerFragment(entry) ||
      isStringArray(entry) && entry.length > 0 && new Set(entry).size === entry.length && entry.every(validPointerFragment));
    case '$root': return typeof value === 'string' && validPointerFragment(value);
    case 'type': return validTypeValue(value);
    case 'abstract': return typeof value === 'boolean';
    case 'additionalProperties': return typeof value === 'boolean' || isObjectLike(value);
    case '$extends': return (typeof value === 'string' && value.length > 0) || (isStringArray(value) && value.length > 0);
    case 'required': return Array.isArray(value);
    case 'tuple': return isStringArray(value) && new Set(value).size === value.length;
    case 'precision': case 'scale': case 'maxLength': return Number.isInteger(value) && (value as number) >= 0;
    case 'definitions': case 'properties': case 'choices': return isObjectLike(value);
    case 'items': case 'values': return isObjectLike(value) && validTypeValue(value.type);
    case 'enum': return Array.isArray(value) && value.length > 0 && deeplyUniqueJsonValues(value);
    case 'const': return value !== undefined;
  }
}
function jsonValueValid(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => jsonValueValid(entry, seen))
    : Object.values(value).every((entry) => jsonValueValid(entry, seen));
  seen.delete(value);
  return valid;
}
function parserDiagnosticKey(diagnostic: { readonly code: string; readonly message: string; readonly location?: { readonly pointer: string } }): string {
  return `${diagnostic.code}\u0000${diagnostic.location?.pointer ?? ''}\u0000${diagnostic.message}`;
}
function definitionsValueValid(session: DocumentSession, value: unknown): boolean {
  const root = pointerValue(session.value, '');
  if (!isObjectLike(root) || !isObjectLike(value) || !jsonValueValid(value)) return false;
  const currentText = JSON.stringify(root);
  const candidateText = JSON.stringify({ ...root, definitions: value });
  if (currentText === undefined || candidateText === undefined) return false;
  const baseline = parseDocument(session.uri, currentText);
  const candidate = parseDocument(session.uri, candidateText);
  const baselineDiagnostics = new Set(baseline.diagnostics.map(parserDiagnosticKey));
  return candidate.recovery === 'valid' && candidate.diagnostics.every((diagnostic) => {
    const pointer = diagnostic.location?.pointer;
    return pointer !== '/definitions' && !pointer?.startsWith('/definitions/') && baselineDiagnostics.has(parserDiagnosticKey(diagnostic));
  });
}
function coreMemberPlacementValid(session: DocumentSession, pointer: string, keyword: CoreDocumentMember): boolean {
  if (['$schema', '$id', 'name', '$uses', '$offers', '$root'].includes(keyword)) return pointer === '';
  if (keyword === 'definitions') return namespaceImportPlacement(session, pointer);
  return pointer === '' || editableCompositionTarget(session, pointer) !== undefined;
}
const DECLARATION_STRUCTURE_MEMBERS = ['properties', 'required', 'additionalProperties', 'items', 'values', 'tuple', 'choices', 'selector'] as const;
const NUMERIC_DECLARATION_TYPES = new Set(['number', 'integer', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'int128', 'uint128', 'float8', 'float', 'double', 'decimal']);
function declarationAfterTypeMutation(session: DocumentSession, targetPointer: string, declaration: Readonly<Record<string, unknown>>, type: unknown): Record<string, unknown> {
  const next: Record<string, unknown> = { ...declaration, type };
  const oldType = typeof declaration.type === 'string' ? declaration.type : undefined;
  const newType = typeof type === 'string' ? type : undefined;
  for (const keyword of DECLARATION_STRUCTURE_MEMBERS) delete next[keyword];

  if (newType === 'object' || newType === 'tuple') {
    const properties = (oldType === 'object' || oldType === 'tuple') && isObjectLike(declaration.properties) ? declaration.properties : {};
    next.properties = properties;
    if (newType === 'object' && oldType === 'object' && declaration.required !== undefined) next.required = declaration.required;
    if (newType === 'object' && oldType === 'object' && declaration.additionalProperties !== undefined) next.additionalProperties = declaration.additionalProperties;
    if (newType === 'tuple') {
      const authoredOrder = oldType === 'tuple' && isStringArray(declaration.tuple) ? declaration.tuple : Object.keys(properties);
      next.tuple = authoredOrder.filter((name) => Object.prototype.hasOwnProperty.call(properties, name));
    }
  } else if (newType === 'array' || newType === 'set') {
    next.items = (oldType === 'array' || oldType === 'set') && isObjectLike(declaration.items) && validSchemaValue(session, declaration.items)
      ? declaration.items
      : { type: 'string' };
  } else if (newType === 'map') {
    next.values = oldType === 'map' && isObjectLike(declaration.values) && validSchemaValue(session, declaration.values)
      ? declaration.values
      : { type: 'string' };
  } else if (newType === 'choice') {
    next.choices = oldType === 'choice' && isObjectLike(declaration.choices) ? declaration.choices : {};
    if (oldType === 'choice' && typeof declaration.selector === 'string') next.selector = declaration.selector;
  }

  if (newType !== 'object' && newType !== 'tuple') {
    delete next.identity;
    delete next.relations;
    delete next.abstract;
  }
  if (oldType !== newType) delete next.$extends;
  if (newType !== 'number' && newType !== 'decimal') {
    delete next.precision;
    delete next.scale;
  }
  if (newType !== 'string') delete next.maxLength;
  if (!newType || !NUMERIC_DECLARATION_TYPES.has(newType)) {
    delete next.unit;
    delete next.ucumUnit;
  }
  if (newType !== 'binary') {
    delete next.contentEncoding;
    delete next.contentCompression;
    delete next.contentMediaType;
  }
  if (newType !== 'object' && newType !== 'tuple') {
    for (const keyword of ['coordinateReferenceSystem', 'vectorReferenceFrames', 'tensorReferenceFrames', 'frameTransforms', 'linearReferenceSystem', 'colorSpaces', 'audioChannels', 'spectralBands']) delete next[keyword];
    if (isObjectLike(next.temporalReferenceSystem) && typeof next.temporalReferenceSystem.position === 'string') delete next.temporalReferenceSystem;
  }

  const effectiveTypes = effectiveValidationTypes(pointerValue(session.value, ''), next);
  if (!effectiveTypes.determinate || effectiveTypes.types.length !== 1) {
    for (const keyword of VALIDATION_KEYWORDS) if (keyword !== 'default') delete next[keyword];
  } else {
    for (const issue of validationIssues(next, effectiveTypes)) delete next[issue.keyword];
  }
  const primitive = effectiveCorePrimitiveType(next, effectiveReferenceResolver(session));
  if (primitive.determinate && primitive.type !== undefined) {
    if (Array.isArray(next.enum) && !next.enum.every((value) => coreScalarValueValid(primitive.type!, value, next))) delete next.enum;
    if (Object.prototype.hasOwnProperty.call(next, 'const') && !coreScalarValueValid(primitive.type, next.const, next)) delete next.const;
  } else {
    delete next.enum;
    delete next.const;
  }
  if (Object.prototype.hasOwnProperty.call(next, 'altenums') &&
      (!Array.isArray(next.enum) || !alternateNamesValueValid(next, 'altenums', next.altenums, true))) delete next.altenums;
  for (const keyword of SEMANTIC_ANNOTATION_KEYWORDS) {
    if (Object.prototype.hasOwnProperty.call(next, keyword) && !semanticPlacementValid(session, targetPointer, next, keyword)) delete next[keyword];
  }
  return next;
}
function typeMutationCommandResult(session: DocumentSession, targetPointer: string, type: unknown): CommandResult {
  const declaration = editableCoreObject(session, targetPointer);
  if (!declaration) throw new Error('Declaration source range is unavailable.');
  const range = objectRange(session, targetPointer);
  if (!range) throw new Error('Declaration source range is unavailable.');
  return replaceMemberCommandResult(session.snapshot().text, range, declarationAfterTypeMutation(session, targetPointer, declaration, type));
}

/** Command that safely sets a supported Core declaration or document object member. */
export class SetCoreMemberCommand implements EditorCommand {
  constructor(readonly targetPointer: string, readonly keyword: CoreDocumentMember, readonly value: unknown) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid' || !CORE_DOCUMENT_MEMBER_SET.has(this.keyword)) return false;
    const target = editableCoreObject(session, this.targetPointer);
    if (!target || !coreMemberPlacementValid(session, this.targetPointer, this.keyword) || !coreMemberValueValid(this.keyword, this.value)) return false;
    if (this.keyword === 'definitions' && !definitionsValueValid(session, this.value)) return false;
    if (this.keyword === 'type' && typeof this.value === 'string' && COLLECTION_TYPE_NAMES.has(this.value) && isScalarCoreType(target.type)) return false;
    if ((this.keyword === 'properties' || this.keyword === 'choices') &&
      !Object.values(this.value as Record<string, unknown>).every((schema) => validSchemaValue(session, schema))) return false;
    if (this.keyword === 'properties' && Object.keys(this.value as Record<string, unknown>).some((name) => declarationInheritedPropertyNames(session, target).has(name))) return false;
    if ((this.keyword === 'items' || this.keyword === 'values') && !validSchemaValue(session, this.value)) return false;
    if (this.keyword === 'additionalProperties' && typeof this.value !== 'boolean' &&
      typeReferenceValue(this.value) === undefined && !validSchemaValue(session, this.value)) return false;
    if (this.keyword === 'type') {
      const references: string[] = [];
      const collect = (candidate: unknown): void => {
        const reference = typeReferenceValue(candidate);
        if (reference !== undefined) references.push(reference);
        else if (Array.isArray(candidate)) candidate.forEach(collect);
      };
      collect(this.value);
      if (!references.every((reference) => concreteReusableReference(session, reference))) return false;
      const desired = declarationAfterTypeMutation(session, this.targetPointer, target, this.value);
      if (!validSchemaValue(session, desired) || !objectRange(session, this.targetPointer)) return false;
    }
    if (this.keyword === 'required' && (!isObjectLike(target.properties) || !validRequired(target.properties, this.value as RequiredProperties))) return false;
    if (this.keyword === 'tuple' && (!isObjectLike(target.properties) || !(this.value as string[]).every((name) => Object.prototype.hasOwnProperty.call(target.properties, name)))) return false;
    if ((this.keyword === 'choices' || this.keyword === 'selector') && target.type !== 'choice') return false;
    if (this.keyword === 'additionalProperties' && target.type !== 'object') return false;
    if ((this.keyword === 'precision' || this.keyword === 'scale') && target.type !== 'number' && target.type !== 'decimal') return false;
    if (this.keyword === 'maxLength') {
      const primitive = effectiveCorePrimitiveType(target, effectiveReferenceResolver(session));
      if (!primitive.determinate || primitive.type !== 'string') return false;
    }
    if ((this.keyword === 'enum' || this.keyword === 'const') && !coreValueMembersValid(session, { ...target, [this.keyword]: this.value })) return false;
    if (this.keyword === 'abstract' && target.type !== 'object' && target.type !== 'tuple') return false;
    if (this.keyword === '$extends') {
      if (!inheritanceValueValid(session, target, this.value)) return false;
    }
    const authored = Object.prototype.hasOwnProperty.call(target, this.keyword);
    return !authored || objectMemberContext(session, this.targetPointer, this.keyword) !== undefined;
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('SetCoreMember command preconditions are not satisfied.');
    if (this.keyword === 'type') return typeMutationCommandResult(context.session, this.targetPointer, this.value);
    return setMemberCommandResult(context.session, this.targetPointer, this.keyword, this.value);
  }
}

/** Command that explicitly removes a supported Core or extension object member. */
export class RemoveObjectMemberCommand implements EditorCommand {
  constructor(readonly targetPointer: string, readonly keyword: string) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid' || this.keyword.length === 0) return false;
    const target = pointerValue(session.value, this.targetPointer);
    if (this.keyword === 'type' && isTypeDeclaration(target)) return false;
    if (this.targetPointer === '' && REQUIRED_DOCUMENT_HEADERS.has(this.keyword)) return false;
    if (isObjectLike(target)) {
      const requiredShapeMembers: Readonly<Record<string, readonly string[]>> = {
        object: ['properties'], array: ['items'], set: ['items'], map: ['values'], tuple: ['properties', 'tuple'], choice: ['choices']
      };
      if (typeof target.type === 'string' && requiredShapeMembers[target.type]?.includes(this.keyword)) return false;
    }
    return isObjectLike(target) && hasUniquePointerPath(session, this.targetPointer) && !hasDuplicatePointerDiagnostic(session, this.targetPointer) &&
      Object.prototype.hasOwnProperty.call(target, this.keyword) && objectMemberContext(session, this.targetPointer, this.keyword) !== undefined;
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('RemoveObjectMember command preconditions are not satisfied.');
    return removeMemberCommandResult(context.session, this.targetPointer, this.keyword);
  }
}
function editableCompositionTarget(session: DocumentSession, pointer: string): Record<string, unknown> | undefined {
  const value = pointerValue(session.value, pointer);
  if (!isObjectLike(value) || !hasUniquePointerPath(session, pointer) || hasDuplicatePointerDiagnostic(session, pointer)) return undefined;
  const compositionOwned = pointer === '' || /\/(?:allOf|anyOf|oneOf)\/\d+$/.test(pointer) || /\/(?:not|if|then|else)$/.test(pointer);
  const projectedNonSchema = session.model?.projections.definitions.some((definition) => definition.pointer === pointer && definition.coreForm === 'composed');
  if (isTypeDeclaration(value) || compositionOwned || projectedNonSchema) return value;
  const locations = new SchemaLocationIndex(); locations.refresh(session.value,session.model);
  return locations.at(pointer) ? value : undefined;
}
function validSchemaValue(session: DocumentSession, value: unknown): boolean {
  const root = pointerValue(session.value, '');
  const visited = new Set<Record<string, unknown>>();
  const validate = (schema: unknown): boolean => {
    if (!isObjectLike(schema) || !validTypeValue(schema.type) || visited.has(schema)) return false;
    visited.add(schema);
    const references: string[] = [];
    const collect = (candidate: unknown): void => {
      const reference = typeReferenceValue(candidate);
      if (reference !== undefined) references.push(reference);
      else if (Array.isArray(candidate)) candidate.forEach(collect);
      else if (isObjectLike(candidate) && candidate.type !== undefined) collect(candidate.type);
    };
    collect(schema.type);
    if (!references.every((reference) => concreteReusableReference(session, reference))) return false;
    if (!coreValueMembersValid(session, schema)) return false;
    const hasValidationKeywords = Object.keys(schema).some((key) => VALIDATION_KEYWORDS_FOR_COMMANDS.has(key));
    const effectiveTypes = effectiveValidationTypes(root, schema);
    if (hasValidationKeywords && (!effectiveTypes.determinate || effectiveTypes.types.length !== 1 || validationIssues(schema, effectiveTypes).length !== 0)) return false;
    for (const keyword of ['contains', 'propertyNames', 'keyNames', 'has'] as const) {
      if (Object.prototype.hasOwnProperty.call(schema, keyword) && !validate(schema[keyword])) return false;
    }
    for (const keyword of ['patternProperties', 'patternKeys'] as const) {
      const map = schema[keyword];
      if (map !== undefined && (!isObjectLike(map) || !Object.values(map).every(validate))) return false;
    }
    return true;
  };
  return validate(value);
}
function validCompositionSchemaValue(session: DocumentSession, value: unknown, visited = new Set<Record<string, unknown>>()): boolean {
  if (!isObjectLike(value) || visited.has(value)) return false;
  visited.add(value);
  if (Object.prototype.hasOwnProperty.call(value, '$ref')) {
    const reference = typeReferenceValue(value);
    return reference !== undefined && Object.keys(value).every((key) => key === '$ref' || key === 'description') &&
      concreteReusableReference(session, reference);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'type') && !validTypeValue(value.type)) return false;
  if (Object.prototype.hasOwnProperty.call(value, 'type') && !coreValueMembersValid(session, value)) return false;
  if (Object.prototype.hasOwnProperty.call(value, 'properties')) {
    if (!isObjectLike(value.properties) || !Object.values(value.properties).every((schema) => validSchemaValue(session, schema))) return false;
  }
  for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
    if (Object.prototype.hasOwnProperty.call(value, keyword) &&
      !compositionArrayValueValid(value[keyword], (schema) => validCompositionSchemaValue(session, schema, visited))) return false;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'not') && !validCompositionSchemaValue(session, value.not, visited)) return false;
  for (const keyword of ['if', 'then', 'else'] as const) {
    if (Object.prototype.hasOwnProperty.call(value, keyword) && !validCompositionSchemaValue(session, value[keyword], visited)) return false;
  }
  if (Object.keys(value).some((key) => VALIDATION_KEYWORDS_FOR_COMMANDS.has(key))) {
    if (!session.capabilities.validationActive) return false;
    const effectiveTypes = effectiveValidationTypes(pointerValue(session.value, ''), value);
    if (effectiveTypes.determinate && effectiveTypes.types.length === 1 && validationIssues(value, effectiveTypes).length !== 0) return false;
  }
  return true;
}
const VALIDATION_KEYWORDS_FOR_COMMANDS = new Set<string>([
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'pattern', 'format',
  'minItems', 'maxItems', 'uniqueItems', 'minContains', 'maxContains', 'minProperties', 'maxProperties', 'minEntries', 'maxEntries',
  'contains', 'propertyNames', 'keyNames', 'has', 'dependentRequired', 'patternProperties', 'patternKeys'
]);
function validRequired(properties: Record<string, unknown>, required: RequiredProperties): boolean {
  if (!Array.isArray(required)) return false;
  const alternatives = required.every((entry) => Array.isArray(entry));
  const simple = required.every((entry) => typeof entry === 'string');
  if (!alternatives && !simple) return false;
  const sets = alternatives ? required as readonly (readonly string[])[] : [required as readonly string[]];
  return (simple || required.length > 0) && sets.every((set) => (simple || set.length > 0) && new Set(set).size === set.length &&
    set.every((name) => typeof name === 'string' && Object.prototype.hasOwnProperty.call(properties, name)));
}
function mediaType(value: string): boolean {
  return /^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+(?:\s*;\s*[!#$%&'*+.^_`|~0-9A-Za-z-]+=(?:[!#$%&'*+.^_`|~0-9A-Za-z-]+|"[^"]*"))*$/.test(value);
}

/**
 * Command that updates required on a schema declaration.
 */
export class SetRequiredCommand implements EditorCommand {
  constructor(readonly targetPointer: string, readonly required: RequiredProperties | undefined) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
    const declaration = editableCompositionTarget(session, this.targetPointer);
    if (!declaration || declaration.type !== 'object' || !isObjectLike(declaration.properties)) return false;
    if (Object.prototype.hasOwnProperty.call(declaration, 'required') && !objectMemberContext(session, this.targetPointer, 'required')) return false;
    return this.required === undefined ? Object.prototype.hasOwnProperty.call(declaration, 'required') : validRequired(declaration.properties, this.required);
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('SetRequired command preconditions are not satisfied.');
    return this.required === undefined
      ? removeMemberCommandResult(context.session, this.targetPointer, 'required')
      : setMemberCommandResult(context.session, this.targetPointer, 'required', this.required);
  }
}

/**
 * Command that updates collection member on a schema declaration.
 */
export class SetCollectionMemberCommand implements EditorCommand {
  constructor(readonly targetPointer: string, readonly schema: Readonly<Record<string, unknown>>) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
    const declaration = editableCompositionTarget(session, this.targetPointer);
    if (!declaration || !['array', 'set', 'map'].includes(String(declaration.type)) || !validSchemaValue(session, this.schema)) return false;
    const keyword = declaration.type === 'map' ? 'values' : 'items';
    return !Object.prototype.hasOwnProperty.call(declaration, keyword) || objectMemberContext(session, this.targetPointer, keyword) !== undefined;
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('SetCollectionMember command preconditions are not satisfied.');
    const declaration = editableDeclaration(context.session, this.targetPointer)!;
    return setMemberCommandResult(context.session, this.targetPointer, declaration.type === 'map' ? 'values' : 'items', this.schema);
  }
}

/**
 * Command that updates tuple members on a schema declaration.
 */
export class SetTupleMembersCommand implements EditorCommand {
  constructor(readonly targetPointer: string, readonly properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>, readonly order: readonly string[]) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
    const declaration = editableDeclaration(session, this.targetPointer);
    if (!declaration || declaration.type !== 'tuple' || !isObjectLike(this.properties)) return false;
    if (new Set(this.order).size !== this.order.length || this.order.length !== Object.keys(this.properties).length) return false;
    if (!this.order.every((name) => Object.prototype.hasOwnProperty.call(this.properties, name)) || !Object.values(this.properties).every((schema) => validSchemaValue(session, schema))) return false;
    if (Object.keys(this.properties).some((name) => declarationInheritedPropertyNames(session, declaration).has(name))) return false;
    return ['properties', 'tuple'].every((keyword) => !Object.prototype.hasOwnProperty.call(declaration, keyword) || objectMemberContext(session, this.targetPointer, keyword) !== undefined);
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('SetTupleMembers command preconditions are not satisfied.');
    const source = context.session.snapshot().text;
    const declaration = editableDeclaration(context.session, this.targetPointer)!;
    const propertiesMember = objectMemberContext(context.session, this.targetPointer, 'properties');
    const tupleMember = objectMemberContext(context.session, this.targetPointer, 'tuple');
    if (propertiesMember && tupleMember) {
      // Apply replacements from the end of the document backward so source offsets remain valid.
      const replacements = [
        { member: propertiesMember, value: this.properties },
        { member: tupleMember, value: this.order }
      ].sort((left, right) => (right.member.valueRange.startOffset ?? 0) - (left.member.valueRange.startOffset ?? 0));
      const edits = replacements.map(({ member, value }) => ({ range: member.valueRange, newText: JSON.stringify(value) }));
      let editedSource = source;
      for (const edit of edits) {
        const offsets = sourceOffsets(edit.range, 'Tuple member source range is unavailable.');
        editedSource = editedSource.slice(0, offsets.start) + edit.newText + editedSource.slice(offsets.end);
      }
      // Rebase inverse ranges to the edited buffer so undo remains byte-accurate after both replacements.
      const inverseEdits = replacements.map(({ member }) => {
        const offsets = sourceOffsets(member.valueRange, 'Tuple member source range is unavailable.');
        const replacement = edits.find((edit) => edit.range === member.valueRange)!;
        const shift = replacements.reduce((total, candidate) => {
          const candidateOffsets = sourceOffsets(candidate.member.valueRange, 'Tuple member source range is unavailable.');
          if (candidateOffsets.start >= offsets.start) return total;
          const candidateEdit = edits.find((edit) => edit.range === candidate.member.valueRange)!;
          return total + candidateEdit.newText.length - (candidateOffsets.end - candidateOffsets.start);
        }, 0);
        const start = offsets.start + shift;
        return { range: rangeFor(editedSource, start, start + replacement.newText.length), newText: source.slice(offsets.start, offsets.end) };
      });
      return { edits, inverseEdits };
    }
    if (Object.prototype.hasOwnProperty.call(declaration, 'properties') || Object.prototype.hasOwnProperty.call(declaration, 'tuple')) {
      throw new Error('Tuple member source ranges are unavailable.');
    }
    const targetRange = objectRange(context.session, this.targetPointer);
    if (!targetRange) throw new Error('Tuple source range is unavailable.');
    return addMembersCommandResult(source, targetRange, { properties: this.properties, tuple: this.order });
  }
}

/**
 * Command that updates description on a schema declaration.
 */
export class SetDescriptionCommand implements EditorCommand {
  constructor(readonly targetPointer: string, readonly description: string | undefined) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
    const declaration = editableCoreObject(session, this.targetPointer);
    if (!declaration || (this.description !== undefined && typeof this.description !== 'string')) return false;
    if (Object.prototype.hasOwnProperty.call(declaration, 'description') && !objectMemberContext(session, this.targetPointer, 'description')) return false;
    return this.description !== undefined || Object.prototype.hasOwnProperty.call(declaration, 'description');
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('SetDescription command preconditions are not satisfied.');
    return this.description === undefined
      ? removeMemberCommandResult(context.session, this.targetPointer, 'description')
      : setMemberCommandResult(context.session, this.targetPointer, 'description', this.description);
  }
}

/**
 * Command that updates validation keyword on a schema declaration.
 */
export class SetValidationKeywordCommand<K extends ValidationKeyword> implements EditorCommand {
  constructor(readonly targetPointer: string, readonly keyword: K, readonly value: ValidationKeywordMap[K] | undefined) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
    if (this.keyword !== 'maxLength' && !session.capabilities.validationActive) return false;
    const declaration = editableDeclaration(session, this.targetPointer);
    if (!declaration) return false;
    const authored = Object.prototype.hasOwnProperty.call(declaration, this.keyword);
    if (authored && !objectMemberContext(session, this.targetPointer, this.keyword)) return false;
    if (this.keyword === 'maxLength') {
      const primitive = effectiveCorePrimitiveType(declaration, effectiveReferenceResolver(session));
      if (!primitive.determinate || primitive.type !== 'string') return false;
      return this.value === undefined ? authored : Number.isInteger(this.value) && (this.value as number) >= 0;
    }
    const root = pointerValue(session.value, '');
    const effectiveTypes = effectiveValidationTypes(root, declaration);
    if (!effectiveTypes.determinate || effectiveTypes.types.length !== 1) return false;
    if (this.value === undefined) {
      if (!authored) return false;
      const candidate = { ...declaration };
      delete candidate[this.keyword];
      return validationIssues(candidate, effectiveTypes).length === 0;
    }
    if (!validationValueIsSchemaBacked(this.keyword, this.value)) return false;
    const candidate = { ...declaration, [this.keyword]: this.value };
    if (validationIssues(candidate, effectiveTypes).length !== 0) return false;
    const schemas = this.keyword === 'patternProperties' || this.keyword === 'patternKeys'
      ? Object.values(this.value as Readonly<Record<string, Readonly<Record<string, unknown>>>>)
      : ['contains', 'propertyNames', 'keyNames', 'has'].includes(this.keyword)
        ? [this.value as Readonly<Record<string, unknown>>]
        : [];
    return schemas.every((schema) => validSchemaValue(session, schema));
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('SetValidationKeyword command preconditions are not satisfied.');
    return this.value === undefined
      ? removeMemberCommandResult(context.session, this.targetPointer, this.keyword)
      : setMemberCommandResult(context.session, this.targetPointer, this.keyword, this.value);
  }
}

interface CompositionArrayContext {
  readonly ownerPointer: string;
  readonly keyword: CompositionArrayKeyword;
  readonly arrayPointer: string;
  readonly values: readonly unknown[];
  readonly range: TextRange;
  readonly itemRanges: readonly TextRange[];
}

function compositionArrayContext(session: DocumentSession, ownerPointer: string, keyword: CompositionArrayKeyword): CompositionArrayContext | undefined {
  const owner = editableCompositionTarget(session, ownerPointer);
  const values = owner?.[keyword];
  const arrayPointer = objectMemberPointer(ownerPointer, keyword);
  const range = session.model?.nodes.find((node) => node.pointer === arrayPointer)?.range;
  if (!owner || !Array.isArray(values) || !range || hasDuplicatePointerDiagnostic(session, arrayPointer)) return undefined;
  const itemRanges = values.map((_entry, index) => session.model?.nodes.find((node) => node.pointer === `${arrayPointer}/${index}`)?.range);
  return itemRanges.every((item): item is TextRange => item !== undefined)
    ? { ownerPointer, keyword, arrayPointer, values, range, itemRanges }
    : undefined;
}

function compositionOperandContext(session: DocumentSession, operandPointer: string): (CompositionArrayContext & { readonly index: number }) | undefined {
  const match = /^(.*)\/(allOf|anyOf|oneOf)\/(\d+)$/.exec(operandPointer);
  if (!match) return undefined;
  const index = Number(match[3]);
  const context = compositionArrayContext(session, match[1]!, match[2] as CompositionArrayKeyword);
  return context && index >= 0 && index < context.values.length ? { ...context, index } : undefined;
}

function lineIndentAt(source: string, offset: number): string {
  const lineStart = source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  return /^[ \t]*/.exec(source.slice(lineStart, offset))?.[0] ?? '';
}

function compositionArraySource(source: string, context: CompositionArrayContext, items: readonly string[]): string {
  const offsets = sourceOffsets(context.range, 'Composition array source range is unavailable.');
  const authored = source.slice(offsets.start, offsets.end);
  if (!authored.includes('\n')) return `[${items.join(',')}]`;
  const closingIndent = lineIndentAt(source, offsets.start);
  const itemIndent = context.itemRanges[0]
    ? lineIndentAt(source, sourceOffsets(context.itemRanges[0], 'Composition operand source range is unavailable.').start)
    : `${closingIndent}  `;
  return items.length === 0 ? '[]' : `[\n${itemIndent}${items.join(`,\n${itemIndent}`)}\n${closingIndent}]`;
}

function compositionArrayItemsSource(session: DocumentSession, context: CompositionArrayContext): string[] {
  const source = session.snapshot().text;
  return context.itemRanges.map((range) => {
    const offsets = sourceOffsets(range, 'Composition operand source range is unavailable.');
    return source.slice(offsets.start, offsets.end);
  });
}

function replaceCompositionArraySource(session: DocumentSession, context: CompositionArrayContext, items: readonly string[]): CommandResult {
  const source = session.snapshot().text;
  const next = compositionArraySource(source, context, items);
  return commandResultForEdits(source, [{ range: context.range, newText: next }]);
}

function compositionCommandReady(session: DocumentSession, documentVersion: DocumentVersion): boolean {
  return documentVersion === session.snapshot().documentVersion && session.snapshot().recovery === 'valid' && session.capabilities.conditionalCompositionActive;
}

/** Adds one full schema operand to an ALL, ANY, or EXACTLY ONE rule. */
export class AddCompositionOperandCommand implements EditorCommand {
  constructor(readonly targetPointer: string, readonly keyword: CompositionArrayKeyword, readonly value: Readonly<Record<string, unknown>>, readonly index?: number) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (!compositionCommandReady(session, documentVersion) || !validCompositionSchemaValue(session, this.value)) return false;
    const context = compositionArrayContext(session, this.targetPointer, this.keyword);
    const index = this.index ?? context?.values.length ?? -1;
    return context !== undefined && index >= 0 && index <= context.values.length;
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('AddCompositionOperand command preconditions are not satisfied.');
    const array = compositionArrayContext(context.session, this.targetPointer, this.keyword)!;
    const items = compositionArrayItemsSource(context.session, array);
    items.splice(this.index ?? items.length, 0, JSON.stringify(this.value));
    return { ...replaceCompositionArraySource(context.session, array, items), pointerTransforms: array.values.flatMap((_value, index) => index >= (this.index ?? array.values.length) ? [{ from: array.arrayPointer + '/' + index, to: array.arrayPointer + '/' + (index+1) }] : []) };
  }
}

/** Adds a newly authored canonical typed reference operand. */
export class AddCompositionReferenceCommand extends AddCompositionOperandCommand {
  constructor(targetPointer: string, keyword: CompositionArrayKeyword, reference: string, index?: number) {
    super(targetPointer, keyword, { type: { $ref: reference } }, index);
  }
}

/** Deletes one operand; deleting the final operand removes the complete rule. */
export class DeleteCompositionOperandCommand implements EditorCommand {
  constructor(readonly operandPointer: string) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    return compositionCommandReady(session, documentVersion) && compositionOperandContext(session, this.operandPointer) !== undefined;
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('DeleteCompositionOperand command preconditions are not satisfied.');
    const array = compositionOperandContext(context.session, this.operandPointer)!;
    if (array.values.length === 1) return { ...removeMemberCommandResult(context.session, array.ownerPointer, array.keyword), pointerTransforms: [{ from: array.arrayPointer }] };
    const items = compositionArrayItemsSource(context.session, array);
    items.splice(array.index, 1);
    return { ...replaceCompositionArraySource(context.session, array, items), pointerTransforms: [{ from: this.operandPointer }, ...array.values.flatMap((_value,index) => index > array.index ? [{ from: array.arrayPointer + '/' + index, to: array.arrayPointer + '/' + (index-1) }] : [])] };
  }
}

/** Duplicates an operand from its exact authored source bytes. */
export class DuplicateCompositionOperandCommand implements EditorCommand {
  constructor(readonly operandPointer: string) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    return compositionCommandReady(session, documentVersion) && compositionOperandContext(session, this.operandPointer) !== undefined;
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('DuplicateCompositionOperand command preconditions are not satisfied.');
    const array = compositionOperandContext(context.session, this.operandPointer)!;
    const items = compositionArrayItemsSource(context.session, array);
    items.splice(array.index + 1, 0, items[array.index]!);
    return { ...replaceCompositionArraySource(context.session, array, items), pointerTransforms: array.values.flatMap((_value,index) => index > array.index ? [{ from: array.arrayPointer + '/' + index, to: array.arrayPointer + '/' + (index+1) }] : []) };
  }
}

/** Moves an operand without changing its authored schema source. */
export class MoveCompositionOperandCommand implements EditorCommand {
  constructor(readonly operandPointer: string, readonly direction: 'up' | 'down') {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (!compositionCommandReady(session, documentVersion)) return false;
    const array = compositionOperandContext(session, this.operandPointer);
    return array !== undefined && (this.direction === 'up' ? array.index > 0 : array.index + 1 < array.values.length);
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('MoveCompositionOperand command preconditions are not satisfied.');
    const array = compositionOperandContext(context.session, this.operandPointer)!;
    const items = compositionArrayItemsSource(context.session, array);
    const destination = array.index + (this.direction === 'up' ? -1 : 1);
    [items[array.index], items[destination]] = [items[destination]!, items[array.index]!];
    return { ...replaceCompositionArraySource(context.session, array, items), pointerTransforms: [{ from: this.operandPointer, to: array.arrayPointer + '/' + destination }, { from: array.arrayPointer + '/' + destination, to: this.operandPointer }] };
  }
}

/** Converts ALL/ANY/EXACTLY ONE by editing only the authored keyword token. */
export class ConvertCompositionRuleCommand implements EditorCommand {
  constructor(readonly targetPointer: string, readonly from: CompositionArrayKeyword, readonly to: CompositionArrayKeyword) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (!compositionCommandReady(session, documentVersion) || this.from === this.to) return false;
    const target = editableCompositionTarget(session, this.targetPointer);
    return compositionArrayContext(session, this.targetPointer, this.from) !== undefined &&
      target !== undefined && !Object.prototype.hasOwnProperty.call(target, this.to) &&
      objectMemberContext(session, this.targetPointer, this.from) !== undefined;
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('ConvertCompositionRule command preconditions are not satisfied.');
    const member = objectMemberContext(context.session, this.targetPointer, this.from)!;
    return { ...commandResultForEdits(context.session.snapshot().text, [{ range: member.keyRange, newText: JSON.stringify(this.to) }]), pointerTransforms: [{ from: this.targetPointer + '/' + this.from, to: this.targetPointer + '/' + this.to }] };
  }
}

function compositionOperandSource(session: DocumentSession, operandPointer: string): { readonly value: Record<string, unknown>; readonly range: TextRange; readonly source: string } | undefined {
  const value = pointerValue(session.value, operandPointer);
  const range = session.model?.nodes.find((node) => node.pointer === operandPointer)?.range;
  if (!isObjectLike(value) || !range || !hasUniquePointerPath(session, operandPointer) || hasDuplicatePointerDiagnostic(session, operandPointer)) return undefined;
  const offsets = sourceOffsets(range, 'Composition operand source range is unavailable.');
  return { value, range, source: session.snapshot().text.slice(offsets.start, offsets.end) };
}

/** Wraps one operand in a nested ALL, ANY, EXACTLY ONE, or NOT rule. */
export class WrapCompositionOperandCommand implements EditorCommand {
  constructor(readonly operandPointer: string, readonly keyword: CompositionArrayKeyword | 'not') {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    const operand = compositionOperandSource(session, this.operandPointer);
    return compositionCommandReady(session, documentVersion) && operand !== undefined;
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('WrapCompositionOperand command preconditions are not satisfied.');
    const operand = compositionOperandSource(context.session, this.operandPointer)!;
    const next = this.keyword === 'not' ? `{"not":${operand.source}}` : `{"${this.keyword}":[${operand.source}]}`;
    return { ...commandResultForEdits(context.session.snapshot().text, [{ range: operand.range, newText: next }]), pointerTransforms: [{ from: this.operandPointer, to: this.operandPointer + '/' + this.keyword + (this.keyword === 'not' ? '' : '/0') }] };
  }
}

export function compositionUnwrapReason(value: unknown): string | undefined {
  if (!isObjectLike(value)) return 'Only a schema object can be unwrapped.';
  if (Object.keys(value).length !== 1) return 'Unsafe unwrap: would discard sibling declaration, constraints or annotations.';
  const keyword = Object.keys(value)[0]!;
  if (keyword === 'not' && isObjectLike(value.not)) return undefined;
  if ((keyword === 'allOf' || keyword === 'anyOf' || keyword === 'oneOf') && Array.isArray(value[keyword]) && value[keyword].length === 1 && isObjectLike(value[keyword][0])) return undefined;
  return 'Unsafe unwrap: requires exactly one schema operand in a single-purpose wrapper.';
}

function unwrapCompositionOperand(session: DocumentSession, operandPointer: string): { readonly range: TextRange; readonly source: string } | undefined {
  const operand = compositionOperandSource(session, operandPointer);
  if (!operand || compositionUnwrapReason(operand.value)) return undefined;
  const keyword = Object.keys(operand.value)[0];
  const childPointer = keyword === 'not' ? `${operandPointer}/not` :
    (keyword === 'allOf' || keyword === 'anyOf' || keyword === 'oneOf') && Array.isArray(operand.value[keyword]) && operand.value[keyword].length === 1
      ? `${operandPointer}/${keyword}/0` : undefined;
  if (!childPointer) return undefined;
  const childRange = session.model?.nodes.find((node) => node.pointer === childPointer)?.range;
  if (!childRange) return undefined;
  const offsets = sourceOffsets(childRange, 'Nested composition operand source range is unavailable.');
  return { range: operand.range, source: session.snapshot().text.slice(offsets.start, offsets.end) };
}

/** Removes a single-purpose wrapper while preserving the nested operand bytes. */
export class UnwrapCompositionOperandCommand implements EditorCommand {
  constructor(readonly operandPointer: string) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    return compositionCommandReady(session, documentVersion) && unwrapCompositionOperand(session, this.operandPointer) !== undefined;
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error(compositionUnwrapReason(pointerValue(context.session.value, this.operandPointer)) ?? 'UnwrapCompositionOperand command preconditions are not satisfied.');
    const unwrapped = unwrapCompositionOperand(context.session, this.operandPointer)!;
    const value = pointerValue(context.session.value, this.operandPointer) as Record<string, unknown>;
    const keyword = Object.keys(value)[0]!;
    return { ...commandResultForEdits(context.session.snapshot().text, [{ range: unwrapped.range, newText: unwrapped.source }]), pointerTransforms: [{ from: this.operandPointer }, { from: this.operandPointer + '/' + keyword + (keyword === 'not' ? '' : '/0'), to: this.operandPointer }] };
  }
}

/** Negates an operand, or removes its exact single NOT wrapper. */
export class NegateCompositionOperandCommand implements EditorCommand {
  constructor(readonly operandPointer: string) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    const operand = compositionOperandSource(session, this.operandPointer);
    return compositionCommandReady(session, documentVersion) && operand !== undefined &&
      (Object.keys(operand.value).length === 1 && Object.prototype.hasOwnProperty.call(operand.value, 'not')
        ? unwrapCompositionOperand(session, this.operandPointer) !== undefined
        : true);
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('NegateCompositionOperand command preconditions are not satisfied.');
    const operand = compositionOperandSource(context.session, this.operandPointer)!;
    const unwrapped = Object.keys(operand.value).length === 1 && Object.prototype.hasOwnProperty.call(operand.value, 'not')
      ? unwrapCompositionOperand(context.session, this.operandPointer)
      : undefined;
    const next = unwrapped?.source ?? `{"not":${operand.source}}`;
    return { ...commandResultForEdits(context.session.snapshot().text, [{ range: operand.range, newText: next }]), pointerTransforms: unwrapped ? [{ from: this.operandPointer }, { from: this.operandPointer + '/not', to: this.operandPointer }] : [{ from: this.operandPointer, to: this.operandPointer + '/not' }] };
  }
}

/** Replaces an operand with a newly authored canonical typed reference. */
export class SetCompositionOperandReferenceCommand implements EditorCommand {
  constructor(readonly operandPointer: string, readonly reference: string) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    const operand = compositionOperandSource(session, this.operandPointer);
    const value = { type: { $ref: this.reference } };
    return documentVersion === session.snapshot().documentVersion && session.snapshot().recovery === 'valid' && editableCompositionTarget(session,this.operandPointer) !== undefined && operand !== undefined && !Object.prototype.hasOwnProperty.call(operand.value, '$ref') && validCompositionSchemaValue(session, value);
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('SetCompositionOperandReference command preconditions are not satisfied.');
    return setMemberCommandResult(context.session, this.operandPointer, 'type', { $ref: this.reference });
  }
}

/** Independently adds, replaces, or removes one conditional branch. */
export class SetConditionalBranchCommand implements EditorCommand {
  constructor(readonly targetPointer: string, readonly keyword: ConditionalBranchKeyword, readonly value: Readonly<Record<string, unknown>> | undefined) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (!compositionCommandReady(session, documentVersion)) return false;
    const target = editableCompositionTarget(session, this.targetPointer);
    if (!target) return false;
    const authored = Object.prototype.hasOwnProperty.call(target, this.keyword);
    if (authored && !objectMemberContext(session, this.targetPointer, this.keyword)) return false;
    return this.value === undefined ? authored : validCompositionSchemaValue(session, this.value);
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('SetConditionalBranch command preconditions are not satisfied.');
    return this.value === undefined
      ? removeMemberCommandResult(context.session, this.targetPointer, this.keyword)
      : setMemberCommandResult(context.session, this.targetPointer, this.keyword, this.value);
  }
}
/**
 * Command that updates composition keyword on a schema declaration.
 */
export class SetCompositionKeywordCommand<K extends keyof CompositionKeywordMap> implements EditorCommand {
  constructor(readonly targetPointer: string, readonly keyword: K, readonly value: CompositionKeywordMap[K] | undefined) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid' || !session.capabilities.conditionalCompositionActive) return false;
    const declaration = editableCompositionTarget(session, this.targetPointer);
    if (!declaration) return false;
    const authored = Object.prototype.hasOwnProperty.call(declaration, this.keyword);
    if (authored && !objectMemberContext(session, this.targetPointer, this.keyword)) return false;
    if (this.value === undefined) return authored;
    return this.keyword === 'not'
      ? compositionSchemaValueValid(this.value, (schema) => validCompositionSchemaValue(session, schema))
      : compositionArrayValueValid(this.value, (schema) => validCompositionSchemaValue(session, schema));
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('SetCompositionKeyword command preconditions are not satisfied.');
    return this.value === undefined
      ? removeMemberCommandResult(context.session, this.targetPointer, this.keyword)
      : setMemberCommandResult(context.session, this.targetPointer, this.keyword, this.value);
  }
}

/**
 * Command that updates all of on a schema declaration.
 */
export class SetAllOfCommand extends SetCompositionKeywordCommand<'allOf'> {
  constructor(targetPointer: string, value: CompositionKeywordMap['allOf'] | undefined) { super(targetPointer, 'allOf', value); }
}
/**
 * Command that updates any of on a schema declaration.
 */
export class SetAnyOfCommand extends SetCompositionKeywordCommand<'anyOf'> {
  constructor(targetPointer: string, value: CompositionKeywordMap['anyOf'] | undefined) { super(targetPointer, 'anyOf', value); }
}
/**
 * Command that updates one of on a schema declaration.
 */
export class SetOneOfCommand extends SetCompositionKeywordCommand<'oneOf'> {
  constructor(targetPointer: string, value: CompositionKeywordMap['oneOf'] | undefined) { super(targetPointer, 'oneOf', value); }
}
/**
 * Command that updates not on a schema declaration.
 */
export class SetNotCommand extends SetCompositionKeywordCommand<'not'> {
  constructor(targetPointer: string, value: CompositionKeywordMap['not'] | undefined) { super(targetPointer, 'not', value); }
}

/**
 * Command that updates conditional composition on a schema declaration.
 */
export class SetConditionalCompositionCommand implements EditorCommand {
  constructor(readonly targetPointer: string, readonly value: ConditionalCompositionGroup | undefined) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid' || !session.capabilities.conditionalCompositionActive) return false;
    const declaration = editableCompositionTarget(session, this.targetPointer);
    if (!declaration) return false;
    const authored = (['if', 'then', 'else'] as const).filter((keyword) => Object.prototype.hasOwnProperty.call(declaration, keyword));
    if (authored.some((keyword) => !objectMemberContext(session, this.targetPointer, keyword))) return false;
    if (this.value === undefined) return authored.length > 0;
    return conditionalCompositionGroupValid(this.value, (schema) => validCompositionSchemaValue(session, schema));
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('SetConditionalComposition command preconditions are not satisfied.');
    const session = context.session;
    const declaration = editableCompositionTarget(session, this.targetPointer)!;
    const authored = (['if', 'then', 'else'] as const).filter((keyword) => Object.prototype.hasOwnProperty.call(declaration, keyword));
    if (this.value !== undefined && authored.length === 0) {
      const range = objectRange(session, this.targetPointer);
      if (!range) throw new Error('Target source range is unavailable.');
      return addMembersCommandResult(session.snapshot().text, range, { ...this.value });
    }
    if (this.value === undefined) return removeMembersCommandResult(session, this.targetPointer, authored);
    const source = session.snapshot().text;
    const desired = this.value;
    const desiredKeywords = (['if', 'then', 'else'] as const).filter((keyword) => Object.prototype.hasOwnProperty.call(desired, keyword));
    const edits: TextEdit[] = [];
    const removed = authored.filter((keyword) => !Object.prototype.hasOwnProperty.call(desired, keyword));
    if (removed.length > 0) edits.push(...removeMembersCommandResult(session, this.targetPointer, removed).edits);
    for (const keyword of authored.filter((entry) => Object.prototype.hasOwnProperty.call(desired, entry))) {
      const member = objectMemberContext(session, this.targetPointer, keyword)!;
      edits.push(...replaceMemberCommandResult(source, member.valueRange, desired[keyword]).edits);
    }
    const added = desiredKeywords.filter((keyword) => !authored.includes(keyword));
    if (added.length > 0) {
      const range = objectRange(session, this.targetPointer);
      if (!range) throw new Error('Target source range is unavailable.');
      edits.push(...addMembersCommandResult(source, range, Object.fromEntries(added.map((keyword) => [keyword, desired[keyword]]))).edits);
    }
    return commandResultForEdits(source, edits);
  }
}

/**
 * Command that updates units keyword on a schema declaration.
 */
export class SetUnitsKeywordCommand<K extends UnitsKeyword> implements EditorCommand {
  constructor(readonly targetPointer: string, readonly keyword: K, readonly value: UnitsKeywordMap[K] | undefined) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid' || !session.capabilities.unitsActive) return false;
    const declaration = editableDeclaration(session, this.targetPointer);
    if (!declaration) return false;
    const authored = Object.prototype.hasOwnProperty.call(declaration, this.keyword);
    if (authored && !objectMemberContext(session, this.targetPointer, this.keyword)) return false;
    if (this.value === undefined) return authored;
    if (this.keyword === 'unit' || this.keyword === 'ucumUnit') {
      const effectiveTypes = effectiveValidationTypes(pointerValue(session.value, ''), declaration);
      if (!effectiveTypes.determinate || effectiveTypes.types.length !== 1 || !NUMERIC_TYPES_FOR_UNITS.has(effectiveTypes.types[0])) return false;
    }
    return unitsValueValid(pointerValue(session.value, ''), declaration, this.keyword, this.value);
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('SetUnitsKeyword command preconditions are not satisfied.');
    return this.value === undefined
      ? removeMemberCommandResult(context.session, this.targetPointer, this.keyword)
      : setMemberCommandResult(context.session, this.targetPointer, this.keyword, this.value);
  }
}

/**
 * Command that updates symbol on a schema declaration.
 */
export class SetSymbolCommand extends SetUnitsKeywordCommand<'symbol'> {
  constructor(targetPointer: string, value: string | undefined) { super(targetPointer, 'symbol', value); }
}
/**
 * Command that updates symbols on a schema declaration.
 */
export class SetSymbolsCommand extends SetUnitsKeywordCommand<'symbols'> {
  constructor(targetPointer: string, value: Readonly<Record<string, string>> | undefined) { super(targetPointer, 'symbols', value); }
}
/**
 * Command that updates unit on a schema declaration.
 */
export class SetUnitCommand extends SetUnitsKeywordCommand<'unit'> {
  constructor(targetPointer: string, value: string | undefined) { super(targetPointer, 'unit', value); }
}
/**
 * Command that updates ucum unit on a schema declaration.
 */
export class SetUcumUnitCommand extends SetUnitsKeywordCommand<'ucumUnit'> {
  constructor(targetPointer: string, value: string | undefined) { super(targetPointer, 'ucumUnit', value); }
}
/**
 * Command that updates currency on a schema declaration.
 */
export class SetCurrencyCommand extends SetUnitsKeywordCommand<'currency'> {
  constructor(targetPointer: string, value: string | undefined) { super(targetPointer, 'currency', value); }
}

/**
 * Command that updates alternate names keyword on a schema declaration.
 */
export class SetAlternateNamesKeywordCommand<K extends AlternateNamesKeyword> implements EditorCommand {
  constructor(readonly targetPointer: string, readonly keyword: K, readonly value: AlternateNamesKeywordMap[K] | undefined) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid' || !session.capabilities.alternateNamesActive) return false;
    const declaration = editableDeclaration(session, this.targetPointer);
    const root = pointerValue(session.value, '');
    const namedElement = this.targetPointer === '' ? isObjectLike(root) && typeof root.name === 'string' :
      propertyContext(session, this.targetPointer) !== undefined || reusableDeclarationPointer(session, this.targetPointer);
    if (!declaration || !alternateNamesPlacementValid(declaration, this.keyword, namedElement)) return false;
    const authored = Object.prototype.hasOwnProperty.call(declaration, this.keyword);
    if (authored && !objectMemberContext(session, this.targetPointer, this.keyword)) return false;
    return this.value === undefined ? authored : alternateNamesValueValid(declaration, this.keyword, this.value, namedElement);
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('SetAlternateNamesKeyword command preconditions are not satisfied.');
    return this.value === undefined
      ? removeMemberCommandResult(context.session, this.targetPointer, this.keyword)
      : setMemberCommandResult(context.session, this.targetPointer, this.keyword, this.value);
  }
}

/**
 * Command that updates alt names on a schema declaration.
 */
export class SetAltNamesCommand extends SetAlternateNamesKeywordCommand<'altnames'> {
  constructor(targetPointer: string, value: AlternateNamesKeywordMap['altnames'] | undefined) { super(targetPointer, 'altnames', value); }
}
/**
 * Command that updates alt enums on a schema declaration.
 */
export class SetAltEnumsCommand extends SetAlternateNamesKeywordCommand<'altenums'> {
  constructor(targetPointer: string, value: AlternateNamesKeywordMap['altenums'] | undefined) { super(targetPointer, 'altenums', value); }
}
/**
 * Command that updates localized descriptions on a schema declaration.
 */
export class SetLocalizedDescriptionsCommand extends SetAlternateNamesKeywordCommand<'descriptions'> {
  constructor(targetPointer: string, value: AlternateNamesKeywordMap['descriptions'] | undefined) { super(targetPointer, 'descriptions', value); }
}

const SEMANTIC_PROPERTY_OR_COLLECTION = new Set<SemanticAnnotationKeyword>([
  'observedProperty', 'semanticRole', 'derivation', 'statistic', 'temporalReferenceSystem',
  'cadence', 'codedValues', 'measurementConditioning', 'referenceRole'
]);
const SEMANTIC_PROPERTY_ONLY = new Set<SemanticAnnotationKeyword>([
  'phenomenonTimeRelation', 'supportPeriod'
]);
const SEMANTIC_RECORD_ONLY = new Set<SemanticAnnotationKeyword>([
  'coordinateReferenceSystem', 'vectorReferenceFrames', 'tensorReferenceFrames', 'frameTransforms',
  'linearReferenceSystem', 'colorSpaces', 'audioChannels', 'spectralBands'
]);
function semanticMemberPosition(session: DocumentSession, pointer: string): 'property' | 'collection' | undefined {
  for (const [marker, ownerTypes, position] of [
    ['/properties/', ['object', 'tuple'], 'property'],
    ['/choices/', ['choice'], 'collection']
  ] as const) {
    const index = pointer.lastIndexOf(marker);
    if (index >= 0 && !pointer.slice(index + marker.length).includes('/')) {
      const owner = pointerValue(session.value, pointer.slice(0, index));
      if (isObjectLike(owner) && ownerTypes.includes(owner.type as never)) return position;
    }
  }
  for (const [suffix, ownerTypes] of [['/items', ['array', 'set']], ['/values', ['map']]] as const) {
    if (!pointer.endsWith(suffix)) continue;
    const owner = pointerValue(session.value, pointer.slice(0, -suffix.length));
    if (isObjectLike(owner) && ownerTypes.includes(owner.type as never)) return 'collection';
  }
  return undefined;
}
function semanticPlacementValid(session: DocumentSession, pointer: string, declaration: Record<string, unknown>, keyword: SemanticAnnotationKeyword): boolean {
  if (keyword === 'concepts') return true;
  const memberPosition = semanticMemberPosition(session, pointer);
  const effectiveType = (): string | undefined => {
    if (typeof declaration.type === 'string') return declaration.type;
    const effective = effectiveValidationTypes(session.value, declaration);
    return effective.determinate && effective.types.length === 1 ? effective.types[0] : undefined;
  };
  if (SEMANTIC_PROPERTY_ONLY.has(keyword)) return memberPosition === 'property';
  if (SEMANTIC_PROPERTY_OR_COLLECTION.has(keyword)) {
    if (memberPosition !== undefined) return true;
    const type = effectiveType();
    return (type === 'object' || type === 'tuple') && (keyword === 'observedProperty' || keyword === 'temporalReferenceSystem');
  }
  if (!SEMANTIC_RECORD_ONLY.has(keyword)) return false;
  const type = effectiveType();
  return type === 'object' || type === 'tuple';
}

/**
 * Command that updates semantic annotation on a schema declaration.
 */
export class SetSemanticAnnotationCommand<K extends SemanticAnnotationKeyword> implements EditorCommand {
  constructor(readonly targetPointer: string, readonly keyword: K, readonly value: SemanticAnnotationKeywordMap[K] | undefined) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid' || !session.capabilities.semanticAnnotationsActive) return false;
    const declaration = editableDeclaration(session, this.targetPointer);
    if (!declaration || !semanticPlacementValid(session, this.targetPointer, declaration, this.keyword)) return false;
    const authored = Object.prototype.hasOwnProperty.call(declaration, this.keyword);
    if (authored && !objectMemberContext(session, this.targetPointer, this.keyword)) return false;
    if (this.value === undefined) {
      if (!authored) return false;
      const candidate = { ...declaration };
      delete candidate[this.keyword];
      return semanticAnnotationSetValid(candidate, pointerValue(session.value, '') as Record<string, unknown>, this.targetPointer, undefined, effectiveReferenceResolver(session));
    }
    return semanticAnnotationCandidateValid(declaration, this.keyword, this.value, pointerValue(session.value, '') as Record<string, unknown>, this.targetPointer, effectiveReferenceResolver(session));
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('SetSemanticAnnotation command preconditions are not satisfied.');
    return this.value === undefined
      ? removeMemberCommandResult(context.session, this.targetPointer, this.keyword)
      : setMemberCommandResult(context.session, this.targetPointer, this.keyword, this.value);
  }
}

/**
 * Command that updates concepts on a schema declaration.
 */
export class SetConceptsCommand extends SetSemanticAnnotationCommand<'concepts'> { constructor(pointer: string, value: SemanticAnnotationKeywordMap['concepts'] | undefined) { super(pointer, 'concepts', value); } }
/**
 * Command that updates observed property on a schema declaration.
 */
export class SetObservedPropertyCommand extends SetSemanticAnnotationCommand<'observedProperty'> { constructor(pointer: string, value: SemanticAnnotationKeywordMap['observedProperty'] | undefined) { super(pointer, 'observedProperty', value); } }
/**
 * Command that updates semantic role on a schema declaration.
 */
export class SetSemanticRoleCommand extends SetSemanticAnnotationCommand<'semanticRole'> { constructor(pointer: string, value: string | undefined) { super(pointer, 'semanticRole', value); } }
/**
 * Command that updates derivation on a schema declaration.
 */
export class SetDerivationCommand extends SetSemanticAnnotationCommand<'derivation'> { constructor(pointer: string, value: string | undefined) { super(pointer, 'derivation', value); } }
/**
 * Command that updates statistic on a schema declaration.
 */
export class SetStatisticCommand extends SetSemanticAnnotationCommand<'statistic'> { constructor(pointer: string, value: SemanticAnnotationKeywordMap['statistic'] | undefined) { super(pointer, 'statistic', value); } }
/**
 * Command that updates coded values on a schema declaration.
 */
export class SetCodedValuesCommand extends SetSemanticAnnotationCommand<'codedValues'> { constructor(pointer: string, value: SemanticAnnotationKeywordMap['codedValues'] | undefined) { super(pointer, 'codedValues', value); } }
/**
 * Command that updates measurement conditioning on a schema declaration.
 */
export class SetMeasurementConditioningCommand extends SetSemanticAnnotationCommand<'measurementConditioning'> { constructor(pointer: string, value: SemanticAnnotationKeywordMap['measurementConditioning'] | undefined) { super(pointer, 'measurementConditioning', value); } }
/**
 * Command that updates reference role on a schema declaration.
 */
export class SetReferenceRoleCommand extends SetSemanticAnnotationCommand<'referenceRole'> { constructor(pointer: string, value: string | undefined) { super(pointer, 'referenceRole', value); } }
/**
 * Command that updates phenomenon time relation on a schema declaration.
 */
export class SetPhenomenonTimeRelationCommand extends SetSemanticAnnotationCommand<'phenomenonTimeRelation'> { constructor(pointer: string, value: string | undefined) { super(pointer, 'phenomenonTimeRelation', value); } }
/**
 * Command that updates support period on a schema declaration.
 */
export class SetSupportPeriodCommand extends SetSemanticAnnotationCommand<'supportPeriod'> { constructor(pointer: string, value: SemanticAnnotationKeywordMap['supportPeriod'] | undefined) { super(pointer, 'supportPeriod', value); } }
/**
 * Command that updates temporal reference system on a schema declaration.
 */
export class SetTemporalReferenceSystemCommand extends SetSemanticAnnotationCommand<'temporalReferenceSystem'> { constructor(pointer: string, value: SemanticAnnotationKeywordMap['temporalReferenceSystem'] | undefined) { super(pointer, 'temporalReferenceSystem', value); } }
/**
 * Command that updates cadence on a schema declaration.
 */
export class SetCadenceCommand extends SetSemanticAnnotationCommand<'cadence'> { constructor(pointer: string, value: SemanticAnnotationKeywordMap['cadence'] | undefined) { super(pointer, 'cadence', value); } }
/**
 * Command that updates coordinate reference system on a schema declaration.
 */
export class SetCoordinateReferenceSystemCommand extends SetSemanticAnnotationCommand<'coordinateReferenceSystem'> { constructor(pointer: string, value: SemanticAnnotationKeywordMap['coordinateReferenceSystem'] | undefined) { super(pointer, 'coordinateReferenceSystem', value); } }
/**
 * Command that updates vector reference frames on a schema declaration.
 */
export class SetVectorReferenceFramesCommand extends SetSemanticAnnotationCommand<'vectorReferenceFrames'> { constructor(pointer: string, value: SemanticAnnotationKeywordMap['vectorReferenceFrames'] | undefined) { super(pointer, 'vectorReferenceFrames', value); } }
/**
 * Command that updates tensor reference frames on a schema declaration.
 */
export class SetTensorReferenceFramesCommand extends SetSemanticAnnotationCommand<'tensorReferenceFrames'> { constructor(pointer: string, value: SemanticAnnotationKeywordMap['tensorReferenceFrames'] | undefined) { super(pointer, 'tensorReferenceFrames', value); } }
/**
 * Command that updates frame transforms on a schema declaration.
 */
export class SetFrameTransformsCommand extends SetSemanticAnnotationCommand<'frameTransforms'> { constructor(pointer: string, value: SemanticAnnotationKeywordMap['frameTransforms'] | undefined) { super(pointer, 'frameTransforms', value); } }
/**
 * Command that updates linear reference system on a schema declaration.
 */
export class SetLinearReferenceSystemCommand extends SetSemanticAnnotationCommand<'linearReferenceSystem'> { constructor(pointer: string, value: SemanticAnnotationKeywordMap['linearReferenceSystem'] | undefined) { super(pointer, 'linearReferenceSystem', value); } }
/**
 * Command that updates color spaces on a schema declaration.
 */
export class SetColorSpacesCommand extends SetSemanticAnnotationCommand<'colorSpaces'> { constructor(pointer: string, value: SemanticAnnotationKeywordMap['colorSpaces'] | undefined) { super(pointer, 'colorSpaces', value); } }
/**
 * Command that updates audio channels on a schema declaration.
 */
export class SetAudioChannelsCommand extends SetSemanticAnnotationCommand<'audioChannels'> { constructor(pointer: string, value: SemanticAnnotationKeywordMap['audioChannels'] | undefined) { super(pointer, 'audioChannels', value); } }
/**
 * Command that updates spectral bands on a schema declaration.
 */
export class SetSpectralBandsCommand extends SetSemanticAnnotationCommand<'spectralBands'> { constructor(pointer: string, value: SemanticAnnotationKeywordMap['spectralBands'] | undefined) { super(pointer, 'spectralBands', value); } }

const NUMERIC_TYPES_FOR_UNITS = new Set([
  'number', 'integer', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'int128', 'uint128',
  'float8', 'float', 'double', 'decimal'
]);

/**
 * Command that updates binary annotations on a schema declaration.
 */
export class SetBinaryAnnotationsCommand implements EditorCommand {
  constructor(readonly targetPointer: string, readonly keyword: BinaryAnnotationKeyword, readonly value: string | undefined) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
    const declaration = editableDeclaration(session, this.targetPointer);
    if (!declaration || declaration.type !== 'binary') return false;
    if (this.value !== undefined) {
      if (this.keyword === 'contentEncoding' && !['base64', 'base64url', 'base16', 'base32', 'base32hex'].includes(this.value)) return false;
      if (this.keyword === 'contentCompression' && !['gzip', 'deflate', 'zlib', 'brotli'].includes(this.value)) return false;
      if (this.keyword === 'contentMediaType' && !mediaType(this.value)) return false;
    }
    if (Object.prototype.hasOwnProperty.call(declaration, this.keyword) && !objectMemberContext(session, this.targetPointer, this.keyword)) return false;
    return this.value !== undefined || Object.prototype.hasOwnProperty.call(declaration, this.keyword);
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('SetBinaryAnnotations command preconditions are not satisfied.');
    return this.value === undefined
      ? removeMemberCommandResult(context.session, this.targetPointer, this.keyword)
      : setMemberCommandResult(context.session, this.targetPointer, this.keyword, this.value);
  }
}

/**
 * Command that updates type reference on a schema declaration.
 */
export class SetTypeReferenceCommand implements EditorCommand {
  constructor(readonly targetPointer: string, readonly reference: string) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid' || this.targetPointer === '') return false;
    const declaration = editableDeclaration(session, this.targetPointer);
    if (!declaration || !concreteReusableReference(session, this.reference)) return false;
    const desired = declarationAfterTypeMutation(session, this.targetPointer, declaration, { $ref: this.reference });
    return objectMemberContext(session, this.targetPointer, 'type') !== undefined &&
      validSchemaValue(session, desired) && objectRange(session, this.targetPointer) !== undefined;
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('SetTypeReference command preconditions are not satisfied.');
    return typeMutationCommandResult(context.session, this.targetPointer, { $ref: this.reference });
  }
}

/** Command that adds a named namespace without replacing existing definitions. */
export class AddNamespaceCommand implements EditorCommand {
  constructor(readonly namespacePointer: string, readonly namespaceName: string) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid' || !IDENTIFIER.test(this.namespaceName)) return false;
    const namespace = pointerValue(session.value, this.namespacePointer);
    if (!isNamespaceObject(namespace) || !namespaceImportPlacement(session, this.namespacePointer)) return false;
    const targetPointer = namespaceContentPointer(this.namespacePointer);
    const target = pointerValue(session.value, targetPointer);
    if (target === undefined) return this.namespacePointer === '';
    return isNamespaceObject(target) && hasUniquePointerPath(session, targetPointer) &&
      !hasDuplicatePointerDiagnostic(session, targetPointer) && !Object.prototype.hasOwnProperty.call(target, this.namespaceName);
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('AddNamespace command preconditions are not satisfied.');
    const targetPointer = namespaceContentPointer(this.namespacePointer);
    const target = pointerValue(context.session.value, targetPointer);
    if (target === undefined && this.namespacePointer === '') return setMemberCommandResult(context.session, '', 'definitions', { [this.namespaceName]: {} });
    const range = objectRange(context.session, targetPointer);
    if (!range) throw new Error('Namespace source range is unavailable.');
    return addMemberCommandResult(context.session.snapshot().text, range, this.namespaceName, {});
  }
}

/** Command that atomically renames a namespace and every local reference into it. */
export class RenameNamespaceCommand implements EditorCommand {
  constructor(readonly namespacePointer: string, readonly newName: string) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid' || !IDENTIFIER.test(this.newName)) return false;
    const context = namespaceContext(session, this.namespacePointer);
    if (!context) return false;
    if (context.namespaceName === this.newName) return true;
    const parent = pointerValue(session.value, context.parentPointer);
    return isObjectLike(parent) && !Object.prototype.hasOwnProperty.call(parent, this.newName);
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('RenameNamespace command preconditions are not satisfied.');
    const source = context.session.snapshot().text;
    const namespace = namespaceContext(context.session, this.namespacePointer)!;
    const keyOffsets = sourceOffsets(namespace.keyRange, 'Namespace name source range is unavailable.');
    const renamedPointer = `${namespace.parentPointer}/${encodePointerPart(this.newName)}`;
    return commandResultForEdits(source, [
      { range: namespace.keyRange, newText: JSON.stringify(this.newName) },
      ...referenceRewriteEdits(context.session, this.namespacePointer, renamedPointer)
    ].filter((edit) => edit.range.startOffset !== keyOffsets.start || edit.range.endOffset !== keyOffsets.end || edit.newText !== source.slice(keyOffsets.start, keyOffsets.end)));
  }
}

/**
 * Command that deletes an empty namespace, or explicitly deletes an
 * unreferenced namespace subtree when deleteContents is true.
 */
export class DeleteNamespaceCommand implements EditorCommand {
  constructor(readonly namespacePointer: string, readonly deleteContents = false) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
    const context = namespaceContext(session, this.namespacePointer);
    if (!context) return false;
    if (namespaceContainsDeclarations(context.namespace) && !this.deleteContents) return false;
    return referenceSites(session, this.namespacePointer, this.namespacePointer).length === 0;
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('DeleteNamespace command preconditions are not satisfied.');
    const namespace = namespaceContext(context.session, this.namespacePointer)!;
    const parentRange = objectRange(context.session, namespace.parentPointer);
    if (!parentRange) throw new Error('Namespace parent source range is unavailable.');
    return deleteMemberCommandResult(context.session.snapshot().text, parentRange, namespace.keyRange, namespace.valueRange);
  }
}

/**
 * Command that adds definition to a schema declaration.
 */
export class AddDefinitionCommand implements EditorCommand {
  constructor(readonly namespacePointer: string, readonly definitionName: string, readonly schema: PropertySchema) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
    if (!IDENTIFIER.test(this.definitionName) || !validSchemaValue(session, this.schema)) return false;
    const namespace = pointerValue(session.value, this.namespacePointer);
    if (!isNamespaceObject(namespace) || !hasUniquePointerPath(session, this.namespacePointer) || hasDuplicatePointerDiagnostic(session, this.namespacePointer)) return false;
    const targetPointer = namespaceContentPointer(this.namespacePointer);
    const target = pointerValue(session.value, targetPointer);
    if (target === undefined) return this.namespacePointer === '';
    if (!isNamespaceObject(target) || !hasUniquePointerPath(session, targetPointer) || hasDuplicatePointerDiagnostic(session, targetPointer)) return false;
    return !Object.prototype.hasOwnProperty.call(target, this.definitionName);
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('AddDefinition command preconditions are not satisfied.');
    const { session } = context;
    const targetPointer = namespaceContentPointer(this.namespacePointer);
    const target = pointerValue(session.value, targetPointer);
    if (target === undefined && this.namespacePointer === '') return setMemberCommandResult(session, '', 'definitions', { [this.definitionName]: this.schema });
    const range = objectRange(session, targetPointer);
    if (!range) throw new Error('Target source range is unavailable.');
    return addMemberCommandResult(session.snapshot().text, range, this.definitionName, this.schema);
  }
}

/**
 * Command that renames definition in a schema declaration.
 */
export class RenameDefinitionCommand implements EditorCommand {
  constructor(readonly definitionPointer: string, readonly newName: string) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
    const context = definitionsContext(session, this.definitionPointer);
    if (!context || !IDENTIFIER.test(this.newName)) return false;
    if (context.definitionName === this.newName) return true;
    return !Object.prototype.hasOwnProperty.call(context.definitions, this.newName);
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('RenameDefinition command preconditions are not satisfied.');
    const source = context.session.snapshot().text;
    const definition = definitionsContext(context.session, this.definitionPointer)!;
    const keyOffsets = sourceOffsets(definition.keyRange, 'Definition name source range is unavailable.');
    const oldText = source.slice(keyOffsets.start, keyOffsets.end);
    const start = keyOffsets.start;
    const newText = JSON.stringify(this.newName);
    const namespacePointer = this.definitionPointer.slice(0, this.definitionPointer.lastIndexOf('/'));
    const renamedPointer = `${namespacePointer}/${encodePointerPart(this.newName)}`;
    const edits: TextEdit[] = [
      { range: rangeFor(source, start, start + oldText.length), newText },
      ...referenceRewriteEdits(context.session, this.definitionPointer, renamedPointer)
    ];
    return commandResultForEdits(source, edits);
  }
}

/**
 * Command that deletes definition from a schema declaration.
 */
export class DeleteDefinitionCommand implements EditorCommand {
  constructor(readonly definitionPointer: string) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
    const context = definitionsContext(session, this.definitionPointer);
    if (!context) return false;
    return definitionReferenceSites(session, this.definitionPointer).length === 0;
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('DeleteDefinition command preconditions are not satisfied.');
    const source = context.session.snapshot().text;
    const definition = definitionsContext(context.session, this.definitionPointer)!;
    const valueOffsets = sourceOffsets(definition.valueRange, 'Definition source range is unavailable.');
    const definitionsRange = objectRange(context.session, definition.definitionsPointer)!;
    const definitionsOffsets = sourceOffsets(definitionsRange, 'Definitions source range is unavailable.');
    const keyOffsets = sourceOffsets(definition.keyRange, 'Definition name source range is unavailable.');
    const keyStart = keyOffsets.start;
    if (keyStart <= definitionsOffsets.start) throw new Error('Definition source range is unavailable.');

    let start = keyStart;
    let end = valueOffsets.end;
    let before = keyStart - 1;
    // Remove either the leading or trailing comma to keep object member syntax valid after deletion.
    while (before > definitionsOffsets.start && /\s/.test(source[before] ?? '')) before--;
    if (source[before] === ',') start = before;
    else {
      let after = valueOffsets.end;
      while (after < definitionsOffsets.end && /\s/.test(source[after] ?? '')) after++;
      if (source[after] === ',') end = after + 1;
    }

    const oldText = source.slice(start, end);
    const edit: TextEdit = { range: rangeFor(source, start, end), newText: '' };
    const editedSource = source.slice(0, start) + source.slice(end);
    const inverse: TextEdit = { range: rangeFor(editedSource, start, start), newText: oldText };
    return { edits: [edit], inverseEdits: [inverse] };
  }
}

/**
 * Command that updates root on a schema declaration.
 */
export class SetRootCommand implements EditorCommand {
  constructor(readonly rootPointer: string) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
    return canSetRoot(session, this.rootPointer);
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('SetRoot command preconditions are not satisfied.');
    const source = context.session.snapshot().text;
    const rootNode = context.session.model?.nodes.find((node) => node.pointer === '/$root');
    const rootRef = `#${this.rootPointer}`;
    const newText = JSON.stringify(rootRef);
    if (rootNode?.range) {
      const offsets = sourceOffsets(rootNode.range, 'Root source range is unavailable.');
      const oldText = source.slice(offsets.start, offsets.end);
      const edit: TextEdit = { range: rootNode.range, newText };
      const edited = source.slice(0, offsets.start) + newText + source.slice(offsets.end);
      const inverse: TextEdit = { range: rangeFor(edited, offsets.start, offsets.start + newText.length), newText: oldText };
      return { edits: [edit], inverseEdits: [inverse] };
    }
    const range = objectRange(context.session, '');
    if (!range?.startOffset && range?.startOffset !== 0) throw new Error('Root source range is unavailable.');
    const close = (range.endOffset ?? 0) - 1;
    const body = source.slice((range.startOffset ?? 0) + 1, close);
    const multiline = body.includes('\n');
    const indent = multiline ? (body.match(/\n([ \t]*)\S/)?.[1] ?? '  ') : '';
    const insertion = body.trim() === ''
      ? `"$root":${multiline ? ' ' : ''}${newText}`
      : (multiline ? `,\n${indent}"$root": ${newText}` : `,"$root":${newText}`);
    const edit: TextEdit = { range: rangeFor(source, close, close), newText: insertion };
    const editedSource = source.slice(0, close) + insertion + source.slice(close);
    const inverse: TextEdit = { range: rangeFor(editedSource, close, close + insertion.length), newText: '' };
    return { edits: [edit], inverseEdits: [inverse] };
  }
}

/**
 * Command that adds property to a schema declaration.
 */
export class AddPropertyCommand implements EditorCommand {
  constructor(readonly targetPointer: string, readonly propertyName: string, readonly schema: PropertySchema) {}
  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
    const target = pointerValue(session.value, this.targetPointer);
    const namespace = target && typeof target === 'object' && !Array.isArray(target) ? (target as Record<string, unknown>).properties : undefined;
    const hasProperties = !!target && typeof target === 'object' && !Array.isArray(target) && Object.prototype.hasOwnProperty.call(target, 'properties');
    const relationNames = effectiveMemberNames(session, this.targetPointer, 'relations');
    return !!target && typeof target === 'object' && !Array.isArray(target) &&
      hasUniquePointerPath(session, this.targetPointer) &&
      (!hasProperties || (!!namespace && typeof namespace === 'object' && !Array.isArray(namespace) && hasUniquePointerPath(session, `${this.targetPointer}/properties`))) &&
      ((target as Record<string, unknown>).type === 'object' || (target as Record<string, unknown>).type === 'tuple') && IDENTIFIER.test(this.propertyName) &&
      !declarationInheritedPropertyNames(session, target as Record<string, unknown>).has(this.propertyName) &&
      (!namespace || (typeof namespace === 'object' && !Array.isArray(namespace) && !Object.prototype.hasOwnProperty.call(namespace, this.propertyName))) &&
      !relationNames.has(this.propertyName) &&
      validSchemaValue(session, this.schema) &&
      ((target as Record<string, unknown>).type !== 'tuple' ||
        isStringArray((target as Record<string, unknown>).tuple) &&
        objectMemberContext(session, this.targetPointer, 'tuple') !== undefined);
  }
  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('AddProperty command preconditions are not satisfied.');
    const { session } = context; const target = pointerValue(session.value, this.targetPointer) as Record<string, unknown>;
    const properties = target.properties;
    if (properties !== undefined && (typeof properties !== 'object' || Array.isArray(properties))) throw new Error('Target properties must be an object.');
    const pointer = `${this.targetPointer}/properties`;
    const range = objectRange(session, properties === undefined ? this.targetPointer : pointer);
    if (!range?.startOffset && range?.startOffset !== 0) throw new Error('Target source range is unavailable.');
    const close = (range.endOffset ?? 0) - 1;
    const source = session.snapshot().text;
    const body = source.slice((range.startOffset ?? 0) + 1, close);
    const valueText = JSON.stringify(this.schema);
    const multiline = body.includes('\n');
    const indent = multiline ? (body.match(/\n([ \t]*)\S/)?.[1] ?? '  ') : '';
    const propertyEntry = `"${escapeJson(this.propertyName)}":${multiline ? ' ' : ''}${valueText}`;
    const insertion = properties === undefined
      ? (body.trim() === '' ? `"properties":{${propertyEntry}}` : `${multiline ? ',\n' + indent : ','}"properties":{${propertyEntry}}`)
      : (body.trim() === '' ? (multiline ? `\n${indent}${propertyEntry}\n${indent.slice(0, Math.max(0, indent.length - 2))}` : propertyEntry) :
      (multiline ? `,\n${indent}"${escapeJson(this.propertyName)}": ${valueText}` : `,"${escapeJson(this.propertyName)}":${valueText}`));
    const edits: TextEdit[] = [{ range: rangeFor(source, close, close), newText: insertion }];
    if (target.type === 'tuple') {
      const tuple = target.tuple as string[];
      const tupleMember = objectMemberContext(session, this.targetPointer, 'tuple');
      if (!tupleMember) throw new Error('Tuple order source range is unavailable.');
      edits.push({ range: tupleMember.valueRange, newText: JSON.stringify([...tuple, this.propertyName]) });
    }
    return commandResultForEdits(source, edits);
  }
}

/**
 * Command that edits property on a schema declaration.
 */
export class EditPropertyCommand implements EditorCommand {
  constructor(readonly propertyPointer: string, readonly schema: PropertySchema) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
    const current = pointerValue(session.value, this.propertyPointer);
    const direct = propertyContext(session, this.propertyPointer) !== undefined || choiceContext(session, this.propertyPointer) !== undefined;
    const nested = this.propertyPointer !== '' && editableCompositionTarget(session, this.propertyPointer) !== undefined;
    if ((!direct && !nested) || !isObjectLike(current)) return false;
    if (isScalarCoreType(current.type) && isCollectionTypeName(this.schema.type) && !hasExplicitCollectionMember(this.schema)) return false;
    return validSchemaValue(session, normalizedEditedSchema(session, this.propertyPointer, current, this.schema));
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('EditProperty command preconditions are not satisfied.');
    const source = context.session.snapshot().text;
    const range = objectRange(context.session, this.propertyPointer)!;
    const offsets = sourceOffsets(range, 'Property source range is unavailable.');
    const current = pointerValue(context.session.value, this.propertyPointer) as Record<string, unknown>;
    const newText = JSON.stringify(normalizedEditedSchema(context.session, this.propertyPointer, current, this.schema));
    const oldText = source.slice(offsets.start, offsets.end);
    const edit: TextEdit = { range, newText };
    const editedSource = source.slice(0, offsets.start) + newText + source.slice(offsets.end);
    const inverse: TextEdit = {
      range: rangeFor(editedSource, offsets.start, offsets.start + newText.length),
      newText: oldText
    };
    return { edits: [edit], inverseEdits: [inverse] };
  }
}

function isCollectionTypeName(value: unknown): value is 'array' | 'set' | 'map' {
  return typeof value === 'string' && COLLECTION_TYPE_NAMES.has(value);
}

function isScalarCoreType(value: unknown): boolean {
  if (typeof value === 'string') return !COLLECTION_TYPE_NAMES.has(value) && !['object', 'tuple', 'choice'].includes(value);
  return Array.isArray(value) && value.length > 0 && value.every((member) => typeof member === 'string' && !COLLECTION_TYPE_NAMES.has(member) && !['object', 'tuple', 'choice'].includes(member));
}

function hasExplicitCollectionMember(schema: PropertySchema): boolean {
  if (!isCollectionTypeName(schema.type)) return true;
  const member = schema[schema.type === 'map' ? 'values' : 'items'];
  return isObjectLike(member) && validTypeValue(member.type);
}

function normalizedEditedSchema(
  session: DocumentSession,
  pointer: string,
  current: Readonly<Record<string, unknown>>,
  requested: PropertySchema
): Record<string, unknown> {
  const normalized = declarationAfterTypeMutation(session, pointer, requested, requested.type);
  if (JSON.stringify(current.type) !== JSON.stringify(requested.type)) delete normalized.$extends;
  return normalized;
}

/**
 * Command that deletes property from a schema declaration.
 */
export class DeletePropertyCommand implements EditorCommand {
  constructor(readonly propertyPointer: string) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
    const context = propertyContext(session, this.propertyPointer);
    if (!context || !isObjectOrTupleDeclaration(context.owner)) return false;
    if (session.capabilities.relationsActive && Array.isArray(context.owner.identity) &&
      context.owner.identity.length === 1 && context.owner.identity[0] === context.propertyName &&
      identityHasInboundRelation(session, this.propertyPointer.slice(0, this.propertyPointer.lastIndexOf('/properties/')))) return false;
    const blockingReferences = referenceSites(session, this.propertyPointer, this.propertyPointer)
      .filter((site) => !/\/scope(?:\/\d+)?$/.test(site.pointer));
    if (blockingReferences.length > 0) return false;
    const ownerPointer = this.propertyPointer.slice(0, this.propertyPointer.lastIndexOf('/properties/'));
    return memberMutationsHaveSource(session, ownerPointer, propertyOwnerMutations(context.owner, context.propertyName, undefined));
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('DeleteProperty command preconditions are not satisfied.');
    const source = context.session.snapshot().text;
    const property = propertyContext(context.session, this.propertyPointer)!;
    const valueRange = property.valueRange;
    const propertiesPointer = this.propertyPointer.slice(0, this.propertyPointer.lastIndexOf('/'));
    const propertiesRange = objectRange(context.session, propertiesPointer)!;
    const valueOffsets = sourceOffsets(valueRange, 'Property source range is unavailable.');
    const propertiesOffsets = sourceOffsets(propertiesRange, 'Properties source range is unavailable.');
    const keyOffsets = sourceOffsets(property.keyRange, 'Property name source range is unavailable.');
    const keyStart = keyOffsets.start;
    if (keyStart <= propertiesOffsets.start) throw new Error('Property source range is unavailable.');

    let start = keyStart;
    let end = valueOffsets.end;
    let before = keyStart - 1;
    // Remove either the leading or trailing comma to keep object member syntax valid after deletion.
    while (before > propertiesOffsets.start && /\s/.test(source[before] ?? '')) before--;
    if (source[before] === ',') start = before;
    else {
      let after = valueOffsets.end;
      while (after < propertiesOffsets.end && /\s/.test(source[after] ?? '')) after++;
      if (source[after] === ',') end = after + 1;
    }

    const ownerPointer = this.propertyPointer.slice(0, this.propertyPointer.lastIndexOf('/properties/'));
    const edits: TextEdit[] = [
      { range: rangeFor(source, start, end), newText: '' },
      ...memberMutationEdits(context.session, ownerPointer, propertyOwnerMutations(property.owner, property.propertyName, undefined)),
      ...scopeDeletionEdits(context.session, this.propertyPointer)
    ];
    return commandResultForEdits(source, edits);
  }
}

/**
 * Command that renames property in a schema declaration.
 */
export class RenamePropertyCommand implements EditorCommand {
  constructor(readonly propertyPointer: string, readonly newName: string) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
    const context = propertyContext(session, this.propertyPointer);
    if (!context || !isObjectOrTupleDeclaration(context.owner) || !IDENTIFIER.test(this.newName)) return false;
    if (declarationInheritedPropertyNames(session, context.owner).has(this.newName)) return false;
    const ownerPointer = this.propertyPointer.slice(0, this.propertyPointer.lastIndexOf('/properties/'));
    const relationCollision = effectiveMemberNames(session, ownerPointer, 'relations').has(this.newName);
    return !relationCollision &&
      (context.propertyName === this.newName || !Object.prototype.hasOwnProperty.call(context.properties, this.newName)) &&
      memberMutationsHaveSource(session, ownerPointer, propertyOwnerMutations(context.owner, context.propertyName, this.newName));
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('RenameProperty command preconditions are not satisfied.');
    const source = context.session.snapshot().text;
    const property = propertyContext(context.session, this.propertyPointer)!;
    const keyOffsets = sourceOffsets(property.keyRange, 'Property name source range is unavailable.');
    const oldText = source.slice(keyOffsets.start, keyOffsets.end);
    const start = keyOffsets.start;
    const newText = JSON.stringify(this.newName);
    const ownerPointer = this.propertyPointer.slice(0, this.propertyPointer.lastIndexOf('/properties/'));
    const nextPointer = `${ownerPointer}/properties/${encodePointerPart(this.newName)}`;
    const edits: TextEdit[] = [
      { range: rangeFor(source, start, start + oldText.length), newText },
      ...memberMutationEdits(context.session, ownerPointer, propertyOwnerMutations(property.owner, property.propertyName, this.newName)),
      ...referenceRewriteEdits(context.session, this.propertyPointer, nextPointer)
    ];
    return { ...commandResultForEdits(source, edits), pointerTransforms: [{ from: this.propertyPointer, to: nextPointer }] };
  }
}

/** Command that adds a named alternative to a choice declaration. */
export class AddChoiceCommand implements EditorCommand {
  constructor(readonly targetPointer: string, readonly choiceName: string, readonly schema: PropertySchema) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid' || !IDENTIFIER.test(this.choiceName) || !validSchemaValue(session, this.schema)) return false;
    const owner = editableDeclaration(session, this.targetPointer);
    if (!owner || owner.type !== 'choice') return false;
    return isObjectLike(owner.choices) && objectMemberContext(session, this.targetPointer, 'choices') !== undefined &&
      !Object.prototype.hasOwnProperty.call(owner.choices, this.choiceName);
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('AddChoice command preconditions are not satisfied.');
    const choicesPointer = `${this.targetPointer}/choices`;
    const choicesRange = objectRange(context.session, choicesPointer);
    if (!choicesRange) throw new Error('Choices source range is unavailable.');
    return addMemberCommandResult(context.session.snapshot().text, choicesRange, this.choiceName, this.schema);
  }
}

/** Command that atomically renames a choice alternative and local references to it. */
export class RenameChoiceCommand implements EditorCommand {
  constructor(readonly choicePointer: string, readonly newName: string) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid' || !IDENTIFIER.test(this.newName)) return false;
    const context = choiceContext(session, this.choicePointer);
    return !!context && (context.choiceName === this.newName || !Object.prototype.hasOwnProperty.call(context.choices, this.newName));
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('RenameChoice command preconditions are not satisfied.');
    const source = context.session.snapshot().text;
    const choice = choiceContext(context.session, this.choicePointer)!;
    const nextPointer = `${choice.ownerPointer}/choices/${encodePointerPart(this.newName)}`;
    return commandResultForEdits(source, [
      { range: choice.keyRange, newText: JSON.stringify(this.newName) },
      ...referenceRewriteEdits(context.session, this.choicePointer, nextPointer)
    ]);
  }
}

/** Command that deletes an unreferenced choice alternative. */
export class DeleteChoiceCommand implements EditorCommand {
  constructor(readonly choicePointer: string) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
    return choiceContext(session, this.choicePointer) !== undefined &&
      referenceSites(session, this.choicePointer, this.choicePointer).length === 0;
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('DeleteChoice command preconditions are not satisfied.');
    const choice = choiceContext(context.session, this.choicePointer)!;
    const choicesRange = objectRange(context.session, `${choice.ownerPointer}/choices`);
    if (!choicesRange) throw new Error('Choices source range is unavailable.');
    return deleteMemberCommandResult(context.session.snapshot().text, choicesRange, choice.keyRange, choice.valueRange);
  }
}

/**
 * Command that updates identity on a schema declaration.
 */
export class SetIdentityCommand implements EditorCommand {
  constructor(readonly targetPointer: string, readonly identity: readonly string[]) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid' || !session.capabilities.relationsActive) return false;
    if (!Array.isArray(this.identity) || this.identity.length === 0 || this.identity.some((entry) => typeof entry !== 'string' || entry.length === 0)) return false;
    if (new Set(this.identity).size !== this.identity.length) return false;
    const owner = relationOwnerContext(session, this.targetPointer);
    if (!owner) return false;
    if (Object.prototype.hasOwnProperty.call(owner.owner, 'identity') && !objectMemberContext(session, this.targetPointer, 'identity')) return false;
    if (!owner.properties) return false;
    return this.identity.every((entry) => Object.prototype.hasOwnProperty.call(owner.properties!, entry) &&
      objectMemberContext(session, `${this.targetPointer}/properties`, entry) !== undefined);
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('SetIdentity command preconditions are not satisfied.');
    const source = context.session.snapshot().text;
    const identityPointer = `${this.targetPointer}/identity`;
    const identityNode = context.session.model?.nodes.find((node) => node.pointer === identityPointer);
    const newText = JSON.stringify(this.identity);
    if (identityNode?.range) {
      const offsets = sourceOffsets(identityNode.range, 'Identity source range is unavailable.');
      const oldText = source.slice(offsets.start, offsets.end);
      const edit: TextEdit = { range: identityNode.range, newText };
      const editedSource = source.slice(0, offsets.start) + newText + source.slice(offsets.end);
      const inverse: TextEdit = { range: rangeFor(editedSource, offsets.start, offsets.start + newText.length), newText: oldText };
      return { edits: [edit], inverseEdits: [inverse] };
    }
    const ownerRange = objectRange(context.session, this.targetPointer);
    if (!ownerRange) throw new Error('Identity owner source range is unavailable.');
    return addMemberCommandResult(source, ownerRange, 'identity', this.identity);
  }
}

/**
 * Command that removes identity from a schema declaration.
 */
export class RemoveIdentityCommand implements EditorCommand {
  constructor(readonly targetPointer: string) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid' || !session.capabilities.relationsActive) return false;
    const owner = relationOwnerContext(session, this.targetPointer);
    if (!owner) return false;
    return !identityHasInboundRelation(session, this.targetPointer) && objectMemberContext(session, this.targetPointer, 'identity') !== undefined;
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('RemoveIdentity command preconditions are not satisfied.');
    const source = context.session.snapshot().text;
    const ownerRange = objectRange(context.session, this.targetPointer);
    const identity = objectMemberContext(context.session, this.targetPointer, 'identity');
    if (!ownerRange || !identity) throw new Error('Identity source range is unavailable.');
    return deleteMemberCommandResult(source, ownerRange, identity.keyRange, identity.valueRange);
  }
}

/**
 * Command that adds relation to a schema declaration.
 */
export class AddRelationCommand implements EditorCommand {
  constructor(readonly targetPointer: string, readonly relationName: string, readonly schema: RelationSchema) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid' || !session.capabilities.relationsActive) return false;
    if (!IDENTIFIER.test(this.relationName) || !relationSchemaValid(this.schema)) return false;
    const owner = relationOwnerContext(session, this.targetPointer);
    if (!owner) return false;
    if (effectiveMemberNames(session, this.targetPointer, 'relations').has(this.relationName)) return false;
    if (effectiveMemberNames(session, this.targetPointer, 'properties').has(this.relationName)) return false;
    if (!referenceResolvesLocally(session, this.schema.targetTypeRef)) return false;
    if (!localTargetTypeHasIdentity(session, this.schema.targetTypeRef)) return false;
    if (!scopeResolvesLocally(session, this.schema.scope) || !relationScopeCompatible(session, this.schema.scope, this.schema.targetTypeRef)) return false;
    if (this.schema.qualifierTypeRef !== undefined && (!referenceResolvesLocally(session, this.schema.qualifierTypeRef) || !localQualifierIsReusable(session, this.schema.qualifierTypeRef))) return false;
    return true;
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('AddRelation command preconditions are not satisfied.');
    const source = context.session.snapshot().text;
    const owner = pointerValue(context.session.value, this.targetPointer) as Record<string, unknown>;
    const hasRelations = Object.prototype.hasOwnProperty.call(owner, 'relations');
    if (hasRelations) {
      const relationsRange = objectRange(context.session, `${this.targetPointer}/relations`);
      if (!relationsRange) throw new Error('Relations source range is unavailable.');
      return addMemberCommandResult(source, relationsRange, this.relationName, relationValue(this.schema));
    }
    const ownerRange = objectRange(context.session, this.targetPointer);
    if (!ownerRange) throw new Error('Owner source range is unavailable.');
    return addMemberCommandResult(source, ownerRange, 'relations', { [this.relationName]: relationValue(this.schema) });
  }
}

/**
 * Command that edits relation on a schema declaration.
 */
export class EditRelationCommand implements EditorCommand {
  constructor(readonly relationPointer: string, readonly schema: RelationSchema) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid' || !session.capabilities.relationsActive) return false;
    if (!relationSchemaValid(this.schema)) return false;
    const relation = relationContext(session, this.relationPointer);
    if (!relation) return false;
    if (!referenceResolvesLocally(session, this.schema.targetTypeRef)) return false;
    if (!localTargetTypeHasIdentity(session, this.schema.targetTypeRef)) return false;
    if (!scopeResolvesLocally(session, this.schema.scope) || !relationScopeCompatible(session, this.schema.scope, this.schema.targetTypeRef)) return false;
    if (this.schema.qualifierTypeRef !== undefined && (!referenceResolvesLocally(session, this.schema.qualifierTypeRef) || !localQualifierIsReusable(session, this.schema.qualifierTypeRef))) return false;
    return true;
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('EditRelation command preconditions are not satisfied.');
    const source = context.session.snapshot().text;
    const relation = relationContext(context.session, this.relationPointer)!;
    const offsets = sourceOffsets(relation.valueRange, 'Relation source range is unavailable.');
    const newText = JSON.stringify(relationValue(this.schema));
    const oldText = source.slice(offsets.start, offsets.end);
    const edit: TextEdit = { range: relation.valueRange, newText };
    const editedSource = source.slice(0, offsets.start) + newText + source.slice(offsets.end);
    const inverse: TextEdit = { range: rangeFor(editedSource, offsets.start, offsets.start + newText.length), newText: oldText };
    return { edits: [edit], inverseEdits: [inverse] };
  }
}

/**
 * Command that renames relation in a schema declaration.
 */
export class RenameRelationCommand implements EditorCommand {
  constructor(readonly relationPointer: string, readonly newName: string) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid' || !session.capabilities.relationsActive) return false;
    const relation = relationContext(session, this.relationPointer);
    if (!relation || !IDENTIFIER.test(this.newName)) return false;
    if (relation.relationName === this.newName) return true;
    if (effectiveMemberNames(session, relation.ownerPointer, 'relations').has(this.newName)) return false;
    return !effectiveMemberNames(session, relation.ownerPointer, 'properties').has(this.newName);
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('RenameRelation command preconditions are not satisfied.');
    const source = context.session.snapshot().text;
    const relation = relationContext(context.session, this.relationPointer)!;
    const offsets = sourceOffsets(relation.keyRange, 'Relation name source range is unavailable.');
    const oldText = source.slice(offsets.start, offsets.end);
    const newText = JSON.stringify(this.newName);
    const edit: TextEdit = { range: rangeFor(source, offsets.start, offsets.end), newText };
    const editedSource = source.slice(0, offsets.start) + newText + source.slice(offsets.end);
    const inverse: TextEdit = { range: rangeFor(editedSource, offsets.start, offsets.start + newText.length), newText: oldText };
    return { edits: [edit], inverseEdits: [inverse] };
  }
}

/**
 * Command that deletes relation from a schema declaration.
 */
export class DeleteRelationCommand implements EditorCommand {
  constructor(readonly relationPointer: string) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid' || !session.capabilities.relationsActive) return false;
    return relationContext(session, this.relationPointer) !== undefined;
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('DeleteRelation command preconditions are not satisfied.');
    const source = context.session.snapshot().text;
    const relation = relationContext(context.session, this.relationPointer)!;
    const relationsPointer = `${relation.ownerPointer}/relations`;
    const relationsRange = objectRange(context.session, relationsPointer);
    if (!relationsRange) throw new Error('Relations source range is unavailable.');
    if (Object.keys(relation.relations).length === 1) {
      const ownerRange = objectRange(context.session, relation.ownerPointer);
      const relationsMember = objectMemberContext(context.session, relation.ownerPointer, 'relations');
      if (!ownerRange || !relationsMember) throw new Error('Relations source range is unavailable.');
      return deleteMemberCommandResult(source, ownerRange, relationsMember.keyRange, relationsMember.valueRange);
    }
    return deleteMemberCommandResult(source, relationsRange, relation.keyRange, relation.valueRange);
  }
}

/**
 * Command that updates relation cardinality on a schema declaration.
 */
export class SetRelationCardinalityCommand implements EditorCommand {
  constructor(readonly relationPointer: string, readonly cardinality: RelationCardinality) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid' || !session.capabilities.relationsActive) return false;
    if (!cardinalityValid(this.cardinality)) return false;
    const relation = relationContext(session, this.relationPointer);
    if (!relation) return false;
    const value = relation.relations[relation.relationName] as Record<string, unknown>;
    return !Object.prototype.hasOwnProperty.call(value, 'cardinality') ||
      objectMemberContext(session, this.relationPointer, 'cardinality') !== undefined;
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('SetRelationCardinality command preconditions are not satisfied.');
    const source = context.session.snapshot().text;
    const cardinalityPointer = `${this.relationPointer}/cardinality`;
    const node = context.session.model?.nodes.find((candidate) => candidate.pointer === cardinalityPointer);
    const newText = JSON.stringify(this.cardinality);
    if (node?.range) {
      const offsets = sourceOffsets(node.range, 'cardinality source range is unavailable.');
      const oldText = source.slice(offsets.start, offsets.end);
      const edit: TextEdit = { range: node.range, newText };
      const editedSource = source.slice(0, offsets.start) + newText + source.slice(offsets.end);
      const inverse: TextEdit = { range: rangeFor(editedSource, offsets.start, offsets.start + newText.length), newText: oldText };
      return { edits: [edit], inverseEdits: [inverse] };
    }
    const relationRange = objectRange(context.session, this.relationPointer);
    if (!relationRange) throw new Error('Relation source range is unavailable.');
    return addMemberCommandResult(source, relationRange, 'cardinality', this.cardinality);
  }
}

/**
 * Command that updates relation scope on a schema declaration.
 */
export class SetRelationScopeCommand implements EditorCommand {
  constructor(readonly relationPointer: string, readonly scope: RelationScope | undefined) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid' || !session.capabilities.relationsActive) return false;
    if (this.scope !== undefined && !validRelationScope(this.scope)) return false;
    const relation = relationContext(session, this.relationPointer);
    if (!relation) return false;
    const value = relation.relations[relation.relationName] as Record<string, unknown>;
    const targetRef = relationTypeReference(value.targettype);
    if (targetRef === undefined || !scopeResolvesLocally(session, this.scope) || !relationScopeCompatible(session, this.scope, targetRef)) return false;
    return (!Object.prototype.hasOwnProperty.call(value, 'scope') && this.scope !== undefined) ||
      objectMemberContext(session, this.relationPointer, 'scope') !== undefined ||
      (this.scope === undefined && !Object.prototype.hasOwnProperty.call(value, 'scope'));
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('SetRelationScope command preconditions are not satisfied.');
    const source = context.session.snapshot().text;
    const member = objectMemberContext(context.session, this.relationPointer, 'scope');
    if (this.scope === undefined) {
      if (!member) return { edits: [], inverseEdits: [] };
      const relationRange = objectRange(context.session, this.relationPointer);
      if (!relationRange) throw new Error('Relation source range is unavailable.');
      return deleteMemberCommandResult(source, relationRange, member.keyRange, member.valueRange);
    }
    const newText = JSON.stringify(this.scope);
    if (member) {
      const offsets = sourceOffsets(member.valueRange, 'scope source range is unavailable.');
      const oldText = source.slice(offsets.start, offsets.end);
      const edit: TextEdit = { range: member.valueRange, newText };
      const editedSource = source.slice(0, offsets.start) + newText + source.slice(offsets.end);
      const inverse: TextEdit = { range: rangeFor(editedSource, offsets.start, offsets.start + newText.length), newText: oldText };
      return { edits: [edit], inverseEdits: [inverse] };
    }
    const relationRange = objectRange(context.session, this.relationPointer);
    if (!relationRange) throw new Error('Relation source range is unavailable.');
    return addMemberCommandResult(source, relationRange, 'scope', this.scope);
  }
}

/**
 * Command that updates relation qualifier on a schema declaration.
 */
export class SetRelationQualifierCommand implements EditorCommand {
  constructor(readonly relationPointer: string, readonly qualifierTypeRef: string | undefined) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid' || !session.capabilities.relationsActive) return false;
    if (this.qualifierTypeRef !== undefined && (this.qualifierTypeRef.length === 0 || !referenceResolvesLocally(session, this.qualifierTypeRef) || !localQualifierIsReusable(session, this.qualifierTypeRef))) return false;
    const relation = relationContext(session, this.relationPointer);
    if (!relation) return false;
    const value = relation.relations[relation.relationName] as Record<string, unknown>;
    return (!Object.prototype.hasOwnProperty.call(value, 'qualifiertype') && this.qualifierTypeRef !== undefined) ||
      objectMemberContext(session, this.relationPointer, 'qualifiertype') !== undefined ||
      (this.qualifierTypeRef === undefined && !Object.prototype.hasOwnProperty.call(value, 'qualifiertype'));
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('SetRelationQualifier command preconditions are not satisfied.');
    const source = context.session.snapshot().text;
    const member = objectMemberContext(context.session, this.relationPointer, 'qualifiertype');
    if (this.qualifierTypeRef === undefined) {
      if (!member) return { edits: [], inverseEdits: [] };
      const relationRange = objectRange(context.session, this.relationPointer);
      if (!relationRange) throw new Error('Relation source range is unavailable.');
      return deleteMemberCommandResult(source, relationRange, member.keyRange, member.valueRange);
    }
    const newText = JSON.stringify({ $ref: this.qualifierTypeRef });
    if (member) {
      const offsets = sourceOffsets(member.valueRange, 'qualifiertype source range is unavailable.');
      const oldText = source.slice(offsets.start, offsets.end);
      const edit: TextEdit = { range: member.valueRange, newText };
      const editedSource = source.slice(0, offsets.start) + newText + source.slice(offsets.end);
      const inverse: TextEdit = { range: rangeFor(editedSource, offsets.start, offsets.start + newText.length), newText: oldText };
      return { edits: [edit], inverseEdits: [inverse] };
    }
    const relationRange = objectRange(context.session, this.relationPointer);
    if (!relationRange) throw new Error('Relation source range is unavailable.');
    return addMemberCommandResult(source, relationRange, 'qualifiertype', { $ref: this.qualifierTypeRef });
  }
}

/**
 * Command that updates import on a schema declaration.
 */
export class SetImportCommand implements EditorCommand {
  constructor(readonly namespacePointer: string, readonly keyword: ImportKeyword, readonly sourceUri: string) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid' || !session.capabilities.importActive) return false;
    if (!isImportUriReference(this.sourceUri) || !namespaceImportPlacement(session, this.namespacePointer)) return false;
    const target = pointerValue(session.value, this.namespacePointer);
    if (!isObjectLike(target) || !hasUniquePointerPath(session, this.namespacePointer) || hasDuplicatePointerDiagnostic(session, this.namespacePointer)) return false;
    if (hasOtherImportKeyword(target, this.keyword)) return false;
    if (Object.prototype.hasOwnProperty.call(target, this.keyword) && !objectMemberContext(session, this.namespacePointer, this.keyword)) return false;
    return true;
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('SetImport command preconditions are not satisfied.');
    const source = context.session.snapshot().text;
    const member = objectMemberContext(context.session, this.namespacePointer, this.keyword);
    const newText = JSON.stringify(this.sourceUri);
    if (member) {
      const offsets = sourceOffsets(member.valueRange, 'Import source range is unavailable.');
      const oldText = source.slice(offsets.start, offsets.end);
      const edit: TextEdit = { range: member.valueRange, newText };
      const editedSource = source.slice(0, offsets.start) + newText + source.slice(offsets.end);
      const inverse: TextEdit = { range: rangeFor(editedSource, offsets.start, offsets.start + newText.length), newText: oldText };
      return { edits: [edit], inverseEdits: [inverse] };
    }
    const namespaceRange = objectRange(context.session, this.namespacePointer);
    if (!namespaceRange) throw new Error('Import namespace source range is unavailable.');
    return addMemberCommandResult(source, namespaceRange, this.keyword, this.sourceUri);
  }
}

/**
 * Command that deletes import from a schema declaration.
 */
export class DeleteImportCommand implements EditorCommand {
  constructor(readonly namespacePointer: string, readonly keyword: ImportKeyword) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid' || !session.capabilities.importActive) return false;
    if (!namespaceImportPlacement(session, this.namespacePointer)) return false;
    const namespace = pointerValue(session.value, this.namespacePointer);
    if (!isObjectLike(namespace) || !hasUniquePointerPath(session, this.namespacePointer) || hasDuplicatePointerDiagnostic(session, this.namespacePointer)) return false;
    return objectMemberContext(session, this.namespacePointer, this.keyword) !== undefined;
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('DeleteImport command preconditions are not satisfied.');
    const source = context.session.snapshot().text;
    const namespaceRange = objectRange(context.session, this.namespacePointer);
    const member = objectMemberContext(context.session, this.namespacePointer, this.keyword);
    if (!namespaceRange || !member) throw new Error('Import source range is unavailable.');
    return deleteMemberCommandResult(source, namespaceRange, member.keyRange, member.valueRange);
  }
}

function decodePointerPart(value: string): string { return value.replace(/~1/g, '/').replace(/~0/g, '~'); }
function escapeJson(value: string): string { return JSON.stringify(value).slice(1, -1); }
