# encoding: utf-8
"""
test_assets.py

Integration tests that validate all schemas and instances from the sdk/test-assets directory.
These tests ensure that invalid schemas fail validation and invalid instances fail validation.
Also tests that validation extension keywords ARE enforced when $uses is present.
"""

import json
import os
import pytest
from pathlib import Path

from json_structure import SchemaValidator, InstanceValidator

# Get the path to test-assets
SDK_ROOT = Path(__file__).parent.parent.parent
TEST_ASSETS = SDK_ROOT / "test-assets"
INVALID_SCHEMAS = TEST_ASSETS / "schemas" / "invalid"
WARNING_SCHEMAS = TEST_ASSETS / "schemas" / "warnings"
VALIDATION_SCHEMAS = TEST_ASSETS / "schemas" / "validation"
INVALID_INSTANCES = TEST_ASSETS / "instances" / "invalid"
VALIDATION_INSTANCES = TEST_ASSETS / "instances" / "validation"
SAMPLES_ROOT = SDK_ROOT / "primer-and-samples" / "samples" / "core"


def get_invalid_schema_files():
    """Get all invalid schema files from test-assets."""
    if not INVALID_SCHEMAS.exists():
        return []
    return list(INVALID_SCHEMAS.glob("*.struct.json"))


def get_invalid_instance_dirs():
    """Get all directories containing invalid instances."""
    if not INVALID_INSTANCES.exists():
        return []
    return [d for d in INVALID_INSTANCES.iterdir() if d.is_dir()]


def resolve_json_pointer(pointer: str, doc: dict):
    """Resolve a JSON pointer to get the target value."""
    if not pointer.startswith("/"):
        return None
    
    parts = pointer[1:].split("/")
    current = doc
    
    for part in parts:
        # Handle JSON pointer escaping
        part = part.replace("~1", "/").replace("~0", "~")
        
        if isinstance(current, dict):
            if part not in current:
                return None
            current = current[part]
        elif isinstance(current, list):
            try:
                index = int(part)
                if index < 0 or index >= len(current):
                    return None
                current = current[index]
            except ValueError:
                return None
        else:
            return None
    
    return current


# =============================================================================
# Invalid Schema Tests
# =============================================================================

@pytest.mark.skipif(not INVALID_SCHEMAS.exists(), reason="test-assets not found")
@pytest.mark.parametrize("schema_file", get_invalid_schema_files(), ids=lambda f: f.name)
def test_invalid_schema_fails_validation(schema_file):
    """Test that invalid schemas fail validation."""
    with open(schema_file, "r", encoding="utf-8") as f:
        schema = json.load(f)
    
    description = schema.get("description", "No description")
    
    validator = SchemaValidator(extended=True)
    errors = validator.validate(schema)
    
    assert len(errors) > 0, f"Schema {schema_file.name} should be invalid. Description: {description}"


# =============================================================================
# Invalid Instance Tests
# =============================================================================

def get_invalid_instance_test_cases():
    """Get all test cases for invalid instances."""
    cases = []
    for instance_dir in get_invalid_instance_dirs():
        sample_name = instance_dir.name
        for instance_file in instance_dir.glob("*.json"):
            cases.append((sample_name, instance_file))
    return cases


@pytest.mark.skipif(not INVALID_INSTANCES.exists(), reason="test-assets not found")
@pytest.mark.parametrize("sample_name,instance_file", get_invalid_instance_test_cases(), 
                         ids=lambda x: f"{x[0]}/{x[1].name}" if isinstance(x, tuple) else str(x))
def test_invalid_instance_fails_validation(sample_name, instance_file):
    """Test that invalid instances fail validation."""
    # Load instance
    with open(instance_file, "r", encoding="utf-8") as f:
        instance = json.load(f)
    
    description = instance.pop("_description", "No description")
    schema_ref = instance.pop("_schema", None)
    
    # Remove other metadata fields
    instance = {k: v for k, v in instance.items() if not k.startswith("_")}
    
    # Load schema
    schema_path = SAMPLES_ROOT / sample_name / "schema.struct.json"
    if not schema_path.exists():
        pytest.skip(f"Schema not found: {schema_path}")
    
    with open(schema_path, "r", encoding="utf-8") as f:
        schema = json.load(f)
    
    # Handle $root
    root_ref = schema.get("$root")
    target_schema = schema
    
    if root_ref and root_ref.startswith("#/"):
        resolved = resolve_json_pointer(root_ref[1:], schema)
        if resolved and isinstance(resolved, dict):
            # Create wrapper with definitions
            target_schema = dict(resolved)
            if "definitions" in schema:
                target_schema["definitions"] = schema["definitions"]
    
    # Validate - Python API takes schema in constructor
    # Need extended=True to enable validation addins like maxLength, minLength, pattern, etc.
    validator = InstanceValidator(target_schema, extended=True)
    errors = validator.validate_instance(instance)
    
    assert len(errors) > 0, f"Instance {sample_name}/{instance_file.name} should be invalid. Description: {description}"


# =============================================================================
# Summary Tests
# =============================================================================

@pytest.mark.skipif(not TEST_ASSETS.exists(), reason="test-assets not found")
def test_invalid_schemas_directory_exists():
    """Verify that the invalid schemas directory exists and has files."""
    assert INVALID_SCHEMAS.exists(), "Invalid schemas directory should exist"
    schemas = list(INVALID_SCHEMAS.glob("*.struct.json"))
    assert len(schemas) > 0, "Should have invalid schema test files"


@pytest.mark.skipif(not TEST_ASSETS.exists(), reason="test-assets not found")
def test_invalid_instances_directory_exists():
    """Verify that the invalid instances directory exists and has subdirectories."""
    assert INVALID_INSTANCES.exists(), "Invalid instances directory should exist"
    dirs = [d for d in INVALID_INSTANCES.iterdir() if d.is_dir()]
    assert len(dirs) > 0, "Should have invalid instance test directories"


# =============================================================================
# Validation Enforcement Tests
# =============================================================================

def get_validation_schemas():
    """Get all validation schemas from test-assets."""
    if not VALIDATION_SCHEMAS.exists():
        return []
    return list(VALIDATION_SCHEMAS.glob("*.struct.json"))


def get_validation_instance_test_cases():
    """Get all test cases for validation enforcement instances."""
    cases = []
    if not VALIDATION_INSTANCES.exists():
        return cases
    for schema_dir in VALIDATION_INSTANCES.iterdir():
        if schema_dir.is_dir():
            schema_name = schema_dir.name
            for instance_file in schema_dir.glob("*.json"):
                cases.append((schema_name, instance_file))
    return cases


@pytest.mark.skipif(not VALIDATION_SCHEMAS.exists(), reason="validation schemas not found")
@pytest.mark.parametrize("schema_file", get_validation_schemas(), ids=lambda f: f.name)
def test_validation_schema_is_valid(schema_file):
    """Test that validation schemas are themselves valid."""
    with open(schema_file, "r", encoding="utf-8") as f:
        schema = json.load(f)
    
    validator = SchemaValidator(extended=True)
    errors = validator.validate(schema)
    
    # Filter out warnings (only keep errors)
    real_errors = [e for e in errors if getattr(e, 'severity', None) != 'warning']
    
    assert len(real_errors) == 0, f"Validation schema {schema_file.name} should be valid. Errors: {real_errors}"


@pytest.mark.skipif(not VALIDATION_INSTANCES.exists(), reason="validation instances not found")
@pytest.mark.parametrize("schema_name,instance_file", get_validation_instance_test_cases(),
                         ids=lambda x: f"{x[0]}/{x[1].name}" if isinstance(x, tuple) else str(x))
def test_validation_enforcement_instance_fails(schema_name, instance_file):
    """Test that instances with validation extension keywords are validated correctly."""
    # Load instance
    with open(instance_file, "r", encoding="utf-8") as f:
        instance_data = json.load(f)
    
    description = instance_data.get("_description", "No description")
    expected_error = instance_data.get("_expectedError")
    expected_valid = instance_data.get("_expectedValid", False)
    
    # Get value to validate (either "value" key or the object minus metadata)
    if "value" in instance_data:
        instance = instance_data["value"]
    else:
        instance = {k: v for k, v in instance_data.items() if not k.startswith("_")}
    
    # Load schema
    schema_path = VALIDATION_SCHEMAS / f"{schema_name}.struct.json"
    if not schema_path.exists():
        pytest.skip(f"Schema not found: {schema_path}")
    
    with open(schema_path, "r", encoding="utf-8") as f:
        schema = json.load(f)
    
    # Validate with extended=True to ensure validation addins are applied
    validator = InstanceValidator(schema, extended=True)
    errors = validator.validate_instance(instance)
    
    if expected_valid:
        # Instance should be valid
        assert len(errors) == 0, (
            f"Instance {schema_name}/{instance_file.name} should be VALID. "
            f"Description: {description}. "
            f"Errors: {[str(e) for e in errors]}"
        )
    else:
        # Instance should be invalid
        assert len(errors) > 0, (
            f"Instance {schema_name}/{instance_file.name} should be INVALID "
            f"(validation extension keywords should be enforced). "
            f"Description: {description}"
        )
    
    # If expected error is specified, verify an appropriate error message is present
    # Map expected error codes to patterns in error messages
    if expected_error:
        error_patterns = {
            "INSTANCE_NUMBER_MINIMUM": ["less than minimum", "minimum"],
            "INSTANCE_NUMBER_MAXIMUM": ["greater than maximum", "maximum"],
            "INSTANCE_NUMBER_EXCLUSIVE_MINIMUM": ["greater than", "exclusiveMinimum"],
            "INSTANCE_NUMBER_EXCLUSIVE_MAXIMUM": ["less than", "exclusiveMaximum"],
            "INSTANCE_NUMBER_MULTIPLE_OF": ["multiple of", "multipleOf"],
            "INSTANCE_STRING_MIN_LENGTH": ["minLength", "shorter than"],
            "INSTANCE_STRING_PATTERN_MISMATCH": ["pattern", "does not match"],
            "INSTANCE_MIN_ITEMS": ["minItems", "fewer items"],
            "INSTANCE_MAX_ITEMS": ["maxItems", "more items"],
            "INSTANCE_MIN_PROPERTIES": ["minProperties", "fewer properties"],
            "INSTANCE_MAX_PROPERTIES": ["maxProperties", "more properties"],
            "INSTANCE_MAP_MIN_ENTRIES": ["minEntries", "fewer than"],
            "INSTANCE_MAP_MAX_ENTRIES": ["maxEntries", "more than"],
            "INSTANCE_MAP_KEY_INVALID": ["keyNames", "key", "does not match"],
            "INSTANCE_DEPENDENT_REQUIRED": ["requires dependent property", "dependentRequired"],
            "INSTANCE_SET_DUPLICATE": ["unique", "duplicate"],
            "INSTANCE_MIN_CONTAINS": ["minContains", "fewer matching", "does not contain required"],
            "INSTANCE_MAX_CONTAINS": ["maxContains", "too many matching", "more than maxContains"],
        }
        
        patterns = error_patterns.get(expected_error, [expected_error])
        error_messages = [str(e) for e in errors]
        all_errors_text = " ".join(error_messages).lower()
        
        # Check if any pattern matches
        found = any(p.lower() in all_errors_text for p in patterns)
        assert found, (
            f"Instance {schema_name}/{instance_file.name} should produce error matching {expected_error}. "
            f"Actual errors: {error_messages}"
        )


@pytest.mark.skipif(not TEST_ASSETS.exists(), reason="test-assets not found")
def test_validation_schemas_directory_exists():
    """Verify that the validation schemas directory exists and has files."""
    if not VALIDATION_SCHEMAS.exists():
        pytest.skip("Validation schemas directory not yet created")
    schemas = list(VALIDATION_SCHEMAS.glob("*.struct.json"))
    assert len(schemas) > 0, "Should have validation schema test files"


@pytest.mark.skipif(not TEST_ASSETS.exists(), reason="test-assets not found")
def test_validation_instances_directory_exists():
    """Verify that the validation instances directory exists and has subdirectories."""
    if not VALIDATION_INSTANCES.exists():
        pytest.skip("Validation instances directory not yet created")
    dirs = [d for d in VALIDATION_INSTANCES.iterdir() if d.is_dir()]
    assert len(dirs) > 0, "Should have validation instance test directories"


# =============================================================================
# Warning Tests for Extension Keywords Without $uses
# =============================================================================

def get_warning_schemas():
    """Get all warning schema test files."""
    if not WARNING_SCHEMAS.exists():
        return []
    return list(WARNING_SCHEMAS.glob("*-without-uses.struct.json"))


@pytest.mark.skipif(not WARNING_SCHEMAS.exists(), reason="warning schemas not found")
@pytest.mark.parametrize("schema_file", get_warning_schemas(), ids=lambda f: f.name)
def test_warning_schema_produces_warnings(schema_file):
    """Test that schemas with extension keywords but without $uses produce warnings."""
    from json_structure import error_codes
    
    with open(schema_file, "r", encoding="utf-8") as f:
        schema = json.load(f)
    
    # Validate with warn_on_unused_extension_keywords=True (default)
    validator = SchemaValidator(extended=True, warn_on_unused_extension_keywords=True)
    errors = validator.validate(schema)
    
    # Schema should be valid (no errors)
    assert len(errors) == 0, (
        f"Schema {schema_file.name} should be valid (warnings only). "
        f"Errors: {[str(e) for e in errors]}"
    )
    
    # But should have warnings for extension keywords
    assert len(validator.warnings) > 0, (
        f"Schema {schema_file.name} should produce warnings for extension keywords without $uses"
    )
    
    # All warnings should be SCHEMA_EXTENSION_KEYWORD_NOT_ENABLED
    for warning in validator.warnings:
        assert warning.code == error_codes.SCHEMA_EXTENSION_KEYWORD_NOT_ENABLED, (
            f"Warning should have code {error_codes.SCHEMA_EXTENSION_KEYWORD_NOT_ENABLED}, got {warning.code}"
        )


@pytest.mark.skipif(not WARNING_SCHEMAS.exists(), reason="warning schemas not found")
def test_warning_schema_with_uses_no_warnings():
    """Test that schemas with $uses don't produce extension keyword warnings."""
    schema_file = WARNING_SCHEMAS / "all-extension-keywords-with-uses.struct.json"
    if not schema_file.exists():
        pytest.skip("all-extension-keywords-with-uses.struct.json not found")
    
    with open(schema_file, "r", encoding="utf-8") as f:
        schema = json.load(f)
    
    validator = SchemaValidator(extended=True, warn_on_unused_extension_keywords=True)
    errors = validator.validate(schema)
    
    # Schema should be valid
    assert len(errors) == 0, (
        f"Schema should be valid. Errors: {[str(e) for e in errors]}"
    )
    
    # Should have no warnings for extension keywords since $uses is present
    extension_keyword_warnings = [
        w for w in validator.warnings 
        if "extension keyword" in w.message.lower()
    ]
    assert len(extension_keyword_warnings) == 0, (
        f"Schema with $uses should not produce extension keyword warnings. "
        f"Warnings: {[str(w) for w in extension_keyword_warnings]}"
    )


@pytest.mark.skipif(not WARNING_SCHEMAS.exists(), reason="warning schemas not found")
def test_warning_disabled_option():
    """Test that warn_on_unused_extension_keywords=False disables warnings."""
    # Use a schema without $uses that would normally produce warnings
    schema_file = WARNING_SCHEMAS / "numeric-minimum-without-uses.struct.json"
    if not schema_file.exists():
        pytest.skip("numeric-minimum-without-uses.struct.json not found")
    
    with open(schema_file, "r", encoding="utf-8") as f:
        schema = json.load(f)
    
    validator = SchemaValidator(extended=True, warn_on_unused_extension_keywords=False)
    errors = validator.validate(schema)
    
    # Schema should be valid
    assert len(errors) == 0
    
    # Should have no warnings when option is disabled
    assert len(validator.warnings) == 0, (
        f"Should have no warnings when warn_on_unused_extension_keywords=False. "
        f"Warnings: {[str(w) for w in validator.warnings]}"
    )


@pytest.mark.skipif(not WARNING_SCHEMAS.exists(), reason="warning schemas not found")
def test_warnings_directory_exists():
    """Verify that the warnings schemas directory exists and has files."""
    assert WARNING_SCHEMAS.exists(), "Warning schemas directory should exist"
    schemas = list(WARNING_SCHEMAS.glob("*.struct.json"))
    assert len(schemas) > 0, "Should have warning schema test files"
