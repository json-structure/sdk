# JSON Structure Python SDK

"""
JSON Structure validation library for Python.

This package provides validators for JSON Structure schemas and instances.
"""

from json_structure.instance_validator import JSONStructureInstanceValidator as InstanceValidator
from json_structure.schema_validator import JSONStructureSchemaCoreValidator as SchemaValidator

try:
    from json_structure._version import __version__
except ImportError:
    __version__ = "0.0.0.dev0"  # Fallback for editable installs without build

__all__ = ["InstanceValidator", "SchemaValidator", "__version__"]
