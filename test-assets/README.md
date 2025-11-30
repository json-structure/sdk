# SDK Test Assets

This directory contains test assets used by all SDK implementations to ensure consistent validation behavior.

## Directory Structure

```
test-assets/
├── schemas/
│   ├── invalid/           # Invalid JSON Structure schemas (one edge case each)
│   │   ├── missing-type.struct.json
│   │   ├── unknown-type.struct.json
│   │   ├── required-missing-property.struct.json
│   │   └── ... (25 edge case schemas)
│   │
│   └── warnings/          # Valid schemas that trigger warnings
│       ├── numeric-minimum-without-uses.struct.json
│       ├── string-pattern-without-uses.struct.json
│       ├── array-minitems-without-uses.struct.json
│       └── ... (21 warning test schemas)
│
└── instances/
    └── invalid/           # Invalid instances for sample schemas
        ├── 01-basic-person/
        ├── 02-address/
        ├── 04-datetime-examples/
        ├── 05-collections/
        ├── 06-tuples/
        └── 11-sets-and-maps/
```

## Invalid Schemas

Each invalid schema file tests a specific edge case that should cause schema validation to fail:

| File | Edge Case |
|------|-----------|
| `missing-type.struct.json` | Object with properties but no `type` keyword |
| `unknown-type.struct.json` | Unrecognized type name |
| `required-missing-property.struct.json` | Required array references non-existent property |
| `ref-undefined.struct.json` | `$ref` points to undefined definition |
| `constraint-type-mismatch-minimum.struct.json` | `minimum` on string type |
| `constraint-type-mismatch-minlength.struct.json` | `minLength` on numeric type |
| `invalid-regex-pattern.struct.json` | Malformed regular expression |
| `minlength-exceeds-maxlength.struct.json` | minLength > maxLength |
| `minimum-exceeds-maximum.struct.json` | minimum > maximum |
| `minitems-exceeds-maxitems.struct.json` | minItems > maxItems |
| `required-not-array.struct.json` | `required` is string instead of array |
| `enum-not-array.struct.json` | `enum` is not an array |
| `enum-empty.struct.json` | Empty enum array |
| `multipleof-zero.struct.json` | multipleOf = 0 |
| `multipleof-negative.struct.json` | Negative multipleOf |
| `circular-ref-direct.struct.json` | Direct circular $ref |
| `tuple-missing-prefixitems.struct.json` | Tuple without prefixItems |
| `array-missing-items.struct.json` | Array without items |
| `map-missing-values.struct.json` | Map without values |
| `minlength-negative.struct.json` | Negative minLength |
| `minitems-negative.struct.json` | Negative minItems |
| `properties-not-object.struct.json` | `properties` is not an object |
| `defs-not-object.struct.json` | `$defs` is an array |
| `allof-not-array.struct.json` | `allOf` is not an array |
| `enum-duplicates.struct.json` | Duplicate values in enum |

## Warning Schemas

Each warning schema file tests a specific case where a validation extension keyword is used without enabling the validation extension via `$uses: ["JSONStructureValidation"]`. These schemas are **valid** but should produce warnings:

| File | Extension Keyword |
|------|-------------------|
| `numeric-minimum-without-uses.struct.json` | `minimum` |
| `numeric-maximum-without-uses.struct.json` | `maximum` |
| `numeric-exclusive-minimum-without-uses.struct.json` | `exclusiveMinimum` |
| `numeric-exclusive-maximum-without-uses.struct.json` | `exclusiveMaximum` |
| `numeric-multiple-of-without-uses.struct.json` | `multipleOf` |
| `string-minlength-without-uses.struct.json` | `minLength` |
| `string-pattern-without-uses.struct.json` | `pattern` |
| `string-format-without-uses.struct.json` | `format` |
| `array-minitems-without-uses.struct.json` | `minItems` |
| `array-maxitems-without-uses.struct.json` | `maxItems` |
| `array-uniqueitems-without-uses.struct.json` | `uniqueItems` |
| `array-contains-without-uses.struct.json` | `contains` |
| `array-mincontains-without-uses.struct.json` | `minContains` |
| `array-maxcontains-without-uses.struct.json` | `maxContains` |
| `object-minproperties-without-uses.struct.json` | `minProperties` |
| `object-maxproperties-without-uses.struct.json` | `maxProperties` |
| `object-dependentrequired-without-uses.struct.json` | `dependentRequired` |
| `object-patternproperties-without-uses.struct.json` | `patternProperties` |
| `object-propertynames-without-uses.struct.json` | `propertyNames` |
| `all-extension-keywords-without-uses.struct.json` | All keywords (13 warnings) |
| `all-extension-keywords-with-uses.struct.json` | All keywords with `$uses` (no warnings) |

## Invalid Instances

Each subdirectory corresponds to a sample schema from `primer-and-samples/samples/core/`. Invalid instances test validation edge cases:

### 01-basic-person
- `missing-required-firstname.json` - Missing required field
- `age-exceeds-int8-range.json` - int8 value > 127
- `wrong-type-age.json` - String instead of int8
- `invalid-date-format.json` - Non-ISO date string

### 02-address
- `missing-required-city.json` - Missing required field
- `invalid-country-enum.json` - Value not in enum
- `street-exceeds-maxlength.json` - String > maxLength

### 04-datetime-examples
- `invalid-datetime-format.json` - Invalid datetime string
- `invalid-uuid-format.json` - Invalid UUID format
- `invalid-duration-format.json` - Non-ISO duration
- `invalid-frequency-enum.json` - Value not in enum

### 05-collections
- `set-with-duplicates.json` - Duplicate values in set
- `invalid-uri-in-array.json` - Invalid URI format
- `wrong-type-in-map-values.json` - Number instead of string in map

### 06-tuples
- `tuple-wrong-length.json` - Tuple has incorrect element count
- `tuple-wrong-element-type.json` - Wrong type at tuple position
- `uint8-exceeds-range.json` - uint8 value > 255

### 11-sets-and-maps
- `genre-not-in-enum.json` - Genre value not in enum
- `invalid-time-format.json` - Non-ISO time format
- `access-level-not-in-enum.json` - Access level not in enum

## Usage

SDK implementations should:

1. Load all schemas from `schemas/invalid/` and verify each fails validation
2. Load instances from `instances/invalid/` along with their corresponding sample schemas
3. Verify each instance fails validation against its schema

Example test structure:
```python
def test_invalid_schemas():
    for schema_file in glob("test-assets/schemas/invalid/*.json"):
        result = validate_schema(load(schema_file))
        assert not result.is_valid

def test_invalid_instances():
    for instance_file in glob("test-assets/instances/invalid/**/*.json"):
        schema_name = instance_file.parent.name  # e.g., "01-basic-person"
        schema = load(f"samples/core/{schema_name}/schema.struct.json")
        instance = load(instance_file)
        result = validate_instance(instance, schema)
        assert not result.is_valid
```
