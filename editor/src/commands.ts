import type { DocumentVersion, TextEdit, TextRange } from './contracts.js';
import type { DocumentSession } from './session.js';
import { rangeFor } from './parser.js';

export interface PropertySchema { readonly type: string; readonly [keyword: string]: unknown; }
export type RelationCardinality = 'single' | 'multiple';
export type RelationScope = string | readonly string[];
export type ImportKeyword = '$import' | '$importdefs';
export interface RelationSchema {
  readonly targetTypeRef: string;
  readonly cardinality: RelationCardinality;
  readonly scope?: RelationScope;
  readonly qualifierTypeRef?: string;
}
export interface CommandResult { readonly edits: readonly TextEdit[]; readonly inverseEdits: readonly TextEdit[]; }
export interface CommandContext { readonly session: DocumentSession; readonly documentVersion: DocumentVersion; }
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
      const rootValue = pointerValue(session.value, pointer);
      if (typeof rootValue === 'string' && (rootValue === definitionRef || rootValue === definitionPointer)) sites.add(pointer);
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

function isTypeDeclaration(value: unknown): value is Record<string, unknown> {
  return isObjectLike(value) && (typeof value.type === 'string' ||
    (isObjectLike(value.type) && Object.keys(value.type).length === 1 && typeof value.type.$ref === 'string'));
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
  if (Object.keys(value).length === 1 && typeof value.$ref === 'string') return value.$ref;
  return isObjectLike(value.type) && Object.keys(value.type).length === 1 && typeof value.type.$ref === 'string' ? value.type.$ref : undefined;
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
      if (!isObjectLike(root) || Object.prototype.hasOwnProperty.call(root, 'type') || typeof root.$root !== 'string' || !isLocalPointerRef(root.$root)) return false;
      const rootPointer = root.$root.slice(1);
      return reusableDeclarationPointer(session, rootPointer) && compatibleCollection(session, pointerValue(session.value, rootPointer), targetRef);
    }
    if (!isLocalPointerRef(entry) || !resolvesUniquePointer(session, entry.slice(1))) return false;
    return compatibleCollection(session, pointerValue(session.value, entry.slice(1)), targetRef);
  });
}
function identityHasInboundRelation(session: DocumentSession, targetPointer: string): boolean {
  const targetRef = `#${targetPointer}`;
  return (session.model?.nodes ?? []).some((node) => node.pointer.endsWith('/targettype/$ref') &&
    pointerValue(session.value, node.pointer) === targetRef);
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
      this.schema !== undefined && typeof this.schema.type === 'string';
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

export class EditPropertyCommand implements EditorCommand {
  constructor(readonly propertyPointer: string, readonly schema: PropertySchema) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
    return propertyContext(session, this.propertyPointer) !== undefined && typeof this.schema.type === 'string';
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

export class SetRelationScopeCommand implements EditorCommand {
  constructor(readonly relationPointer: string, readonly scope: RelationScope | undefined) {}

  canExecute({ session, documentVersion }: CommandContext): boolean {
    if (documentVersion !== session.snapshot().documentVersion || session.snapshot().recovery !== 'valid') return false;
    if (this.scope !== undefined && !validRelationScope(this.scope)) return false;
    const relation = relationContext(session, this.relationPointer);
    if (!relation) return false;
    const value = relation.relations[relation.relationName] as Record<string, unknown>;
    const targetRef = schemaReference(value.targettype);
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
