# encoding: utf-8
"""
test_schema_validator.py

Pytest-based test suite for the JSON Structure schema validator.
It includes both valid and invalid schemas that probe corner conditions,
including testing of union types, $ref, $extends, namespaces (including empty namespaces),
JSON pointers, enum/const usage, and the --metaschema parameter (allowing '$' in property names).
Also includes tests for extended validation features (conditional composition and validation keywords).
"""

import json
import pytest
from json_structure.schema_validator import validate_json_structure_schema_core

# =============================================================================
# Valid Schemas (Core)
# =============================================================================

# Case 1: Minimal valid schema with 'any' type.
VALID_MINIMAL = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/minimal",
    "name": "MinimalSchema",
    "type": "any"
}

# Case 2: Valid object schema with properties and required field.
VALID_OBJECT = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/object",
    "name": "Person",
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "age": {"type": "int32"}
    },
    "required": ["name"]
}

# Case 3: Valid schema using $ref to a type declared in definitions.
VALID_REF = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/ref",
    "name": "RefSchema",
    "type": {"$ref": "#/definitions/SomeType"},
    "definitions": {
        "SomeType": {
            "name": "SomeType",
            "type": "string"
        }
    }
}

# Case 4: Valid union type combining a primitive and a $ref.
VALID_UNION = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/union",
    "name": "UnionSchema",
    "type": ["string", {"$ref": "#/definitions/OtherType"}],
    "definitions": {
        "OtherType": {
            "name": "OtherType",
            "type": "int32"
        }
    }
}

# Case 5: Valid object type using $extends; properties are optional in extending type.
VALID_EXTENDS = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/extends",
    "name": "ExtendedSchema",
    "type": "object",
    "$extends": "#/definitions/BaseType",
    "definitions": {
        "BaseType": {
            "name": "BaseType",
            "type": "object",
            "properties": {
                "baseProp": {"type": "string"}
            }
        }
    }
}

# Case 6: Valid schema with property name containing '$', allowed with metaschema flag.
VALID_ALLOW_DOLLAR = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/allow_dollar",
    "name": "AllowDollarSchema",
    "type": "object",
    "properties": {
        "$custom": {"type": "string"}
    }
}

# Case 7: Valid empty namespace: no 'type' or '$ref' so it is a non-schema (namespace)
VALID_NAMESPACE_EMPTY = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/empty_namespace",
    "name": "EmptyNamespace"
}

# Case 8: Valid tuple type with implicit required properties and tuple order
VALID_TUPLE = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/tuple",
    "name": "PersonTuple",
    "type": "tuple",
    "properties": {
        "name": {"type": "string"},
        "age": {"type": "int32"}
    },
    "tuple": ["name", "age"]
}

VALID_SCHEMAS = [
    VALID_MINIMAL,
    VALID_OBJECT,
    VALID_REF,
    VALID_UNION,
    VALID_EXTENDS,
    VALID_ALLOW_DOLLAR,  # must be validated with allow_dollar=True
    VALID_NAMESPACE_EMPTY,
    VALID_TUPLE,
]

# =============================================================================
# Valid Schemas (Extended Features)
# =============================================================================

# Valid schema with conditional composition keywords
VALID_ALLOF = {
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "https://example.com/schema/allof",
    "name": "AllOfSchema",
    "$uses": ["JSONStructureConditionalComposition"],
    "allOf": [
        {"type": "object", "properties": {"a": {"type": "string"}}},
        {"type": "object", "properties": {"b": {"type": "number"}}}
    ]
}

VALID_ANYOF = {
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "https://example.com/schema/anyof",
    "name": "AnyOfSchema",
    "$uses": ["JSONStructureConditionalComposition"],
    "anyOf": [
        {"type": "string"},
        {"type": "number"}
    ]
}

VALID_ONEOF = {
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "https://example.com/schema/oneof",
    "name": "OneOfSchema",
    "$uses": ["JSONStructureConditionalComposition", "JSONStructureValidation"],
    "oneOf": [
        {"type": "string", "minLength": 5},
        {"type": "string", "maxLength": 3}
    ]
}

VALID_NOT = {
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "https://example.com/schema/not",
    "name": "NotSchema",
    "$uses": ["JSONStructureConditionalComposition"],
    "not": {"type": "string"}
}

VALID_IF_THEN_ELSE = {
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "https://example.com/schema/ifthenelse",
    "name": "IfThenElseSchema",
    "$uses": ["JSONStructureConditionalComposition"],
    "if": {"type": "object", "properties": {"a": {"type": "string"}}},
    "then": {"type": "object", "properties": {"b": {"type": "number"}}, "required": ["b"]},
    "else": {"type": "object", "properties": {"c": {"type": "boolean"}}, "required": ["c"]}
}

# Valid schema with validation keywords
VALID_NUMERIC_VALIDATION = {
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "https://example.com/schema/numeric_validation",
    "name": "NumericValidationSchema",
    "$uses": ["JSONStructureValidation"],
    "type": "number",
    "minimum": 0,
    "maximum": 100,
    "exclusiveMinimum": 0,
    "exclusiveMaximum": 100,
    "multipleOf": 5
}

VALID_STRING_VALIDATION = {
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "https://example.com/schema/string_validation",
    "name": "StringValidationSchema",
    "$uses": ["JSONStructureValidation"],
    "type": "string",
    "minLength": 3,
    "maxLength": 50,
    "pattern": "^[A-Za-z]+$",
    "format": "email"
}

VALID_ARRAY_VALIDATION = {
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "https://example.com/schema/array_validation",
    "name": "ArrayValidationSchema",
    "$uses": ["JSONStructureValidation"],
    "type": "array",
    "items": {"type": "string"},
    "minItems": 1,
    "maxItems": 10,
    "uniqueItems": True,
    "contains": {"type": "string", "const": "special"},
    "minContains": 1,
    "maxContains": 2
}

VALID_OBJECT_VALIDATION = {
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "https://example.com/schema/object_validation",
    "name": "ObjectValidationSchema",
    "$uses": ["JSONStructureValidation"],
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "age": {"type": "number"}
    },
    "minProperties": 1,
    "maxProperties": 5,
    "dependentRequired": {
        "age": ["birthdate"]
    },
    "patternProperties": {
        "^meta_": {"type": "string"}
    },
    "propertyNames": {"type": "string", "pattern": "^[a-z_]+$"}
}

# Valid with validation meta-schema (enables extensions by default)
VALID_VALIDATION_METASCHEMA = {
    "$schema": "https://json-structure.org/meta/validation/v0/#",
    "$id": "https://example.com/schema/validation_meta",
    "name": "ValidationMetaSchema",
    "type": "string",
    "minLength": 5,
    "pattern": "^[A-Z]"
}

# Valid with extended types and validation
VALID_DECIMAL_VALIDATION = {
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "https://example.com/schema/decimal_validation",
    "name": "DecimalValidationSchema",
    "$uses": ["JSONStructureValidation"],
    "type": "decimal",
    "minimum": "0.00",
    "maximum": "999.99",
    "multipleOf": "0.01"
}

VALID_EXTENDED_SCHEMAS = [
    VALID_ALLOF,
    VALID_ANYOF,
    VALID_ONEOF,
    VALID_NOT,
    VALID_IF_THEN_ELSE,
    VALID_NUMERIC_VALIDATION,
    VALID_STRING_VALIDATION,
    VALID_ARRAY_VALIDATION,
    VALID_OBJECT_VALIDATION,
    VALID_VALIDATION_METASCHEMA,
    VALID_DECIMAL_VALIDATION
]

# =============================================================================
# Invalid Schemas (Core)
# =============================================================================

# Case 1: Missing required '$id' keyword.
INVALID_MISSING_ID = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "name": "MissingID",
    "type": "any"
}

# Case 2: Missing required 'name' when 'type' is present at root.
INVALID_MISSING_NAME = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/missing_name",
    "type": "object",
    "properties": {
        "foo": {"type": "string"}
    }
}

# Case 3: Both 'type' and '$root' present at the root.
INVALID_BOTH_TYPE_AND_ROOT = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/both",
    "$root": "#/definitions/SomeRoot",
    "type": "any"
}

# Case 4: Object type missing 'properties' and not using '$extends'.
INVALID_NO_PROPERTIES = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/no_properties",
    "name": "NoPropsObject",
    "type": "object"
}

# Case 5: Union with inline compound type (not allowed).
INVALID_UNION_INLINE = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/invalid_union",
    "name": "InvalidUnion",
    "type": [
        "string",
        {"type": "object", "properties": {"foo": {"type": "int32"}}}
    ]
}

# Case 6: $ref property is not a string.
INVALID_REF_NOT_STRING = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/ref_not_string",
    "name": "RefNotString",
    "type": {"$ref": 123}
}

# Case 7: $ref pointer does not resolve (non-existent).
INVALID_BAD_REF = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/bad_ref",
    "name": "BadRef",
    "type": {"$ref": "#/definitions/NonExistent"}
}

# Case 8: definitions is not an object.
INVALID_DEFS_NOT_OBJECT = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/defs_not_object",
    "definitions": "not an object"
}

# Case 9: 'required' keyword used in a non-object type.
INVALID_REQUIRED_NON_OBJECT = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/required_non_object",
    "name": "RequiredNonObject",
    "type": "string",
    "required": ["someProp"]
}

# Case 10: 'additionalProperties' used in a non-object type.
INVALID_ADDITIONAL_NON_OBJECT = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/additional_non_object",
    "name": "AdditionalNonObject",
    "type": "int32",
    "additionalProperties": False
}

# Case 11: 'abstract' keyword not boolean.
INVALID_ABSTRACT_NOT_BOOL = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/abstract_not_bool",
    "name": "AbstractNotBool",
    "type": "string",
    "abstract": "true"
}

# Case 12: $extends pointer does not resolve.
INVALID_EXTENDS_BAD_POINTER = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/extends_bad",
    "name": "ExtendsBad",
    "type": "object",
    "$extends": "#/nonexistent"
}

# Case 13: 'properties' is not an object.
INVALID_PROPERTIES_NOT_OBJECT = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/props_not_object",
    "name": "PropsNotObj",
    "type": "object",
    "properties": ["not", "an", "object"]
}

# Case 14: 'enum' is not a list.
INVALID_ENUM_NOT_LIST = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/enum_not_list",
    "name": "EnumNotList",
    "type": "string",
    "enum": "not a list"
}

# Case 15: 'enum' used with a compound type.
INVALID_ENUM_COMPOUND = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/enum_compound",
    "name": "EnumCompound",
    "type": "object",
    "enum": ["a", "b"]
}

# Case 16: 'const' used with a compound type.
INVALID_CONST_COMPOUND = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/const_compound",
    "name": "ConstCompound",
    "type": "object",
    "const": "some value"
}

# Case 17: $offers is not an object.
INVALID_OFFERS_NOT_OBJECT = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/offers_not_obj",
    "name": "OffersNotObj",
    "type": "any",
    "$offers": "should be an object"
}

# Case 18: $offers key is not a string.
INVALID_OFFERS_KEY_NOT_STRING = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/offers_key_not_str",
    "name": "OffersKeyNotStr",
    "type": "any",
    "$offers": {123: "#/definitions/SomeType"},
    "definitions": {
        "SomeType": {
            "name": "SomeType",
            "type": "string"
        }
    }
}

# Case 19: $offers value list contains a non-string.
INVALID_OFFERS_VALUE_LIST_NONSTRING = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/offers_value_list_nonstr",
    "name": "OffersValueListNonStr",
    "type": "any",
    "$offers": {"OfferKey": ["#/definitions/SomeType", 123]},
    "definitions": {
        "SomeType": {
            "name": "SomeType",
            "type": "string"
        }
    }
}

# Case 20: $ref pointer that does not start with '#'
INVALID_REF_POINTER_NO_HASH = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/ref_no_hash",
    "name": "RefNoHash",
    "type": {"$ref": "invalid_pointer"}
}

# Case 21: Invalid definitions section without a top-level map
INVALID_DEFS_NO_MAP = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/defs_no_map",
    "name": "DefsNoMap",
    "type": "object",
    "definitions": "not a map"
}

#Case 22: Invalid definitions section with a type definition at the root of definitions
INVALID_DEFS_ROOT_TYPE = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/defs_root_type",
    "name": "DefsRootType",
    "type": "object",
    "definitions": {
        "name": "RootType",
        "type": "string"
    }
}

#Case 23: Not an object
INVALID_NOT_OBJECT = "test"

# Case 24: $schema is not an absolute URI.
INVALID_NOT_ABSOLUTE_URI = {
    "$schema": "not an absolute URI",
}

# Case 25: $schema is not a string.
INVALID_NOT_STRING = {
    "$schema": 123,
}

# Case 26: Tuple type missing 'tuple' keyword.
INVALID_TUPLE_MISSING_KEYWORD = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/invalid_tuple_missing",
    "name": "MissingTupleKeyword",
    "type": "tuple",
    "properties": {
        "name": {"type": "string"},
        "age": {"type": "int32"}
    }
}

# Case 27: 'tuple' keyword is not an array of strings.
INVALID_TUPLE_NOT_ARRAY = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/invalid_tuple_not_array",
    "name": "TupleNotArray",
    "type": "tuple",
    "properties": {
        "name": {"type": "string"},
        "age": {"type": "int32"}
    },
    "tuple": "name,age"
}

# Case 28: 'tuple' contains non-string elements.
INVALID_TUPLE_NONSTRING_ITEM = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/invalid_tuple_nonstring",
    "name": "TupleNonString",
    "type": "tuple",
    "properties": {
        "name": {"type": "string"},
        "age": {"type": "int32"}
    },
    "tuple": ["name", 42]
}

INVALID_SCHEMAS = [
    INVALID_MISSING_ID,
    INVALID_MISSING_NAME,
    INVALID_BOTH_TYPE_AND_ROOT,
    INVALID_NO_PROPERTIES,
    INVALID_UNION_INLINE,
    INVALID_REF_NOT_STRING,
    INVALID_BAD_REF,
    INVALID_DEFS_NOT_OBJECT,
    INVALID_REQUIRED_NON_OBJECT,
    INVALID_ADDITIONAL_NON_OBJECT,
    INVALID_ABSTRACT_NOT_BOOL,
    INVALID_EXTENDS_BAD_POINTER,
    INVALID_PROPERTIES_NOT_OBJECT,
    INVALID_ENUM_NOT_LIST,
    INVALID_ENUM_COMPOUND,
    INVALID_CONST_COMPOUND,
    INVALID_OFFERS_NOT_OBJECT,
    INVALID_OFFERS_KEY_NOT_STRING,
    INVALID_OFFERS_VALUE_LIST_NONSTRING,
    INVALID_REF_POINTER_NO_HASH,
    INVALID_DEFS_NO_MAP,
    INVALID_DEFS_ROOT_TYPE,
    INVALID_NOT_OBJECT,
    INVALID_NOT_ABSOLUTE_URI,
    INVALID_NOT_STRING,
    INVALID_TUPLE_MISSING_KEYWORD,
    INVALID_TUPLE_NOT_ARRAY,
    INVALID_TUPLE_NONSTRING_ITEM
]

# =============================================================================
# Invalid Schemas (Extended Features)
# =============================================================================

# Using extended keywords without enabling the extension
INVALID_COMPOSITION_NO_EXTENSION = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/composition_no_ext",
    "allOf": [
        {"type": "string"}
    ]
}

INVALID_VALIDATION_NO_EXTENSION = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/schema/validation_no_ext",
    "type": "string",
    "minLength": 5
}

# Invalid composition keyword usage
INVALID_ALLOF_NOT_ARRAY = {
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "https://example.com/schema/allof_not_array",
    "$uses": ["JSONStructureConditionalComposition"],
    "allOf": {"type": "string"}
}

INVALID_ALLOF_EMPTY = {
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "https://example.com/schema/allof_empty",
    "$uses": ["JSONStructureConditionalComposition"],
    "allOf": []
}

INVALID_NOT_NOT_SCHEMA = {
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "https://example.com/schema/not_not_schema",
    "$uses": ["JSONStructureConditionalComposition"],
    "not": "string"
}

# Invalid validation keyword usage
INVALID_MINLENGTH_NEGATIVE = {
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "https://example.com/schema/minlength_negative",
    "$uses": ["JSONStructureValidation"],
    "type": "string",
    "minLength": -1
}

INVALID_PATTERN_NOT_STRING = {
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "https://example.com/schema/pattern_not_string",
    "$uses": ["JSONStructureValidation"],
    "type": "string",
    "pattern": 123
}

INVALID_FORMAT_UNKNOWN = {
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "https://example.com/schema/format_unknown",
    "$uses": ["JSONStructureValidation"],
    "type": "string",
    "format": "unknown-format"
}

INVALID_NUMERIC_VALIDATION_ON_STRING = {
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "https://example.com/schema/numeric_on_string",
    "$uses": ["JSONStructureValidation"],
    "type": "string",
    "minimum": 10
}

INVALID_UNIQUEITEMS_NOT_BOOL = {
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "https://example.com/schema/uniqueitems_not_bool",
    "$uses": ["JSONStructureValidation"],
    "type": "array",
    "items": {"type": "string"},
    "uniqueItems": "true"
}

INVALID_CONTAINS_NOT_SCHEMA = {
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "https://example.com/schema/contains_not_schema",
    "$uses": ["JSONStructureValidation"],
    "type": "array",
    "items": {"type": "string"},
    "contains": "string"
}

INVALID_MINCONTAINS_WITHOUT_CONTAINS = {
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "https://example.com/schema/mincontains_no_contains",
    "$uses": ["JSONStructureValidation"],
    "type": "array",
    "items": {"type": "string"},
    "minContains": 1
}

INVALID_DEPENDENT_REQUIRED_NOT_OBJECT = {
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "https://example.com/schema/dependent_not_obj",
    "$uses": ["JSONStructureValidation"],
    "type": "object",
    "properties": {"name": {"type": "string"}},
    "dependentRequired": ["name"]
}

INVALID_PATTERN_PROPERTIES_BAD_REGEX = {
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "https://example.com/schema/pattern_bad_regex",
    "$uses": ["JSONStructureValidation"],
    "type": "object",
    "patternProperties": {
        "[": {"type": "string"}
    }
}

INVALID_MINPROPERTIES_ON_MAP = {
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "https://example.com/schema/minprops_on_map",
    "$uses": ["JSONStructureValidation"],
    "type": "map",
    "values": {"type": "string"},
    "minProperties": 1
}

INVALID_PROPERTYNAMES_ON_MAP = {
    "$schema": "https://json-structure.org/meta/extended/v0/#",
    "$id": "https://example.com/schema/propnames_on_map",
    "$uses": ["JSONStructureValidation"],
    "type": "map",
    "values": {"type": "string"},
    "propertyNames": {"type": "string"}
}

INVALID_EXTENDED_SCHEMAS = [
    INVALID_COMPOSITION_NO_EXTENSION,
    INVALID_VALIDATION_NO_EXTENSION,
    INVALID_ALLOF_NOT_ARRAY,
    INVALID_ALLOF_EMPTY,
    INVALID_NOT_NOT_SCHEMA,
    INVALID_MINLENGTH_NEGATIVE,
    INVALID_PATTERN_NOT_STRING,
    INVALID_FORMAT_UNKNOWN,
    INVALID_NUMERIC_VALIDATION_ON_STRING,
    INVALID_UNIQUEITEMS_NOT_BOOL,
    INVALID_CONTAINS_NOT_SCHEMA,
    INVALID_MINCONTAINS_WITHOUT_CONTAINS,
    INVALID_DEPENDENT_REQUIRED_NOT_OBJECT,
    INVALID_PATTERN_PROPERTIES_BAD_REGEX,
    INVALID_MINPROPERTIES_ON_MAP,
    INVALID_PROPERTYNAMES_ON_MAP
]

# =============================================================================
# Pytest Test Functions
# =============================================================================

@pytest.mark.parametrize("schema", VALID_SCHEMAS)
def test_valid_schemas(schema):
    """
    Test that valid schemas produce no errors.
    For VALID_ALLOW_DOLLAR, the allow_dollar flag is set.
    """
    source_text = json.dumps(schema)
    # Enable allow_dollar flag if the schema has a property with a '$' at the start
    allow_dollar = any(key.startswith('$') for key in schema.get("properties", {}))
    errors = validate_json_structure_schema_core(schema, source_text, allow_dollar=allow_dollar)
    assert errors == []

@pytest.mark.parametrize("schema", VALID_EXTENDED_SCHEMAS)
def test_valid_extended_schemas(schema):
    """
    Test that valid extended schemas produce no errors when extended=True.
    """
    source_text = json.dumps(schema)
    errors = validate_json_structure_schema_core(schema, source_text, extended=True)
    assert errors == []

@pytest.mark.parametrize("schema", INVALID_SCHEMAS)
def test_invalid_schemas(schema):
    """
    Test that invalid schemas produce one or more errors.
    """
    source_text = json.dumps(schema)
    errors = validate_json_structure_schema_core(schema, source_text)
    assert errors != []

@pytest.mark.parametrize("schema", INVALID_EXTENDED_SCHEMAS)
def test_invalid_extended_schemas(schema):
    """
    Test that invalid extended schemas produce one or more errors when extended=True.
    """
    source_text = json.dumps(schema)
    errors = validate_json_structure_schema_core(schema, source_text, extended=True)
    assert errors != []

# Additional test: Check that property names with '$' are rejected when allow_dollar is False.
def test_dollar_property_rejected():
    schema = {
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/dollar_rejected",
        "name": "DollarRejected",
        "type": "object",
        "properties": {
            "$invalid": {"type": "string"}
        }
    }
    source_text = json.dumps(schema)
    errors = validate_json_structure_schema_core(schema, source_text, allow_dollar=False)
    assert any("does not match" in err for err in errors)

# Additional test: Valid $offers structure.
def test_valid_offers():
    schema = {
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/offers_valid",
        "name": "OffersValid",
        "type": "any",
        "$offers": {
            "CustomOffer": "#/definitions/OfferType"
        },
        "definitions": {
            "OfferType": {
                "name": "OfferType",
                "type": "string"
            }
        }
    }
    source_text = json.dumps(schema)
    errors = validate_json_structure_schema_core(schema, source_text)
    assert errors == []

# Test that extended keywords are rejected without extended=True
def test_extended_keywords_rejected_without_flag():
    schema = {
        "$schema": "https://json-structure.org/meta/extended/v0/#",
        "$id": "https://example.com/schema/extended_rejected",
        "name": "ExtendedRejectedSchema",
        "$uses": ["JSONStructureValidation"],
        "type": "string",
        "minLength": 5
    }
    source_text = json.dumps(schema)
    # Without extended=True, this should not fail (validator does not check for extension if extended=False)
    errors = validate_json_structure_schema_core(schema, source_text, extended=False)
    assert errors == []

# Test $uses validation
def test_uses_validation():
    # Valid $uses
    schema_valid = {
        "$schema": "https://json-structure.org/meta/extended/v0/#",
        "$id": "https://example.com/schema/uses_valid",
        "name": "UsesValidSchema",
        "$uses": ["JSONStructureValidation", "JSONStructureConditionalComposition"],
        "type": "string"
    }
    source_text = json.dumps(schema_valid)
    errors = validate_json_structure_schema_core(schema_valid, source_text, extended=True)
    assert errors == []
    
    # Invalid $uses - not an array
    schema_invalid = {
        "$schema": "https://json-structure.org/meta/extended/v0/#",
        "$id": "https://example.com/schema/uses_invalid",
        "$uses": "JSONStructureValidation",
        "type": "string"
    }
    source_text = json.dumps(schema_invalid)
    errors = validate_json_structure_schema_core(schema_invalid, source_text, extended=True)
    assert any("$uses must be an array" in err for err in errors)
    
    # Invalid $uses - unknown extension
    schema_unknown = {
        "$schema": "https://json-structure.org/meta/extended/v0/#",
        "$id": "https://example.com/schema/uses_unknown",
        "$uses": ["UnknownExtension"],
        "type": "string"
    }
    source_text = json.dumps(schema_unknown)
    errors = validate_json_structure_schema_core(schema_unknown, source_text, extended=True)
    assert any("Unknown extension" in err for err in errors)

# Test that validation meta-schema enables extensions by default
def test_validation_metaschema_enables_extensions():
    schema = {
        "$schema": "https://json-structure.org/meta/validation/v0/#",
        "$id": "https://example.com/schema/validation_auto",
        "name": "ValidationAutoSchema",
        "type": "string",
        "minLength": 5,
        "allOf": [
            {"type": "string", "pattern": "^[A-Z]"}
        ]
    }
    source_text = json.dumps(schema)
    errors = validate_json_structure_schema_core(schema, source_text, extended=True)
    assert errors == []


# =============================================================================
# Tests for all primitive types
# =============================================================================

# Test all primitive types are recognized
@pytest.mark.parametrize("primitive_type", [
    "string", "number", "integer", "boolean", "null",
    "int8", "uint8", "int16", "uint16", "int32", "uint32",
    "int64", "uint64", "int128", "uint128",
    "float8", "float", "double", "decimal",
    "date", "datetime", "time", "duration",
    "uuid", "uri", "binary", "jsonpointer"
])
def test_all_primitive_types_valid(primitive_type):
    """Test that all primitive types are recognized as valid."""
    schema = {
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": f"https://example.com/schema/{primitive_type}_test",
        "name": f"{primitive_type.capitalize()}Schema",
        "type": primitive_type
    }
    source_text = json.dumps(schema)
    errors = validate_json_structure_schema_core(schema, source_text)
    assert errors == [], f"Type '{primitive_type}' should be valid but got errors: {errors}"


# Test that unknown types are rejected
def test_unknown_type_rejected():
    schema = {
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/unknown_type",
        "name": "UnknownTypeSchema",
        "type": "unknowntype"
    }
    source_text = json.dumps(schema)
    errors = validate_json_structure_schema_core(schema, source_text)
    assert any("not a recognized" in err for err in errors)


# Test maxLength validation
def test_maxlength_valid():
    schema = {
        "$schema": "https://json-structure.org/meta/extended/v0/#",
        "$id": "https://example.com/schema/maxlength_valid",
        "name": "MaxLengthSchema",
        "$uses": ["JSONStructureValidation"],
        "type": "string",
        "maxLength": 100
    }
    source_text = json.dumps(schema)
    errors = validate_json_structure_schema_core(schema, source_text, extended=True)
    assert errors == []


def test_maxlength_negative():
    schema = {
        "$schema": "https://json-structure.org/meta/extended/v0/#",
        "$id": "https://example.com/schema/maxlength_negative",
        "name": "MaxLengthNegativeSchema",
        "$uses": ["JSONStructureValidation"],
        "type": "string",
        "maxLength": -1
    }
    source_text = json.dumps(schema)
    errors = validate_json_structure_schema_core(schema, source_text, extended=True)
    assert any("maxLength" in err for err in errors)


def test_maxlength_not_integer():
    schema = {
        "$schema": "https://json-structure.org/meta/extended/v0/#",
        "$id": "https://example.com/schema/maxlength_not_int",
        "name": "MaxLengthNotIntSchema",
        "$uses": ["JSONStructureValidation"],
        "type": "string",
        "maxLength": "100"
    }
    source_text = json.dumps(schema)
    errors = validate_json_structure_schema_core(schema, source_text, extended=True)
    assert any("maxLength" in err for err in errors)


# Test compound types are valid
@pytest.mark.parametrize("compound_type", ["object", "array", "set", "map", "tuple", "choice", "any"])
def test_compound_types_recognized(compound_type):
    """Test that compound types are recognized."""
    # Build appropriate schema for each compound type
    if compound_type == "object":
        schema = {
            "$schema": "https://json-structure.org/meta/core/v0/#",
            "$id": f"https://example.com/schema/{compound_type}_test",
            "name": "ObjectSchema",
            "type": "object",
            "properties": {"prop": {"type": "string"}}
        }
    elif compound_type in ["array", "set"]:
        schema = {
            "$schema": "https://json-structure.org/meta/core/v0/#",
            "$id": f"https://example.com/schema/{compound_type}_test",
            "name": f"{compound_type.capitalize()}Schema",
            "type": compound_type,
            "items": {"type": "string"}
        }
    elif compound_type == "map":
        schema = {
            "$schema": "https://json-structure.org/meta/core/v0/#",
            "$id": f"https://example.com/schema/{compound_type}_test",
            "name": "MapSchema",
            "type": "map",
            "values": {"type": "string"}
        }
    elif compound_type == "tuple":
        schema = {
            "$schema": "https://json-structure.org/meta/core/v0/#",
            "$id": f"https://example.com/schema/{compound_type}_test",
            "name": "TupleSchema",
            "type": "tuple",
            "properties": {"a": {"type": "string"}, "b": {"type": "int32"}},
            "tuple": ["a", "b"]
        }
    elif compound_type == "choice":
        schema = {
            "$schema": "https://json-structure.org/meta/core/v0/#",
            "$id": f"https://example.com/schema/{compound_type}_test",
            "name": "ChoiceSchema",
            "type": "choice",
            "choices": {"opt1": {"type": "string"}, "opt2": {"type": "int32"}}
        }
    else:  # any
        schema = {
            "$schema": "https://json-structure.org/meta/core/v0/#",
            "$id": f"https://example.com/schema/{compound_type}_test",
            "name": "AnySchema",
            "type": "any"
        }
    
    source_text = json.dumps(schema)
    errors = validate_json_structure_schema_core(schema, source_text)
    assert errors == [], f"Compound type '{compound_type}' should be valid but got errors: {errors}"


# Test validation keywords on all numeric types
@pytest.mark.parametrize("numeric_type", [
    "number", "integer", "float", "double", "float8",
    "int8", "uint8", "int16", "uint16", "int32", "uint32"
])
def test_numeric_validation_keywords(numeric_type):
    """Test that numeric validation keywords work on numeric types."""
    schema = {
        "$schema": "https://json-structure.org/meta/extended/v0/#",
        "$id": f"https://example.com/schema/{numeric_type}_validation",
        "name": f"{numeric_type.capitalize()}ValidationSchema",
        "$uses": ["JSONStructureValidation"],
        "type": numeric_type,
        "minimum": 0,
        "maximum": 100
    }
    source_text = json.dumps(schema)
    errors = validate_json_structure_schema_core(schema, source_text, extended=True)
    assert errors == [], f"Numeric validation on '{numeric_type}' should be valid but got errors: {errors}"


# Test validation keywords on string-based numeric types (int64, uint64, int128, uint128, decimal)
@pytest.mark.parametrize("string_numeric_type", ["int64", "uint64", "int128", "uint128", "decimal"])
def test_string_numeric_validation_keywords(string_numeric_type):
    """Test that string-based numeric types require string values for validation keywords."""
    schema = {
        "$schema": "https://json-structure.org/meta/extended/v0/#",
        "$id": f"https://example.com/schema/{string_numeric_type}_validation",
        "name": f"{string_numeric_type.capitalize()}ValidationSchema",
        "$uses": ["JSONStructureValidation"],
        "type": string_numeric_type,
        "minimum": "0",
        "maximum": "1000000000000"
    }
    source_text = json.dumps(schema)
    errors = validate_json_structure_schema_core(schema, source_text, extended=True)
    assert errors == [], f"String-based numeric validation on '{string_numeric_type}' should be valid but got errors: {errors}"


# =============================================================================
# External Schemas (Sideloading) Tests
# =============================================================================


def test_external_schemas_single_import():
    """Test sideloading a single external schema via external_schemas parameter."""
    from json_structure.schema_validator import JSONStructureSchemaCoreValidator
    
    # External schema to sideload
    people_schema = {
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/people.json",
        "name": "Person",
        "type": "object",
        "properties": {
            "firstName": {"type": "string"},
            "lastName": {"type": "string"}
        }
    }
    
    # Main schema importing the external one
    main_schema = {
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/main",
        "name": "MainSchema",
        "type": "object",
        "properties": {
            "person": {"$ref": "#/definitions/People/Person"}
        },
        "definitions": {
            "People": {
                "$import": "https://example.com/people.json"
            }
        }
    }
    
    source_text = json.dumps(main_schema)
    validator = JSONStructureSchemaCoreValidator(
        allow_import=True,
        external_schemas=[people_schema]
    )
    errors = validator.validate(main_schema, source_text)
    assert errors == [], f"Expected no errors but got: {errors}"


def test_external_schemas_multiple_imports():
    """Test sideloading multiple external schemas for multiple imports."""
    from json_structure.schema_validator import JSONStructureSchemaCoreValidator
    
    address_schema = {
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/address.json",
        "name": "Address",
        "type": "object",
        "properties": {
            "street": {"type": "string"},
            "city": {"type": "string"}
        }
    }
    
    person_schema = {
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/person.json",
        "name": "Person",
        "type": "object",
        "properties": {
            "name": {"type": "string"}
        }
    }
    
    main_schema = {
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/main",
        "name": "MainSchema",
        "type": "object",
        "properties": {
            "person": {"$ref": "#/definitions/People/Person"},
            "location": {"$ref": "#/definitions/Addresses/Address"}
        },
        "definitions": {
            "People": {
                "$import": "https://example.com/person.json"
            },
            "Addresses": {
                "$import": "https://example.com/address.json"
            }
        }
    }
    
    source_text = json.dumps(main_schema)
    validator = JSONStructureSchemaCoreValidator(
        allow_import=True,
        external_schemas=[address_schema, person_schema]
    )
    errors = validator.validate(main_schema, source_text)
    assert errors == [], f"Expected no errors but got: {errors}"


def test_external_schemas_missing_import():
    """Test that missing external schemas still produce errors."""
    from json_structure.schema_validator import JSONStructureSchemaCoreValidator
    
    main_schema = {
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/main",
        "name": "MainSchema",
        "type": "object",
        "properties": {
            "thing": {"$ref": "#/definitions/Stuff/Missing"}
        },
        "definitions": {
            "Stuff": {
                "$import": "https://example.com/missing.json"
            }
        }
    }
    
    source_text = json.dumps(main_schema)
    validator = JSONStructureSchemaCoreValidator(
        allow_import=True,
        external_schemas=[]
    )
    errors = validator.validate(main_schema, source_text)
    assert any("unable to fetch" in err.lower() for err in errors)


def test_external_schemas_priority_over_simulated():
    """Test that external_schemas takes priority over simulated schemas."""
    from json_structure.schema_validator import JSONStructureSchemaCoreValidator
    
    # Override the simulated people.json with our own version
    custom_people_schema = {
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/people.json",
        "name": "CustomPerson",
        "type": "object",
        "properties": {
            "customField": {"type": "boolean"}
        }
    }
    
    main_schema = {
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/main",
        "name": "MainSchema",
        "type": "object",
        "properties": {
            "person": {"$ref": "#/definitions/People/CustomPerson"}
        },
        "definitions": {
            "People": {
                "$import": "https://example.com/people.json"
            }
        }
    }
    
    source_text = json.dumps(main_schema)
    validator = JSONStructureSchemaCoreValidator(
        allow_import=True,
        external_schemas=[custom_people_schema]
    )
    errors = validator.validate(main_schema, source_text)
    assert errors == [], f"Expected no errors but got: {errors}"
