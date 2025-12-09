# JSON Structure TypeScript SDK

TypeScript/JavaScript library for validating JSON documents against [JSON Structure](https://json-structure.org) schemas.

## Installation

```bash
npm install json-structure
```

## Usage

The package works with both TypeScript and plain JavaScript, and supports both ES modules and CommonJS.

### JavaScript (CommonJS)

```javascript
const { SchemaValidator, InstanceValidator } = require('json-structure');

const schema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    age: { type: 'int32' }
  },
  required: ['name']
};

// Validate schema
const schemaValidator = new SchemaValidator();
console.log(schemaValidator.validate(schema));

// Validate instance
const instanceValidator = new InstanceValidator();
console.log(instanceValidator.validate({ name: 'Alice', age: 30 }, schema));
```

### JavaScript (ES Modules)

```javascript
import { SchemaValidator, InstanceValidator } from 'json-structure';

// Same usage as above
```

### TypeScript

#### Schema Validation

Validate that a schema document follows the JSON Structure specification:

```typescript
import { SchemaValidator } from 'json-structure';

const schema = {
  $schema: 'https://json-structure.org/meta/core/v0/#',
  type: 'object',
  properties: {
    name: { type: 'string' },
    age: { type: 'int32' }
  },
  required: ['name']
};

const validator = new SchemaValidator();
const result = validator.validate(schema);

if (result.isValid) {
  console.log('Schema is valid!');
} else {
  console.error('Schema validation errors:', result.errors);
}
```

### Instance Validation

Validate JSON data against a JSON Structure schema:

```typescript
import { InstanceValidator } from 'json-structure';

const schema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    age: { type: 'int32' }
  },
  required: ['name']
};

const instance = {
  name: 'Alice',
  age: 30
};

const validator = new InstanceValidator();
const result = validator.validate(instance, schema);

if (result.isValid) {
  console.log('Instance is valid!');
} else {
  console.error('Validation errors:', result.errors);
}
```

### Sideloading External Schemas

When using `$import` to reference external schemas, you can provide those schemas
directly instead of fetching them from URIs:

```typescript
import { SchemaValidator } from 'json-structure';

// External schema that would normally be fetched
const addressSchema = {
  $schema: 'https://json-structure.org/meta/core/v0/#',
  $id: 'https://example.com/address.json',
  type: 'object',
  properties: {
    street: { type: 'string' },
    city: { type: 'string' }
  }
};

// Main schema that imports the address schema
const mainSchema = {
  $schema: 'https://json-structure.org/meta/core/v0/#',
  type: 'object',
  properties: {
    name: { type: 'string' },
    address: { $ref: '#/definitions/Imported/Address' }
  },
  definitions: {
    Imported: {
      $import: 'https://example.com/address.json'
    }
  }
};

// Sideload the address schema - matched by $id
const validator = new SchemaValidator({
  allowImport: true,
  externalSchemas: [addressSchema]
});

const result = validator.validate(mainSchema);
```

### Extended Validation

To enable extended validation features (minLength, maxLength, pattern, minimum, maximum, allOf, anyOf, oneOf, not, if/then/else):

```typescript
import { InstanceValidator } from 'json-structure';

const schema = {
  type: 'string',
  minLength: 1,
  maxLength: 100,
  pattern: '^[A-Za-z]+$'
};

// Enable extended validation
const validator = new InstanceValidator({ extended: true });

const result = validator.validate('Hello', schema);
console.log(result.isValid); // true
```

## Thread Safety and Reentrancy

Both `SchemaValidator` and `InstanceValidator` are **stateless after construction** and safe for reuse across multiple validations. Each validation creates its own internal context, ensuring no state is shared between validations.

### Safe for Async/Concurrent Use

The validators can be safely reused in async contexts without risk of state interference:

```typescript
const validator = new SchemaValidator();

// Safe: Multiple concurrent validations with the same validator
const results = await Promise.all([
  validator.validate(schema1),
  validator.validate(schema2),
  validator.validate(schema3)
]);
```

### Safe for Web Workers

When using validators in Web Workers, each worker gets its own validator instance, and the stateless design ensures no issues with shared module state:

```typescript
// In main thread
const worker = new Worker('./validator-worker.js');

// In worker
const validator = new SchemaValidator();

self.onmessage = (e) => {
  const result = validator.validate(e.data.schema);
  self.postMessage(result);
};
```

### Sequential Reuse

A single validator instance can be safely reused for sequential validations without any state leakage:

```typescript
const validator = new InstanceValidator();

// Safe: No state leakage between validations
const result1 = validator.validate(data1, schema1);
const result2 = validator.validate(data2, schema2);
const result3 = validator.validate(data3, schema3);
```

Each call to `validate()` operates independently with its own validation context, so errors and state from one validation never affect another.

## API

### SchemaValidator

```typescript
class SchemaValidator {
  constructor(options?: SchemaValidatorOptions);
  validate(schema: JsonValue): ValidationResult;
}

interface SchemaValidatorOptions {
  extended?: boolean;           // Enable extended validation (default: false)
  allowImport?: boolean;        // Allow $import references (default: false)
  externalSchemas?: JsonValue[]; // Sideloaded schemas for import resolution
}
```

### InstanceValidator

```typescript
class InstanceValidator {
  constructor(options?: InstanceValidatorOptions);
  validate(instance: JsonValue, schema: JsonValue): ValidationResult;
}

interface InstanceValidatorOptions {
  extended?: boolean;           // Enable extended validation features
  allowImport?: boolean;        // Allow $import references (default: false)
  externalSchemas?: JsonValue[]; // Sideloaded schemas for import resolution
}
```

### ValidationResult

```typescript
interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

interface ValidationError {
  path: string;    // JSON Pointer to the error location
  message: string; // Human-readable error description
  code?: string;   // Optional error code
}
```

## Serialization Helpers

The SDK provides wrapper types for JSON Structure types that need special serialization handling. Per the JSON Structure spec, certain types must be serialized as strings because JSON numbers (IEEE 754 double) cannot represent their full range.

### Large Integers

```typescript
import { Int64, UInt64, Int128, UInt128 } from 'json-structure';

// Int64/UInt64 - serializes to/from string to preserve precision
const id = new Int64('9223372036854775807');
console.log(JSON.stringify({ id })); // {"id":"9223372036854775807"}
console.log(id.toBigInt()); // 9223372036854775807n

// Parse from JSON
const parsed = Int64.fromJSON('9223372036854775807');

// Int128/UInt128 for even larger values
const bigVal = new Int128('170141183460469231731687303715884105727');
```

### Decimal Numbers

```typescript
import { Decimal } from 'json-structure';

// Preserve arbitrary precision
const price = new Decimal('123.456789012345678901234567890');
console.log(JSON.stringify({ price })); // {"price":"123.456789012345678901234567890"}
```

### Duration (ISO 8601)

```typescript
import { Duration } from 'json-structure';

// Create from hours, minutes, seconds
const duration = Duration.fromHMS(2, 30, 45);
console.log(duration.toString()); // "PT2H30M45S"

// Parse ISO 8601 duration
const parsed = Duration.parse('P1Y2M3DT4H5M6S');
console.log(parsed.toMilliseconds());

// Create from components
const dur = Duration.fromComponents({
  years: 1, months: 2, days: 3,
  hours: 4, minutes: 5, seconds: 6
});
```

### Date and Time

```typescript
import { DateOnly, TimeOnly } from 'json-structure';

// Date without time (RFC 3339)
const date = new DateOnly(2024, 6, 15);
console.log(date.toString()); // "2024-06-15"

// Parse from string
const parsed = DateOnly.parse('2024-06-15');

// Convert to/from JavaScript Date
const jsDate = date.toDate();
const fromDate = DateOnly.fromDate(new Date());

// Time without date
const time = new TimeOnly(14, 30, 45, 123);
console.log(time.toString()); // "14:30:45.123"
```

### Binary Data

```typescript
import { Binary } from 'json-structure';

// Create from bytes
const binary = new Binary(new Uint8Array([72, 101, 108, 108, 111]));
console.log(binary.toBase64()); // "SGVsbG8="

// Create from string
const fromStr = Binary.fromString('Hello');

// Parse from base64
const parsed = Binary.fromBase64('SGVsbG8=');
console.log(parsed.toString()); // "Hello"

// Serializes to base64 in JSON
console.log(JSON.stringify({ data: binary })); // {"data":"SGVsbG8="}
```

### UUID

```typescript
import { UUID } from 'json-structure';

// Create from string (validates format)
const uuid = new UUID('550e8400-e29b-41d4-a716-446655440000');

// Generate random UUID v4
const random = UUID.random();

// Compare UUIDs
console.log(uuid.equals(random)); // false
```

### JSON Pointer (RFC 6901)

```typescript
import { JSONPointer } from 'json-structure';

// Create from string
const ptr = new JSONPointer('/foo/bar/0');
console.log(ptr.toTokens()); // ['foo', 'bar', '0']

// Build from tokens
const fromTokens = JSONPointer.fromTokens(['foo', 'bar', '0']);
console.log(fromTokens.toString()); // "/foo/bar/0"

// Handles escaping automatically
const escaped = JSONPointer.fromTokens(['a/b', 'c~d']);
console.log(escaped.toString()); // "/a~1b/c~0d"
```

### JSON Reviver and Replacer

```typescript
import { jsonStructureReviver, jsonStructureReplacer } from 'json-structure';

// Parse JSON with automatic type conversion
const parsed = JSON.parse(jsonString, jsonStructureReviver);
// Recognizes: UUIDs, dates (YYYY-MM-DD), durations (PT...), datetimes

// Stringify with proper serialization
const json = JSON.stringify(obj, jsonStructureReplacer);
// Handles: Int64, Decimal, Duration, Binary, UUID, etc.
```

## Supported Types

### Primitive Types
- `string`, `boolean`, `null`
- Integers: `int8`, `uint8`, `int16`, `uint16`, `int32`, `uint32`, `int64`, `uint64`, `int128`, `uint128`
- Floating point: `float`, `float8`, `double`, `decimal`, `number`, `integer`
- Date/Time: `date`, `datetime`, `time`, `duration`
- Other: `uuid`, `uri`, `binary`, `jsonpointer`

### Compound Types
- `object` - with `properties` and optional `required`
- `array` - with `items`
- `set` - array with unique items
- `map` - object with homogeneous `values`
- `tuple` - fixed-length array with `prefixItems`
- `choice` - tagged union with `choices`
- `any` - accepts any value

### Extended Validation
- String: `minLength`, `maxLength`, `pattern`
- Numeric: `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`
- Array: `minItems`, `maxItems`, `uniqueItems`
- Composition: `allOf`, `anyOf`, `oneOf`, `not`
- Conditional: `if`, `then`, `else`

## License

MIT
