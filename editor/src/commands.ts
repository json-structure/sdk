import type { DocumentVersion, TextEdit, TextRange } from './contracts.js';
import type { DocumentSession } from './session.js';
import {
  compositionArrayValueValid,
  compositionSchemaValueValid,
  conditionalCompositionGroupValid,
  type CompositionKeywordMap,
  type ConditionalCompositionGroup
} from './composition.js';
import { rangeFor, semanticAnnotationCandidateValid, semanticAnnotationSetValid, type SemanticAnnotationKeyword, type SemanticAnnotationKeywordMap } from './parser.js';
import { effectiveValidationTypes, validationIssues, validationValueIsSchemaBacked, type ValidationKeyword, type ValidationKeywordMap } from './validation.js';
import { unitsValueValid, type UnitsKeyword, type UnitsKeywordMap } from './units.js';
import { alternateNamesPlacementValid, alternateNamesValueValid, type AlternateNamesKeyword, type AlternateNamesKeywordMap } from './alternate-names.js';

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
export interface CommandResult { readonly edits: readonly TextEdit[]; readonly inverseEdits: readonly TextEdit[]; }
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
function isReferencedProperty(owner: Record<string, unknown>, propertyName: string): boolean {
  const containsName = (value: unknown): boolean => value === propertyName || (Array.isArray(value) && value.some(containsName));
  return containsName(owner.required) || (Array.isArray(owner.identity) && owner.identity.includes(propertyName));
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
  if (definitionsPointer === '' || !definitionsPointer.endsWith('/definitions')) return undefined;
  const namespacePointer = definitionsContextNamespace(definitionsPointer);
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
function isNamespaceObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}
function definitionReferenceSites(session: DocumentSession, definitionPointer: string, definitionRef: string): string[] {
  const root = pointerValue(session.value, '');
  if (!isNamespaceObject(root)) return [];
  const sites = new Set<string>();
  const subtree = `${definitionPointer}/`;
  for (const node of session.model?.nodes ?? []) {
    const pointer = node.pointer;
    if (pointer === definitionPointer) continue;
    const outsideDeletedSubtree = !(pointer === definitionPointer || pointer.startsWith(subtree));

    if (pointer === '/$root' && outsideDeletedSubtree) {
      if (session.model?.rootPointer === definitionPointer) sites.add(pointer);
    }

    if (pointer.endsWith('/$ref') && outsideDeletedSubtree) {
      const ref = pointerValue(session.value, pointer);
      if (typeof ref === 'string' && (ref === definitionRef || ref === definitionPointer)) sites.add(pointer);
    }

    if (pointer.endsWith('/$extends') && outsideDeletedSubtree) {
      const extendsValue = pointerValue(session.value, pointer);
      if (typeof extendsValue === 'string' && (extendsValue === definitionRef || extendsValue === definitionPointer)) sites.add(pointer);
      if (isStringArray(extendsValue) && extendsValue.some((entry) => entry === definitionRef || entry === definitionPointer)) sites.add(pointer);
    }

    if (pointer.endsWith('/targettype/$ref') && outsideDeletedSubtree) {
      const targetRef = pointerValue(session.value, pointer);
      if (typeof targetRef === 'string' && (targetRef === definitionRef || targetRef === definitionPointer)) sites.add(pointer);
    }

    if (pointer.endsWith('/qualifiertype/$ref') && outsideDeletedSubtree) {
      const qualifierRef = pointerValue(session.value, pointer);
      if (typeof qualifierRef === 'string' && (qualifierRef === definitionRef || qualifierRef === definitionPointer)) sites.add(pointer);
    }
  }
  return [...sites];
}
function canSetRoot(session: DocumentSession, rootPointer: string): boolean {
  const root = pointerValue(session.value, '');
  return isObjectLike(root) && !Object.prototype.hasOwnProperty.call(root, 'type') &&
    (!Object.prototype.hasOwnProperty.call(root, '$root') || objectMemberContext(session, '', '$root') !== undefined) &&
    reusableDeclarationPointer(session, rootPointer);
}
function sourceOffsets(range: TextRange, message: string): { start: number; end: number } {
  if (range.startOffset === undefined || range.endOffset === undefined) throw new Error(message);
  return { start: range.startOffset, end: range.endOffset };
}

function applyTextEdits(source: string, edits: readonly TextEdit[]): string {
  return [...edits]
    .sort((left, right) => sourceOffsets(right.range, 'Edit source range is unavailable.').start - sourceOffsets(left.range, 'Edit source range is unavailable.').start)
    .reduce((text, edit) => {
      const offsets = sourceOffsets(edit.range, 'Edit source range is unavailable.');
      return text.slice(0, offsets.start) + edit.newText + text.slice(offsets.end);
    }, source);
}

function minimalReplacementCommandResult(source: string, changed: string): CommandResult {
  let start = 0;
  while (start < source.length && start < changed.length && source[start] === changed[start]) start++;
  let sourceEnd = source.length;
  let changedEnd = changed.length;
  while (sourceEnd > start && changedEnd > start && source[sourceEnd - 1] === changed[changedEnd - 1]) {
    sourceEnd--;
    changedEnd--;
  }
  return {
    edits: [{ range: rangeFor(source, start, sourceEnd), newText: changed.slice(start, changedEnd) }],
    inverseEdits: [{ range: rangeFor(changed, start, changedEnd), newText: source.slice(start, sourceEnd) }]
  };
}
function chooseInsertRange(session: DocumentSession, pointer: string): TextRange | undefined {
  return objectRange(session, pointer);
}
function isObjectLike(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function isObjectOrTupleDeclaration(value: Record<string, unknown>): boolean {
  return value.type === 'object' || value.type === 'tuple';
}
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CORE_TYPES = new Set([
  'string', 'number', 'integer', 'boolean', 'null',
  'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'int128', 'uint128',
  'float8', 'float', 'double', 'decimal', 'date', 'datetime', 'time', 'duration', 'uuid', 'uri', 'binary', 'jsonpointer',
  'object', 'array', 'map', 'set', 'tuple', 'choice'
]);
export const CORE_DOCUMENT_MEMBERS = [
  '$schema', '$id', 'name', 'description', '$uses', '$offers', '$root', 'definitions', 'type', 'enum', 'const',
  'abstract', '$extends', 'properties', 'required', 'additionalProperties', 'items', 'values', 'tuple', 'choices',
  'selector', 'precision', 'scale'
] as const;
export type CoreDocumentMember = typeof CORE_DOCUMENT_MEMBERS[number];
const CORE_DOCUMENT_MEMBER_SET = new Set<string>(CORE_DOCUMENT_MEMBERS);

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
  return Array.isArray(value) && value.length > 0 && value.every((member) =>
    typeof member === 'string' ? CORE_TYPES.has(member) : validUnionObjectMember(member));
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
  if (!isLocalPointerRef(reference)) return true;
  return resolvesUniquePointer(session, reference.slice(1));
}
function scopeResolvesLocally(session: DocumentSession, scope: RelationScope | undefined): boolean {
  if (scope === undefined) return true;
  const entries = typeof scope === 'string' ? [scope] : scope;
  return entries.every((entry) => !isLocalPointerRef(entry) || resolvesUniquePointer(session, entry.slice(1)));
}
function localIdentityValid(session: DocumentSession, pointer: string, value: unknown): boolean {
  if (!isObjectLike(value) || !isObjectOrTupleDeclaration(value) || !reusableDeclarationPointer(session, pointer)) return false;
  const identity = value.identity;
  const properties = value.properties;
  if (!Array.isArray(identity) || identity.length === 0 || !isObjectLike(properties) || new Set(identity).size !== identity.length) return false;
  if (!objectMemberContext(session, pointer, 'identity') || !objectMemberContext(session, pointer, 'properties')) return false;
  return identity.every((entry) => typeof entry === 'string' && entry.length > 0 && Object.prototype.hasOwnProperty.call(properties, entry) &&
    objectMemberContext(session, `${pointer}/properties`, entry) !== undefined);
}
function localTargetTypeHasIdentity(session: DocumentSession, reference: string): boolean {
  if (!isLocalPointerRef(reference)) return true;
  const pointer = reference.slice(1);
  return resolvesUniquePointer(session, pointer) && localIdentityValid(session, pointer, pointerValue(session.value, pointer));
}
function localQualifierIsReusable(session: DocumentSession, reference: string): boolean {
  return !isLocalPointerRef(reference) || reusableDeclarationPointer(session, reference.slice(1));
}
function schemaReference(value: unknown): string | undefined {
  if (!isObjectLike(value)) return undefined;
  return isObjectLike(value.type) && Object.keys(value.type).length === 1 && typeof value.type.$ref === 'string' ? value.type.$ref : undefined;
}
function relationTypeReference(value: unknown): string | undefined {
  return isObjectLike(value) && Object.keys(value).length === 1 && typeof value.$ref === 'string' ? value.$ref : undefined;
}
function referenceCompatible(session: DocumentSession, candidate: string, target: string, seen = new Set<string>()): boolean {
  if (candidate === target) return true;
  if (!isLocalPointerRef(candidate) || !isLocalPointerRef(target) || seen.has(candidate)) return false;
  seen.add(candidate);
  const declaration = pointerValue(session.value, candidate.slice(1));
  if (!isObjectLike(declaration)) return false;
  const bases = typeof declaration.$extends === 'string' ? [declaration.$extends] : Array.isArray(declaration.$extends) ? declaration.$extends : [];
  return bases.some((base) => typeof base === 'string' && referenceCompatible(session, base, target, seen));
}
function compatibleCollection(session: DocumentSession, collection: unknown, targetRef: string): boolean {
  if (!isObjectLike(collection) || !['array', 'set', 'map'].includes(String(collection.type))) return false;
  const member = collection.type === 'map' ? collection.values : collection.items;
  const memberRef = schemaReference(member);
  return memberRef !== undefined && referenceCompatible(session, memberRef, targetRef);
}
function relationScopeCompatible(session: DocumentSession, scope: RelationScope | undefined, targetRef: string): boolean {
  if (scope === undefined) return true;
  const entries = typeof scope === 'string' ? [scope] : scope;
  return entries.every((entry) => {
    if (entry === '#') {
      const root = pointerValue(session.value, '');
      const rootPointer = isObjectLike(root) && typeof root.$root === 'string' ? decodeLocalPointerFragment(root.$root) : undefined;
      if (!isObjectLike(root) || Object.prototype.hasOwnProperty.call(root, 'type') || rootPointer === undefined) return false;
      return reusableDeclarationPointer(session, rootPointer) && compatibleCollection(session, pointerValue(session.value, rootPointer), targetRef);
    }
    if (!isLocalPointerRef(entry) || !resolvesUniquePointer(session, entry.slice(1))) return false;
    return compatibleCollection(session, pointerValue(session.value, entry.slice(1)), targetRef);
  });
}
function identityHasInboundRelation(session: DocumentSession, targetPointer: string): boolean {
  const targetRef = `#${targetPointer}`;
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
      if (pointerValue(session.value, referencePointer) === targetRef) return true;
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
function removeMembersCommandResult(session: DocumentSession, targetPointer: string, keywords: readonly string[]): CommandResult {
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
    case '$offers': return isObjectLike(value) && Object.values(value).every((entry) => typeReferenceValue(entry) !== undefined);
    case '$root': return typeof value === 'string' && validPointerFragment(value);
    case 'type': return validTypeValue(value);
    case 'abstract': return typeof value === 'boolean';
    case 'additionalProperties': return typeof value === 'boolean' || typeReferenceValue(value) !== undefined;
    case '$extends': return (typeof value === 'string' && value.length > 0) || (isStringArray(value) && value.length > 0);
    case 'required': return Array.isArray(value);
    case 'tuple': return isStringArray(value) && new Set(value).size === value.length;
    case 'precision': case 'scale': return Number.isInteger(value) && (value as number) >= 0;
    case 'definitions': case 'properties': case 'choices': return isObjectLike(value);
    case 'items': case 'values': return isObjectLike(value) && validTypeValue(value.type);
    case 'enum': return Array.isArray(value) && value.length > 0;
    case 'const': return value !== undefined;
  }
}
function coreMemberPlacementValid(session: DocumentSession, pointer: string, keyword: CoreDocumentMember): boolean {
  if (['$schema', '$id', 'name', '$uses', '$offers', '$root'].includes(keyword)) return pointer === '';
  if (keyword === 'definitions') return namespaceImportPlacement(session, pointer);
  return pointer === '' || editableCompositionTarget(session, pointer) !== undefined;
}

/** Command that safely sets a supported Core declaration or document object member. */
export class SetCoreMemberCommand implements EditorCommand {
  constructor(readonly targetPointer: string, readonly keyword: CoreDocumentMember, readonly value: unknown) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid' || !CORE_DOCUMENT_MEMBER_SET.has(this.keyword)) return false;
    const target = editableCoreObject(session, this.targetPointer);
    if (!target || !coreMemberPlacementValid(session, this.targetPointer, this.keyword) || !coreMemberValueValid(this.keyword, this.value)) return false;
    if ((this.keyword === 'properties' || this.keyword === 'choices') &&
      !Object.values(this.value as Record<string, unknown>).every((schema) => validSchemaValue(session, schema))) return false;
    if ((this.keyword === 'items' || this.keyword === 'values') && !validSchemaValue(session, this.value)) return false;
    if (this.keyword === 'required' && (!isObjectLike(target.properties) || !validRequired(target.properties, this.value as RequiredProperties))) return false;
    if (this.keyword === 'tuple' && (!isObjectLike(target.properties) || !(this.value as string[]).every((name) => Object.prototype.hasOwnProperty.call(target.properties, name)))) return false;
    if ((this.keyword === 'choices' || this.keyword === 'selector') && target.type !== 'choice') return false;
    if (this.keyword === 'additionalProperties' && target.type !== 'object') return false;
    if ((this.keyword === 'precision' || this.keyword === 'scale') && target.type !== 'number' && target.type !== 'decimal') return false;
    if (this.keyword === '$extends') {
      const references = typeof this.value === 'string' ? [this.value] : this.value as string[];
      if (!references.every((reference) => referenceResolvesLocally(session, reference))) return false;
    }
    const authored = Object.prototype.hasOwnProperty.call(target, this.keyword);
    return !authored || objectMemberContext(session, this.targetPointer, this.keyword) !== undefined;
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('SetCoreMember command preconditions are not satisfied.');
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
  return isTypeDeclaration(value) || compositionOwned || projectedNonSchema ? value : undefined;
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
    if (!references.every((reference) => referenceResolvesLocally(session, reference) &&
      (!isLocalPointerRef(reference) || reusableDeclarationPointer(session, reference.slice(1))))) return false;
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
      referenceResolvesLocally(session, reference) && (!isLocalPointerRef(reference) || reusableDeclarationPointer(session, reference.slice(1)));
  }
  if (Object.prototype.hasOwnProperty.call(value, 'type') && !validTypeValue(value.type)) return false;
  if (Object.prototype.hasOwnProperty.call(value, 'properties')) {
    if (!isObjectLike(value.properties) || !Object.values(value.properties).every((schema) => validSchemaValue(session, schema))) return false;
  }
  for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
    if (Object.prototype.hasOwnProperty.call(value, keyword) &&
      !compositionArrayValueValid(value[keyword], (schema) => validCompositionSchemaValue(session, schema, visited))) return false;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'not') && !validCompositionSchemaValue(session, value.not, visited)) return false;
  const hasIf = Object.prototype.hasOwnProperty.call(value, 'if');
  const hasThen = Object.prototype.hasOwnProperty.call(value, 'then');
  const hasElse = Object.prototype.hasOwnProperty.call(value, 'else');
  if ((hasThen || hasElse) && !hasIf || hasIf && !hasThen && !hasElse) return false;
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
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'format',
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
    const declaration = editableDeclaration(session, this.targetPointer);
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
    if (!session.capabilities.validationActive) return false;
    const declaration = editableDeclaration(session, this.targetPointer);
    if (!declaration) return false;
    const root = pointerValue(session.value, '');
    const effectiveTypes = effectiveValidationTypes(root, declaration);
    if (!effectiveTypes.determinate || effectiveTypes.types.length !== 1) return false;
    const authored = Object.prototype.hasOwnProperty.call(declaration, this.keyword);
    if (authored && !objectMemberContext(session, this.targetPointer, this.keyword)) return false;
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
    const authored = ['if', 'then', 'else'].filter((keyword) => Object.prototype.hasOwnProperty.call(declaration, keyword));
    if (authored.some((keyword) => !objectMemberContext(session, this.targetPointer, keyword))) return false;
    if (this.value === undefined) return authored.length > 0;
    return conditionalCompositionGroupValid(this.value, (schema) => validCompositionSchemaValue(session, schema));
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('SetConditionalComposition command preconditions are not satisfied.');
    const session = context.session;
    const declaration = editableCompositionTarget(session, this.targetPointer)!;
    const authored = ['if', 'then', 'else'].filter((keyword) => Object.prototype.hasOwnProperty.call(declaration, keyword));
    if (this.value !== undefined && authored.length === 0) {
      const range = objectRange(session, this.targetPointer);
      if (!range) throw new Error('Target source range is unavailable.');
      return addMembersCommandResult(session.snapshot().text, range, { ...this.value });
    }
    if (this.value === undefined) return removeMembersCommandResult(session, this.targetPointer, authored);
    const removed = removeMembersCommandResult(session, this.targetPointer, authored);
    const source = session.snapshot().text;
    const withoutConditional = applyTextEdits(source, removed.edits);
    const originalRange = objectRange(session, this.targetPointer);
    if (!originalRange) throw new Error('Target source range is unavailable.');
    const originalOffsets = sourceOffsets(originalRange, 'Target source range is unavailable.');
    const removedLength = removed.edits.reduce((total, edit) => {
      const offsets = sourceOffsets(edit.range, 'Conditional branch source range is unavailable.');
      return total + offsets.end - offsets.start;
    }, 0);
    const range = rangeFor(withoutConditional, originalOffsets.start, originalOffsets.end - removedLength);
    const added = addMembersCommandResult(withoutConditional, range, { ...this.value });
    const changed = applyTextEdits(withoutConditional, added.edits);
    return minimalReplacementCommandResult(source, changed);
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

const SEMANTIC_COLLECTION_TYPES = new Set(['array', 'set', 'map', 'choice']);
const SEMANTIC_PROPERTY_OR_COLLECTION = new Set<SemanticAnnotationKeyword>([
  'observedProperty', 'semanticRole', 'derivation', 'statistic', 'temporalReferenceSystem',
  'cadence', 'codedValues', 'measurementConditioning'
]);
const SEMANTIC_PROPERTY_ONLY = new Set<SemanticAnnotationKeyword>([
  'phenomenonTimeRelation', 'supportPeriod', 'referenceRole'
]);
const SEMANTIC_RECORD_ONLY = new Set<SemanticAnnotationKeyword>([
  'coordinateReferenceSystem', 'vectorReferenceFrames', 'tensorReferenceFrames', 'frameTransforms',
  'linearReferenceSystem', 'colorSpaces', 'audioChannels', 'spectralBands'
]);
function semanticPlacementValid(pointer: string, declaration: Record<string, unknown>, keyword: SemanticAnnotationKeyword): boolean {
  if (keyword === 'concepts') return true;
  const property = /\/properties\/[^/]+$/.test(pointer);
  if (SEMANTIC_PROPERTY_ONLY.has(keyword)) return property;
  if (SEMANTIC_PROPERTY_OR_COLLECTION.has(keyword)) {
    return property || SEMANTIC_COLLECTION_TYPES.has(String(declaration.type)) ||
      ((declaration.type === 'object' || declaration.type === 'tuple') && (keyword === 'observedProperty' || keyword === 'temporalReferenceSystem'));
  }
  return SEMANTIC_RECORD_ONLY.has(keyword) && (declaration.type === 'object' || declaration.type === 'tuple');
}

/**
 * Command that updates semantic annotation on a schema declaration.
 */
export class SetSemanticAnnotationCommand<K extends SemanticAnnotationKeyword> implements EditorCommand {
  constructor(readonly targetPointer: string, readonly keyword: K, readonly value: SemanticAnnotationKeywordMap[K] | undefined) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid' || !session.capabilities.semanticAnnotationsActive) return false;
    const declaration = editableDeclaration(session, this.targetPointer);
    if (!declaration || !semanticPlacementValid(this.targetPointer, declaration, this.keyword)) return false;
    const authored = Object.prototype.hasOwnProperty.call(declaration, this.keyword);
    if (authored && !objectMemberContext(session, this.targetPointer, this.keyword)) return false;
    if (this.value === undefined) {
      if (!authored) return false;
      const candidate = { ...declaration };
      delete candidate[this.keyword];
      return semanticAnnotationSetValid(candidate, pointerValue(session.value, '') as Record<string, unknown>, this.targetPointer);
    }
    return semanticAnnotationCandidateValid(declaration, this.keyword, this.value, pointerValue(session.value, '') as Record<string, unknown>, this.targetPointer);
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
    if (!declaration || !isLocalPointerRef(this.reference) || !reusableDeclarationPointer(session, this.reference.slice(1))) return false;
    return objectMemberContext(session, this.targetPointer, 'type') !== undefined;
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('SetTypeReference command preconditions are not satisfied.');
    return setMemberCommandResult(context.session, this.targetPointer, 'type', { $ref: this.reference });
  }
}

/** Command that adds a named namespace without replacing existing definitions. */
export class AddNamespaceCommand implements EditorCommand {
  constructor(readonly namespacePointer: string, readonly namespaceName: string) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid' || !IDENTIFIER.test(this.namespaceName)) return false;
    const namespace = pointerValue(session.value, this.namespacePointer);
    if (!isNamespaceObject(namespace) || !namespaceImportPlacement(session, this.namespacePointer)) return false;
    const definitions = namespace.definitions;
    return definitions === undefined || isNamespaceObject(definitions) && hasUniquePointerPath(session, objectMemberPointer(this.namespacePointer, 'definitions')) &&
      !Object.prototype.hasOwnProperty.call(definitions, this.namespaceName);
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('AddNamespace command preconditions are not satisfied.');
    const namespace = pointerValue(context.session.value, this.namespacePointer) as Record<string, unknown>;
    if (isNamespaceObject(namespace.definitions)) {
      const range = objectRange(context.session, objectMemberPointer(this.namespacePointer, 'definitions'));
      if (!range) throw new Error('Definitions source range is unavailable.');
      return addMemberCommandResult(context.session.snapshot().text, range, this.namespaceName, {});
    }
    return setMemberCommandResult(context.session, this.namespacePointer, 'definitions', { [this.namespaceName]: {} });
  }
}

/**
 * Command that adds definition to a schema declaration.
 */
export class AddDefinitionCommand implements EditorCommand {
  constructor(readonly namespacePointer: string, readonly definitionName: string, readonly schema: PropertySchema) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
    if (this.definitionName.length === 0 || typeof this.schema.type !== 'string') return false;
    const namespace = pointerValue(session.value, this.namespacePointer);
    if (!isNamespaceObject(namespace) || !hasUniquePointerPath(session, this.namespacePointer) || hasDuplicatePointerDiagnostic(session, this.namespacePointer)) return false;
    const definitions = (namespace as Record<string, unknown>).definitions;
    if (definitions !== undefined && (!isNamespaceObject(definitions) || !hasUniquePointerPath(session, `${this.namespacePointer}/definitions`))) return false;
    const definitionsObject = isNamespaceObject(definitions) ? definitions : undefined;
    return !definitionsObject || !Object.prototype.hasOwnProperty.call(definitionsObject, this.definitionName);
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('AddDefinition command preconditions are not satisfied.');
    const { session } = context;
    const namespace = pointerValue(session.value, this.namespacePointer) as Record<string, unknown>;
    const definitions = namespace.definitions;
    const targetPointer = definitions === undefined ? this.namespacePointer : `${this.namespacePointer}/definitions`;
    const range = chooseInsertRange(session, targetPointer);
    if (!range?.startOffset && range?.startOffset !== 0) throw new Error('Target source range is unavailable.');
    const close = (range.endOffset ?? 0) - 1;
    const source = session.snapshot().text;
    const body = source.slice((range.startOffset ?? 0) + 1, close);
    const valueText = JSON.stringify(this.schema);
    const multiline = body.includes('\n');
    const indent = multiline ? (body.match(/\n([ \t]*)\S/)?.[1] ?? '  ') : '';
    const entry = `"${escapeJson(this.definitionName)}":${multiline ? ' ' : ''}${valueText}`;
    const insertion = definitions === undefined
      ? (body.trim() === '' ? `"definitions":{${entry}}` : `${multiline ? ',\n' + indent : ','}"definitions":{${entry}}`)
      : (body.trim() === '' ? (multiline ? `\n${indent}${entry}\n${indent.slice(0, Math.max(0, indent.length - 2))}` : entry) :
      (multiline ? `,\n${indent}"${escapeJson(this.definitionName)}": ${valueText}` : `,"${escapeJson(this.definitionName)}":${valueText}`));
    const edit: TextEdit = { range: rangeFor(source, close, close), newText: insertion };
    const editedSource = source.slice(0, close) + insertion + source.slice(close);
    const inverse: TextEdit = { range: rangeFor(editedSource, close, close + insertion.length), newText: '' };
    return { edits: [edit], inverseEdits: [inverse] };
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
    if (!context || this.newName.length === 0) return false;
    if (context.definitionName === this.newName) return true;
    if (Object.prototype.hasOwnProperty.call(context.definitions, this.newName)) return false;
    const oldRef = `#${this.definitionPointer}`;
    return definitionReferenceSites(session, this.definitionPointer, oldRef).length === 0;
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('RenameDefinition command preconditions are not satisfied.');
    const source = context.session.snapshot().text;
    const definition = definitionsContext(context.session, this.definitionPointer)!;
    const keyOffsets = sourceOffsets(definition.keyRange, 'Definition name source range is unavailable.');
    const oldText = source.slice(keyOffsets.start, keyOffsets.end);
    const start = keyOffsets.start;
    const newText = JSON.stringify(this.newName);
    const edit: TextEdit = { range: rangeFor(source, start, start + oldText.length), newText };
    const editedSource = source.slice(0, start) + newText + source.slice(start + oldText.length);
    const inverse: TextEdit = { range: rangeFor(editedSource, start, start + newText.length), newText: oldText };
    return { edits: [edit], inverseEdits: [inverse] };
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
    const ref = `#${this.definitionPointer}`;
    return definitionReferenceSites(session, this.definitionPointer, ref).length === 0;
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
    const relations = target && typeof target === 'object' && !Array.isArray(target) ? (target as Record<string, unknown>).relations : undefined;
    return !!target && typeof target === 'object' && !Array.isArray(target) &&
      hasUniquePointerPath(session, this.targetPointer) &&
      (!hasProperties || (!!namespace && typeof namespace === 'object' && !Array.isArray(namespace) && hasUniquePointerPath(session, `${this.targetPointer}/properties`))) &&
      (target as Record<string, unknown>).type === 'object' && this.propertyName.length > 0 &&
      (!namespace || (typeof namespace === 'object' && !Array.isArray(namespace) && !Object.prototype.hasOwnProperty.call(namespace, this.propertyName))) &&
      (!relations || (typeof relations === 'object' && !Array.isArray(relations) && !Object.prototype.hasOwnProperty.call(relations, this.propertyName))) &&
      validSchemaValue(session, this.schema);
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
    const edit: TextEdit = { range: rangeFor(source, close, close), newText: insertion };
    const editedSource = source.slice(0, close) + insertion + source.slice(close);
    const inverse: TextEdit = { range: rangeFor(editedSource, close, close + insertion.length), newText: '' };
    return { edits: [edit], inverseEdits: [inverse] };
  }
}

/**
 * Command that edits property on a schema declaration.
 */
export class EditPropertyCommand implements EditorCommand {
  constructor(readonly propertyPointer: string, readonly schema: PropertySchema) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
    return propertyContext(session, this.propertyPointer) !== undefined && validSchemaValue(session, this.schema);
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('EditProperty command preconditions are not satisfied.');
    const source = context.session.snapshot().text;
    const range = objectRange(context.session, this.propertyPointer)!;
    const offsets = sourceOffsets(range, 'Property source range is unavailable.');
    const newText = JSON.stringify(this.schema);
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

/**
 * Command that deletes property from a schema declaration.
 */
export class DeletePropertyCommand implements EditorCommand {
  constructor(readonly propertyPointer: string) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
    const context = propertyContext(session, this.propertyPointer);
    return context !== undefined && !isReferencedProperty(context.owner, context.propertyName);
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

    const oldText = source.slice(start, end);
    const edit: TextEdit = { range: rangeFor(source, start, end), newText: '' };
    const editedSource = source.slice(0, start) + source.slice(end);
    const inverse: TextEdit = { range: rangeFor(editedSource, start, start), newText: oldText };
    return { edits: [edit], inverseEdits: [inverse] };
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
    if (!context || this.newName.length === 0 || isReferencedProperty(context.owner, context.propertyName)) return false;
    const relations = context.owner.relations;
    const relationCollision = !!relations && typeof relations === 'object' && !Array.isArray(relations) && Object.prototype.hasOwnProperty.call(relations, this.newName);
    return !relationCollision && (context.propertyName === this.newName || !Object.prototype.hasOwnProperty.call(context.properties, this.newName));
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('RenameProperty command preconditions are not satisfied.');
    const source = context.session.snapshot().text;
    const property = propertyContext(context.session, this.propertyPointer)!;
    const keyOffsets = sourceOffsets(property.keyRange, 'Property name source range is unavailable.');
    const oldText = source.slice(keyOffsets.start, keyOffsets.end);
    const start = keyOffsets.start;
    const newText = JSON.stringify(this.newName);
    const edit: TextEdit = { range: rangeFor(source, start, start + oldText.length), newText };
    const editedSource = source.slice(0, start) + newText + source.slice(start + oldText.length);
    const inverse: TextEdit = { range: rangeFor(editedSource, start, start + newText.length), newText: oldText };
    return { edits: [edit], inverseEdits: [inverse] };
  }
}

/**
 * Command that updates identity on a schema declaration.
 */
export class SetIdentityCommand implements EditorCommand {
  constructor(readonly targetPointer: string, readonly identity: readonly string[]) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
    if (!Array.isArray(this.identity) || this.identity.length === 0 || this.identity.some((entry) => typeof entry !== 'string' || entry.length === 0)) return false;
    if (new Set(this.identity).size !== this.identity.length) return false;
    const owner = relationOwnerContext(session, this.targetPointer);
    if (!owner || !owner.properties) return false;
    if (Object.prototype.hasOwnProperty.call(owner.owner, 'identity') && !objectMemberContext(session, this.targetPointer, 'identity')) return false;
    return this.identity.every((entry) => Object.prototype.hasOwnProperty.call(owner.properties, entry) &&
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
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
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
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
    if (!IDENTIFIER.test(this.relationName) || !relationSchemaValid(this.schema)) return false;
    const owner = relationOwnerContext(session, this.targetPointer);
    if (!owner) return false;
    if (owner.relations && Object.prototype.hasOwnProperty.call(owner.relations, this.relationName)) return false;
    if (owner.properties && Object.prototype.hasOwnProperty.call(owner.properties, this.relationName)) return false;
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
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
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
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
    const relation = relationContext(session, this.relationPointer);
    if (!relation || !IDENTIFIER.test(this.newName)) return false;
    if (relation.relationName === this.newName) return true;
    if (Object.prototype.hasOwnProperty.call(relation.relations, this.newName)) return false;
    const properties = relation.owner.properties;
    return !(isObjectLike(properties) && Object.prototype.hasOwnProperty.call(properties, this.newName));
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
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
    return relationContext(session, this.relationPointer) !== undefined;
  }

  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('DeleteRelation command preconditions are not satisfied.');
    const source = context.session.snapshot().text;
    const relation = relationContext(context.session, this.relationPointer)!;
    const relationsPointer = `${relation.ownerPointer}/relations`;
    const relationsRange = objectRange(context.session, relationsPointer);
    if (!relationsRange) throw new Error('Relations source range is unavailable.');
    return deleteMemberCommandResult(source, relationsRange, relation.keyRange, relation.valueRange);
  }
}

/**
 * Command that updates relation cardinality on a schema declaration.
 */
export class SetRelationCardinalityCommand implements EditorCommand {
  constructor(readonly relationPointer: string, readonly cardinality: RelationCardinality) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
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
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
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
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
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
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
    if (!absoluteUri(this.sourceUri) || !namespaceImportPlacement(session, this.namespacePointer)) return false;
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
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
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
