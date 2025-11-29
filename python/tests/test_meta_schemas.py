# encoding: utf-8
"""
test_meta_schemas.py

Tests that validate the JSON Structure metaschemas from the meta repository.
The metaschemas define the JSON Structure specification itself, so they
must be valid according to the schema validator.
"""

import json
import pytest
from pathlib import Path

from json_structure import SchemaValidator

# Get the path to meta submodule
SDK_ROOT = Path(__file__).parent.parent.parent
META_ROOT = SDK_ROOT / "meta"


def load_metaschema(schema_name, version):
    """Load a metaschema from the meta submodule."""
    schema_path = META_ROOT / schema_name / version / "index.json"
    if not schema_path.exists():
        return None
    with open(schema_path, "r", encoding="utf-8") as f:
        return json.load(f)


def get_all_metaschemas():
    """Load all metaschemas to use as external schemas for import resolution."""
    schemas = []
    for name in ["core", "extended", "validation"]:
        schema = load_metaschema(name, "v0")
        if schema:
            schemas.append(schema)
    return schemas


# Define the metaschemas to test
METASCHEMAS = [
    ("core", "v0"),
    ("extended", "v0"),
    ("validation", "v0"),
]


@pytest.fixture(scope="module")
def metaschema_validator():
    """Create a validator configured for metaschema validation."""
    external_schemas = get_all_metaschemas()
    return SchemaValidator(
        allow_dollar=True, 
        allow_import=True,
        external_schemas=external_schemas
    )


@pytest.mark.skipif(not META_ROOT.exists(), reason="meta submodule not initialized")
@pytest.mark.parametrize("schema_name,version", METASCHEMAS)
def test_metaschema_valid(schema_name, version, metaschema_validator):
    """Test that all metaschemas are valid JSON Structure schemas."""
    schema = load_metaschema(schema_name, version)
    if schema is None:
        pytest.skip(f"Metaschema {schema_name}/{version} not found")
    
    errors = metaschema_validator.validate(schema)
    assert errors == [], f"Metaschema {schema_name}/{version} has errors: {errors}"


@pytest.mark.skipif(not META_ROOT.exists(), reason="meta submodule not initialized")
def test_core_metaschema_has_definitions():
    """Test that the core metaschema has the expected type definitions."""
    schema_path = META_ROOT / "core" / "v0" / "index.json"
    if not schema_path.exists():
        pytest.skip(f"Core metaschema not found: {schema_path}")
    
    with open(schema_path, "r", encoding="utf-8") as f:
        schema = json.load(f)
    
    # The core metaschema should have key definitions
    assert "definitions" in schema or "$defs" in schema, "Core metaschema must have definitions"
    
    defs = schema.get("definitions", schema.get("$defs", {}))
    
    # Check for some expected core types (actual names from the metaschema)
    expected_types = ["Type", "ObjectType", "Property", "SchemaDocument"]
    for type_name in expected_types:
        assert type_name in defs, f"Core metaschema missing expected type: {type_name}"


@pytest.mark.skipif(not META_ROOT.exists(), reason="meta submodule not initialized")
def test_extended_metaschema_imports_core():
    """Test that the extended metaschema imports the core schema."""
    schema_path = META_ROOT / "extended" / "v0" / "index.json"
    if not schema_path.exists():
        pytest.skip(f"Extended metaschema not found: {schema_path}")
    
    with open(schema_path, "r", encoding="utf-8") as f:
        schema = json.load(f)
    
    # The extended metaschema should have $import at the root level
    assert "$import" in schema, "Extended metaschema should import core schema"
    assert "core" in schema["$import"], "Extended metaschema should import core schema"


@pytest.mark.skipif(not META_ROOT.exists(), reason="meta submodule not initialized")
def test_validation_metaschema_imports_extended():
    """Test that the validation metaschema imports the extended schema."""
    schema_path = META_ROOT / "validation" / "v0" / "index.json"
    if not schema_path.exists():
        pytest.skip(f"Validation metaschema not found: {schema_path}")
    
    with open(schema_path, "r", encoding="utf-8") as f:
        schema = json.load(f)
    
    # The validation metaschema should have $import at the root level
    assert "$import" in schema, "Validation metaschema should import extended schema"
    assert "extended" in schema["$import"], "Validation metaschema should import extended schema"

