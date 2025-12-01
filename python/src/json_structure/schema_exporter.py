"""
JSON Structure Schema Exporter for Python.

Generates JSON Structure schemas from Python dataclasses, similar to
JsonStructureSchemaExporter in .NET.
"""

import dataclasses
import enum
import inspect
import re
import sys
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import (
    Any, Callable, Dict, FrozenSet, Generic, List, Mapping, Optional, 
    Set, Tuple, Type, TypeVar, Union, get_args, get_origin, get_type_hints
)
from uuid import UUID

# Python 3.9+ compatibility
if sys.version_info >= (3, 10):
    from types import UnionType
else:
    UnionType = None


class SchemaExporterOptions:
    """Options for controlling JSON Structure schema generation."""
    
    def __init__(
        self,
        schema_uri: str = "https://json-structure.org/meta/core/v0/#",
        include_schema_keyword: bool = True,
        include_titles: bool = True,
        include_descriptions: bool = True,
        include_defaults: bool = True,
        transform_schema: Optional[Callable[['SchemaExporterContext', dict], dict]] = None
    ):
        """
        Initialize schema exporter options.
        
        Args:
            schema_uri: The $schema URI to use. Defaults to JSON Structure 1.0.
            include_schema_keyword: Whether to include $schema. Default True.
            include_titles: Whether to include title from class name. Default True.
            include_descriptions: Whether to include description from docstrings. Default True.
            include_defaults: Whether to include default values. Default True.
            transform_schema: Optional callback to transform generated schemas.
        """
        self.schema_uri = schema_uri
        self.include_schema_keyword = include_schema_keyword
        self.include_titles = include_titles
        self.include_descriptions = include_descriptions
        self.include_defaults = include_defaults
        self.transform_schema = transform_schema


@dataclasses.dataclass
class SchemaExporterContext:
    """Context provided to schema transformation callbacks."""
    
    type_: Type
    """The type being processed."""
    
    field: Optional[dataclasses.Field] = None
    """The dataclass field if processing a field."""
    
    path: str = ""
    """The path in the schema."""
    
    @property
    def is_root(self) -> bool:
        """Returns True if this is the root schema."""
        return not self.path


# Field metadata keys for constraints
class FieldConstraints:
    """Metadata keys for field constraints."""
    
    MIN_LENGTH = "min_length"
    MAX_LENGTH = "max_length"
    MINIMUM = "minimum"
    MAXIMUM = "maximum"
    EXCLUSIVE_MINIMUM = "exclusive_minimum"
    EXCLUSIVE_MAXIMUM = "exclusive_maximum"
    PATTERN = "pattern"
    MULTIPLE_OF = "multiple_of"
    MIN_ITEMS = "min_items"
    MAX_ITEMS = "max_items"
    UNIQUE_ITEMS = "unique_items"
    DEPRECATED = "deprecated"
    TITLE = "title"
    DESCRIPTION = "description"
    EXAMPLES = "examples"


def field_constraints(
    min_length: Optional[int] = None,
    max_length: Optional[int] = None,
    minimum: Optional[float] = None,
    maximum: Optional[float] = None,
    exclusive_minimum: Optional[float] = None,
    exclusive_maximum: Optional[float] = None,
    pattern: Optional[str] = None,
    multiple_of: Optional[float] = None,
    min_items: Optional[int] = None,
    max_items: Optional[int] = None,
    unique_items: Optional[bool] = None,
    deprecated: Optional[bool] = None,
    title: Optional[str] = None,
    description: Optional[str] = None,
    examples: Optional[List[Any]] = None,
) -> Dict[str, Any]:
    """
    Create a metadata dictionary for dataclass field constraints.
    
    Usage:
        @dataclass
        class Person:
            name: str = field(metadata=field_constraints(min_length=1, max_length=100))
            age: int = field(metadata=field_constraints(minimum=0, maximum=150))
    
    Args:
        min_length: Minimum string length.
        max_length: Maximum string length.
        minimum: Minimum numeric value (inclusive).
        maximum: Maximum numeric value (inclusive).
        exclusive_minimum: Minimum numeric value (exclusive).
        exclusive_maximum: Maximum numeric value (exclusive).
        pattern: Regex pattern for strings.
        multiple_of: Number must be multiple of this value.
        min_items: Minimum array length.
        max_items: Maximum array length.
        unique_items: Whether array items must be unique.
        deprecated: Whether the field is deprecated.
        title: Title for the field schema.
        description: Description for the field schema.
        examples: Example values for the field.
    
    Returns:
        Metadata dictionary to pass to dataclasses.field(metadata=...).
    """
    result = {}
    
    if min_length is not None:
        result[FieldConstraints.MIN_LENGTH] = min_length
    if max_length is not None:
        result[FieldConstraints.MAX_LENGTH] = max_length
    if minimum is not None:
        result[FieldConstraints.MINIMUM] = minimum
    if maximum is not None:
        result[FieldConstraints.MAXIMUM] = maximum
    if exclusive_minimum is not None:
        result[FieldConstraints.EXCLUSIVE_MINIMUM] = exclusive_minimum
    if exclusive_maximum is not None:
        result[FieldConstraints.EXCLUSIVE_MAXIMUM] = exclusive_maximum
    if pattern is not None:
        result[FieldConstraints.PATTERN] = pattern
    if multiple_of is not None:
        result[FieldConstraints.MULTIPLE_OF] = multiple_of
    if min_items is not None:
        result[FieldConstraints.MIN_ITEMS] = min_items
    if max_items is not None:
        result[FieldConstraints.MAX_ITEMS] = max_items
    if unique_items is not None:
        result[FieldConstraints.UNIQUE_ITEMS] = unique_items
    if deprecated is not None:
        result[FieldConstraints.DEPRECATED] = deprecated
    if title is not None:
        result[FieldConstraints.TITLE] = title
    if description is not None:
        result[FieldConstraints.DESCRIPTION] = description
    if examples is not None:
        result[FieldConstraints.EXAMPLES] = examples
    
    return result


class JsonStructureSchemaExporter:
    """
    Generates JSON Structure schemas from Python dataclasses.
    
    Similar to JsonStructureSchemaExporter in the .NET SDK.
    """
    
    # Type mapping from Python types to JSON Structure types
    TYPE_MAP: Dict[Type, str] = {
        str: "string",
        bool: "boolean",
        int: "int64",  # Python ints are arbitrary precision, default to int64
        float: "double",  # Python floats are 64-bit
        bytes: "binary",
        bytearray: "binary",
        Decimal: "decimal",
        date: "date",
        datetime: "datetime",
        time: "time",
        timedelta: "duration",
        UUID: "uuid",
    }
    
    def __init__(self, options: Optional[SchemaExporterOptions] = None):
        """
        Initialize the schema exporter.
        
        Args:
            options: Optional exporter options.
        """
        self.options = options or SchemaExporterOptions()
        self._visited_types: Set[Type] = set()
        self._definitions: Dict[str, dict] = {}
    
    def export(self, type_: Type) -> dict:
        """
        Export a JSON Structure schema from a Python type.
        
        Args:
            type_: The type to generate a schema for. Should be a dataclass.
        
        Returns:
            A dictionary representing the JSON Structure schema.
        """
        self._visited_types = set()
        self._definitions = {}
        
        schema = self._generate_schema(type_, "", None)
        
        # Add definitions if there are any
        if self._definitions:
            schema["definitions"] = self._definitions
        
        return schema
    
    def _generate_schema(
        self,
        type_: Type,
        path: str,
        field: Optional[dataclasses.Field]
    ) -> dict:
        """Generate schema for a type."""
        schema: Dict[str, Any] = {}
        is_root = not path
        
        # Add $schema for root
        if is_root and self.options.include_schema_keyword:
            schema["$schema"] = self.options.schema_uri
        
        # Handle Optional types
        origin = get_origin(type_)
        args = get_args(type_)
        
        # Check for Optional[T] which is Union[T, None]
        is_optional = False
        if origin is Union or (UnionType and isinstance(type_, UnionType)):
            # Check if it's Optional (Union with None)
            non_none_args = [a for a in args if a is not type(None)]
            if len(non_none_args) == 1 and type(None) in args:
                is_optional = True
                type_ = non_none_args[0]
                origin = get_origin(type_)
                args = get_args(type_)
        
        # Check for recursion - per JSON Structure spec, $ref must be inside type
        if self._is_complex_type(type_) and type_ in self._visited_types:
            type_name = self._get_type_name(type_)
            schema["type"] = {"$ref": f"#/definitions/{type_name}"}
            return schema
        
        # Map type to JSON Structure type
        structure_type = self._get_json_structure_type(type_)
        if structure_type:
            schema["type"] = structure_type
        
        # Handle enums
        if isinstance(type_, type) and issubclass(type_, enum.Enum):
            schema["type"] = "string"
            schema["enum"] = [member.value if isinstance(member.value, str) else member.name 
                             for member in type_]
            return self._apply_transform(schema, type_, field, path)
        
        # Handle collections
        if origin is list or origin is List:
            schema["type"] = "array"
            if args:
                schema["items"] = self._generate_schema(args[0], path + "/items", None)
            return self._apply_transform(schema, type_, field, path)
        
        if origin is set or origin is Set or origin is frozenset or origin is FrozenSet:
            schema["type"] = "set"
            if args:
                schema["items"] = self._generate_schema(args[0], path + "/items", None)
            return self._apply_transform(schema, type_, field, path)
        
        if origin is dict or origin is Dict or origin is Mapping:
            schema["type"] = "map"
            if args and len(args) >= 2:
                schema["values"] = self._generate_schema(args[1], path + "/values", None)
            return self._apply_transform(schema, type_, field, path)
        
        if origin is tuple or origin is Tuple:
            schema["type"] = "tuple"
            if args:
                # Handle Tuple[int, str, ...] - variable length
                if len(args) == 2 and args[1] is ...:
                    schema["items"] = self._generate_schema(args[0], path + "/items", None)
                else:
                    # Fixed length tuple
                    prefix_items = []
                    for i, arg in enumerate(args):
                        prefix_items.append(
                            self._generate_schema(arg, f"{path}/prefixItems/{i}", None)
                        )
                    schema["prefixItems"] = prefix_items
            return self._apply_transform(schema, type_, field, path)
        
        # Handle Union types (choice)
        if origin is Union or (UnionType and isinstance(type_, UnionType)):
            non_none_args = [a for a in args if a is not type(None)]
            if len(non_none_args) > 1:
                schema["type"] = "choice"
                options = {}
                for i, arg in enumerate(non_none_args):
                    option_name = self._get_type_name(arg)
                    options[option_name] = self._generate_schema(
                        arg, f"{path}/options/{option_name}", None
                    )
                schema["options"] = options
                return self._apply_transform(schema, type_, field, path)
        
        # Handle dataclasses (objects)
        if dataclasses.is_dataclass(type_) and isinstance(type_, type):
            self._visited_types.add(type_)
            
            schema["type"] = "object"
            
            # Add title
            if self.options.include_titles:
                schema["title"] = type_.__name__
            
            # Add description from docstring
            if self.options.include_descriptions and type_.__doc__:
                doc = inspect.cleandoc(type_.__doc__)
                if doc:
                    schema["description"] = doc
            
            properties: Dict[str, Any] = {}
            required: List[str] = []
            
            # Get type hints for the class
            try:
                hints = get_type_hints(type_)
            except Exception:
                hints = {}
            
            for f in dataclasses.fields(type_):
                # Get the actual type from hints if available
                field_type = hints.get(f.name, f.type)
                
                # Check if field is optional
                field_origin = get_origin(field_type)
                field_args = get_args(field_type)
                field_is_optional = (
                    field_origin is Union or 
                    (UnionType and isinstance(field_type, UnionType))
                ) and type(None) in field_args
                
                # Generate field schema
                prop_schema = self._generate_schema(
                    field_type,
                    f"{path}/properties/{f.name}",
                    f
                )
                
                # Apply field metadata constraints
                self._apply_field_constraints(prop_schema, f)
                
                # Add description from field metadata or default
                if self.options.include_descriptions:
                    if FieldConstraints.DESCRIPTION in f.metadata:
                        prop_schema["description"] = f.metadata[FieldConstraints.DESCRIPTION]
                
                # Add title from field metadata
                if self.options.include_titles:
                    if FieldConstraints.TITLE in f.metadata:
                        prop_schema["title"] = f.metadata[FieldConstraints.TITLE]
                
                # Add default value
                if self.options.include_defaults:
                    if f.default is not dataclasses.MISSING:
                        prop_schema["default"] = self._serialize_default(f.default)
                    elif f.default_factory is not dataclasses.MISSING:
                        # We can include a hint that there's a default factory
                        pass  # Skip factory defaults as they're dynamic
                
                properties[f.name] = prop_schema
                
                # Determine if required
                has_default = (
                    f.default is not dataclasses.MISSING or
                    f.default_factory is not dataclasses.MISSING
                )
                if not field_is_optional and not has_default:
                    required.append(f.name)
            
            schema["properties"] = properties
            if required:
                schema["required"] = required
            
            self._visited_types.discard(type_)
        
        return self._apply_transform(schema, type_, field, path)
    
    def _apply_field_constraints(self, schema: dict, field: dataclasses.Field) -> None:
        """Apply field metadata constraints to the schema."""
        metadata = field.metadata
        
        # String constraints
        if FieldConstraints.MIN_LENGTH in metadata:
            schema["minLength"] = metadata[FieldConstraints.MIN_LENGTH]
        if FieldConstraints.MAX_LENGTH in metadata:
            schema["maxLength"] = metadata[FieldConstraints.MAX_LENGTH]
        if FieldConstraints.PATTERN in metadata:
            schema["pattern"] = metadata[FieldConstraints.PATTERN]
        
        # Numeric constraints
        if FieldConstraints.MINIMUM in metadata:
            schema["minimum"] = metadata[FieldConstraints.MINIMUM]
        if FieldConstraints.MAXIMUM in metadata:
            schema["maximum"] = metadata[FieldConstraints.MAXIMUM]
        if FieldConstraints.EXCLUSIVE_MINIMUM in metadata:
            schema["exclusiveMinimum"] = metadata[FieldConstraints.EXCLUSIVE_MINIMUM]
        if FieldConstraints.EXCLUSIVE_MAXIMUM in metadata:
            schema["exclusiveMaximum"] = metadata[FieldConstraints.EXCLUSIVE_MAXIMUM]
        if FieldConstraints.MULTIPLE_OF in metadata:
            schema["multipleOf"] = metadata[FieldConstraints.MULTIPLE_OF]
        
        # Array constraints
        if FieldConstraints.MIN_ITEMS in metadata:
            schema["minItems"] = metadata[FieldConstraints.MIN_ITEMS]
        if FieldConstraints.MAX_ITEMS in metadata:
            schema["maxItems"] = metadata[FieldConstraints.MAX_ITEMS]
        if FieldConstraints.UNIQUE_ITEMS in metadata:
            schema["uniqueItems"] = metadata[FieldConstraints.UNIQUE_ITEMS]
        
        # Metadata
        if FieldConstraints.DEPRECATED in metadata:
            schema["deprecated"] = metadata[FieldConstraints.DEPRECATED]
        if FieldConstraints.EXAMPLES in metadata:
            schema["examples"] = metadata[FieldConstraints.EXAMPLES]
    
    def _get_json_structure_type(self, type_: Type) -> Optional[str]:
        """Map a Python type to a JSON Structure type string."""
        # Check direct mapping
        if type_ in self.TYPE_MAP:
            return self.TYPE_MAP[type_]
        
        # Handle origin types for generics
        origin = get_origin(type_)
        if origin is not None:
            if origin in (list, List):
                return "array"
            if origin in (set, Set, frozenset, FrozenSet):
                return "set"
            if origin in (dict, Dict, Mapping):
                return "map"
            if origin in (tuple, Tuple):
                return "tuple"
        
        # Check if it's a dataclass
        if dataclasses.is_dataclass(type_) and isinstance(type_, type):
            return "object"
        
        # Check if it's an enum
        if isinstance(type_, type) and issubclass(type_, enum.Enum):
            return "string"
        
        return None
    
    def _get_type_name(self, type_: Type) -> str:
        """Get a friendly name for a type."""
        if hasattr(type_, "__name__"):
            return type_.__name__
        return str(type_)
    
    def _is_complex_type(self, type_: Type) -> bool:
        """Check if a type is complex (can cause recursion)."""
        if dataclasses.is_dataclass(type_) and isinstance(type_, type):
            return True
        return False
    
    def _serialize_default(self, value: Any) -> Any:
        """Serialize a default value to JSON-compatible format."""
        if value is None:
            return None
        if isinstance(value, (str, int, float, bool)):
            return value
        if isinstance(value, (list, tuple)):
            return [self._serialize_default(v) for v in value]
        if isinstance(value, dict):
            return {k: self._serialize_default(v) for k, v in value.items()}
        if isinstance(value, enum.Enum):
            return value.value if isinstance(value.value, str) else value.name
        if isinstance(value, (date, datetime)):
            return value.isoformat()
        if isinstance(value, UUID):
            return str(value)
        if isinstance(value, Decimal):
            return str(value)
        # For other types, convert to string
        return str(value)
    
    def _apply_transform(
        self,
        schema: dict,
        type_: Type,
        field: Optional[dataclasses.Field],
        path: str
    ) -> dict:
        """Apply transformation callback if configured."""
        if self.options.transform_schema:
            context = SchemaExporterContext(
                type_=type_,
                field=field,
                path=path
            )
            return self.options.transform_schema(context, schema)
        return schema


def export_schema(
    type_: Type,
    options: Optional[SchemaExporterOptions] = None
) -> dict:
    """
    Export a JSON Structure schema from a Python type.
    
    This is a convenience function that creates an exporter and exports the schema.
    
    Args:
        type_: The type to generate a schema for. Should be a dataclass.
        options: Optional exporter options.
    
    Returns:
        A dictionary representing the JSON Structure schema.
    
    Example:
        >>> from dataclasses import dataclass, field
        >>> from json_structure import export_schema, field_constraints
        >>> 
        >>> @dataclass
        ... class Person:
        ...     name: str = field(metadata=field_constraints(min_length=1, max_length=100))
        ...     age: int = field(metadata=field_constraints(minimum=0, maximum=150))
        ...     tags: List[str] = field(default_factory=list)
        >>> 
        >>> schema = export_schema(Person)
        >>> print(schema)
    """
    exporter = JsonStructureSchemaExporter(options)
    return exporter.export(type_)
