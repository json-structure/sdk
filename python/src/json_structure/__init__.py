# JSON Structure Python SDK

"""
JSON Structure validation library for Python.

This package provides validators for JSON Structure schemas and instances.
"""

from json_structure.instance_validator import JSONStructureInstanceValidator as InstanceValidator
from json_structure.schema_validator import JSONStructureSchemaCoreValidator as SchemaValidator

__version__ = "0.1.0"
__all__ = ["InstanceValidator", "SchemaValidator", "__version__"]
