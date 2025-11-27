/**
 * JSON Structure Serialization Helpers
 * 
 * This module provides classes and utilities for correctly serializing
 * JSON Structure types according to the specification. Per the JSON Structure spec,
 * certain types must be serialized as strings because JSON numbers (IEEE 754 double)
 * cannot accurately represent their full range.
 * 
 * Types that serialize as strings:
 * - int64, uint64: Full 64-bit range exceeds JSON number precision
 * - int128, uint128: Represented as BigInt, serialized as strings
 * - decimal: Arbitrary precision, serialized as strings
 * - duration: ISO 8601 duration format (e.g., "PT1H30M")
 * - date, time, datetime: ISO 8601/RFC 3339 formats
 * - binary: Base64 encoded
 * - uuid, uri, jsonpointer: String representations
 */

/**
 * Int64 wrapper that serializes to/from a JSON string.
 * Use this for JSON Structure int64 fields to preserve precision.
 * 
 * @example
 * ```typescript
 * const id = new Int64("9223372036854775807");
 * JSON.stringify({ id }); // '{"id":"9223372036854775807"}'
 * ```
 */
export class Int64 {
  private readonly value: bigint;

  constructor(value: bigint | string | number) {
    if (typeof value === 'string') {
      this.value = BigInt(value);
    } else if (typeof value === 'number') {
      this.value = BigInt(Math.trunc(value));
    } else {
      this.value = value;
    }
    
    // Validate range
    if (this.value < Int64.MIN_VALUE || this.value > Int64.MAX_VALUE) {
      throw new RangeError(`Value ${this.value} is out of int64 range`);
    }
  }

  static readonly MIN_VALUE = BigInt('-9223372036854775808');
  static readonly MAX_VALUE = BigInt('9223372036854775807');

  /** Get the value as a bigint. */
  toBigInt(): bigint {
    return this.value;
  }

  /** Get the value as a number (may lose precision for large values). */
  toNumber(): number {
    return Number(this.value);
  }

  /** Get the string representation. */
  toString(): string {
    return this.value.toString();
  }

  /** Custom JSON serialization - outputs as string. */
  toJSON(): string {
    return this.value.toString();
  }

  /** Parse from JSON string or number. */
  static fromJSON(value: string | number): Int64 {
    return new Int64(value);
  }
}

/**
 * UInt64 wrapper that serializes to/from a JSON string.
 * Use this for JSON Structure uint64 fields to preserve precision.
 */
export class UInt64 {
  private readonly value: bigint;

  constructor(value: bigint | string | number) {
    if (typeof value === 'string') {
      this.value = BigInt(value);
    } else if (typeof value === 'number') {
      this.value = BigInt(Math.trunc(value));
    } else {
      this.value = value;
    }
    
    // Validate range
    if (this.value < UInt64.MIN_VALUE || this.value > UInt64.MAX_VALUE) {
      throw new RangeError(`Value ${this.value} is out of uint64 range`);
    }
  }

  static readonly MIN_VALUE = BigInt('0');
  static readonly MAX_VALUE = BigInt('18446744073709551615');

  toBigInt(): bigint {
    return this.value;
  }

  toNumber(): number {
    return Number(this.value);
  }

  toString(): string {
    return this.value.toString();
  }

  toJSON(): string {
    return this.value.toString();
  }

  static fromJSON(value: string | number): UInt64 {
    return new UInt64(value);
  }
}

/**
 * Int128 wrapper that serializes to/from a JSON string.
 * Use this for JSON Structure int128 fields.
 */
export class Int128 {
  private readonly value: bigint;

  constructor(value: bigint | string) {
    this.value = typeof value === 'string' ? BigInt(value) : value;
    
    // Validate range
    if (this.value < Int128.MIN_VALUE || this.value > Int128.MAX_VALUE) {
      throw new RangeError(`Value ${this.value} is out of int128 range`);
    }
  }

  static readonly MIN_VALUE = BigInt('-170141183460469231731687303715884105728');
  static readonly MAX_VALUE = BigInt('170141183460469231731687303715884105727');

  toBigInt(): bigint {
    return this.value;
  }

  toString(): string {
    return this.value.toString();
  }

  toJSON(): string {
    return this.value.toString();
  }

  static fromJSON(value: string): Int128 {
    return new Int128(value);
  }
}

/**
 * UInt128 wrapper that serializes to/from a JSON string.
 * Use this for JSON Structure uint128 fields.
 */
export class UInt128 {
  private readonly value: bigint;

  constructor(value: bigint | string) {
    this.value = typeof value === 'string' ? BigInt(value) : value;
    
    // Validate range
    if (this.value < UInt128.MIN_VALUE || this.value > UInt128.MAX_VALUE) {
      throw new RangeError(`Value ${this.value} is out of uint128 range`);
    }
  }

  static readonly MIN_VALUE = BigInt('0');
  static readonly MAX_VALUE = BigInt('340282366920938463463374607431768211455');

  toBigInt(): bigint {
    return this.value;
  }

  toString(): string {
    return this.value.toString();
  }

  toJSON(): string {
    return this.value.toString();
  }

  static fromJSON(value: string): UInt128 {
    return new UInt128(value);
  }
}

/**
 * Decimal wrapper that serializes to/from a JSON string.
 * For full decimal support, consider using a library like decimal.js.
 */
export class Decimal {
  private readonly value: string;

  constructor(value: string | number) {
    this.value = typeof value === 'number' ? value.toString() : value;
    // Basic validation
    if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(this.value)) {
      throw new Error(`Invalid decimal format: ${value}`);
    }
  }

  toString(): string {
    return this.value;
  }

  toNumber(): number {
    return parseFloat(this.value);
  }

  toJSON(): string {
    return this.value;
  }

  static fromJSON(value: string | number): Decimal {
    return new Decimal(value);
  }
}

/**
 * Duration wrapper that serializes to/from ISO 8601 duration strings.
 * Format examples: "PT1H30M", "P1DT12H", "PT0.5S"
 */
export class Duration {
  private readonly milliseconds: number;

  constructor(milliseconds: number) {
    this.milliseconds = milliseconds;
  }

  /** Create from hours, minutes, seconds. */
  static fromHMS(hours: number, minutes: number, seconds: number): Duration {
    return new Duration((hours * 3600 + minutes * 60 + seconds) * 1000);
  }

  /** Create from a Date-compatible duration object. */
  static fromComponents(components: {
    years?: number;
    months?: number;
    weeks?: number;
    days?: number;
    hours?: number;
    minutes?: number;
    seconds?: number;
    milliseconds?: number;
  }): Duration {
    // Approximate: months = 30.44 days, years = 365.25 days
    const ms = 
      (components.years || 0) * 365.25 * 24 * 3600 * 1000 +
      (components.months || 0) * 30.44 * 24 * 3600 * 1000 +
      (components.weeks || 0) * 7 * 24 * 3600 * 1000 +
      (components.days || 0) * 24 * 3600 * 1000 +
      (components.hours || 0) * 3600 * 1000 +
      (components.minutes || 0) * 60 * 1000 +
      (components.seconds || 0) * 1000 +
      (components.milliseconds || 0);
    return new Duration(ms);
  }

  /** Parse an ISO 8601 duration string. */
  static parse(iso8601: string): Duration {
    const match = iso8601.match(
      /^(-)?P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/
    );
    if (!match) {
      throw new Error(`Invalid ISO 8601 duration: ${iso8601}`);
    }

    const negative = match[1] === '-';
    const years = parseInt(match[2] || '0', 10);
    const months = parseInt(match[3] || '0', 10);
    const weeks = parseInt(match[4] || '0', 10);
    const days = parseInt(match[5] || '0', 10);
    const hours = parseInt(match[6] || '0', 10);
    const minutes = parseInt(match[7] || '0', 10);
    const seconds = parseFloat(match[8] || '0');

    const duration = Duration.fromComponents({
      years, months, weeks, days, hours, minutes, seconds
    });

    return negative ? new Duration(-duration.milliseconds) : duration;
  }

  /** Get total milliseconds. */
  toMilliseconds(): number {
    return this.milliseconds;
  }

  /** Get total seconds. */
  toSeconds(): number {
    return this.milliseconds / 1000;
  }

  /** Format as ISO 8601 duration string. */
  toString(): string {
    if (this.milliseconds === 0) {
      return 'PT0S';
    }

    let ms = Math.abs(this.milliseconds);
    const negative = this.milliseconds < 0;

    const hours = Math.floor(ms / 3600000);
    ms %= 3600000;
    const minutes = Math.floor(ms / 60000);
    ms %= 60000;
    const seconds = ms / 1000;

    let result = negative ? '-PT' : 'PT';
    if (hours > 0) result += `${hours}H`;
    if (minutes > 0) result += `${minutes}M`;
    if (seconds > 0 || (hours === 0 && minutes === 0)) {
      result += `${seconds % 1 === 0 ? seconds : seconds.toFixed(3).replace(/\.?0+$/, '')}S`;
    }

    return result;
  }

  toJSON(): string {
    return this.toString();
  }

  static fromJSON(value: string): Duration {
    return Duration.parse(value);
  }
}

/**
 * Date wrapper (without time) that serializes to RFC 3339 date string.
 * Format: "YYYY-MM-DD"
 */
export class DateOnly {
  readonly year: number;
  readonly month: number;
  readonly day: number;

  constructor(year: number, month: number, day: number) {
    this.year = year;
    this.month = month;
    this.day = day;
  }

  /** Create from a JavaScript Date. */
  static fromDate(date: Date): DateOnly {
    return new DateOnly(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }

  /** Parse from RFC 3339 date string. */
  static parse(dateString: string): DateOnly {
    const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      throw new Error(`Invalid date format: ${dateString}`);
    }
    return new DateOnly(
      parseInt(match[1], 10),
      parseInt(match[2], 10),
      parseInt(match[3], 10)
    );
  }

  /** Convert to JavaScript Date (at midnight UTC). */
  toDate(): Date {
    return new Date(Date.UTC(this.year, this.month - 1, this.day));
  }

  toString(): string {
    return `${this.year.toString().padStart(4, '0')}-${this.month.toString().padStart(2, '0')}-${this.day.toString().padStart(2, '0')}`;
  }

  toJSON(): string {
    return this.toString();
  }

  static fromJSON(value: string): DateOnly {
    return DateOnly.parse(value);
  }
}

/**
 * Time wrapper (without date) that serializes to RFC 3339 time string.
 * Format: "HH:MM:SS" or "HH:MM:SS.sss"
 */
export class TimeOnly {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;

  constructor(hour: number, minute: number, second: number, millisecond: number = 0) {
    this.hour = hour;
    this.minute = minute;
    this.second = second;
    this.millisecond = millisecond;
  }

  /** Create from a JavaScript Date. */
  static fromDate(date: Date): TimeOnly {
    return new TimeOnly(
      date.getHours(),
      date.getMinutes(),
      date.getSeconds(),
      date.getMilliseconds()
    );
  }

  /** Parse from RFC 3339 time string. */
  static parse(timeString: string): TimeOnly {
    const match = timeString.match(/^(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|[+-]\d{2}:\d{2})?$/);
    if (!match) {
      throw new Error(`Invalid time format: ${timeString}`);
    }
    const ms = match[4] ? parseInt(match[4].padEnd(3, '0').slice(0, 3), 10) : 0;
    return new TimeOnly(
      parseInt(match[1], 10),
      parseInt(match[2], 10),
      parseInt(match[3], 10),
      ms
    );
  }

  toString(): string {
    const base = `${this.hour.toString().padStart(2, '0')}:${this.minute.toString().padStart(2, '0')}:${this.second.toString().padStart(2, '0')}`;
    if (this.millisecond > 0) {
      return `${base}.${this.millisecond.toString().padStart(3, '0').replace(/0+$/, '')}`;
    }
    return base;
  }

  toJSON(): string {
    return this.toString();
  }

  static fromJSON(value: string): TimeOnly {
    return TimeOnly.parse(value);
  }
}

/**
 * Binary data wrapper that serializes to/from base64 strings.
 */
export class Binary {
  private readonly data: Uint8Array;

  constructor(data: Uint8Array | ArrayBuffer | number[]) {
    if (data instanceof Uint8Array) {
      this.data = data;
    } else if (data instanceof ArrayBuffer) {
      this.data = new Uint8Array(data);
    } else {
      this.data = new Uint8Array(data);
    }
  }

  /** Create from a base64 string. */
  static fromBase64(base64: string): Binary {
    // Browser and Node.js compatible base64 decoding
    if (typeof atob === 'function') {
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return new Binary(bytes);
    } else {
      // Node.js
      return new Binary(Buffer.from(base64, 'base64'));
    }
  }

  /** Create from a UTF-8 string. */
  static fromString(str: string): Binary {
    const encoder = new TextEncoder();
    return new Binary(encoder.encode(str));
  }

  /** Get the raw bytes. */
  toBytes(): Uint8Array {
    return this.data;
  }

  /** Convert to base64 string. */
  toBase64(): string {
    // Browser and Node.js compatible base64 encoding
    if (typeof btoa === 'function') {
      let binaryString = '';
      for (let i = 0; i < this.data.length; i++) {
        binaryString += String.fromCharCode(this.data[i]);
      }
      return btoa(binaryString);
    } else {
      // Node.js
      return Buffer.from(this.data).toString('base64');
    }
  }

  /** Convert to UTF-8 string. */
  toString(): string {
    const decoder = new TextDecoder();
    return decoder.decode(this.data);
  }

  toJSON(): string {
    return this.toBase64();
  }

  static fromJSON(value: string): Binary {
    return Binary.fromBase64(value);
  }
}

/**
 * UUID regex pattern for validation.
 */
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * UUID wrapper that validates format and serializes as string.
 */
export class UUID {
  private readonly value: string;

  constructor(value: string) {
    if (!UUID_REGEX.test(value)) {
      throw new Error(`Invalid UUID format: ${value}`);
    }
    this.value = value.toLowerCase();
  }

  /** Generate a random UUID v4. */
  static random(): UUID {
    // Simple UUID v4 generation
    const hex = '0123456789abcdef';
    let uuid = '';
    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) {
        uuid += '-';
      } else if (i === 14) {
        uuid += '4'; // Version 4
      } else if (i === 19) {
        uuid += hex[(Math.random() * 4) | 8]; // Variant
      } else {
        uuid += hex[(Math.random() * 16) | 0];
      }
    }
    return new UUID(uuid);
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }

  static fromJSON(value: string): UUID {
    return new UUID(value);
  }

  equals(other: UUID): boolean {
    return this.value === other.value;
  }
}

/**
 * JSON Pointer (RFC 6901) wrapper.
 */
export class JSONPointer {
  private readonly value: string;

  constructor(value: string) {
    if (value !== '' && !value.startsWith('/')) {
      throw new Error(`Invalid JSON Pointer: must be empty or start with /`);
    }
    this.value = value;
  }

  /** Parse from an array of tokens. */
  static fromTokens(tokens: string[]): JSONPointer {
    if (tokens.length === 0) {
      return new JSONPointer('');
    }
    const escaped = tokens.map(t => t.replace(/~/g, '~0').replace(/\//g, '~1'));
    return new JSONPointer('/' + escaped.join('/'));
  }

  /** Get the tokens (path segments). */
  toTokens(): string[] {
    if (this.value === '') {
      return [];
    }
    return this.value.slice(1).split('/').map(t => t.replace(/~1/g, '/').replace(/~0/g, '~'));
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }

  static fromJSON(value: string): JSONPointer {
    return new JSONPointer(value);
  }
}

/**
 * Reviver function for JSON.parse to automatically convert string-serialized types.
 * 
 * @example
 * ```typescript
 * const data = JSON.parse(jsonString, jsonStructureReviver);
 * ```
 */
export function jsonStructureReviver(key: string, value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  // Try to detect and convert common JSON Structure types
  // Note: This is a best-effort heuristic - for precise control, use explicit types

  // UUID pattern
  if (UUID_REGEX.test(value)) {
    return new UUID(value);
  }

  // ISO 8601 date pattern (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    try {
      return DateOnly.parse(value);
    } catch {
      return value;
    }
  }

  // ISO 8601 datetime pattern
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
    // Return as native Date for datetime
    return new Date(value);
  }

  // ISO 8601 duration pattern
  if (/^-?P/.test(value)) {
    try {
      return Duration.parse(value);
    } catch {
      return value;
    }
  }

  return value;
}

/**
 * Replacer function for JSON.stringify to handle JSON Structure types.
 * Most wrapper types already have toJSON(), but this handles edge cases.
 */
export function jsonStructureReplacer(key: string, value: unknown): unknown {
  if (value instanceof Int64 || value instanceof UInt64 || 
      value instanceof Int128 || value instanceof UInt128 ||
      value instanceof Decimal || value instanceof Duration ||
      value instanceof DateOnly || value instanceof TimeOnly ||
      value instanceof Binary || value instanceof UUID ||
      value instanceof JSONPointer) {
    return value.toJSON();
  }
  
  // Handle BigInt natively (serialize as string)
  if (typeof value === 'bigint') {
    return value.toString();
  }

  return value;
}
