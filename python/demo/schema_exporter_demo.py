#!/usr/bin/env python3
"""
Demonstration of the JSON Structure Schema Exporter for Python.

This demo shows how to generate JSON Structure schemas from Python dataclasses,
similar to the JsonStructureSchemaExporter in the .NET SDK.
"""

import json
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Dict, List, Optional, Set
from uuid import UUID

from json_structure import (
    export_schema,
    field_constraints,
    SchemaExporterOptions,
    JsonStructureSchemaExporter,
)


def main():
    print("=" * 70)
    print("JSON Structure Schema Exporter Demo")
    print("=" * 70)
    
    # Example 1: Simple dataclass
    print("\n--- Example 1: Simple Dataclass ---\n")
    
    @dataclass
    class Person:
        """A person in the system."""
        name: str
        age: int
        email: Optional[str] = None
    
    schema = export_schema(Person)
    print("Python dataclass:")
    print("""
@dataclass
class Person:
    '''A person in the system.'''
    name: str
    age: int
    email: Optional[str] = None
""")
    print("Generated JSON Structure schema:")
    print(json.dumps(schema, indent=2))
    
    # Example 2: With field constraints
    print("\n--- Example 2: Field Constraints ---\n")
    
    @dataclass
    class User:
        """A user with validation constraints."""
        username: str = field(metadata=field_constraints(
            min_length=3, 
            max_length=50,
            pattern=r"^[a-zA-Z][a-zA-Z0-9_]*$",
            description="The user's unique username"
        ))
        age: int = field(metadata=field_constraints(
            minimum=0, 
            maximum=150,
            description="Age in years"
        ))
        tags: List[str] = field(
            default_factory=list, 
            metadata=field_constraints(
                min_items=0,
                max_items=10,
                description="User tags for categorization"
            )
        )
    
    schema = export_schema(User)
    print("Python dataclass with constraints:")
    print("""
@dataclass
class User:
    username: str = field(metadata=field_constraints(
        min_length=3, max_length=50,
        pattern=r"^[a-zA-Z][a-zA-Z0-9_]*$"
    ))
    age: int = field(metadata=field_constraints(minimum=0, maximum=150))
    tags: List[str] = field(default_factory=list, metadata=field_constraints(
        min_items=0, max_items=10
    ))
""")
    print("Generated JSON Structure schema:")
    print(json.dumps(schema, indent=2))
    
    # Example 3: Enums
    print("\n--- Example 3: Enums ---\n")
    
    class Status(Enum):
        ACTIVE = "active"
        INACTIVE = "inactive"
        PENDING = "pending"
    
    @dataclass
    class Account:
        id: UUID
        status: Status = Status.PENDING
    
    schema = export_schema(Account)
    print("Python dataclass with enum:")
    print("""
class Status(Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    PENDING = "pending"

@dataclass
class Account:
    id: UUID
    status: Status = Status.PENDING
""")
    print("Generated JSON Structure schema:")
    print(json.dumps(schema, indent=2))
    
    # Example 4: Nested dataclasses
    print("\n--- Example 4: Nested Dataclasses ---\n")
    
    @dataclass
    class Address:
        """Physical address."""
        street: str
        city: str
        country: str = "USA"
    
    @dataclass
    class Company:
        """A company entity."""
        name: str
        founded: date
        headquarters: Address
        employees: List[str] = field(default_factory=list)
        revenue: Optional[Decimal] = None
    
    schema = export_schema(Company)
    print("Nested Python dataclasses:")
    print("""
@dataclass
class Address:
    street: str
    city: str
    country: str = "USA"

@dataclass
class Company:
    name: str
    founded: date
    headquarters: Address
    employees: List[str] = field(default_factory=list)
    revenue: Optional[Decimal] = None
""")
    print("Generated JSON Structure schema:")
    print(json.dumps(schema, indent=2))
    
    # Example 5: Collections - array, set, map
    print("\n--- Example 5: Collection Types ---\n")
    
    @dataclass
    class DataStore:
        """Container for various collection types."""
        items: List[str]           # array
        unique_tags: Set[str]      # set
        metadata: Dict[str, int]   # map
    
    schema = export_schema(DataStore)
    print("Collections (array, set, map):")
    print("""
@dataclass
class DataStore:
    items: List[str]           # JSON Structure: array
    unique_tags: Set[str]      # JSON Structure: set
    metadata: Dict[str, int]   # JSON Structure: map
""")
    print("Generated JSON Structure schema:")
    print(json.dumps(schema, indent=2))
    
    # Example 6: Custom schema transformation
    print("\n--- Example 6: Custom Schema Transformation ---\n")
    
    def add_metadata(context, schema):
        """Add custom metadata to root schema."""
        if context.is_root:
            schema["$id"] = "https://example.com/schemas/config"
            schema["$comment"] = "Auto-generated from Python dataclass"
        return schema
    
    @dataclass
    class Config:
        """Application configuration."""
        debug: bool = False
        log_level: str = "INFO"
    
    options = SchemaExporterOptions(transform_schema=add_metadata)
    schema = export_schema(Config, options)
    print("With custom transformation callback:")
    print("""
def add_metadata(context, schema):
    if context.is_root:
        schema["$id"] = "https://example.com/schemas/config"
        schema["$comment"] = "Auto-generated from Python dataclass"
    return schema

options = SchemaExporterOptions(transform_schema=add_metadata)
schema = export_schema(Config, options)
""")
    print("Generated JSON Structure schema:")
    print(json.dumps(schema, indent=2))
    
    print("\n" + "=" * 70)
    print("Demo Complete!")
    print("=" * 70)


if __name__ == "__main__":
    main()
