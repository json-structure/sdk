using System;
using System.Text.Json.Nodes;
using JsonStructure.Validation;

Console.WriteLine("=== JSON Structure Validation Error Demo ===\n");

// Test 1: Instance validation errors with LINE/COLUMN tracking
Console.WriteLine("--- Instance Validation Errors (with source location) ---\n");

var schema1 = new JsonObject
{
    ["type"] = "object",
    ["properties"] = new JsonObject
    {
        ["name"] = new JsonObject { ["type"] = "string", ["minLength"] = 3 },
        ["age"] = new JsonObject { ["type"] = "int32", ["minimum"] = 0 },
        ["email"] = new JsonObject { ["type"] = "string", ["pattern"] = "^[a-z]+@[a-z]+\\.[a-z]+$" }
    },
    ["required"] = new JsonArray { "name", "age" }
};

// Parse from STRING to get line/column tracking
var instanceJson = """
{
    "name": "AB",
    "email": "INVALID"
}
""";

var schemaJson = """
{
    "type": "object",
    "properties": {
        "name": { "type": "string", "minLength": 3 },
        "age": { "type": "int32", "minimum": 0 },
        "email": { "type": "string", "pattern": "^[a-z]+@[a-z]+\\.[a-z]+$" }
    },
    "required": ["name", "age"]
}
""";

Console.WriteLine("Input JSON:");
var lines = instanceJson.Split('\n');
for (int i = 0; i < lines.Length; i++)
{
    Console.WriteLine($"  Line {i + 1}: {lines[i].TrimEnd('\r')}");
}
Console.WriteLine();

var options = new ValidationOptions { StopOnFirstError = false };
var validator = new InstanceValidator(options);
var result = validator.Validate(instanceJson, schemaJson);

Console.WriteLine($"Valid: {result.IsValid}\n");
Console.WriteLine("Errors with source location:");
Console.WriteLine(new string('-', 80));
foreach (var error in result.Errors)
{
    Console.WriteLine($"  Error: {error}");
    Console.WriteLine($"         → Code:     {error.Code}");
    Console.WriteLine($"         → Path:     {error.Path}");
    Console.WriteLine($"         → Location: Line {error.Location.Line}, Column {error.Location.Column}");
    Console.WriteLine($"         → Message:  {error.Message}");
    
    // Show the actual line from the source
    if (error.Location.Line > 0 && error.Location.Line <= lines.Length)
    {
        var sourceLine = lines[error.Location.Line - 1].TrimEnd('\r');
        Console.WriteLine($"         → Source:   {sourceLine}");
        Console.WriteLine($"                     {new string(' ', error.Location.Column - 1)}^");
    }
    Console.WriteLine();
}

// Test 2: Schema validation errors
Console.WriteLine("\n--- Schema Validation Errors ---\n");

var badSchema = """
{
    "type": "object",
    "properties": {
        "count": { "type": "integer", "minimum": 10, "maximum": 5 }
    },
    "required": ["missing_property"]
}
""";

Console.WriteLine("Bad Schema:");
var schemaLines = badSchema.Split('\n');
for (int i = 0; i < schemaLines.Length; i++)
{
    Console.WriteLine($"  Line {i + 1}: {schemaLines[i].TrimEnd('\r')}");
}
Console.WriteLine();

var schemaValidator = new SchemaValidator(new ValidationOptions { StopOnFirstError = false });
var schemaResult = schemaValidator.Validate(badSchema);

Console.WriteLine($"Valid: {schemaResult.IsValid}\n");
Console.WriteLine("Errors with source location:");
Console.WriteLine(new string('-', 80));
foreach (var error in schemaResult.Errors)
{
    Console.WriteLine($"  Error: {error}");
    Console.WriteLine($"         → Code:     {error.Code}");
    Console.WriteLine($"         → Path:     {error.Path}");
    Console.WriteLine($"         → Location: Line {error.Location.Line}, Column {error.Location.Column}");
    Console.WriteLine($"         → Message:  {error.Message}");
    
    // Show the actual line from the source
    if (error.Location.Line > 0 && error.Location.Line <= schemaLines.Length)
    {
        var sourceLine = schemaLines[error.Location.Line - 1].TrimEnd('\r');
        Console.WriteLine($"         → Source:   {sourceLine}");
        Console.WriteLine($"                     {new string(' ', error.Location.Column - 1)}^");
    }
    Console.WriteLine();
}
