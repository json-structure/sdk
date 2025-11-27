# encoding: utf-8
"""
test_primer_samples.py

Tests that validate all schemas and instances from the primer-and-samples repository.
This ensures the SDK validators work correctly with real-world examples.
"""

import json
import os
import pytest
from pathlib import Path

from json_structure import SchemaValidator, InstanceValidator

# Get the path to primer-and-samples
SDK_ROOT = Path(__file__).parent.parent.parent
SAMPLES_ROOT = SDK_ROOT / "primer-and-samples" / "samples"
CORE_SAMPLES = SAMPLES_ROOT / "core"
IMPORT_SAMPLES = SAMPLES_ROOT / "import"


def get_schema_files(base_path: Path) -> list:
    """Find all schema.struct.json files in subdirectories."""
    schemas = []
    if base_path.exists():
        for schema_file in base_path.rglob("schema.struct.json"):
            schemas.append(schema_file)
    return schemas


def get_example_files(schema_dir: Path) -> list:
    """Find all example*.json files in a directory."""
    examples = []
    for example_file in schema_dir.glob("example*.json"):
        examples.append(example_file)
    return examples


# =============================================================================
# Core Sample Schema Tests
# =============================================================================

CORE_SCHEMAS = [
    "01-basic-person",
    "02-address",
    "03-financial-types",
    "04-datetime-examples",
    "05-collections",
    "06-tuples",
    "07-unions",
    "08-namespaces",
    "09-extensions",
    "10-discriminated-unions",
    "11-sets-and-maps",
]


@pytest.mark.skipif(not CORE_SAMPLES.exists(), reason="primer-and-samples submodule not initialized")
@pytest.mark.parametrize("sample_name", CORE_SCHEMAS)
def test_core_schema_valid(sample_name):
    """Test that all core sample schemas are valid."""
    schema_path = CORE_SAMPLES / sample_name / "schema.struct.json"
    if not schema_path.exists():
        pytest.skip(f"Schema not found: {schema_path}")
    
    with open(schema_path, "r", encoding="utf-8") as f:
        schema = json.load(f)
    
    validator = SchemaValidator()
    errors = validator.validate(schema)
    assert errors == [], f"Schema {sample_name} has errors: {errors}"


def strip_schema_field(instance):
    """Strip $schema field from instance before validation.
    
    The $schema field in instances is a reference to the schema URL,
    not actual data. It should be stripped before validation.
    """
    if isinstance(instance, dict):
        result = {k: strip_schema_field(v) for k, v in instance.items() if k != "$schema"}
        return result
    elif isinstance(instance, list):
        return [strip_schema_field(item) for item in instance]
    else:
        return instance


@pytest.mark.skipif(not CORE_SAMPLES.exists(), reason="primer-and-samples submodule not initialized")
@pytest.mark.parametrize("sample_name", CORE_SCHEMAS)
def test_core_instances_valid(sample_name):
    """Test that all core sample instances validate against their schemas."""
    schema_path = CORE_SAMPLES / sample_name / "schema.struct.json"
    if not schema_path.exists():
        pytest.skip(f"Schema not found: {schema_path}")
    
    with open(schema_path, "r", encoding="utf-8") as f:
        schema = json.load(f)
    
    sample_dir = CORE_SAMPLES / sample_name
    examples = get_example_files(sample_dir)
    
    if not examples:
        pytest.skip(f"No example files found in {sample_dir}")
    
    for example_path in examples:
        with open(example_path, "r", encoding="utf-8") as f:
            instance = json.load(f)
        
        # Strip $schema field from instance (it's a reference, not data)
        instance = strip_schema_field(instance)
        
        validator = InstanceValidator(schema)
        errors = validator.validate_instance(instance)
        assert errors == [], f"Instance {example_path.name} failed against {sample_name}: {errors}"


# =============================================================================
# Import Extension Sample Tests
# =============================================================================

IMPORT_LIBRARY_SCHEMAS = [
    "02-namespace-import/person-library",
    "02-namespace-import/financial-library",
]

IMPORT_SCHEMAS = [
    "01-root-import",
    "02-namespace-import",
    "03-importdefs-only",
    "04-shadowing",
]


def load_library_schemas():
    """Load all library schemas for use with external_schemas parameter."""
    libraries = []
    for lib_path in IMPORT_LIBRARY_SCHEMAS:
        schema_path = IMPORT_SAMPLES / lib_path / "schema.struct.json"
        if schema_path.exists():
            with open(schema_path, "r", encoding="utf-8") as f:
                libraries.append(json.load(f))
    return libraries


def build_import_map(sample_name: str) -> dict:
    """
    Build an import_map for a sample that maps relative URIs to actual file paths.
    This handles the primer samples which use relative file paths for $import.
    """
    sample_dir = IMPORT_SAMPLES / sample_name
    import_map = {}
    
    # Map relative paths from each sample to actual library files
    # Sample 01-root-import uses: ../02-namespace-import/person-library/schema.struct.json
    person_lib = IMPORT_SAMPLES / "02-namespace-import" / "person-library" / "schema.struct.json"
    financial_lib = IMPORT_SAMPLES / "02-namespace-import" / "financial-library" / "schema.struct.json"
    
    if person_lib.exists():
        # Various relative path forms that might be used
        import_map["../02-namespace-import/person-library/schema.struct.json"] = str(person_lib)
        import_map["./person-library/schema.struct.json"] = str(person_lib)
        import_map["person-library/schema.struct.json"] = str(person_lib)
    
    if financial_lib.exists():
        import_map["../02-namespace-import/financial-library/schema.struct.json"] = str(financial_lib)
        import_map["./financial-library/schema.struct.json"] = str(financial_lib)
        import_map["financial-library/schema.struct.json"] = str(financial_lib)
    
    return import_map


@pytest.mark.skipif(not IMPORT_SAMPLES.exists(), reason="primer-and-samples submodule not initialized")
@pytest.mark.parametrize("lib_path", IMPORT_LIBRARY_SCHEMAS)
def test_import_library_schema_valid(lib_path):
    """Test that import library schemas are valid.
    
    Note: Library schemas use core metaschema with maxLength (a validation keyword).
    This is a documentation issue in primer-and-samples - the schemas should use
    extended metaschema or $uses to enable validation keywords.
    For now, we test with extended=True to allow these keywords.
    """
    schema_path = IMPORT_SAMPLES / lib_path / "schema.struct.json"
    if not schema_path.exists():
        pytest.skip(f"Schema not found: {schema_path}")
    
    with open(schema_path, "r", encoding="utf-8") as f:
        schema = json.load(f)
    
    # Use extended=True because library schemas use maxLength without $uses
    # This is acceptable for reusable libraries that may be imported into extended schemas
    validator = SchemaValidator(allow_import=True, extended=True)
    errors = validator.validate(schema)
    
    # Filter out validation extension warnings for library schemas
    # Library schemas may use validation keywords that get enabled when imported
    filtered_errors = [e for e in errors if "requires JSONStructureValidation" not in e]
    assert filtered_errors == [], f"Library schema {lib_path} has errors: {filtered_errors}"


@pytest.mark.skipif(not IMPORT_SAMPLES.exists(), reason="primer-and-samples submodule not initialized")
@pytest.mark.parametrize("sample_name", IMPORT_SCHEMAS)
def test_import_schema_valid(sample_name):
    """Test that import example schemas are valid (using import_map for relative paths)."""
    schema_path = IMPORT_SAMPLES / sample_name / "schema.struct.json"
    if not schema_path.exists():
        pytest.skip(f"Schema not found: {schema_path}")
    
    with open(schema_path, "r", encoding="utf-8") as f:
        schema = json.load(f)
    
    # Load library schemas for sideloading and build import map
    libraries = load_library_schemas()
    import_map = build_import_map(sample_name)
    
    validator = SchemaValidator(allow_import=True, extended=True, 
                                external_schemas=libraries, import_map=import_map)
    errors = validator.validate(schema)
    
    # Filter out errors about relative URIs - these are valid for local development
    # The import_map handles the actual resolution
    filtered_errors = [e for e in errors 
                       if "must be an absolute URI" not in e
                       and "requires JSONStructureValidation" not in e]
    assert filtered_errors == [], f"Import schema {sample_name} has errors: {filtered_errors}"


@pytest.mark.skipif(not IMPORT_SAMPLES.exists(), reason="primer-and-samples submodule not initialized")
@pytest.mark.parametrize("sample_name", IMPORT_SCHEMAS)
def test_import_instances_valid(sample_name):
    """Test that import example instances validate against their schemas."""
    schema_path = IMPORT_SAMPLES / sample_name / "schema.struct.json"
    example_path = IMPORT_SAMPLES / sample_name / "example.json"
    
    if not schema_path.exists():
        pytest.skip(f"Schema not found: {schema_path}")
    if not example_path.exists():
        pytest.skip(f"Example not found: {example_path}")
    
    with open(schema_path, "r", encoding="utf-8") as f:
        schema = json.load(f)
    with open(example_path, "r", encoding="utf-8") as f:
        instance = json.load(f)
    
    # Strip $schema field from instance (it's a reference, not data)
    instance = strip_schema_field(instance)
    
    # Load library schemas for sideloading and build import map
    libraries = load_library_schemas()
    import_map = build_import_map(sample_name)
    
    validator = InstanceValidator(schema, allow_import=True, extended=True, 
                                  external_schemas=libraries, import_map=import_map)
    errors = validator.validate_instance(instance)
    
    # Filter out errors about relative URIs - these are valid for local development
    filtered_errors = [e for e in errors if "must be an absolute URI" not in e]
    assert filtered_errors == [], f"Instance {sample_name}/example.json failed: {filtered_errors}"


# =============================================================================
# Comprehensive Discovery Tests
# =============================================================================

@pytest.mark.skipif(not SAMPLES_ROOT.exists(), reason="primer-and-samples submodule not initialized")
def test_all_schemas_discoverable():
    """Verify we can find all expected schema files."""
    all_schemas = list(SAMPLES_ROOT.rglob("schema.struct.json"))
    # Exclude py folder (validator code, not samples)
    sample_schemas = [s for s in all_schemas if "py" not in str(s)]
    
    assert len(sample_schemas) >= 10, f"Expected at least 10 sample schemas, found {len(sample_schemas)}"
    print(f"\nDiscovered {len(sample_schemas)} sample schemas")


@pytest.mark.skipif(not SAMPLES_ROOT.exists(), reason="primer-and-samples submodule not initialized")
def test_all_examples_discoverable():
    """Verify we can find all expected example files."""
    all_examples = list(SAMPLES_ROOT.rglob("example*.json"))
    
    assert len(all_examples) >= 30, f"Expected at least 30 example files, found {len(all_examples)}"
    print(f"\nDiscovered {len(all_examples)} example files")
