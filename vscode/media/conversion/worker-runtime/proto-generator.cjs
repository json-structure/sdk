'use strict';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LOCK_VERSION = 2;
const PROTO_PRIMITIVES = {
  null: 'google.protobuf.NullValue', boolean: 'bool', string: 'string',
  integer: 'int32', int8: 'int32', int16: 'int32', int32: 'int32', int64: 'int64',
  uint8: 'uint32', uint16: 'uint32', uint32: 'uint32', uint64: 'uint64',
  int128: 'string', uint128: 'string', decimal: 'string',
  float8: 'float', float: 'float', double: 'double', number: 'double',
  date: 'string', time: 'string', datetime: 'string', duration: 'string',
  uuid: 'string', uri: 'string', jsonpointer: 'string', binary: 'bytes',
};

function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function escapePointer(value) { return String(value).replace(/~/g, '~0').replace(/\//g, '~1'); }
function unescapePointer(value) { return String(value).replace(/~1/g, '/').replace(/~0/g, '~'); }
function definitionPointer(path) { return `#/definitions/${path.map(escapePointer).join('/')}`; }
function definitionPath(pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('#/definitions/')) return undefined;
  const rest = pointer.slice('#/definitions/'.length);
  return rest ? rest.split('/').map(unescapePointer) : undefined;
}
function canonicalDefinitionPointer(pointer) {
  const path = definitionPath(pointer);
  return path ? definitionPointer(path) : undefined;
}
function qualify(packageName, name) { return packageName ? `${packageName}.${name}` : name; }
function reservedFieldNumber(value) { return value >= 19000 && value <= 19999; }
function isTypeDeclaration(value) { return isRecord(value) && (Object.prototype.hasOwnProperty.call(value, 'type') || Object.prototype.hasOwnProperty.call(value, '$extends') || Object.prototype.hasOwnProperty.call(value, 'abstract')); }
function firstDuplicate(values) { const seen = new Set(); return values.find((value) => seen.has(value) || !seen.add(value)); }
function branchFieldStem(typeName) {
  const last = typeName.split('.').pop() || typeName;
  return last.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}
function screamingSnake(name) { return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/_+/g, '_').toUpperCase(); }
function jsonCommentValue(value) { return JSON.stringify(value); }
function at(message, pointer) { return `${message} (at ${pointer || '#'})`; }

function requiredNames(schema, pointer, warnings) {
  if (!Array.isArray(schema.required)) return new Set();
  if (schema.required.every((entry) => typeof entry === 'string')) return new Set(schema.required);
  if (!schema.required.every((entry) => Array.isArray(entry) && entry.every((name) => typeof name === 'string'))) throw new Error(`required at ${pointer} is malformed.`);
  const alternatives = schema.required.map((entry) => new Set(entry));
  const intersection = new Set(alternatives[0] || []);
  for (const name of intersection) if (!alternatives.every((alternative) => alternative.has(name))) intersection.delete(name);
  warnings.push({ path: pointer, code: 'protobuf.required.alternatives', lossiness: 'unsupported-feature', message: `required declares ${alternatives.length} alternative sets; only their intersection is emitted as present.` });
  return intersection;
}

function collectSelectors(value, selectors = new Set()) {
  if (Array.isArray(value)) { value.forEach((entry) => collectSelectors(entry, selectors)); return selectors; }
  if (!isRecord(value)) return selectors;
  if (Object.prototype.hasOwnProperty.call(value, '$extends') && typeof value.selector === 'string') selectors.add(value.selector);
  Object.values(value).forEach((entry) => collectSelectors(entry, selectors));
  return selectors;
}

class ProtoGenerator {
  constructor(document, sourceName, options) {
    if (!isRecord(document)) throw new Error('JSON Structure source must be an object.');
    this.document = document;
    this.sourceName = sourceName || 'schema.struct.json';
    this.options = options || {};
    this.files = [];
    this.registry = new Map();
    this.taken = new Set();
    this.planEntries = [];
    this.packageSources = new Map();
    this.edges = [];
    this.warnings = [];
    this.addIns = [];
    this.selectors = collectSelectors(document);
    this.enumSymbols = new Map();
    this.lockInput = this.parseLock(this.options.numbers);
    this.lockOutput = { version: LOCK_VERSION, messages: {}, enums: {} };
  }

  run() {
    this.plan();
    this.collectAddIns();
    this.checkPackageCollisions();
    for (const descriptor of this.planEntries) {
      if (descriptor.abstract) continue;
      const declaration = this.buildNamed(descriptor.schema, descriptor.name, descriptor.packageName, {
        hint: descriptor.name, member: undefined, pointer: descriptor.pointer, file: descriptor.file,
      });
      this.files[descriptor.file].declarations.push(declaration);
    }
    this.checkImportCycles();
    const files = this.files.filter((file) => file.declarations.length > 0).map((file) => ({
      path: file.path, packageName: file.packageName, contents: renderFile(file),
    })).sort((left, right) => left.path.localeCompare(right.path));
    if (files.length === 0) throw new Error('document declares neither `type` nor `$root`, and has no `definitions`; nothing to generate');
    return { files, numbers: this.lockOutput, warnings: this.warnings };
  }

  parseLock(value) {
    if (value === undefined || value === '') return undefined;
    let parsed = value;
    if (typeof value === 'string') {
      try { parsed = JSON.parse(value); } catch { throw new Error('Protobuf numbers option must contain valid JSON.'); }
    }
    if (!isRecord(parsed) || parsed.version !== LOCK_VERSION) throw new Error(`field-number lock has version ${String(isRecord(parsed) ? parsed.version : 'none')}, but this implementation writes version ${LOCK_VERSION}; regenerate the lock rather than letting it be ignored (in message <lock>)`);
    return parsed;
  }

  plan() {
    if (isRecord(this.document.definitions)) this.planNamespace(this.document.definitions, []);
    if (typeof this.document.$root === 'string') {
      const root = this.resolveDescriptor(this.document.$root, '#/$root');
      if (root.abstract) throw new Error(at('the root type is abstract and cannot be generated', root.pointer));
    }
    if (Object.prototype.hasOwnProperty.call(this.document, 'type')) {
      const name = this.declaredName(this.document, '#') || 'Root';
      const file = this.fileFor([]);
      const packageName = this.files[file].packageName;
      const fq = qualify(packageName, name);
      if (this.taken.has(fq)) throw new Error(at(`two declared types both map to the protobuf name \`${fq}\``, '#'));
      const descriptor = { pointer: '#', path: ['#'], schema: this.document, name, packageName, fq, file, abstract: false };
      this.registry.set('#', descriptor);
      this.taken.add(fq);
      this.planEntries.push(descriptor);
    }
    if (this.planEntries.length === 0) throw new Error('document declares neither `type` nor `$root`, and has no `definitions`; nothing to generate');
  }

  planNamespace(namespace, path) {
    for (const [key, value] of Object.entries(namespace)) {
      if (!isRecord(value) || key === '$import' || key === '$importdefs') continue;
      const childPath = [...path, key];
      if (!isTypeDeclaration(value)) { this.planNamespace(value, childPath); continue; }
      const pointer = definitionPointer(childPath);
      const name = this.declaredName(value, pointer) || key;
      const file = this.fileFor(path);
      const packageName = this.files[file].packageName;
      const fq = qualify(packageName, name);
      if (this.taken.has(fq)) throw new Error(at(`two declared types both map to the protobuf name \`${fq}\``, pointer));
      const descriptor = { pointer, path: childPath, schema: value, name, packageName, fq, file, abstract: value.abstract === true };
      this.registry.set(pointer, descriptor);
      this.taken.add(fq);
      this.planEntries.push(descriptor);
    }
  }

  fileFor(namespacePath) {
    for (const segment of namespacePath) if (!IDENTIFIER.test(segment.toLowerCase())) throw new Error(`Namespace segment ${JSON.stringify(segment)} is not a legal protobuf package component.`);
    const segments = namespacePath.map((segment) => segment.toLowerCase());
    const packageName = segments.join('.');
    const path = segments.length ? `${segments.join('/')}.proto` : `${this.documentStem()}.proto`;
    const origin = namespacePath.join('.');
    const sources = this.packageSources.get(packageName) || [];
    if (!sources.includes(origin)) sources.push(origin);
    this.packageSources.set(packageName, sources);
    const existing = this.files.findIndex((file) => file.path === path);
    if (existing >= 0) return existing;
    this.files.push({ path, packageName, imports: [], declarations: [] });
    return this.files.length - 1;
  }

  documentStem() {
    if (typeof this.document.name === 'string' && this.document.name) return this.document.name.toLowerCase();
    if (typeof this.document.$id === 'string') {
      const last = this.document.$id.replace(/\/$/, '').split('/').pop() || '';
      const cleaned = last.replace(/[^A-Za-z0-9_-]/g, '_').toLowerCase();
      if (cleaned) return cleaned;
    }
    const sourceStem = this.sourceName.replace(/\.struct\.json$/i, '').replace(/[^A-Za-z0-9_-]/g, '_').toLowerCase();
    return sourceStem || 'schema';
  }

  checkPackageCollisions() {
    const collision = [...this.packageSources.entries()].filter(([, sources]) => sources.length > 1).sort(([a], [b]) => a.localeCompare(b))[0];
    if (collision) throw new Error(at(`namespaces [${[...collision[1]].sort().join(', ')}] all lowercase to the protobuf package \`${collision[0]}\`; protobuf package segments are lowercased, so these namespaces would merge. Rename them in the JSON Structure document so they differ by more than case`, '#/definitions'));
  }

  collectAddIns() {
    const uses = Array.isArray(this.options.uses) ? this.options.uses : [];
    if (uses.length === 0) return;
    const requested = new Set(uses);
    const found = new Set();
    const offers = isRecord(this.document.$offers) ? this.document.$offers : {};
    for (const [name, offered] of Object.entries(offers)) {
      if (!requested.has(name)) continue;
      found.add(name);
      for (const reference of Array.isArray(offered) ? offered : [offered]) {
        if (typeof reference !== 'string') throw new Error(`$offers/${name} must contain JSON Pointer references.`);
        const descriptor = this.resolveDescriptor(reference, `#/$offers/${name}`);
        if (typeof descriptor.schema.$extends !== 'string') throw new Error(`Add-in ${reference} must declare a single $extends target.`);
        this.addIns.push({ target: canonicalDefinitionPointer(descriptor.schema.$extends), descriptor });
      }
    }
    for (const name of uses) if (!found.has(name)) throw new Error(`add-in '${name}' is not offered by this schema`);
  }

  declaredName(schema, pointer) {
    const alt = isRecord(schema.altnames) ? schema.altnames.proto : undefined;
    if (alt !== undefined) {
      if (typeof alt !== 'string' || !IDENTIFIER.test(alt)) throw new Error(at(`'${String(alt)}' is not a legal protobuf identifier`, `${pointer}/altnames/proto`));
      return alt;
    }
    if (schema.name !== undefined && (typeof schema.name !== 'string' || !IDENTIFIER.test(schema.name))) throw new Error(`name at ${pointer} must be a legal protobuf identifier.`);
    return typeof schema.name === 'string' ? schema.name : undefined;
  }

  fieldName(schema, fallback, pointer) {
    const alt = isRecord(schema.altnames) ? schema.altnames.proto : undefined;
    const name = alt === undefined ? fallback : alt;
    if (typeof name !== 'string' || !IDENTIFIER.test(name)) {
      const target = alt === undefined ? pointer : `${pointer}/altnames/proto`;
      throw new Error(at(`'${String(name)}' is not a legal protobuf identifier`, target));
    }
    return name;
  }

  resolveDescriptor(reference, from) {
    const canonical = reference === '#' ? '#' : canonicalDefinitionPointer(reference);
    const descriptor = canonical ? this.registry.get(canonical) : undefined;
    if (!descriptor) throw new Error(at(`cannot resolve '${reference}'`, from));
    return descriptor;
  }

  buildNamed(schema, name, packageName, context) {
    const enumDeclaration = this.tryEnum(schema, name, packageName, context.pointer);
    if (enumDeclaration) return enumDeclaration;
    if (schema.type === 'object') return this.buildMessage(schema, name, packageName, context);
    if (schema.type === 'tuple') return this.buildTuple(schema, name, packageName, context);
    if (schema.type === 'choice') return this.buildChoice(schema, name, packageName, context);
    const resolved = this.typeReference(schema, context);
    return { kind: 'message', name, comment: this.commentOf(schema), members: [{ kind: 'field', field: { ...this.field('value', resolved, true, schema, context.pointer), number: 1 } }], reserved: [] };
  }

  buildMessage(schema, name, packageName, context) {
    this.checkAdditionalProperties(schema, context.pointer);
    const fields = this.collectFields(schema, context.pointer, schema.type === 'tuple' ? 'tuple' : 'object');
    const members = fields.map((spec) => ({ kind: 'field', field: this.buildField(spec, context) }));
    return this.finishMessage(name, packageName, this.commentOf(schema), members);
  }

  buildTuple(schema, name, packageName, context) {
    const fields = this.collectFields(schema, context.pointer, 'tuple');
    const members = fields.map((spec) => ({ kind: 'field', field: this.buildField({ ...spec, required: true }, context) }));
    return this.finishMessage(name, packageName, this.commentOf(schema), members);
  }

  collectFields(schema, pointer, kind, ancestors = [], existing) {
    if (ancestors.includes(pointer)) throw new Error(at(`\`$extends\` cycle: ${[...ancestors, pointer].join(' -> ')}`, pointer));
    const fields = existing ? existing.fields : [];
    const names = existing ? existing.names : new Set();
    const outer = new Set(names);
    const bases = typeof schema.$extends === 'string' ? [schema.$extends] : Array.isArray(schema.$extends) ? schema.$extends : [];
    for (const reference of bases) {
      if (typeof reference !== 'string') throw new Error(`$extends at ${pointer} must contain JSON Pointer references.`);
      const base = this.resolveDescriptor(reference, pointer);
      const expected = kind === 'choice' ? 'object' : kind;
      if (base.schema.type !== expected || base.schema.abstract !== true) throw new Error(`Base ${reference} must be an abstract ${expected} type.`);
      this.collectFields(base.schema, base.pointer, expected, [...ancestors, pointer], { fields, names });
    }
    const required = requiredNames(schema, pointer, this.warnings);
    const properties = schema.properties === undefined ? {} : schema.properties;
    if (!isRecord(properties)) throw new Error(`properties at ${pointer} must be an object.`);
    let entries;
    if (kind === 'tuple') {
      if (!Array.isArray(schema.tuple)) throw new Error(`tuple at ${pointer} requires tuple order.`);
      entries = schema.tuple.map((propertyName) => [propertyName, properties[propertyName]]);
    } else entries = Object.entries(properties);
    for (const [propertyName, member] of entries) {
      if (typeof propertyName !== 'string' || !isRecord(member)) throw new Error(`Property ${String(propertyName)} at ${pointer} must be a schema object.`);
      if (names.has(propertyName)) {
        if (!outer.has(propertyName) && !this.selectors.has(propertyName)) throw new Error(at(`property '${propertyName}' is inherited through \`$extends\` and MUST NOT be redefined`, `${pointer}/properties/${escapePointer(propertyName)}`));
        continue;
      }
      names.add(propertyName);
      fields.push({ key: propertyName, schema: member, pointer: `${pointer}/properties/${escapePointer(propertyName)}`, required: kind === 'tuple' || required.has(propertyName) });
    }
    const canonical = pointer === '#' ? '#' : canonicalDefinitionPointer(pointer);
    for (const addIn of this.addIns.filter((entry) => entry.target === canonical)) {
      const addInSchema = addIn.descriptor.schema;
      const addInRequired = requiredNames(addInSchema, addIn.descriptor.pointer, this.warnings);
      if (!isRecord(addInSchema.properties)) continue;
      for (const [propertyName, member] of Object.entries(addInSchema.properties)) {
        if (names.has(propertyName)) continue;
        if (!isRecord(member)) throw new Error(`Property ${propertyName} at ${addIn.descriptor.pointer} must be a schema object.`);
        names.add(propertyName);
        fields.push({ key: propertyName, schema: member, pointer: `${addIn.descriptor.pointer}/properties/${escapePointer(propertyName)}`, required: addInRequired.has(propertyName) });
      }
    }
    return fields;
  }

  buildField(spec, context) {
    const name = this.fieldName(spec.schema, spec.key, spec.pointer);
    const child = { hint: `${context.hint}_${spec.key}`, member: spec.key, pointer: spec.pointer, file: context.file };
    const resolved = this.typeReference(spec.schema, child);
    const field = this.field(name, resolved, spec.required, spec.schema, spec.pointer);
    const notes = [];
    if (this.options.emit_comments !== false && typeof spec.schema.description === 'string') notes.push(spec.schema.description);
    for (const keyword of ['default', 'const']) if (Object.prototype.hasOwnProperty.call(spec.schema, keyword)) {
      if (this.options.emit_comments !== false) notes.push(`JSON Structure ${keyword}: ${jsonCommentValue(spec.schema[keyword])}`);
      this.warnings.push({ path: spec.pointer, code: `protobuf.${keyword}.omitted`, lossiness: 'unsupported-feature', message: `proto3 cannot express ${keyword}; the value is not enforced.` });
    }
    field.comment = notes.length ? notes.join('\n') : undefined;
    return field;
  }

  field(name, resolved, required, schema, pointer) {
    let rule = resolved.rule;
    if (rule === 'singular' && !required) rule = 'optional';
    let pin;
    if (schema.protoNumber !== undefined) {
      if (!Number.isInteger(schema.protoNumber) || schema.protoNumber < 1 || schema.protoNumber > 536870911) throw new Error(at(`\`protoNumber\` ${String(schema.protoNumber)} is outside the legal protobuf field number range 1..=536870911`, pointer));
      if (reservedFieldNumber(schema.protoNumber)) throw new Error(at(`\`protoNumber\` ${schema.protoNumber} falls in the reserved range 19000..=19999`, pointer));
      pin = schema.protoNumber;
    }
    return { name, type: resolved.name, rule, mapKey: resolved.mapKey, number: 0, pin, comment: undefined };
  }

  buildChoice(schema, name, packageName, context) {
    if (!isRecord(schema.choices) || Object.keys(schema.choices).length === 0) throw new Error(`Choice at ${context.pointer} requires choices.`);
    const inline = Object.prototype.hasOwnProperty.call(schema, '$extends') && typeof schema.selector === 'string';
    let members = [];
    if (inline) {
      const fields = this.collectFields(schema, context.pointer, 'choice').filter((field) => field.key !== schema.selector);
      members = fields.map((spec) => ({ kind: 'field', field: this.buildField(spec, context) }));
    }
    const branches = [];
    for (const [key, branch] of Object.entries(schema.choices)) {
      if (!isRecord(branch) || !IDENTIFIER.test(key)) throw new Error(`Choice branch ${key} at ${context.pointer} is invalid.`);
      const child = { hint: `${context.hint}_${key}`, member: key, pointer: `${context.pointer}/choices/${escapePointer(key)}`, file: context.file };
      const type = this.typeForOneof(branch, child);
      branches.push({ name: key, type, rule: 'singular', number: 0 });
    }
    members.push({ kind: 'oneof', name: inline ? schema.selector : context.member || 'value', fields: branches });
    return this.finishMessage(name, packageName, this.commentOf(schema), members);
  }

  typeReference(schema, context) {
    const reference = typeof schema.$ref === 'string' ? schema.$ref : isRecord(schema.type) && typeof schema.type.$ref === 'string' ? schema.type.$ref : undefined;
    if (reference) return { name: this.reference(reference, context), rule: 'singular' };
    if (Object.prototype.hasOwnProperty.call(schema, 'enum')) {
      const name = this.mint(context);
      const enumDeclaration = this.tryEnum(schema, name, this.files[context.file].packageName, context.pointer);
      if (enumDeclaration) {
        this.files[context.file].declarations.push(enumDeclaration);
        return { name, rule: 'singular' };
      }
    }
    if (Array.isArray(schema.type)) return { name: this.unionMessage(schema.type, context), rule: 'singular' };
    if (typeof schema.type !== 'string') throw new Error(`Schema at ${context.pointer} is missing a supported type.`);
    const primitive = PROTO_PRIMITIVES[schema.type];
    if (primitive) {
      if (schema.type === 'null') this.addImport(context.file, 'google/protobuf/struct.proto');
      return { name: primitive, rule: 'singular' };
    }
    if (schema.type === 'any') {
      this.addImport(context.file, 'google/protobuf/any.proto');
      return { name: 'google.protobuf.Any', rule: 'singular' };
    }
    if (schema.type === 'array' || schema.type === 'set') {
      if (!isRecord(schema.items)) throw new Error(`${schema.type} at ${context.pointer} requires items.`);
      if (schema.type === 'set') this.warnings.push({ path: context.pointer, code: 'protobuf.set.uniqueness', lossiness: 'unsupported-feature', message: 'Protobuf has no set type; uniqueness is not enforced on the wire.' });
      const child = { hint: `${context.hint}Item`, member: undefined, pointer: `${context.pointer}/items`, file: context.file };
      const inner = this.typeReference(schema.items, child);
      const name = inner.rule === 'singular' || inner.rule === 'optional' ? inner.name : this.wrap(inner, inner.rule === 'map' ? 'values' : 'items', child);
      return { name, rule: 'repeated' };
    }
    if (schema.type === 'map') {
      if (!isRecord(schema.values)) throw new Error(`map at ${context.pointer} requires values.`);
      const child = { hint: `${context.hint}Value`, member: undefined, pointer: `${context.pointer}/values`, file: context.file };
      const inner = this.typeReference(schema.values, child);
      const name = inner.rule === 'singular' || inner.rule === 'optional' ? inner.name : this.wrap(inner, inner.rule === 'map' ? 'values' : 'items', child);
      return { name, rule: 'map', mapKey: 'string' };
    }
    if (['object', 'tuple', 'choice'].includes(schema.type)) {
      const name = this.mint(context);
      const packageName = this.files[context.file].packageName;
      const declaration = this.buildNamed(schema, name, packageName, context);
      this.files[context.file].declarations.push(declaration);
      return { name, rule: 'singular' };
    }
    throw new Error(`Unsupported JSON Structure type ${schema.type} at ${context.pointer}.`);
  }

  typeForOneof(schema, context) {
    const resolved = this.typeReference(schema, context);
    return resolved.rule === 'singular' || resolved.rule === 'optional' ? resolved.name : this.wrap(resolved, resolved.rule === 'map' ? 'values' : 'items', context);
  }

  wrap(resolved, fieldName, context) {
    const name = this.mint(context);
    this.files[context.file].declarations.push({ kind: 'message', name, comment: undefined, members: [{ kind: 'field', field: { name: fieldName, type: resolved.name, rule: resolved.rule, mapKey: resolved.mapKey, number: 1 } }], reserved: [] });
    return name;
  }

  unionMessage(branches, context) {
    const name = this.mint(context);
    const fields = [];
    for (let index = 0; index < branches.length; index++) {
      const branch = branches[index];
      const schema = typeof branch === 'string' ? { type: branch } : branch;
      if (!isRecord(schema)) throw new Error(`Unsupported union branch at ${context.pointer}/type/${index}.`);
      const child = { hint: `${context.hint}_${index}`, member: undefined, pointer: `${context.pointer}/type/${index}`, file: context.file };
      const type = this.typeForOneof(schema, child);
      if (fields.some((field) => field.type === type)) continue;
      let fieldName = `${branchFieldStem(type)}_value`;
      if (fields.some((field) => field.name === fieldName)) fieldName = `${type.replace(/^\./, '').replace(/\./g, '_').toLowerCase()}_value`;
      fields.push({ name: fieldName, type, rule: 'singular', number: 0 });
    }
    const packageName = this.files[context.file].packageName;
    this.files[context.file].declarations.push(this.finishMessage(name, packageName, undefined, [{ kind: 'oneof', name: 'value', fields }]));
    return name;
  }

  reference(pointer, context) {
    const descriptor = this.resolveDescriptor(pointer, context.pointer);
    if (descriptor.abstract) throw new Error(at('abstract types cannot be used as a value type', descriptor.pointer));
    if (descriptor.file !== context.file) {
      this.addImport(context.file, this.files[descriptor.file].path);
      this.edges.push([this.files[context.file].packageName, descriptor.packageName]);
    }
    return descriptor.fq;
  }

  addImport(file, importPath) {
    if (!this.files[file].imports.includes(importPath)) this.files[file].imports.push(importPath);
  }

  tryEnum(schema, name, packageName, pointer) {
    if (schema.type !== 'string' || !Array.isArray(schema.enum) || schema.enum.length === 0) return undefined;
    const overrides = isRecord(schema.altenums) && isRecord(schema.altenums.proto) ? schema.altenums.proto : {};
    const symbols = [];
    for (const value of schema.enum) {
      if (typeof value !== 'string') return undefined;
      const symbol = overrides[value] === undefined ? value : overrides[value];
      if (typeof symbol !== 'string' || !IDENTIFIER.test(symbol)) {
        if (overrides[value] !== undefined) throw new Error(`altenums.proto value at ${pointer} must be a legal protobuf identifier.`);
        this.warnings.push({ path: pointer, code: 'protobuf.enum.lexical', lossiness: 'unsupported-feature', message: `Enum symbol ${JSON.stringify(value)} is not a legal protobuf identifier; the type falls back to string.` });
        return undefined;
      }
      symbols.push(symbol);
    }
    const duplicate = firstDuplicate(symbols);
    if (duplicate) throw new Error(`Enum at ${pointer} declares ${duplicate} twice.`);
    const unspecified = `${screamingSnake(name)}_UNSPECIFIED`;
    if (symbols.includes(unspecified)) throw new Error(at(`enum symbol '${unspecified}' collides with the synthesized zero value`, pointer));
    const fq = qualify(packageName, name);
    const { numbers, reserved } = this.numberEnum(fq, symbols, schema, pointer);
    const values = [{ name: unspecified, number: 0 }, ...symbols.map((symbol, index) => ({ name: symbol, number: numbers[index] }))];
    for (const value of values) {
      const scoped = qualify(packageName, value.name);
      if (this.enumSymbols.has(scoped)) throw new Error(at(`enum symbol '${value.name}' is already declared by enum \`${this.enumSymbols.get(scoped)}\`; protobuf enum values are siblings of their type, so they must be unique within the enclosing scope`, pointer));
      this.enumSymbols.set(scoped, fq);
    }
    return { kind: 'enum', name, comment: this.commentOf(schema), values, reserved };
  }

  finishMessage(name, packageName, comment, members) {
    const fq = qualify(packageName, name);
    const fields = members.flatMap((member) => member.kind === 'field' ? [member.field] : member.fields);
    const names = fields.map((field) => field.name);
    const duplicate = firstDuplicate(names);
    if (duplicate) throw new Error(`Field ${duplicate} is declared twice in message ${fq}.`);
    const lockEntry = isRecord(this.lockInput?.messages) && isRecord(this.lockInput.messages[fq]) ? this.lockInput.messages[fq] : {};
    const lockedFields = isRecord(lockEntry.fields) ? lockEntry.fields : {};
    const reserved = Array.isArray(lockEntry.reserved) ? lockEntry.reserved.filter(Number.isInteger) : [];
    const taken = new Set(reserved);
    const assigned = new Map();
    for (const field of fields) if (field.pin !== undefined) {
      if (lockedFields[field.name] !== undefined && lockedFields[field.name] !== field.pin) throw new Error(`field '${field.name}' is pinned to ${field.pin} but locked at ${lockedFields[field.name]} (in message ${fq})`);
      if (taken.has(field.pin)) throw new Error(`number ${field.pin} is pinned twice (in message ${fq})`);
      taken.add(field.pin); assigned.set(field.name, field.pin);
    }
    for (const [fieldName, number] of Object.entries(lockedFields)) {
      if (!Number.isInteger(number)) continue;
      if (assigned.has(fieldName)) continue;
      if (names.includes(fieldName)) {
        if (taken.has(number)) throw new Error(`Lock assigns number ${number} twice in ${fq}.`);
        taken.add(number); assigned.set(fieldName, number);
      } else { reserved.push(number); taken.add(number); }
    }
    let next = 1;
    for (const field of fields) {
      if (!assigned.has(field.name)) {
        while (taken.has(next) || reservedFieldNumber(next)) next++;
        assigned.set(field.name, next); taken.add(next);
      }
      field.number = assigned.get(field.name);
    }
    const output = { fields: Object.fromEntries(names.map((fieldName) => [fieldName, assigned.get(fieldName)])) };
    const uniqueReserved = [...new Set(reserved)].sort((left, right) => left - right);
    if (uniqueReserved.length) output.reserved = uniqueReserved;
    this.lockOutput.messages[fq] = output;
    return { kind: 'message', name, comment, members, reserved: uniqueReserved };
  }

  numberEnum(fq, symbols, schema, pointer) {
    const pins = isRecord(schema.protoNumbers) ? schema.protoNumbers : {};
    const lockEntry = isRecord(this.lockInput?.enums) && isRecord(this.lockInput.enums[fq]) ? this.lockInput.enums[fq] : {};
    const locked = isRecord(lockEntry.values) ? lockEntry.values : {};
    const reserved = Array.isArray(lockEntry.reserved) ? lockEntry.reserved.filter(Number.isInteger) : [];
    for (const [symbol, number] of Object.entries(locked)) if (!symbols.includes(symbol) && Number.isInteger(number)) reserved.push(number);
    const taken = new Set([0, ...reserved]);
    const assigned = new Map();
    for (const symbol of symbols) {
      const pin = pins[symbol];
      const lockedNumber = locked[symbol];
      if (pin !== undefined && (!Number.isInteger(pin) || pin < 1 || pin > 2147483647)) throw new Error(at(`\`protoNumbers\` value ${String(pin)} for '${symbol}' is outside the int32 range protobuf enum values occupy`, pointer));
      if (pin !== undefined && lockedNumber !== undefined && pin !== lockedNumber) throw new Error(`value '${symbol}' is pinned to ${pin} but locked at ${lockedNumber} (in message ${fq})`);
      const number = pin ?? lockedNumber;
      if (number !== undefined) {
        if (!Number.isInteger(number) || number < 1 || number > 2147483647 || taken.has(number)) throw new Error(`Invalid or duplicate enum number ${String(number)} in ${fq}.`);
        taken.add(number); assigned.set(symbol, number);
      }
    }
    let next = 1;
    const numbers = symbols.map((symbol) => {
      if (assigned.has(symbol)) return assigned.get(symbol);
      while (taken.has(next)) next++;
      taken.add(next); assigned.set(symbol, next); return next;
    });
    const output = { values: Object.fromEntries(symbols.map((symbol) => [symbol, assigned.get(symbol)])) };
    const uniqueReserved = [...new Set(reserved)].sort((left, right) => left - right);
    if (uniqueReserved.length) output.reserved = uniqueReserved;
    this.lockOutput.enums[fq] = output;
    return { numbers, reserved: uniqueReserved };
  }

  mint(context) {
    const packageName = this.files[context.file].packageName;
    const base = context.hint;
    if (!IDENTIFIER.test(base)) throw new Error(`Generated name ${base} at ${context.pointer} is not a legal protobuf identifier.`);
    let candidate = base;
    let suffix = 1;
    while (this.taken.has(qualify(packageName, candidate))) candidate = `${base}_${suffix++}`;
    if (candidate !== base) this.warnings.push({ path: context.pointer, code: 'protobuf.name.suffixed', lossiness: 'metadata', message: `Generated name ${base} was already taken and became ${candidate}.` });
    this.taken.add(qualify(packageName, candidate));
    return candidate;
  }

  checkAdditionalProperties(schema, pointer) {
    const open = schema.additionalProperties !== undefined && schema.additionalProperties !== false;
    if (!open) return;
    if (this.options.additional_properties === 'error') throw new Error(at('protobuf messages are closed; `additionalProperties` cannot be carried and undeclared properties will not be transmitted', pointer));
    this.warnings.push({ path: pointer, code: 'protobuf.additionalProperties.dropped', lossiness: 'data-loss', message: 'Protobuf messages are closed; undeclared properties will not be transmitted.' });
  }

  commentOf(schema) { return this.options.emit_comments === false || typeof schema.description !== 'string' ? undefined : schema.description; }

  checkImportCycles() {
    const adjacency = new Map();
    for (const [from, to] of this.edges) {
      if (from === to) continue;
      const targets = adjacency.get(from) || [];
      if (!targets.includes(to)) targets.push(to);
      adjacency.set(from, targets);
    }
    const done = new Set();
    const visit = (node, path) => {
      const index = path.indexOf(node);
      if (index >= 0) throw new Error(`packages '${path[index]}' and '${path[path.length - 1]}' reference each other; protoc forbids circular file imports. Put mutually-referencing types in one namespace.`);
      if (done.has(node)) return;
      for (const target of adjacency.get(node) || []) visit(target, [...path, node]);
      done.add(node);
    };
    for (const node of adjacency.keys()) visit(node, []);
  }
}

function renderFile(file) {
  let output = 'syntax = "proto3";\n';
  if (file.packageName) output += `\npackage ${file.packageName};\n`;
  const imports = [...file.imports].sort((left, right) => {
    const leftWellKnown = left.startsWith('google/protobuf/');
    const rightWellKnown = right.startsWith('google/protobuf/');
    return leftWellKnown === rightWellKnown ? left.localeCompare(right) : leftWellKnown ? -1 : 1;
  });
  if (imports.length) output += `\n${imports.map((entry) => `import "${entry}";`).join('\n')}\n`;
  for (const declaration of file.declarations) output += `\n${renderDeclaration(declaration)}`;
  return output;
}

function renderComment(comment, depth) {
  if (!comment) return '';
  const indent = '  '.repeat(depth);
  return String(comment).split(/\r?\n/).map((line) => `${indent}// ${line}\n`).join('');
}

function renderDeclaration(declaration, depth = 0) {
  const indent = '  '.repeat(depth);
  if (declaration.kind === 'enum') {
    let output = `${renderComment(declaration.comment, depth)}${indent}enum ${declaration.name} {\n`;
    if (declaration.reserved.length) output += `${indent}  reserved ${[...declaration.reserved].sort((a, b) => a - b).join(', ')};\n`;
    for (const value of declaration.values) output += `${renderComment(value.comment, depth + 1)}${indent}  ${value.name} = ${value.number};\n`;
    return `${output}${indent}}\n`;
  }
  let output = `${renderComment(declaration.comment, depth)}${indent}message ${declaration.name} {\n`;
  for (const member of declaration.members) {
    if (member.kind === 'field') output += renderField(member.field, depth + 1);
    else {
      output += `${'  '.repeat(depth + 1)}oneof ${member.name} {\n`;
      for (const field of member.fields) output += renderField(field, depth + 2);
      output += `${'  '.repeat(depth + 1)}}\n`;
    }
  }
  if (declaration.reserved.length) output += `${'  '.repeat(depth + 1)}reserved ${[...declaration.reserved].sort((a, b) => a - b).join(', ')};\n`;
  return `${output}${indent}}\n`;
}

function renderField(field, depth) {
  const indent = '  '.repeat(depth);
  let declaration;
  if (field.rule === 'optional') declaration = `optional ${field.type} ${field.name}`;
  else if (field.rule === 'repeated') declaration = `repeated ${field.type} ${field.name}`;
  else if (field.rule === 'map') declaration = `map<${field.mapKey || 'string'}, ${field.type}> ${field.name}`;
  else declaration = `${field.type} ${field.name}`;
  return `${renderComment(field.comment, depth)}${indent}${declaration} = ${field.number};\n`;
}

function generateProto(document, sourceName, options) { return new ProtoGenerator(document, sourceName, options).run(); }

module.exports = { generateProto };