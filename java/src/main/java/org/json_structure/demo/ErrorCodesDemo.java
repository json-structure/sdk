package org.json_structure.demo;

import org.json_structure.validation.*;

/**
 * Java SDK - Error Codes Demo
 * 
 * This demo shows how error codes are included in validation errors.
 */
public class ErrorCodesDemo {
    public static void main(String[] args) {
        System.out.println("=== JSON Structure Java SDK - Error Codes Demo ===\n");

        // Test 1: Instance validation errors
        System.out.println("--- Instance Validation Errors ---\n");

        String schemaJson = """
            {
                "type": "object",
                "properties": {
                    "name": { "type": "string", "minLength": 3 },
                    "age": { "type": "int32", "minimum": 0 },
                    "email": { "type": "string", "pattern": "^[a-z]+@[a-z]+\\\\.[a-z]+$" }
                },
                "required": ["name", "age"]
            }
            """;

        String instanceJson = """
            {
                "name": "AB",
                "email": "INVALID"
            }
            """;

        System.out.println("Input JSON:");
        String[] lines = instanceJson.split("\n");
        for (int i = 0; i < lines.length; i++) {
            System.out.printf("  Line %d: %s%n", i + 1, lines[i]);
        }
        System.out.println();

        ValidationOptions options = new ValidationOptions();
        options.setStopOnFirstError(false);

        InstanceValidator instanceValidator = new InstanceValidator(options);
        ValidationResult result = instanceValidator.validate(instanceJson, schemaJson);

        System.out.printf("Valid: %s%n%n", result.isValid());
        System.out.println("Errors with error codes:");
        System.out.println("-".repeat(80));

        for (ValidationError error : result.getErrors()) {
            System.out.printf("  Error: %s%n", error.getMessage());
            System.out.printf("         → Code:     %s%n", error.getCode());
            System.out.printf("         → Path:     %s%n", error.getPath());
            if (error.getLocation() != null) {
                System.out.printf("         → Location: Line %d, Column %d%n", 
                    error.getLocation().getLine(), error.getLocation().getColumn());
            }
            System.out.println();
        }

        // Test 2: Schema validation errors
        System.out.println("\n--- Schema Validation Errors ---\n");

        String badSchema = """
            {
                "type": "object",
                "properties": {
                    "count": { "type": "integer", "minimum": 10, "maximum": 5 }
                },
                "required": ["missing_property"]
            }
            """;

        System.out.println("Bad Schema:");
        String[] schemaLines = badSchema.split("\n");
        for (int i = 0; i < schemaLines.length; i++) {
            System.out.printf("  Line %d: %s%n", i + 1, schemaLines[i]);
        }
        System.out.println();

        SchemaValidator schemaValidator = new SchemaValidator(options);
        ValidationResult schemaResult = schemaValidator.validate(badSchema);

        System.out.printf("Valid: %s%n%n", schemaResult.isValid());
        System.out.println("Errors with error codes:");
        System.out.println("-".repeat(80));

        for (ValidationError error : schemaResult.getErrors()) {
            System.out.printf("  Error: %s%n", error.getMessage());
            System.out.printf("         → Code:     %s%n", error.getCode());
            System.out.printf("         → Path:     %s%n", error.getPath());
            if (error.getLocation() != null) {
                System.out.printf("         → Location: Line %d, Column %d%n", 
                    error.getLocation().getLine(), error.getLocation().getColumn());
            }
            System.out.println();
        }

        // Test 3: Show available error codes
        System.out.println("\n--- Available Error Codes (sample) ---\n");
        System.out.println("Schema Error Codes:");
        System.out.printf("  SCHEMA_NULL = \"%s\"%n", ErrorCodes.SCHEMA_NULL);
        System.out.printf("  SCHEMA_INVALID_TYPE = \"%s\"%n", ErrorCodes.SCHEMA_INVALID_TYPE);
        System.out.printf("  SCHEMA_REF_NOT_FOUND = \"%s\"%n", ErrorCodes.SCHEMA_REF_NOT_FOUND);
        System.out.printf("  SCHEMA_MIN_GREATER_THAN_MAX = \"%s\"%n", ErrorCodes.SCHEMA_MIN_GREATER_THAN_MAX);

        System.out.println("\nInstance Error Codes:");
        System.out.printf("  INSTANCE_STRING_MIN_LENGTH = \"%s\"%n", ErrorCodes.INSTANCE_STRING_MIN_LENGTH);
        System.out.printf("  INSTANCE_REQUIRED_PROPERTY_MISSING = \"%s\"%n", ErrorCodes.INSTANCE_REQUIRED_PROPERTY_MISSING);
        System.out.printf("  INSTANCE_TYPE_MISMATCH = \"%s\"%n", ErrorCodes.INSTANCE_TYPE_MISMATCH);
        System.out.printf("  INSTANCE_STRING_PATTERN_MISMATCH = \"%s\"%n", ErrorCodes.INSTANCE_STRING_PATTERN_MISMATCH);
    }
}
