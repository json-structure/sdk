# encoding: utf-8
"""
test_assets.py

Integration tests that validate all schemas and instances from the sdk/test-assets directory.
These tests ensure that invalid schemas fail validation and invalid instances fail validation.
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
INVALID_INSTANCES = TEST_ASSETS / "instances" / "invalid"
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
            if "$defs" in schema:
                target_schema["$defs"] = schema["$defs"]
    
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
