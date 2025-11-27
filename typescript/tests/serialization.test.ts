/**
 * Tests for JSON Structure serialization helpers
 */

import {
  Int64,
  UInt64,
  Int128,
  UInt128,
  Decimal,
  Duration,
  DateOnly,
  TimeOnly,
  Binary,
  UUID,
  JSONPointer,
  jsonStructureReviver,
  jsonStructureReplacer,
} from '../src/serialization';

describe('Int64', () => {
  it('should create from bigint', () => {
    const val = new Int64(12345n);
    expect(val.toBigInt()).toBe(12345n);
    expect(val.toString()).toBe('12345');
    expect(val.toJSON()).toBe('12345');
  });

  it('should create from string', () => {
    const val = new Int64('9223372036854775807');
    expect(val.toBigInt()).toBe(9223372036854775807n);
  });

  it('should create from number', () => {
    const val = new Int64(12345);
    expect(val.toBigInt()).toBe(12345n);
  });

  it('should reject values out of range', () => {
    expect(() => new Int64('9223372036854775808')).toThrow('out of int64 range');
    expect(() => new Int64('-9223372036854775809')).toThrow('out of int64 range');
  });

  it('should handle negative values', () => {
    const val = new Int64('-9223372036854775808');
    expect(val.toBigInt()).toBe(-9223372036854775808n);
    expect(val.toJSON()).toBe('-9223372036854775808');
  });

  it('should have correct min/max constants', () => {
    expect(Int64.MIN_VALUE).toBe(-9223372036854775808n);
    expect(Int64.MAX_VALUE).toBe(9223372036854775807n);
  });

  it('should serialize to JSON as string', () => {
    const val = new Int64(12345n);
    expect(JSON.stringify(val)).toBe('"12345"');
  });

  it('should provide number value when safe', () => {
    const val = new Int64(12345n);
    expect(val.toNumber()).toBe(12345);
  });

  it('should parse with fromJSON', () => {
    const val = Int64.fromJSON('9223372036854775807');
    expect(val.toBigInt()).toBe(9223372036854775807n);
  });
});

describe('UInt64', () => {
  it('should create from positive values', () => {
    const val = new UInt64(18446744073709551615n);
    expect(val.toBigInt()).toBe(18446744073709551615n);
    expect(val.toJSON()).toBe('18446744073709551615');
  });

  it('should reject negative values', () => {
    expect(() => new UInt64(-1n)).toThrow('out of uint64 range');
  });

  it('should reject values above max', () => {
    expect(() => new UInt64('18446744073709551616')).toThrow('out of uint64 range');
  });

  it('should have correct max constant', () => {
    expect(UInt64.MAX_VALUE).toBe(18446744073709551615n);
  });

  it('should parse with fromJSON', () => {
    const val = UInt64.fromJSON('18446744073709551615');
    expect(val.toBigInt()).toBe(18446744073709551615n);
  });
});

describe('Int128', () => {
  it('should handle large values', () => {
    const val = new Int128('170141183460469231731687303715884105727');
    expect(val.toJSON()).toBe('170141183460469231731687303715884105727');
  });

  it('should handle negative values', () => {
    const val = new Int128('-170141183460469231731687303715884105728');
    expect(val.toBigInt()).toBe(-170141183460469231731687303715884105728n);
  });

  it('should reject values out of range', () => {
    expect(() => new Int128('170141183460469231731687303715884105728')).toThrow('out of int128 range');
  });

  it('should parse with fromJSON', () => {
    const val = Int128.fromJSON('170141183460469231731687303715884105727');
    expect(val.toBigInt()).toBe(170141183460469231731687303715884105727n);
  });
});

describe('UInt128', () => {
  it('should handle large values', () => {
    const val = new UInt128('340282366920938463463374607431768211455');
    expect(val.toJSON()).toBe('340282366920938463463374607431768211455');
  });

  it('should reject negative values', () => {
    expect(() => new UInt128(-1n)).toThrow('out of uint128 range');
  });

  it('should parse with fromJSON', () => {
    const val = UInt128.fromJSON('340282366920938463463374607431768211455');
    expect(val.toBigInt()).toBe(340282366920938463463374607431768211455n);
  });
});

describe('Decimal', () => {
  it('should preserve decimal precision', () => {
    const val = new Decimal('123.456789012345678901234567890');
    expect(val.toString()).toBe('123.456789012345678901234567890');
    expect(val.toJSON()).toBe('123.456789012345678901234567890');
  });

  it('should reject invalid formats', () => {
    expect(() => new Decimal('not-a-number')).toThrow('Invalid decimal');
    expect(() => new Decimal('12.34.56')).toThrow('Invalid decimal');
  });

  it('should accept scientific notation', () => {
    const val = new Decimal('1.23e10');
    expect(val.toString()).toBe('1.23e10');
  });

  it('should accept negative values', () => {
    const val = new Decimal('-123.456');
    expect(val.toString()).toBe('-123.456');
  });

  it('should serialize to JSON as string', () => {
    const val = new Decimal('123.456');
    expect(JSON.stringify(val)).toBe('"123.456"');
  });

  it('should create from number', () => {
    const val = new Decimal(123.456);
    expect(val.toNumber()).toBeCloseTo(123.456);
  });
});

describe('Duration', () => {
  it('should create from milliseconds', () => {
    const dur = new Duration(5430000); // 1h 30m 30s
    expect(dur.toMilliseconds()).toBe(5430000);
    expect(dur.toSeconds()).toBe(5430);
  });

  it('should create from HMS', () => {
    const dur = Duration.fromHMS(2, 30, 45);
    expect(dur.toString()).toBe('PT2H30M45S');
  });

  it('should create from components', () => {
    const dur = Duration.fromComponents({ hours: 1, minutes: 30, seconds: 30 });
    expect(dur.toSeconds()).toBe(5430);
  });

  it('should parse ISO duration string', () => {
    const dur = Duration.parse('P1Y2M3DT4H5M6S');
    expect(dur.toMilliseconds()).toBeGreaterThan(0);
  });

  it('should handle decimal seconds', () => {
    const dur = Duration.parse('PT1.5S');
    expect(dur.toMilliseconds()).toBe(1500);
  });

  it('should handle date-only durations', () => {
    const dur = Duration.parse('P1D');
    expect(dur.toMilliseconds()).toBe(24 * 3600 * 1000);
  });

  it('should handle time-only durations', () => {
    const dur = Duration.parse('PT30M');
    expect(dur.toMilliseconds()).toBe(30 * 60 * 1000);
  });

  it('should handle negative durations', () => {
    const dur = Duration.parse('-P1D');
    expect(dur.toMilliseconds()).toBeLessThan(0);
    expect(dur.toString()).toBe('-PT24H');
  });

  it('should reject invalid formats', () => {
    expect(() => Duration.parse('invalid')).toThrow('Invalid ISO 8601 duration');
    expect(() => Duration.parse('1H30M')).toThrow('Invalid ISO 8601 duration');
  });

  it('should serialize to JSON', () => {
    const dur = Duration.fromHMS(1, 0, 0);
    expect(JSON.stringify(dur)).toBe('"PT1H"');
  });

  it('should format zero duration', () => {
    const dur = new Duration(0);
    expect(dur.toString()).toBe('PT0S');
  });
});

describe('DateOnly', () => {
  it('should create from components', () => {
    const date = new DateOnly(2024, 6, 15);
    expect(date.year).toBe(2024);
    expect(date.month).toBe(6);
    expect(date.day).toBe(15);
    expect(date.toString()).toBe('2024-06-15');
  });

  it('should parse date string', () => {
    const date = DateOnly.parse('2024-01-15');
    expect(date.year).toBe(2024);
    expect(date.month).toBe(1);
    expect(date.day).toBe(15);
  });

  it('should reject invalid formats', () => {
    expect(() => DateOnly.parse('2024/01/15')).toThrow('Invalid date format');
    expect(() => DateOnly.parse('01-15-2024')).toThrow('Invalid date format');
    expect(() => DateOnly.parse('not-a-date')).toThrow('Invalid date format');
  });

  it('should convert to Date', () => {
    const dateOnly = new DateOnly(2024, 6, 15);
    const date = dateOnly.toDate();
    expect(date.getUTCFullYear()).toBe(2024);
    expect(date.getUTCMonth()).toBe(5); // 0-indexed
    expect(date.getUTCDate()).toBe(15);
  });

  it('should create from Date', () => {
    const date = new Date(2024, 5, 15); // June 15, 2024
    const dateOnly = DateOnly.fromDate(date);
    expect(dateOnly.year).toBe(2024);
    expect(dateOnly.month).toBe(6);
    expect(dateOnly.day).toBe(15);
  });

  it('should serialize to JSON', () => {
    const date = new DateOnly(2024, 6, 15);
    expect(JSON.stringify(date)).toBe('"2024-06-15"');
  });

  it('should pad single-digit months and days', () => {
    const date = new DateOnly(2024, 1, 5);
    expect(date.toString()).toBe('2024-01-05');
  });
});

describe('TimeOnly', () => {
  it('should create from components', () => {
    const time = new TimeOnly(14, 30, 45, 123);
    expect(time.hour).toBe(14);
    expect(time.minute).toBe(30);
    expect(time.second).toBe(45);
    expect(time.millisecond).toBe(123);
  });

  it('should parse time string', () => {
    const time = TimeOnly.parse('14:30:45');
    expect(time.hour).toBe(14);
    expect(time.minute).toBe(30);
    expect(time.second).toBe(45);
  });

  it('should parse time with milliseconds', () => {
    const time = TimeOnly.parse('14:30:45.123');
    expect(time.millisecond).toBe(123);
  });

  it('should parse time with timezone (ignoring it)', () => {
    const time = TimeOnly.parse('14:30:45Z');
    expect(time.hour).toBe(14);
    expect(time.minute).toBe(30);
    expect(time.second).toBe(45);
  });

  it('should reject invalid formats', () => {
    expect(() => TimeOnly.parse('2:30 PM')).toThrow('Invalid time format');
    expect(() => TimeOnly.parse('not-a-time')).toThrow('Invalid time format');
  });

  it('should format with milliseconds when present', () => {
    const time = new TimeOnly(14, 30, 45, 100);
    expect(time.toString()).toBe('14:30:45.1');
  });

  it('should format without milliseconds when zero', () => {
    const time = new TimeOnly(14, 30, 45, 0);
    expect(time.toString()).toBe('14:30:45');
  });

  it('should serialize to JSON', () => {
    const time = new TimeOnly(14, 30, 45);
    expect(JSON.stringify(time)).toBe('"14:30:45"');
  });
});

describe('Binary', () => {
  it('should encode bytes to base64', () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const binary = new Binary(bytes);
    expect(binary.toBase64()).toBe('SGVsbG8=');
  });

  it('should decode from base64', () => {
    const binary = Binary.fromBase64('SGVsbG8=');
    const text = binary.toString();
    expect(text).toBe('Hello');
  });

  it('should handle empty data', () => {
    const binary = new Binary(new Uint8Array(0));
    expect(binary.toBase64()).toBe('');
    expect(binary.toBytes().length).toBe(0);
  });

  it('should serialize to JSON as base64', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const binary = new Binary(bytes);
    expect(JSON.stringify(binary)).toBe('"AQID"');
  });

  it('should handle binary with padding', () => {
    const binary = Binary.fromBase64('YQ=='); // "a"
    expect(binary.toBytes().length).toBe(1);
    expect(binary.toBytes()[0]).toBe(97);
  });

  it('should create from string', () => {
    const binary = Binary.fromString('Hello');
    expect(binary.toBase64()).toBe('SGVsbG8=');
  });

  it('should create from array of numbers', () => {
    const binary = new Binary([72, 101, 108, 108, 111]);
    expect(binary.toString()).toBe('Hello');
  });
});

describe('UUID', () => {
  it('should accept valid UUIDs', () => {
    const uuid = new UUID('550e8400-e29b-41d4-a716-446655440000');
    expect(uuid.toString()).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('should normalize to lowercase', () => {
    const uuid = new UUID('550E8400-E29B-41D4-A716-446655440000');
    expect(uuid.toString()).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('should reject invalid UUIDs', () => {
    expect(() => new UUID('not-a-uuid')).toThrow('Invalid UUID format');
    expect(() => new UUID('550e8400-e29b-41d4-a716')).toThrow('Invalid UUID format');
    expect(() => new UUID('550e8400-e29b-41d4-a716-44665544000g')).toThrow('Invalid UUID format');
  });

  it('should generate valid UUIDs with random()', () => {
    const uuid = UUID.random();
    expect(uuid.toString()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('should implement equality', () => {
    const uuid1 = new UUID('550e8400-e29b-41d4-a716-446655440000');
    const uuid2 = new UUID('550e8400-e29b-41d4-a716-446655440000');
    const uuid3 = new UUID('550e8400-e29b-41d4-a716-446655440001');
    expect(uuid1.equals(uuid2)).toBe(true);
    expect(uuid1.equals(uuid3)).toBe(false);
  });

  it('should serialize to JSON', () => {
    const uuid = new UUID('550e8400-e29b-41d4-a716-446655440000');
    expect(JSON.stringify(uuid)).toBe('"550e8400-e29b-41d4-a716-446655440000"');
  });
});

describe('JSONPointer', () => {
  it('should parse valid pointers', () => {
    const ptr = new JSONPointer('/foo/bar/0');
    expect(ptr.toTokens()).toEqual(['foo', 'bar', '0']);
  });

  it('should handle root pointer', () => {
    const ptr = new JSONPointer('');
    expect(ptr.toTokens()).toEqual([]);
  });

  it('should handle escaped characters', () => {
    const ptr = new JSONPointer('/a~1b/c~0d');
    expect(ptr.toTokens()).toEqual(['a/b', 'c~d']);
  });

  it('should reject invalid pointers', () => {
    expect(() => new JSONPointer('not-starting-with-slash')).toThrow('Invalid JSON Pointer');
  });

  it('should build from tokens', () => {
    const ptr = JSONPointer.fromTokens(['foo', 'bar', '0']);
    expect(ptr.toString()).toBe('/foo/bar/0');
  });

  it('should escape special characters when building', () => {
    const ptr = JSONPointer.fromTokens(['a/b', 'c~d']);
    expect(ptr.toString()).toBe('/a~1b/c~0d');
  });

  it('should serialize to JSON', () => {
    const ptr = new JSONPointer('/foo/bar');
    expect(JSON.stringify(ptr)).toBe('"/foo/bar"');
  });

  it('should handle empty tokens', () => {
    const ptr = JSONPointer.fromTokens([]);
    expect(ptr.toString()).toBe('');
  });
});

describe('JSON.parse/stringify with revivers and replacers', () => {
  it('should use jsonStructureReviver for parsing UUIDs', () => {
    const json = '{"id": "550e8400-e29b-41d4-a716-446655440000"}';
    const parsed = JSON.parse(json, jsonStructureReviver);
    expect(parsed.id).toBeInstanceOf(UUID);
    expect(parsed.id.toString()).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('should use jsonStructureReviver for parsing dates', () => {
    const json = '{"date": "2024-06-15"}';
    const parsed = JSON.parse(json, jsonStructureReviver);
    expect(parsed.date).toBeInstanceOf(DateOnly);
    expect(parsed.date.year).toBe(2024);
  });

  it('should use jsonStructureReviver for parsing durations', () => {
    const json = '{"duration": "PT1H30M"}';
    const parsed = JSON.parse(json, jsonStructureReviver);
    expect(parsed.duration).toBeInstanceOf(Duration);
    expect(parsed.duration.toMilliseconds()).toBe(5400000);
  });

  it('should use jsonStructureReplacer for stringifying', () => {
    const obj = {
      id: new UUID('550e8400-e29b-41d4-a716-446655440000'),
      data: new Binary(new Uint8Array([1, 2, 3])),
      duration: Duration.fromHMS(1, 0, 0),
    };
    const json = JSON.stringify(obj, jsonStructureReplacer);
    const parsed = JSON.parse(json);
    expect(parsed.id).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(parsed.data).toBe('AQID');
    expect(parsed.duration).toBe('PT1H');
  });

  it('should handle BigInt with jsonStructureReplacer', () => {
    const obj = { value: 9223372036854775807n };
    const json = JSON.stringify(obj, jsonStructureReplacer);
    expect(json).toBe('{"value":"9223372036854775807"}');
  });
});

describe('Round-trip serialization', () => {
  it('should round-trip Int64', () => {
    const original = new Int64(9223372036854775807n);
    const json = JSON.stringify(original);
    const parsed = Int64.fromJSON(JSON.parse(json));
    expect(parsed.toBigInt()).toBe(original.toBigInt());
  });

  it('should round-trip Duration', () => {
    const original = Duration.fromHMS(4, 5, 6);
    const json = JSON.stringify(original);
    const parsed = Duration.fromJSON(JSON.parse(json));
    expect(parsed.toMilliseconds()).toBe(original.toMilliseconds());
  });

  it('should round-trip DateOnly', () => {
    const original = new DateOnly(2024, 6, 15);
    const json = JSON.stringify(original);
    const parsed = DateOnly.fromJSON(JSON.parse(json));
    expect(parsed.year).toBe(original.year);
    expect(parsed.month).toBe(original.month);
    expect(parsed.day).toBe(original.day);
  });

  it('should round-trip TimeOnly', () => {
    const original = new TimeOnly(14, 30, 45, 0);
    const json = JSON.stringify(original);
    const parsed = TimeOnly.fromJSON(JSON.parse(json));
    expect(parsed.hour).toBe(original.hour);
    expect(parsed.minute).toBe(original.minute);
    expect(parsed.second).toBe(original.second);
  });

  it('should round-trip Binary', () => {
    const original = new Binary(new Uint8Array([0, 127, 255, 1, 2, 3]));
    const json = JSON.stringify(original);
    const parsed = Binary.fromJSON(JSON.parse(json));
    expect(parsed.toBytes()).toEqual(original.toBytes());
  });

  it('should round-trip UUID', () => {
    const original = UUID.random();
    const json = JSON.stringify(original);
    const parsed = UUID.fromJSON(JSON.parse(json));
    expect(parsed.toString()).toBe(original.toString());
  });

  it('should round-trip JSONPointer', () => {
    const original = new JSONPointer('/foo/bar/0');
    const json = JSON.stringify(original);
    const parsed = JSONPointer.fromJSON(JSON.parse(json));
    expect(parsed.toTokens()).toEqual(original.toTokens());
  });
});
