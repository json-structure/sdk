import type { Diagnostic, RecoveryState, SourceLocation, TextPosition, TextRange } from './contracts.js';
import { nodeId, type ModelNode, type NormalizedDocument } from './model.js';

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
  const model: NormalizedDocument = { uri, recovery: 'valid', nodes, rootPointer: typeof root?.$root === 'string' ? root.$root : undefined, unknownKeysPreserved: true };
  return { model, value: parsed.value, diagnostics: parsed.diagnostics, recovery: 'valid' };
}
function declarationKind(value: unknown): ModelNode['kind'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'unknown';
  const type = (value as Record<string, unknown>).type;
  if (typeof type !== 'string') return 'unknown';
  if (type === 'object') return 'object';
  if (type === 'array') return 'array';
  if (type === 'set') return 'set';
  if (type === 'map') return 'map';
  if (type === 'tuple') return 'tuple';
  if (type === 'choice') return 'choice';
  if (type === 'union') return 'union';
  if (['string', 'str', 'int32', 'float64', 'number', 'boolean', 'bool'].includes(type)) return 'primitive';
  return 'unknown';
}
