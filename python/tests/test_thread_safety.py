"""
Thread safety tests for JSON Structure validators.

These tests verify that validators can be safely used from multiple threads
concurrently without data races or corruption.
"""

import concurrent.futures
import threading
import time
from json_structure import InstanceValidator, SchemaValidator


class TestInstanceValidatorThreadSafety:
    """Tests for thread-safe instance validation."""

    def test_concurrent_validations_isolated(self):
        """Verify that concurrent validations don't interfere with each other."""
        schema = {
            "$schema": "https://json-structure.org/meta/extended/v0/schema",
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "age": {"type": "int32", "minimum": 0, "maximum": 150}
            },
            "required": ["name", "age"]
        }
        
        validator = InstanceValidator(schema)
        results = {}
        errors_by_thread = {}
        
        def validate_instance(thread_id: int, instance: dict, should_pass: bool):
            """Validate an instance and record the result."""
            # Small delay to increase chance of race conditions
            time.sleep(0.001 * (thread_id % 3))
            
            errors = validator.validate(instance)
            results[thread_id] = (len(errors) == 0) == should_pass
            errors_by_thread[thread_id] = errors
        
        # Mix of valid and invalid instances
        test_cases = [
            (0, {"name": "Alice", "age": 30}, True),
            (1, {"name": "Bob"}, False),  # Missing age
            (2, {"name": "Charlie", "age": 25}, True),
            (3, {"name": "Diana", "age": -5}, False),  # Negative age
            (4, {"name": "Eve", "age": 200}, False),  # Age too high
            (5, {"name": "Frank", "age": 45}, True),
            (6, {"age": 50}, False),  # Missing name
            (7, {"name": "Grace", "age": 35}, True),
            (8, {"name": "Henry", "age": 0}, True),  # Edge case: age = 0
            (9, {"name": "Ivy", "age": 150}, True),  # Edge case: age = 150
        ]
        
        threads = []
        for thread_id, instance, should_pass in test_cases:
            t = threading.Thread(
                target=validate_instance, 
                args=(thread_id, instance, should_pass)
            )
            threads.append(t)
        
        # Start all threads
        for t in threads:
            t.start()
        
        # Wait for all threads to complete
        for t in threads:
            t.join()
        
        # Verify all results are correct
        for thread_id, instance, should_pass in test_cases:
            assert results[thread_id], (
                f"Thread {thread_id} got unexpected result for {instance}. "
                f"Expected {'pass' if should_pass else 'fail'}, "
                f"got errors: {errors_by_thread[thread_id]}"
            )

    def test_concurrent_validations_with_thread_pool(self):
        """Verify thread safety using ThreadPoolExecutor."""
        schema = {
            "$schema": "https://json-structure.org/meta/extended/v0/schema",
            "type": "array",
            "items": {"type": "string", "minLength": 1}
        }
        
        validator = InstanceValidator(schema)
        
        def validate_and_check(args):
            instance, should_pass = args
            errors = validator.validate(instance)
            is_valid = len(errors) == 0
            return is_valid == should_pass
        
        # Generate many test cases
        test_cases = []
        for i in range(100):
            if i % 2 == 0:
                test_cases.append((["hello", "world", f"item{i}"], True))
            else:
                test_cases.append(([f"item{i}", ""], False))  # Empty string invalid
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            results = list(executor.map(validate_and_check, test_cases))
        
        assert all(results), "Some validations returned incorrect results"

    def test_validator_reusable_after_concurrent_use(self):
        """Verify validator works correctly after concurrent use."""
        schema = {
            "$schema": "https://json-structure.org/meta/extended/v0/schema",
            "type": "object",
            "properties": {
                "value": {"type": "int32"}
            }
        }
        
        validator = InstanceValidator(schema)
        
        # Run concurrent validations
        def validate_many(n: int):
            for i in range(n):
                validator.validate({"value": i})
        
        threads = [threading.Thread(target=validate_many, args=(50,)) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        
        # Validator should still work correctly after concurrent use
        errors = validator.validate({"value": 42})
        assert len(errors) == 0, f"Expected no errors, got: {errors}"
        
        errors = validator.validate({"value": "not an int"})
        assert len(errors) > 0, "Expected errors for invalid instance"


class TestSchemaValidatorThreadSafety:
    """Tests for thread-safe schema validation."""

    def test_concurrent_schema_validations(self):
        """Verify that concurrent schema validations don't interfere."""
        validator = SchemaValidator()
        results = {}
        
        valid_schemas = [
            {
                "$schema": "https://json-structure.org/meta/extended/v0/schema",
                "$id": "https://example.com/test1",
                "name": "Test1",
                "type": "string"
            },
            {
                "$schema": "https://json-structure.org/meta/extended/v0/schema",
                "$id": "https://example.com/test2",
                "name": "Test2",
                "type": "object",
                "properties": {"x": {"type": "int32"}}
            },
            {
                "$schema": "https://json-structure.org/meta/extended/v0/schema",
                "$id": "https://example.com/test3",
                "name": "Test3",
                "type": "array",
                "items": {"type": "boolean"}
            },
        ]
        
        invalid_schemas = [
            {"type": "invalid_type"},  # Unknown type, missing $id/name
            {"type": "object", "properties": "not_an_object"},  # Invalid properties
            {"type": "array"},  # Missing items, $id, name
        ]
        
        def validate_schema(thread_id: int, schema: dict, should_pass: bool):
            time.sleep(0.001 * (thread_id % 3))
            errors = validator.validate(schema)
            results[thread_id] = (len(errors) == 0) == should_pass
        
        threads = []
        for i, schema in enumerate(valid_schemas):
            t = threading.Thread(target=validate_schema, args=(i, schema, True))
            threads.append(t)
        
        for i, schema in enumerate(invalid_schemas):
            t = threading.Thread(
                target=validate_schema, 
                args=(i + len(valid_schemas), schema, False)
            )
            threads.append(t)
        
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        
        for thread_id, result in results.items():
            assert result, f"Thread {thread_id} got unexpected validation result"

    def test_schema_validator_with_thread_pool(self):
        """Verify schema validator thread safety with ThreadPoolExecutor."""
        validator = SchemaValidator()
        
        def validate_and_check(args):
            schema, should_pass = args
            errors = validator.validate(schema)
            is_valid = len(errors) == 0
            return is_valid == should_pass
        
        test_cases = []
        for i in range(50):
            if i % 2 == 0:
                test_cases.append((
                    {
                        "$schema": "https://json-structure.org/meta/extended/v0/schema",
                        "$id": f"https://example.com/test{i}",
                        "name": f"Test{i}",
                        "type": "string",
                        "minLength": i
                    },
                    True
                ))
            else:
                test_cases.append((
                    {"type": "nonexistent_type"},
                    False
                ))
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            results = list(executor.map(validate_and_check, test_cases))
        
        assert all(results), "Some schema validations returned incorrect results"


class TestCrossValidatorThreadSafety:
    """Tests for using both validators concurrently."""

    def test_mixed_validator_concurrent_use(self):
        """Verify both validator types can be used concurrently."""
        schema = {
            "$schema": "https://json-structure.org/meta/extended/v0/schema",
            "$id": "https://example.com/test-cross",
            "name": "TestCross",
            "type": "object",
            "properties": {
                "id": {"type": "int32"},
                "name": {"type": "string"}
            },
            "required": ["id", "name"]
        }
        
        schema_validator = SchemaValidator()
        instance_validator = InstanceValidator(schema)
        
        schema_results = []
        instance_results = []
        
        def validate_schemas():
            for _ in range(20):
                errors = schema_validator.validate(schema)
                schema_results.append(len(errors) == 0)
        
        def validate_instances():
            for i in range(20):
                instance = {"id": i, "name": f"Item {i}"}
                errors = instance_validator.validate(instance)
                instance_results.append(len(errors) == 0)
        
        threads = []
        for _ in range(3):
            threads.append(threading.Thread(target=validate_schemas))
            threads.append(threading.Thread(target=validate_instances))
        
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        
        assert all(schema_results), "Some schema validations failed unexpectedly"
        assert all(instance_results), "Some instance validations failed unexpectedly"
