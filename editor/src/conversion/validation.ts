import { parseDocument } from '../parser.js';

const CORE_SCHEMA_URI = 'https://json-structure.org/meta/core/v0/#';
const EXTENDED_SCHEMA_URI = 'https://json-structure.org/meta/extended/v0/#';
const VALIDATION_SCHEMA_URI = 'https://json-structure.org/meta/validation/v0/#';
const JSON_SCHEMA_URI = 'https://json-schema.org/draft/2020-12/schema';
const JSON_OUTPUT_FORMATS = new Set(['avro', 'data-package', 'iceberg', 'json-schema', 'json-structure', 'jtd', 'tmsl']);

const PROTO_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PROTO_RESERVED_KEYWORDS = new Set([
  'syntax', 'import', 'weak', 'public', 'package', 'option', 'message', 'enum', 'service',
  'extend', 'extensions', 'group', 'oneof', 'map', 'repeated', 'optional', 'required',
  'reserved', 'rpc', 'returns', 'stream', 'to', 'max',
]);

const PROTO_FIELD_NUMBER_MIN = 1;
const PROTO_FIELD_NUMBER_MAX = 536870911;
const PROTO_IMPLEMENTATION_RESERVED_MIN = 19000;
const PROTO_IMPLEMENTATION_RESERVED_MAX = 19999;
const PROTO_ENUM_NUMBER_MIN = -2147483648;
const PROTO_ENUM_NUMBER_MAX = 2147483647;
interface ProtoReservedRange { readonly start: number; readonly end: number }
function protoImplementationReserved(value: number): boolean {
  return value >= PROTO_IMPLEMENTATION_RESERVED_MIN && value <= PROTO_IMPLEMENTATION_RESERVED_MAX;
}
function protoRangesOverlap(left: ProtoReservedRange, right: ProtoReservedRange): boolean {
  return left.start <= right.end && right.start <= left.end;
}
// Lock reserved entries are inclusive numbers or canonical {from,to} ranges.
function validateProtoLockRanges(value: unknown, path: string, minimum: number, maximum: number, excludeImplementationRange: boolean): readonly ProtoReservedRange[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`Generated Protobuf lock ${path} must be an array of numbers or {from,to} ranges.`);
  const ranges: ProtoReservedRange[] = [];
  value.forEach((entry, index) => {
    let start: number;
    let end: number;
    if (typeof entry === 'number' && Number.isSafeInteger(entry)) {
      start = entry;
      end = entry;
    } else if (isRecord(entry) && Object.keys(entry).length === 2 && Object.prototype.hasOwnProperty.call(entry, 'from') && Object.prototype.hasOwnProperty.call(entry, 'to') && typeof entry.from === 'number' && Number.isSafeInteger(entry.from) && typeof entry.to === 'number' && Number.isSafeInteger(entry.to)) {
      start = entry.from;
      end = entry.to;
    } else {
      throw new Error(`Generated Protobuf lock ${path}[${index}] must be an integer or an object with integer from/to endpoints.`);
    }
    if (start < minimum || start > maximum || end < minimum || end > maximum) throw new Error(`Generated Protobuf lock ${path}[${index}] has endpoints ${start}..${end} outside ${minimum}..${maximum}.`);
    if (start > end) throw new Error(`Generated Protobuf lock ${path}[${index}] is reversed (${start} to ${end}); from must not exceed to.`);
    if (excludeImplementationRange && (protoImplementationReserved(start) || protoImplementationReserved(end))) throw new Error(`Generated Protobuf lock ${path}[${index}] uses implementation-reserved endpoint ${protoImplementationReserved(start) ? start : end}; endpoints 19000..19999 are not allowed.`);
    const range = { start, end };
    const previous = ranges[ranges.length - 1];
    if (previous && start < previous.start) throw new Error(`Generated Protobuf lock ${path}[${index}] is out of order; reserved entries must be sorted by their from endpoint.`);
    if (previous && protoRangesOverlap(previous, range)) throw new Error(`Generated Protobuf lock ${path}[${index}] overlaps an earlier reserved entry.`);
    ranges.push(range);
  });
  return ranges;
}
function validateProtoLockNumber(value: unknown, path: string, minimum: number, maximum: number, excludeImplementationRange: boolean): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum || (excludeImplementationRange && protoImplementationReserved(value))) throw new Error(`Generated Protobuf lock ${path} has invalid number ${String(value)}; expected ${minimum}..${maximum}${excludeImplementationRange ? ' excluding 19000..19999' : ''}.`);
  return value;
}
function validateProtoLock(value: Record<string, unknown>, path: string): void {
  if (value.version !== 2 || !isRecord(value.messages) || !isRecord(value.enums)) throw new Error(`Generated Protobuf lock ${path} must contain version 2 and object-valued messages and enums sections.`);
  for (const key of Object.keys(value)) if (!['version', 'messages', 'enums'].includes(key)) throw new Error(`Generated Protobuf lock ${path} has unsupported top-level property ${key}.`);
  for (const [name, entry] of Object.entries(value.messages)) {
    if (!isRecord(entry) || !isRecord(entry.fields)) throw new Error(`Generated Protobuf lock ${path}.messages.${name} must contain an object-valued fields section.`);
    for (const key of Object.keys(entry)) if (!['fields', 'reserved'].includes(key)) throw new Error(`Generated Protobuf lock ${path}.messages.${name} has unsupported property ${key}.`);
    const assigned = new Set<number>();
    for (const [fieldName, number] of Object.entries(entry.fields)) {
      const checked = validateProtoLockNumber(number, `${path}.messages.${name}.fields.${fieldName}`, PROTO_FIELD_NUMBER_MIN, PROTO_FIELD_NUMBER_MAX, true);
      if (assigned.has(checked)) throw new Error(`Generated Protobuf lock ${path}.messages.${name}.fields assigns number ${checked} more than once.`);
      assigned.add(checked);
    }
    const reserved = validateProtoLockRanges(entry.reserved, `${path}.messages.${name}.reserved`, PROTO_FIELD_NUMBER_MIN, PROTO_FIELD_NUMBER_MAX, true);
    for (const number of assigned) if (reserved.some((range) => number >= range.start && number <= range.end)) throw new Error(`Generated Protobuf lock ${path}.messages.${name} reserves assigned number ${number}.`);
  }
  for (const [name, entry] of Object.entries(value.enums)) {
    if (!isRecord(entry) || !isRecord(entry.values)) throw new Error(`Generated Protobuf lock ${path}.enums.${name} must contain an object-valued values section.`);
    for (const key of Object.keys(entry)) if (!['values', 'reserved'].includes(key)) throw new Error(`Generated Protobuf lock ${path}.enums.${name} has unsupported property ${key}.`);
    const assigned = new Set<number>();
    for (const [symbol, number] of Object.entries(entry.values)) {
      const checked = validateProtoLockNumber(number, `${path}.enums.${name}.values.${symbol}`, PROTO_ENUM_NUMBER_MIN, PROTO_ENUM_NUMBER_MAX, false);
      if (assigned.has(checked)) throw new Error(`Generated Protobuf lock ${path}.enums.${name}.values assigns number ${checked} more than once.`);
      assigned.add(checked);
    }
    const reserved = validateProtoLockRanges(entry.reserved, `${path}.enums.${name}.reserved`, PROTO_ENUM_NUMBER_MIN, PROTO_ENUM_NUMBER_MAX, false);
    for (const number of assigned) if (reserved.some((range) => number >= range.start && number <= range.end)) throw new Error(`Generated Protobuf lock ${path}.enums.${name} reserves assigned number ${number}.`);
  }
}

type ProtoTokenKind = 'identifier' | 'number' | 'string' | 'symbol' | 'eof';
interface ProtoToken { readonly kind: ProtoTokenKind; readonly text: string; readonly offset: number }

function protoError(path: string, message: string): never {
  throw new Error(`Generated Protobuf output ${path} is invalid: ${message}.`);
}

function tokenizeProto(source: string, path: string): readonly ProtoToken[] {
  const tokens: ProtoToken[] = [];
  let offset = 0;
  while (offset < source.length) {
    const character = source[offset];
    if (/\s/.test(character)) { offset++; continue; }
    if (source.startsWith('//', offset)) {
      const end = source.indexOf('\n', offset + 2);
      offset = end < 0 ? source.length : end + 1;
      continue;
    }
    if (source.startsWith('/*', offset)) {
      const end = source.indexOf('*/', offset + 2);
      if (end < 0) protoError(path, 'unterminated block comment');
      offset = end + 2;
      continue;
    }
    if (/[A-Za-z_]/.test(character)) {
      const start = offset++;
      while (offset < source.length && /[A-Za-z0-9_]/.test(source[offset])) offset++;
      tokens.push({ kind: 'identifier', text: source.slice(start, offset), offset: start });
      continue;
    }
    if (/[0-9]/.test(character)) {
      const start = offset++;
      while (offset < source.length && /[0-9]/.test(source[offset])) offset++;
      tokens.push({ kind: 'number', text: source.slice(start, offset), offset: start });
      continue;
    }
    if (character === '"' || character === "'") {
      const start = offset++;
      let value = '';
      let closed = false;
      while (offset < source.length) {
        const current = source[offset++];
        if (current === character) { closed = true; break; }
        if (current === '\\') {
          if (offset >= source.length) break;
          value += source[offset++];
        } else {
          if (current === '\n' || current === '\r') protoError(path, 'newline in string literal');
          value += current;
        }
      }
      if (!closed) protoError(path, 'unterminated string literal');
      tokens.push({ kind: 'string', text: value, offset: start });
      continue;
    }
    if ('{}()[\];=,.<>:+-'.includes(character)) {
      tokens.push({ kind: 'symbol', text: character, offset });
      offset++;
      continue;
    }
    protoError(path, `unexpected character ${JSON.stringify(character)}`);
  }
  tokens.push({ kind: 'eof', text: '', offset: source.length });
  return tokens;
}

class ProtoGrammarParser {
  private index = 0;
  constructor(private readonly tokens: readonly ProtoToken[], private readonly path: string) {}

  parse(): void {
    this.word('syntax');
    this.symbol('=');
    const syntax = this.string();
    if (syntax !== 'proto3') protoError(this.path, `syntax must be \"proto3\", got ${JSON.stringify(syntax)}`);
    this.symbol(';');
    let packageSeen = false;
    const declarations = new Set<string>();
    while (!this.atEnd()) {
      if (this.acceptWord('package')) {
        if (packageSeen) protoError(this.path, 'package is declared more than once');
        packageSeen = true;
        this.fullName();
        this.symbol(';');
      } else if (this.acceptWord('import')) {
        this.acceptWord('weak');
        this.acceptWord('public');
        this.string();
        this.symbol(';');
      } else if (this.peekWord('message')) {
        this.message('', declarations);
      } else if (this.peekWord('enum')) {
        this.enum('', declarations);
      } else {
        protoError(this.path, `unexpected top-level token ${JSON.stringify(this.peek().text)}`);
      }
    }
    if (declarations.size === 0) protoError(this.path, 'no message or enum declaration was found');
  }

  private message(scope: string, declarations: Set<string>): void {
    this.word('message');
    const name = this.identifier();
    const qualified = scope ? scope + '.' + name : name;
    if (declarations.has(qualified)) protoError(this.path, `duplicate declaration ${qualified}`);
    declarations.add(qualified);
    this.symbol('{');
    const members = new Set<string>();
    const numbers = new Set<number>();
    const reservedRanges: ProtoReservedRange[] = [];
    while (!this.acceptSymbol('}')) {
      if (this.atEnd()) protoError(this.path, `message ${qualified} is missing a closing brace`);
      if (this.peekWord('message')) this.message(qualified, declarations);
      else if (this.peekWord('enum')) this.enum(qualified, declarations);
      else if (this.peekWord('oneof')) this.oneof(members, numbers, reservedRanges);
      else if (this.peekWord('reserved')) this.reserved(reservedRanges, 'field');
      else this.field(members, numbers, reservedRanges, false);
    }
  }

  private enum(scope: string, declarations: Set<string>): void {
    this.word('enum');
    const name = this.identifier();
    const qualified = scope ? scope + '.' + name : name;
    if (declarations.has(qualified)) protoError(this.path, `duplicate declaration ${qualified}`);
    declarations.add(qualified);
    this.symbol('{');
    const names = new Set<string>();
    const numbers = new Set<number>();
    const reservedRanges: ProtoReservedRange[] = [];
    while (!this.acceptSymbol('}')) {
      if (this.atEnd()) protoError(this.path, `enum ${qualified} is missing a closing brace`);
      if (this.peekWord('reserved')) { this.reserved(reservedRanges, 'enum'); continue; }
      const valueName = this.identifier();
      if (names.has(valueName)) protoError(this.path, `duplicate enum value ${valueName} in ${qualified}`);
      names.add(valueName);
      this.symbol('=');
      const value = this.integer();
      if (value < PROTO_ENUM_NUMBER_MIN || value > PROTO_ENUM_NUMBER_MAX || numbers.has(value) || reservedRanges.some((range) => value >= range.start && value <= range.end)) protoError(this.path, `invalid, reserved, or duplicate enum number ${value} in ${qualified}`);
      numbers.add(value);
      this.skipOptions();
      this.symbol(';');
    }
  }

  private oneof(members: Set<string>, numbers: Set<number>, reservedRanges: ProtoReservedRange[]): void {
    this.word('oneof');
    const name = this.identifier();
    if (members.has(name)) protoError(this.path, `duplicate member ${name}`);
    members.add(name);
    this.symbol('{');
    while (!this.acceptSymbol('}')) {
      if (this.atEnd()) protoError(this.path, `oneof ${name} is missing a closing brace`);
      this.field(members, numbers, reservedRanges, true);
    }
  }

  private field(members: Set<string>, numbers: Set<number>, reservedRanges: readonly ProtoReservedRange[], inOneof: boolean): void {
    let map = false;
    if (!inOneof) {
      if (this.acceptWord('optional') || this.acceptWord('repeated')) {
      } else if (this.acceptWord('map')) {
        map = true;
      }
    }
    if (map) {
      this.symbol('<');
      this.typeName();
      this.symbol(',');
      this.typeName();
      this.symbol('>');
    } else {
      this.typeName();
    }
    const name = this.identifier();
    if (members.has(name)) protoError(this.path, `duplicate field or oneof ${name}`);
    members.add(name);
    this.symbol('=');
    const number = this.integer();
    if (number < PROTO_FIELD_NUMBER_MIN || number > PROTO_FIELD_NUMBER_MAX || protoImplementationReserved(number) || numbers.has(number) || reservedRanges.some((range) => number >= range.start && number <= range.end)) protoError(this.path, `invalid, reserved, or duplicate field number ${number}; field numbers must be 1..536870911 excluding 19000..19999`);
    numbers.add(number);
    this.skipOptions();
    this.symbol(';');
  }

  private reserved(ranges: ProtoReservedRange[], kind: 'field' | 'enum'): void {
    this.word('reserved');
    do {
      if (this.peek().kind === 'string') this.string();
      else {
        const minimum = kind === 'field' ? PROTO_FIELD_NUMBER_MIN : PROTO_ENUM_NUMBER_MIN;
        const maximum = kind === 'field' ? PROTO_FIELD_NUMBER_MAX : PROTO_ENUM_NUMBER_MAX;
        const start = this.integer();
        const end = this.acceptWord('to') ? (this.acceptWord('max') ? maximum : this.integer()) : start;
        if (start < minimum || start > maximum || end < minimum || end > maximum) protoError(this.path, 'reserved ' + kind + ' range ' + start + ' to ' + end + ' is outside ' + minimum + '..' + maximum);
        if (start > end) protoError(this.path, 'reserved ' + kind + ' range ' + start + ' to ' + end + ' is reversed');
        if (kind === 'field' && (protoImplementationReserved(start) || protoImplementationReserved(end))) protoError(this.path, 'reserved field range ' + start + ' to ' + end + ' uses implementation-reserved endpoint 19000..19999');
        const range = { start, end };
        if (ranges.some((existing) => protoRangesOverlap(existing, range))) protoError(this.path, 'reserved ' + kind + ' range ' + start + ' to ' + end + ' overlaps another reserved range');
        ranges.push(range);
      }
    } while (this.acceptSymbol(','));
    this.symbol(';');
  }

  private typeName(): string {
    let result = '';
    if (this.acceptSymbol('.')) result = '.';
    result += this.identifier();
    while (this.acceptSymbol('.')) result += '.' + this.identifier();
    return result;
  }

  private fullName(): string { return this.typeName(); }

  private skipOptions(): void {
    if (!this.acceptSymbol('[')) return;
    let depth = 1;
    while (depth > 0) {
      if (this.atEnd()) protoError(this.path, 'field options are missing a closing bracket');
      if (this.acceptSymbol('[')) depth++;
      else if (this.acceptSymbol(']')) depth--;
      else this.index++;
    }
  }

  private identifier(): string {
    const token = this.take();
    if (token.kind !== 'identifier' || !PROTO_IDENTIFIER.test(token.text) || PROTO_RESERVED_KEYWORDS.has(token.text)) protoError(this.path, `${JSON.stringify(token.text)} is not a legal protobuf identifier`);
    return token.text;
  }

  private integer(): number {
    const negative = this.acceptSymbol('-');
    const token = this.take();
    if (token.kind !== 'number') protoError(this.path, `expected an integer, got ${JSON.stringify(token.text)}`);
    const value = Number(token.text) * (negative ? -1 : 1);
    if (!Number.isSafeInteger(value)) protoError(this.path, `integer ${token.text} is outside the safe range`);
    return value;
  }

  private string(): string {
    const token = this.take();
    if (token.kind !== 'string') protoError(this.path, `expected a string literal, got ${JSON.stringify(token.text)}`);
    return token.text;
  }

  private word(expected: string): void {
    if (!this.acceptWord(expected)) protoError(this.path, `expected ${expected}, got ${JSON.stringify(this.peek().text)}`);
  }

  private symbol(expected: string): void {
    if (!this.acceptSymbol(expected)) protoError(this.path, `expected \"${expected}\", got ${JSON.stringify(this.peek().text)}`);
  }

  private acceptWord(word: string): boolean {
    if (this.peek().kind === 'identifier' && this.peek().text === word) { this.index++; return true; }
    return false;
  }

  private acceptSymbol(symbol: string): boolean {
    if (this.peek().kind === 'symbol' && this.peek().text === symbol) { this.index++; return true; }
    return false;
  }

  private peekWord(word: string): boolean { return this.peek().kind === 'identifier' && this.peek().text === word; }
  private peek(): ProtoToken { return this.tokens[this.index]; }
  private take(): ProtoToken { const token = this.peek(); this.index++; return token; }
  private atEnd(): boolean { return this.peek().kind === 'eof'; }
}

function validateProto3Source(path: string, source: string): void {
  if (!source.startsWith('syntax = "proto3";\n') || !source.endsWith('\n')) protoError(path, 'source must begin with the canonical proto3 syntax declaration and end with a newline');
  new ProtoGrammarParser(tokenizeProto(source, path), path).parse();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function pointerValue(root: unknown, pointer: string): unknown {
  if (!pointer.startsWith('#/')) return undefined;
  return pointer.slice(2).split('/').map(token => token.replace(/~1/g, '/').replace(/~0/g, '~')).reduce<unknown>((value, token) =>
    isRecord(value) && Object.prototype.hasOwnProperty.call(value, token) ? value[token] : undefined, root);
}

function validateJsonStructure(document: Record<string, unknown>, path: string): void {
  if (![CORE_SCHEMA_URI, EXTENDED_SCHEMA_URI, VALIDATION_SCHEMA_URI].includes(String(document.$schema))) throw new Error(`Generated JSON Structure output ${path} has a non-canonical schema URI.`);
  if (typeof document.$id !== 'string') throw new Error(`Generated JSON Structure output ${path} requires an absolute $id URI.`);
  try {
    if (!new URL(document.$id).protocol) throw new Error();
  } catch {
    throw new Error(`Generated JSON Structure output ${path} requires an absolute $id URI.`);
  }
  if (document.name !== undefined && (typeof document.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(document.name))) throw new Error(`Generated JSON Structure output ${path} requires a valid name.`);
  if (document.$root !== undefined && (typeof document.$root !== 'string' || !isRecord(pointerValue(document, document.$root)))) throw new Error(`Generated JSON Structure output ${path} has an unresolved $root.`);
  if (document.$root === undefined && !Object.prototype.hasOwnProperty.call(document, 'type')) throw new Error(`Generated JSON Structure output ${path} requires either $root or a top-level type declaration.`);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!isRecord(value)) return;
    if (typeof value.$ref === 'string' && value.$ref.startsWith('#') && pointerValue(document, value.$ref) === undefined) {
      throw new Error(`Generated JSON Structure output ${path} has an unresolved reference ${value.$ref}.`);
    }
    Object.values(value).forEach(visit);
  };
  visit(document);
}

export function validateGeneratedConversionFiles(targetFormat: string, files: Readonly<Record<string, Uint8Array>>): void {
  const entries = Object.entries(files);
  if (entries.length === 0) throw new Error('Converter produced no output files.');
  for (const [path, content] of entries) {
    if (content.byteLength === 0) throw new Error(`Generated output ${path} is empty.`);
    if (targetFormat === 'protobuf' && path.endsWith('.proto')) {
      const text = new TextDecoder().decode(content);
      validateProto3Source(path, text);
      continue;
    }
    if (!JSON_OUTPUT_FORMATS.has(targetFormat) && targetFormat !== 'protobuf') continue;
    let value: unknown;
    const text = new TextDecoder().decode(content);
    try { value = JSON.parse(text); }
    catch { throw new Error(`Generated output ${path} is not valid JSON.`); }
    if (targetFormat === 'avro') {
      if (typeof value === 'string' && value.length > 0) continue;
      if (Array.isArray(value) && value.length > 0) continue;
      if (isRecord(value) && Object.prototype.hasOwnProperty.call(value, 'type')) continue;
      throw new Error(`Generated Avro output ${path} has no root type.`);
    }
    if (!isRecord(value)) throw new Error(`Generated output ${path} must be a JSON object.`);
    if (targetFormat === 'protobuf') {
      if (path !== 'proto-numbers.json' || !isRecord(value)) throw new Error(`Generated Protobuf lock ${path} is invalid.`);
      validateProtoLock(value, path);
      continue;
    }
    if (targetFormat === 'json-structure') {
      validateJsonStructure(value, path);
      const parsed = parseDocument(`conversion-output://${encodeURIComponent(path)}`, text);
      const errors = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
      if (errors.length > 0) {
        const first = errors[0];
        throw new Error(`Generated JSON Structure output ${path} failed canonical validation: ${first.code} at ${first.location?.pointer || '/'}: ${first.message}`);
      }
    }
    else if (targetFormat === 'json-schema' && value.$schema !== JSON_SCHEMA_URI) throw new Error(`Generated JSON Schema output ${path} has an unsupported dialect.`);
  }
}