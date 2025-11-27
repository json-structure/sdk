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

## API

### SchemaValidator

```typescript
class SchemaValidator {
  constructor(options?: SchemaValidatorOptions);
  validate(schema: JsonValue): ValidationResult;
}

interface SchemaValidatorOptions {
  extended?: boolean; // Enable extended validation (default: false)
}
```

### InstanceValidator

```typescript
class InstanceValidator {
  constructor(options?: InstanceValidatorOptions);
  validate(instance: JsonValue, schema: JsonValue): ValidationResult;
}

interface InstanceValidatorOptions {
  extended?: boolean;    // Enable extended validation features
  allowImport?: boolean; // Allow $import references (default: false)
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
