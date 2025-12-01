"""Tests for the JSON Structure Schema Exporter."""

import json
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from enum import Enum
from typing import Dict, FrozenSet, List, Optional, Set, Tuple, Union
from uuid import UUID

import pytest

from json_structure.schema_exporter import (
    JsonStructureSchemaExporter,
    SchemaExporterOptions,
    export_schema,
    field_constraints,
)


class TestBasicTypes:
    """Test schema generation for basic Python types."""
    
    def test_string_field(self):
        @dataclass
        class Model:
            name: str
        
        schema = export_schema(Model)
        
        assert schema["type"] == "object"
        assert schema["properties"]["name"]["type"] == "string"
        assert "name" in schema["required"]
    
    def test_int_field(self):
        @dataclass
        class Model:
            count: int
        
        schema = export_schema(Model)
        
        assert schema["properties"]["count"]["type"] == "int64"
    
    def test_float_field(self):
        @dataclass
        class Model:
            value: float
        
        schema = export_schema(Model)
        
        assert schema["properties"]["value"]["type"] == "double"
    
    def test_bool_field(self):
        @dataclass
        class Model:
            active: bool
        
        schema = export_schema(Model)
        
        assert schema["properties"]["active"]["type"] == "boolean"
    
    def test_decimal_field(self):
        @dataclass
        class Model:
            amount: Decimal
        
        schema = export_schema(Model)
        
        assert schema["properties"]["amount"]["type"] == "decimal"
    
    def test_bytes_field(self):
        @dataclass
        class Model:
            data: bytes
        
        schema = export_schema(Model)
        
        assert schema["properties"]["data"]["type"] == "binary"
    
    def test_uuid_field(self):
        @dataclass
        class Model:
            id: UUID
        
        schema = export_schema(Model)
        
        assert schema["properties"]["id"]["type"] == "uuid"


class TestDateTimeTypes:
    """Test schema generation for date/time types."""
    
    def test_date_field(self):
        @dataclass
        class Model:
            birth_date: date
        
        schema = export_schema(Model)
        
        assert schema["properties"]["birth_date"]["type"] == "date"
    
    def test_datetime_field(self):
        @dataclass
        class Model:
            created_at: datetime
        
        schema = export_schema(Model)
        
        assert schema["properties"]["created_at"]["type"] == "datetime"
    
    def test_time_field(self):
        @dataclass
        class Model:
            start_time: time
        
        schema = export_schema(Model)
        
        assert schema["properties"]["start_time"]["type"] == "time"
    
    def test_duration_field(self):
        @dataclass
        class Model:
            duration: timedelta
        
        schema = export_schema(Model)
        
        assert schema["properties"]["duration"]["type"] == "duration"


class TestCollectionTypes:
    """Test schema generation for collection types."""
    
    def test_list_field(self):
        @dataclass
        class Model:
            tags: List[str]
        
        schema = export_schema(Model)
        
        assert schema["properties"]["tags"]["type"] == "array"
        assert schema["properties"]["tags"]["items"]["type"] == "string"
    
    def test_set_field(self):
        @dataclass
        class Model:
            unique_tags: Set[str]
        
        schema = export_schema(Model)
        
        assert schema["properties"]["unique_tags"]["type"] == "set"
        assert schema["properties"]["unique_tags"]["items"]["type"] == "string"
    
    def test_frozenset_field(self):
        @dataclass
        class Model:
            immutable_tags: FrozenSet[str]
        
        schema = export_schema(Model)
        
        assert schema["properties"]["immutable_tags"]["type"] == "set"
    
    def test_dict_field(self):
        @dataclass
        class Model:
            scores: Dict[str, int]
        
        schema = export_schema(Model)
        
        assert schema["properties"]["scores"]["type"] == "map"
        assert schema["properties"]["scores"]["values"]["type"] == "int64"
    
    def test_tuple_field(self):
        @dataclass
        class Model:
            point: Tuple[int, int]
        
        schema = export_schema(Model)
        
        assert schema["properties"]["point"]["type"] == "tuple"
        assert len(schema["properties"]["point"]["prefixItems"]) == 2
        assert schema["properties"]["point"]["prefixItems"][0]["type"] == "int64"


class TestOptionalAndUnion:
    """Test schema generation for Optional and Union types."""
    
    def test_optional_field(self):
        @dataclass
        class Model:
            nickname: Optional[str] = None
        
        schema = export_schema(Model)
        
        assert schema["properties"]["nickname"]["type"] == "string"
        # Optional fields with default should not be required
        assert "nickname" not in schema.get("required", [])
    
    def test_optional_without_default(self):
        @dataclass
        class Model:
            nickname: Optional[str]
        
        schema = export_schema(Model)
        
        assert schema["properties"]["nickname"]["type"] == "string"
        # Optional fields are never required, even without a default
        # (the type annotation indicates None is a valid value)
        assert "nickname" not in schema.get("required", [])
    
    def test_union_field(self):
        @dataclass
        class Model:
            value: Union[str, int]
        
        schema = export_schema(Model)
        
        assert schema["properties"]["value"]["type"] == "choice"
        assert "choices" in schema["properties"]["value"]


class TestEnums:
    """Test schema generation for enum types."""
    
    def test_string_enum(self):
        class Color(Enum):
            RED = "red"
            GREEN = "green"
            BLUE = "blue"
        
        @dataclass
        class Model:
            color: Color
        
        schema = export_schema(Model)
        
        assert schema["properties"]["color"]["type"] == "string"
        assert schema["properties"]["color"]["enum"] == ["red", "green", "blue"]
    
    def test_int_enum(self):
        class Priority(Enum):
            LOW = 1
            MEDIUM = 2
            HIGH = 3
        
        @dataclass
        class Model:
            priority: Priority
        
        schema = export_schema(Model)
        
        assert schema["properties"]["priority"]["type"] == "string"
        # Uses name for non-string enums
        assert set(schema["properties"]["priority"]["enum"]) == {"LOW", "MEDIUM", "HIGH"}


class TestNestedDataclasses:
    """Test schema generation for nested dataclasses."""
    
    def test_nested_dataclass(self):
        @dataclass
        class Address:
            street: str
            city: str
        
        @dataclass
        class Person:
            name: str
            address: Address
        
        schema = export_schema(Person)
        
        assert schema["properties"]["address"]["type"] == "object"
        assert schema["properties"]["address"]["properties"]["street"]["type"] == "string"
        assert schema["properties"]["address"]["properties"]["city"]["type"] == "string"
    
    def test_list_of_dataclass(self):
        @dataclass
        class Tag:
            name: str
        
        @dataclass
        class Article:
            title: str
            tags: List[Tag]
        
        schema = export_schema(Article)
        
        assert schema["properties"]["tags"]["type"] == "array"
        assert schema["properties"]["tags"]["items"]["type"] == "object"


class TestFieldConstraints:
    """Test schema generation with field constraints."""
    
    def test_string_length_constraints(self):
        @dataclass
        class Model:
            name: str = field(metadata=field_constraints(min_length=1, max_length=100))
        
        schema = export_schema(Model)
        
        assert schema["properties"]["name"]["minLength"] == 1
        assert schema["properties"]["name"]["maxLength"] == 100
    
    def test_numeric_range_constraints(self):
        @dataclass
        class Model:
            age: int = field(metadata=field_constraints(minimum=0, maximum=150))
        
        schema = export_schema(Model)
        
        assert schema["properties"]["age"]["minimum"] == 0
        assert schema["properties"]["age"]["maximum"] == 150
    
    def test_pattern_constraint(self):
        @dataclass
        class Model:
            email: str = field(metadata=field_constraints(pattern=r"^[\w.-]+@[\w.-]+\.\w+$"))
        
        schema = export_schema(Model)
        
        assert schema["properties"]["email"]["pattern"] == r"^[\w.-]+@[\w.-]+\.\w+$"
    
    def test_array_constraints(self):
        @dataclass
        class Model:
            tags: List[str] = field(
                default_factory=list,
                metadata=field_constraints(min_items=1, max_items=10, unique_items=True)
            )
        
        schema = export_schema(Model)
        
        assert schema["properties"]["tags"]["minItems"] == 1
        assert schema["properties"]["tags"]["maxItems"] == 10
        assert schema["properties"]["tags"]["uniqueItems"] is True
    
    def test_deprecated_field(self):
        @dataclass
        class Model:
            old_field: str = field(metadata=field_constraints(deprecated=True))
        
        schema = export_schema(Model)
        
        assert schema["properties"]["old_field"]["deprecated"] is True
    
    def test_description_constraint(self):
        @dataclass
        class Model:
            name: str = field(metadata=field_constraints(description="The user's full name"))
        
        schema = export_schema(Model)
        
        assert schema["properties"]["name"]["description"] == "The user's full name"


class TestMetadata:
    """Test schema metadata generation."""
    
    def test_includes_schema_keyword(self):
        @dataclass
        class Model:
            name: str
        
        schema = export_schema(Model)
        
        assert "$schema" in schema
        assert schema["$schema"] == "https://json-structure.org/meta/core/v0/#"
    
    def test_excludes_schema_keyword(self):
        @dataclass
        class Model:
            name: str
        
        options = SchemaExporterOptions(include_schema_keyword=False)
        schema = export_schema(Model, options)
        
        assert "$schema" not in schema
    
    def test_includes_title(self):
        @dataclass
        class PersonModel:
            name: str
        
        schema = export_schema(PersonModel)
        
        assert schema["title"] == "PersonModel"
    
    def test_includes_description_from_docstring(self):
        @dataclass
        class Model:
            """This is a model for testing."""
            name: str
        
        schema = export_schema(Model)
        
        assert schema["description"] == "This is a model for testing."
    
    def test_default_values(self):
        @dataclass
        class Model:
            name: str = "default"
            count: int = 0
        
        schema = export_schema(Model)
        
        assert schema["properties"]["name"]["default"] == "default"
        assert schema["properties"]["count"]["default"] == 0


class TestTransformCallback:
    """Test schema transformation callback."""
    
    def test_transform_adds_custom_property(self):
        def add_custom(context, schema):
            if context.is_root:
                schema["$id"] = "https://example.com/my-schema"
            return schema
        
        @dataclass
        class Model:
            name: str
        
        options = SchemaExporterOptions(transform_schema=add_custom)
        schema = export_schema(Model, options)
        
        assert schema["$id"] == "https://example.com/my-schema"


class TestComplexExample:
    """Test a complex real-world example."""
    
    def test_person_schema(self):
        class Status(Enum):
            ACTIVE = "active"
            INACTIVE = "inactive"
        
        @dataclass
        class Address:
            """A physical address."""
            street: str = field(metadata=field_constraints(min_length=1))
            city: str = field(metadata=field_constraints(min_length=1))
            zip_code: str = field(metadata=field_constraints(pattern=r"^\d{5}(-\d{4})?$"))
        
        @dataclass
        class Person:
            """A person in the system."""
            name: str = field(metadata=field_constraints(min_length=1, max_length=100))
            age: int = field(metadata=field_constraints(minimum=0, maximum=150))
            email: str = field(metadata=field_constraints(pattern=r"^[\w.-]+@[\w.-]+\.\w+$"))
            status: Status = Status.ACTIVE
            address: Optional[Address] = None
            tags: List[str] = field(default_factory=list)
            scores: Dict[str, int] = field(default_factory=dict)
        
        schema = export_schema(Person)
        
        # Verify structure
        assert schema["type"] == "object"
        assert schema["title"] == "Person"
        assert schema["description"] == "A person in the system."
        
        # Verify properties
        props = schema["properties"]
        assert props["name"]["type"] == "string"
        assert props["name"]["minLength"] == 1
        assert props["name"]["maxLength"] == 100
        
        assert props["age"]["type"] == "int64"
        assert props["age"]["minimum"] == 0
        
        assert props["email"]["pattern"] == r"^[\w.-]+@[\w.-]+\.\w+$"
        
        assert props["status"]["type"] == "string"
        assert props["status"]["enum"] == ["active", "inactive"]
        
        assert props["address"]["type"] == "object"
        
        assert props["tags"]["type"] == "array"
        assert props["tags"]["items"]["type"] == "string"
        
        assert props["scores"]["type"] == "map"
        assert props["scores"]["values"]["type"] == "int64"
        
        # Verify required fields
        required = schema["required"]
        assert "name" in required
        assert "age" in required
        assert "email" in required
        # Fields with defaults should not be required
        assert "status" not in required
        assert "address" not in required
        assert "tags" not in required
        
        # Verify it's valid JSON
        json_str = json.dumps(schema, indent=2)
        assert json_str is not None


class TestSchemaOutput:
    """Test that schema output matches expected JSON Structure format."""
    
    def test_output_format(self):
        @dataclass
        class SimpleModel:
            """A simple model."""
            name: str = field(metadata=field_constraints(min_length=1))
            count: int = field(default=0, metadata=field_constraints(minimum=0))
        
        schema = export_schema(SimpleModel)
        
        expected_keys = {"$schema", "type", "title", "description", "properties", "required"}
        assert expected_keys.issubset(set(schema.keys()))
        
        # Verify JSON serializable
        json_output = json.dumps(schema, indent=2)
        parsed = json.loads(json_output)
        assert parsed == schema
