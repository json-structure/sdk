#!/usr/bin/env python3
"""
Python SDK - Error Codes Demo

This demo shows how error codes and source locations are included in validation errors.
"""

import json
import sys
import os

# Add the src directory to the path so we can import without installing
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from json_structure import SchemaValidator, InstanceValidator
from json_structure import (
    SCHEMA_NULL, SCHEMA_INVALID_TYPE, SCHEMA_REF_NOT_FOUND, SCHEMA_MIN_GREATER_THAN_MAX,
    INSTANCE_STRING_MIN_LENGTH, INSTANCE_REQUIRED_PROPERTY_MISSING, 
    INSTANCE_TYPE_MISMATCH, INSTANCE_STRING_PATTERN_MISMATCH
)

print("=== JSON Structure Python SDK - Error Codes Demo ===\n")

# Test 1: Schema validation errors with error codes and source locations
print("--- Schema Validation Errors ---\n")

# Use source text to enable source location tracking
schema_source = """{
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "type": "object",
    "properties": {
        "count": {"type": "integer", "minimum": 10, "maximum": 5}
    },
    "required": ["missing_property"]
}"""

bad_schema = json.loads(schema_source)

print("Bad Schema:")
print(schema_source)
print()

schema_validator = SchemaValidator()
# Pass source_text to enable line/column tracking
schema_errors = schema_validator.validate(bad_schema, schema_source)

print(f"Valid: {len(schema_errors) == 0}\n")
print("Errors with error codes:")
print("-" * 80)

for error in schema_errors:
    print(f"  Error: {error.message}")
    print(f"         → Code:     {error.code}")
    print(f"         → Path:     {error.path}")
    if error.location and error.location.is_known:
        print(f"         → Location: Line {error.location.line}, Column {error.location.column}")
    print()

# Test 2: Instance validation errors with error codes
print("\n--- Instance Validation Errors ---\n")

schema = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "age": {"type": "int32"}
    },
    "required": ["name", "age"]
}

instance = {
    "name": 123,        # Wrong type (should be string)
    # Missing required "age"
}

print("Schema:")
print(json.dumps(schema, indent=2))
print()
print("Instance:")
print(json.dumps(instance, indent=2))
print()

# Create instance validator with the schema in the constructor
instance_validator = InstanceValidator(schema)
# validate_instance returns a list of error strings
instance_errors = instance_validator.validate_instance(instance)

print(f"Valid: {len(instance_errors) == 0}\n")
print("Errors:")
print("-" * 80)

for error in instance_errors:
    # Instance errors are strings, not ValidationError objects
    print(f"  {error}")

print()

# Test 3: Show available error codes
print("\n--- Available Error Codes (sample) ---\n")
print("Schema Error Codes:")
print(f'  SCHEMA_NULL = "{SCHEMA_NULL}"')
print(f'  SCHEMA_INVALID_TYPE = "{SCHEMA_INVALID_TYPE}"')
print(f'  SCHEMA_REF_NOT_FOUND = "{SCHEMA_REF_NOT_FOUND}"')
print(f'  SCHEMA_MIN_GREATER_THAN_MAX = "{SCHEMA_MIN_GREATER_THAN_MAX}"')

print("\nInstance Error Codes:")
print(f'  INSTANCE_STRING_MIN_LENGTH = "{INSTANCE_STRING_MIN_LENGTH}"')
print(f'  INSTANCE_REQUIRED_PROPERTY_MISSING = "{INSTANCE_REQUIRED_PROPERTY_MISSING}"')
print(f'  INSTANCE_TYPE_MISMATCH = "{INSTANCE_TYPE_MISMATCH}"')
print(f'  INSTANCE_STRING_PATTERN_MISMATCH = "{INSTANCE_STRING_PATTERN_MISMATCH}"')

print("\n=== Demo Complete ===\n")
