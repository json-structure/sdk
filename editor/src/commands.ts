import type { DocumentVersion, TextEdit, TextRange } from './contracts.js';
import type { DocumentSession } from './session.js';
import { rangeFor } from './parser.js';

export interface PropertySchema { readonly type: string; readonly [keyword: string]: unknown; }
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
  if (!rootPointer.startsWith('/definitions/')) return false;
  const target = pointerValue(session.value, rootPointer);
  if (!isNamespaceObject(target) || !hasUniquePointerPath(session, rootPointer) || hasDuplicatePointerDiagnostic(session, rootPointer)) return false;
  const type = (target as Record<string, unknown>).type;
  if (typeof type === 'string') return true;
  return isNamespaceObject(type) && Object.keys(type).length === 1 && typeof (type as Record<string, unknown>).$ref === 'string';
}
function sourceOffsets(range: TextRange, message: string): { start: number; end: number } {
  if (range.startOffset === undefined || range.endOffset === undefined) throw new Error(message);
  return { start: range.startOffset, end: range.endOffset };
}
function chooseInsertRange(session: DocumentSession, pointer: string): TextRange | undefined {
  return objectRange(session, pointer);
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

function decodePointerPart(value: string): string { return value.replace(/~1/g, '/').replace(/~0/g, '~'); }
function escapeJson(value: string): string { return JSON.stringify(value).slice(1, -1); }
