// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using System.Text.Json.Nodes;
using Shouldly;
using JsonStructure.Schema;
using Xunit;

namespace JsonStructure.Tests.Schema;

public class JsonStructureSchemaExporterTests
{
    [Fact]
    public void GetJsonStructureSchemaAsNode_SimpleClass_GeneratesSchema()
    {
        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<SimpleClass>();

        var schemaObj = schema.AsObject();
        
        // Check $schema is present and correct
        schemaObj["$schema"].ShouldNotBeNull();
        schemaObj["$schema"]!.GetValue<string>().ShouldBe("https://json-structure.org/meta/core/v0/#");
        
        // Check type is object
        schemaObj["type"].ShouldNotBeNull();
        schemaObj["type"]!.GetValue<string>().ShouldBe("object");
        
        // Check title is generated
        schemaObj["title"].ShouldNotBeNull();
        schemaObj["title"]!.GetValue<string>().ShouldBe("SimpleClass");
        
        // Check properties exist
        schemaObj["properties"].ShouldNotBeNull();
        var props = schemaObj["properties"]!.AsObject();
        
        // Check Name property
        props.ContainsKey("Name").ShouldBeTrue();
        var nameProp = props["Name"]!.AsObject();
        nameProp["type"]!.GetValue<string>().ShouldBe("string");
        nameProp["title"]!.GetValue<string>().ShouldBe("String");
        
        // Check Age property
        props.ContainsKey("Age").ShouldBeTrue();
        var ageProp = props["Age"]!.AsObject();
        ageProp["type"]!.GetValue<string>().ShouldBe("int32");
        ageProp["title"]!.GetValue<string>().ShouldBe("Int32");
        
        // Check required array contains non-nullable properties
        schemaObj["required"].ShouldNotBeNull();
        var required = schemaObj["required"]!.AsArray();
        var requiredProps = required.Select(v => v!.GetValue<string>()).ToList();
        requiredProps.ShouldContain("Name");
        requiredProps.ShouldContain("Age");
        
        // Verify no extra properties at root level
        schemaObj.Count.ShouldBe(5); // $schema, type, title, properties, required
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_WithPrimitiveTypes_MapsCorrectly()
    {
        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<TypeMappingClass>();

        var schemaObj = schema.AsObject();
        
        // Check root schema structure
        schemaObj["$schema"]!.GetValue<string>().ShouldBe("https://json-structure.org/meta/core/v0/#");
        schemaObj["type"]!.GetValue<string>().ShouldBe("object");
        schemaObj["title"]!.GetValue<string>().ShouldBe("TypeMappingClass");
        
        var props = schemaObj["properties"]!.AsObject();
        
        // Verify all 11 properties exist
        props.Count.ShouldBe(11);

        // Check each property type mapping
        props["StringProp"]!.AsObject()["type"]!.GetValue<string>().ShouldBe("string");
        props["StringProp"]!.AsObject()["title"]!.GetValue<string>().ShouldBe("String");
        
        props["IntProp"]!.AsObject()["type"]!.GetValue<string>().ShouldBe("int32");
        props["IntProp"]!.AsObject()["title"]!.GetValue<string>().ShouldBe("Int32");
        
        props["LongProp"]!.AsObject()["type"]!.GetValue<string>().ShouldBe("int64");
        props["LongProp"]!.AsObject()["title"]!.GetValue<string>().ShouldBe("Int64");
        
        props["DoubleProp"]!.AsObject()["type"]!.GetValue<string>().ShouldBe("double");
        props["DoubleProp"]!.AsObject()["title"]!.GetValue<string>().ShouldBe("Double");
        
        props["BoolProp"]!.AsObject()["type"]!.GetValue<string>().ShouldBe("boolean");
        props["BoolProp"]!.AsObject()["title"]!.GetValue<string>().ShouldBe("Boolean");
        
        props["DecimalProp"]!.AsObject()["type"]!.GetValue<string>().ShouldBe("decimal");
        props["DecimalProp"]!.AsObject()["title"]!.GetValue<string>().ShouldBe("Decimal");
        
        props["GuidProp"]!.AsObject()["type"]!.GetValue<string>().ShouldBe("uuid");
        props["GuidProp"]!.AsObject()["title"]!.GetValue<string>().ShouldBe("Guid");
        
        props["UriProp"]!.AsObject()["type"]!.GetValue<string>().ShouldBe("uri");
        props["UriProp"]!.AsObject()["title"]!.GetValue<string>().ShouldBe("Uri");
        
        props["DateOnlyProp"]!.AsObject()["type"]!.GetValue<string>().ShouldBe("date");
        props["DateOnlyProp"]!.AsObject()["title"]!.GetValue<string>().ShouldBe("DateOnly");
        
        props["TimeOnlyProp"]!.AsObject()["type"]!.GetValue<string>().ShouldBe("time");
        props["TimeOnlyProp"]!.AsObject()["title"]!.GetValue<string>().ShouldBe("TimeOnly");
        
        props["TimeSpanProp"]!.AsObject()["type"]!.GetValue<string>().ShouldBe("duration");
        props["TimeSpanProp"]!.AsObject()["title"]!.GetValue<string>().ShouldBe("TimeSpan");
        
        // Verify required array contains all non-nullable value types and non-null reference types
        var required = schemaObj["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        required.Count.ShouldBe(11);
        required.ShouldContain("StringProp");
        required.ShouldContain("IntProp");
        required.ShouldContain("LongProp");
        required.ShouldContain("DoubleProp");
        required.ShouldContain("BoolProp");
        required.ShouldContain("DecimalProp");
        required.ShouldContain("GuidProp");
        required.ShouldContain("UriProp");
        required.ShouldContain("DateOnlyProp");
        required.ShouldContain("TimeOnlyProp");
        required.ShouldContain("TimeSpanProp");
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_Enum_GeneratesEnumConstraint()
    {
        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithEnum>();

        var schemaObj = schema.AsObject();
        
        // Check root schema structure
        schemaObj["$schema"]!.GetValue<string>().ShouldBe("https://json-structure.org/meta/core/v0/#");
        schemaObj["type"]!.GetValue<string>().ShouldBe("object");
        schemaObj["title"]!.GetValue<string>().ShouldBe("ClassWithEnum");
        
        var props = schemaObj["properties"]!.AsObject();
        props.Count.ShouldBe(1);
        
        var statusProp = props["Status"]!.AsObject();
        statusProp["type"]!.GetValue<string>().ShouldBe("string");
        statusProp["title"]!.GetValue<string>().ShouldBe("Status");
        statusProp["enum"].ShouldNotBeNull();
        
        var enumValues = statusProp["enum"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        enumValues.Count.ShouldBe(3);
        enumValues.ShouldBe(new[] {"Active", "Inactive", "Pending"});
        
        // Verify required
        var required = schemaObj["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        required.ShouldHaveSingleItem().ShouldBe("Status");
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_List_GeneratesArraySchema()
    {
        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithList>();

        var schemaObj = schema.AsObject();
        
        // Check root schema structure
        schemaObj["$schema"]!.GetValue<string>().ShouldBe("https://json-structure.org/meta/core/v0/#");
        schemaObj["type"]!.GetValue<string>().ShouldBe("object");
        schemaObj["title"]!.GetValue<string>().ShouldBe("ClassWithList");
        
        var props = schemaObj["properties"]!.AsObject();
        props.Count.ShouldBe(1);
        
        var itemsProp = props["Items"]!.AsObject();
        itemsProp["type"]!.GetValue<string>().ShouldBe("array");
        itemsProp["title"]!.GetValue<string>().ShouldBe("List<String>");
        itemsProp["items"].ShouldNotBeNull();
        
        var itemsSchema = itemsProp["items"]!.AsObject();
        itemsSchema["type"]!.GetValue<string>().ShouldBe("string");
        itemsSchema["title"]!.GetValue<string>().ShouldBe("String");
        
        // Verify required
        var required = schemaObj["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        required.ShouldHaveSingleItem().ShouldBe("Items");
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_Dictionary_GeneratesMapSchema()
    {
        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithDictionary>();

        var schemaObj = schema.AsObject();
        
        // Check root schema structure
        schemaObj["$schema"]!.GetValue<string>().ShouldBe("https://json-structure.org/meta/core/v0/#");
        schemaObj["type"]!.GetValue<string>().ShouldBe("object");
        schemaObj["title"]!.GetValue<string>().ShouldBe("ClassWithDictionary");
        
        var props = schemaObj["properties"]!.AsObject();
        props.Count.ShouldBe(1);
        
        var dataProp = props["Data"]!.AsObject();
        dataProp["type"]!.GetValue<string>().ShouldBe("map");
        dataProp["title"]!.GetValue<string>().ShouldBe("Dictionary<String, Int32>");
        dataProp["values"].ShouldNotBeNull();
        
        var valuesSchema = dataProp["values"]!.AsObject();
        valuesSchema["type"]!.GetValue<string>().ShouldBe("int32");
        valuesSchema["title"]!.GetValue<string>().ShouldBe("Int32");
        
        // Verify required
        var required = schemaObj["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        required.ShouldHaveSingleItem().ShouldBe("Data");
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_HashSet_GeneratesSetSchema()
    {
        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithHashSet>();

        var schemaObj = schema.AsObject();
        
        // Check root schema structure
        schemaObj["$schema"]!.GetValue<string>().ShouldBe("https://json-structure.org/meta/core/v0/#");
        schemaObj["type"]!.GetValue<string>().ShouldBe("object");
        schemaObj["title"]!.GetValue<string>().ShouldBe("ClassWithHashSet");
        
        var props = schemaObj["properties"]!.AsObject();
        props.Count.ShouldBe(1);
        
        var tagsProp = props["Tags"]!.AsObject();
        tagsProp["type"]!.GetValue<string>().ShouldBe("set");
        tagsProp["title"]!.GetValue<string>().ShouldBe("HashSet<String>");
        tagsProp["items"].ShouldNotBeNull();
        
        var itemsSchema = tagsProp["items"]!.AsObject();
        itemsSchema["type"]!.GetValue<string>().ShouldBe("string");
        itemsSchema["title"]!.GetValue<string>().ShouldBe("String");
        
        // Verify required
        var required = schemaObj["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        required.ShouldHaveSingleItem().ShouldBe("Tags");
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_RequiredAttribute_AddsToRequired()
    {
        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithRequired>();

        var schemaObj = schema.AsObject();
        
        // Check root schema structure
        schemaObj["$schema"]!.GetValue<string>().ShouldBe("https://json-structure.org/meta/core/v0/#");
        schemaObj["type"]!.GetValue<string>().ShouldBe("object");
        schemaObj["title"]!.GetValue<string>().ShouldBe("ClassWithRequired");
        
        var props = schemaObj["properties"]!.AsObject();
        props.Count.ShouldBe(2);
        
        // Check Name property
        props["Name"]!.AsObject()["type"]!.GetValue<string>().ShouldBe("string");
        
        // Check OptionalField property
        props["OptionalField"]!.AsObject()["type"]!.GetValue<string>().ShouldBe("string");
        
        // Verify only Name is required (has [Required] attribute), OptionalField is nullable
        var required = schemaObj["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        required.ShouldHaveSingleItem().ShouldBe("Name");
        required.ShouldNotContain("OptionalField");
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_WithDescription_IncludesDescription()
    {
        var options = new JsonStructureSchemaExporterOptions
        {
            IncludeDescriptions = true
        };

        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithDescription>(
            exporterOptions: options);

        var schemaObj = schema.AsObject();
        
        // Check root schema structure
        schemaObj["$schema"]!.GetValue<string>().ShouldBe("https://json-structure.org/meta/core/v0/#");
        schemaObj["type"]!.GetValue<string>().ShouldBe("object");
        schemaObj["title"]!.GetValue<string>().ShouldBe("ClassWithDescription");
        schemaObj["description"]!.GetValue<string>().ShouldBe("This is a test class");
        
        var props = schemaObj["properties"]!.AsObject();
        props.Count.ShouldBe(1);
        props["Value"]!.AsObject()["type"]!.GetValue<string>().ShouldBe("string");
        
        // Verify required
        var required = schemaObj["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        required.ShouldHaveSingleItem().ShouldBe("Value");
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_WithJsonPropertyName_UsesJsonName()
    {
        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        };

        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithJsonPropertyName>(options);

        var schemaObj = schema.AsObject();
        
        // Check root schema structure
        schemaObj["$schema"]!.GetValue<string>().ShouldBe("https://json-structure.org/meta/core/v0/#");
        schemaObj["type"]!.GetValue<string>().ShouldBe("object");
        schemaObj["title"]!.GetValue<string>().ShouldBe("ClassWithJsonPropertyName");
        
        var props = schemaObj["properties"]!.AsObject();
        props.Count.ShouldBe(1);
        
        // Should use explicit JsonPropertyName, not camelCase of property name
        props.ContainsKey("custom_name").ShouldBeTrue();
        props.ContainsKey("customProperty").ShouldBeFalse();
        props.ContainsKey("CustomProperty").ShouldBeFalse();
        
        props["custom_name"]!.AsObject()["type"]!.GetValue<string>().ShouldBe("string");
        
        // Verify required uses the JSON name
        var required = schemaObj["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        required.ShouldHaveSingleItem().ShouldBe("custom_name");
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_WithTransform_AppliesTransform()
    {
        var transformCalled = false;
        var options = new JsonStructureSchemaExporterOptions
        {
            TransformSchema = (context, schema) =>
            {
                if (context.IsRoot && schema is JsonObject obj)
                {
                    transformCalled = true;
                    obj["$id"] = "https://example.com/schema";
                    obj["customProperty"] = "customValue";
                }
                return schema;
            }
        };

        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<SimpleClass>(
            exporterOptions: options);

        var schemaObj = schema.AsObject();
        
        // Verify transform was called
        transformCalled.ShouldBeTrue();
        
        // Check transformed properties
        schemaObj["$id"]!.GetValue<string>().ShouldBe("https://example.com/schema");
        schemaObj["customProperty"]!.GetValue<string>().ShouldBe("customValue");
        
        // Check original properties still exist
        schemaObj["$schema"]!.GetValue<string>().ShouldBe("https://json-structure.org/meta/core/v0/#");
        schemaObj["type"]!.GetValue<string>().ShouldBe("object");
        schemaObj["title"]!.GetValue<string>().ShouldBe("SimpleClass");
        schemaObj["properties"].ShouldNotBeNull();
        schemaObj["required"].ShouldNotBeNull();
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_Int128_MapsCorrectly()
    {
        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithLargeIntegers>();

        var schemaObj = schema.AsObject();
        
        // Check root schema structure
        schemaObj["$schema"]!.GetValue<string>().ShouldBe("https://json-structure.org/meta/core/v0/#");
        schemaObj["type"]!.GetValue<string>().ShouldBe("object");
        schemaObj["title"]!.GetValue<string>().ShouldBe("ClassWithLargeIntegers");
        
        var props = schemaObj["properties"]!.AsObject();
        props.Count.ShouldBe(2);
        
        props["BigInt"]!.AsObject()["type"]!.GetValue<string>().ShouldBe("int128");
        props["BigInt"]!.AsObject()["title"]!.GetValue<string>().ShouldBe("Int128");
        
        props["BigUInt"]!.AsObject()["type"]!.GetValue<string>().ShouldBe("uint128");
        props["BigUInt"]!.AsObject()["title"]!.GetValue<string>().ShouldBe("UInt128");
        
        // Verify required
        var required = schemaObj["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        required.Count.ShouldBe(2);
        required.ShouldContain("BigInt");
        required.ShouldContain("BigUInt");
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_WithRangeAttribute_DoesNotIncludeMinMaxWithoutExtendedValidation()
    {
        // Without UseExtendedValidation, range constraints should NOT be emitted
        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithRange>();

        var schemaObj = schema.AsObject();
        var props = schemaObj["properties"]!.AsObject();
        var valueProp = props["Value"]!.AsObject();
        
        // Validation keywords should NOT be present
        valueProp.ContainsKey("minimum").ShouldBeFalse();
        valueProp.ContainsKey("maximum").ShouldBeFalse();
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_WithRangeAttribute_IncludesMinMaxWithExtendedValidation()
    {
        var exporterOptions = new JsonStructureSchemaExporterOptions
        {
            UseExtendedValidation = true
        };

        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithRange>(
            exporterOptions: exporterOptions);

        var schemaObj = schema.AsObject();
        
        // Check extended schema and $uses
        schemaObj["$schema"]!.GetValue<string>().ShouldBe("https://json-structure.org/meta/extended/v0/#");
        schemaObj["$uses"]!.AsArray()[0]!.GetValue<string>().ShouldBe("JSONStructureValidation");
        
        var props = schemaObj["properties"]!.AsObject();
        var valueProp = props["Value"]!.AsObject();
        valueProp["type"]!.GetValue<string>().ShouldBe("int32");
        valueProp["minimum"]!.GetValue<double>().ShouldBe(0);
        valueProp["maximum"]!.GetValue<double>().ShouldBe(100);
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_WithStringLength_DoesNotIncludeLengthWithoutExtendedValidation()
    {
        // Without UseExtendedValidation, length constraints should NOT be emitted
        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithStringLength>();

        var schemaObj = schema.AsObject();
        var props = schemaObj["properties"]!.AsObject();
        var nameProp = props["Name"]!.AsObject();
        
        // Validation keywords should NOT be present
        nameProp.ContainsKey("minLength").ShouldBeFalse();
        nameProp.ContainsKey("maxLength").ShouldBeFalse();
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_WithStringLength_IncludesLengthWithExtendedValidation()
    {
        var exporterOptions = new JsonStructureSchemaExporterOptions
        {
            UseExtendedValidation = true
        };

        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithStringLength>(
            exporterOptions: exporterOptions);

        var schemaObj = schema.AsObject();
        
        // Check extended schema and $uses
        schemaObj["$schema"]!.GetValue<string>().ShouldBe("https://json-structure.org/meta/extended/v0/#");
        
        var props = schemaObj["properties"]!.AsObject();
        var nameProp = props["Name"]!.AsObject();
        nameProp["type"]!.GetValue<string>().ShouldBe("string");
        nameProp["minLength"]!.GetValue<int>().ShouldBe(1);
        nameProp["maxLength"]!.GetValue<int>().ShouldBe(50);
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_WithRegex_DoesNotIncludePatternWithoutExtendedValidation()
    {
        // Without UseExtendedValidation, pattern should NOT be emitted
        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithRegex>();

        var schemaObj = schema.AsObject();
        var props = schemaObj["properties"]!.AsObject();
        var emailProp = props["Email"]!.AsObject();
        
        // Pattern should NOT be present
        emailProp.ContainsKey("pattern").ShouldBeFalse();
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_WithRegex_IncludesPatternWithExtendedValidation()
    {
        var exporterOptions = new JsonStructureSchemaExporterOptions
        {
            UseExtendedValidation = true
        };

        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithRegex>(
            exporterOptions: exporterOptions);

        var schemaObj = schema.AsObject();
        
        // Check extended schema
        schemaObj["$schema"]!.GetValue<string>().ShouldBe("https://json-structure.org/meta/extended/v0/#");
        
        var props = schemaObj["properties"]!.AsObject();
        var emailProp = props["Email"]!.AsObject();
        emailProp["type"]!.GetValue<string>().ShouldBe("string");
        emailProp["pattern"]!.GetValue<string>().ShouldBe(@"^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$");
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_WithMinLengthAttribute_IncludesMinLengthWithExtendedValidation()
    {
        var exporterOptions = new JsonStructureSchemaExporterOptions
        {
            UseExtendedValidation = true
        };

        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithMinLength>(
            exporterOptions: exporterOptions);

        var schemaObj = schema.AsObject();
        var props = schemaObj["properties"]!.AsObject();
        var valueProp = props["Value"]!.AsObject();
        
        valueProp["minLength"]!.GetValue<int>().ShouldBe(5);
        valueProp.ContainsKey("maxLength").ShouldBeFalse();
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_WithMaxLengthAttribute_IncludesMaxLengthWithExtendedValidation()
    {
        var exporterOptions = new JsonStructureSchemaExporterOptions
        {
            UseExtendedValidation = true
        };

        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithMaxLength>(
            exporterOptions: exporterOptions);

        var schemaObj = schema.AsObject();
        var props = schemaObj["properties"]!.AsObject();
        var valueProp = props["Value"]!.AsObject();
        
        valueProp["maxLength"]!.GetValue<int>().ShouldBe(100);
        valueProp.ContainsKey("minLength").ShouldBeFalse();
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_AllValidationAnnotations_OnlyEmittedWithExtendedValidation()
    {
        var exporterOptions = new JsonStructureSchemaExporterOptions
        {
            UseExtendedValidation = true
        };

        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithAllValidationAnnotations>(
            exporterOptions: exporterOptions);

        var schemaObj = schema.AsObject();
        
        // Verify extended schema
        schemaObj["$schema"]!.GetValue<string>().ShouldBe("https://json-structure.org/meta/extended/v0/#");
        schemaObj["$uses"]!.AsArray().Count.ShouldBe(1);
        
        var props = schemaObj["properties"]!.AsObject();
        
        // Check Age with Range
        var ageProp = props["Age"]!.AsObject();
        ageProp["minimum"]!.GetValue<double>().ShouldBe(0);
        ageProp["maximum"]!.GetValue<double>().ShouldBe(150);
        
        // Check Name with StringLength
        var nameProp = props["Name"]!.AsObject();
        nameProp["minLength"]!.GetValue<int>().ShouldBe(1);
        nameProp["maxLength"]!.GetValue<int>().ShouldBe(100);
        
        // Check Email with RegularExpression
        var emailProp = props["Email"]!.AsObject();
        emailProp["pattern"].ShouldNotBeNull();
        
        // Check Score with Range (double)
        var scoreProp = props["Score"]!.AsObject();
        scoreProp["minimum"]!.GetValue<double>().ShouldBe(0.0);
        scoreProp["maximum"]!.GetValue<double>().ShouldBe(100.0);
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_AllValidationAnnotations_NotEmittedWithoutExtendedValidation()
    {
        // Without UseExtendedValidation flag
        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithAllValidationAnnotations>();

        var schemaObj = schema.AsObject();
        
        // Verify core schema (not extended)
        schemaObj["$schema"]!.GetValue<string>().ShouldBe("https://json-structure.org/meta/core/v0/#");
        schemaObj.ContainsKey("$uses").ShouldBeFalse();
        
        var props = schemaObj["properties"]!.AsObject();
        
        // Check Age - no validation keywords
        var ageProp = props["Age"]!.AsObject();
        ageProp.ContainsKey("minimum").ShouldBeFalse();
        ageProp.ContainsKey("maximum").ShouldBeFalse();
        
        // Check Name - no validation keywords
        var nameProp = props["Name"]!.AsObject();
        nameProp.ContainsKey("minLength").ShouldBeFalse();
        nameProp.ContainsKey("maxLength").ShouldBeFalse();
        
        // Check Email - no pattern
        var emailProp = props["Email"]!.AsObject();
        emailProp.ContainsKey("pattern").ShouldBeFalse();
        
        // Check Score - no validation keywords
        var scoreProp = props["Score"]!.AsObject();
        scoreProp.ContainsKey("minimum").ShouldBeFalse();
        scoreProp.ContainsKey("maximum").ShouldBeFalse();
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_WithArrayMinLength_EmitsMinItems()
    {
        var exporterOptions = new JsonStructureSchemaExporterOptions
        {
            UseExtendedValidation = true
        };

        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithArrayLengthConstraints>(
            exporterOptions: exporterOptions);

        var schemaObj = schema.AsObject();
        var props = schemaObj["properties"]!.AsObject();
        
        // Tags has MinLength(2) - should be minItems for arrays
        var tagsProp = props["Tags"]!.AsObject();
        tagsProp["minItems"]!.GetValue<int>().ShouldBe(2);
        tagsProp.ContainsKey("minLength").ShouldBeFalse();
        
        // Numbers has MaxLength(10) - should be maxItems for arrays
        var numbersProp = props["Numbers"]!.AsObject();
        numbersProp["maxItems"]!.GetValue<int>().ShouldBe(10);
        numbersProp.ContainsKey("maxLength").ShouldBeFalse();
        
        // Scores has both MinLength(1) and MaxLength(5)
        var scoresProp = props["Scores"]!.AsObject();
        scoresProp["minItems"]!.GetValue<int>().ShouldBe(1);
        scoresProp["maxItems"]!.GetValue<int>().ShouldBe(5);
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_WithArrayMinLength_NotEmittedWithoutExtendedValidation()
    {
        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithArrayLengthConstraints>();

        var schemaObj = schema.AsObject();
        var props = schemaObj["properties"]!.AsObject();
        
        var tagsProp = props["Tags"]!.AsObject();
        tagsProp.ContainsKey("minItems").ShouldBeFalse();
        
        var numbersProp = props["Numbers"]!.AsObject();
        numbersProp.ContainsKey("maxItems").ShouldBeFalse();
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_WithExclusiveRange_EmitsExclusiveMinMax()
    {
        var exporterOptions = new JsonStructureSchemaExporterOptions
        {
            UseExtendedValidation = true
        };

        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithExclusiveRange>(
            exporterOptions: exporterOptions);

        var schemaObj = schema.AsObject();
        var props = schemaObj["properties"]!.AsObject();
        
        // ExclusiveBoth - both exclusive
        var exclusiveBothProp = props["ExclusiveBoth"]!.AsObject();
        exclusiveBothProp["exclusiveMinimum"]!.GetValue<double>().ShouldBe(0);
        exclusiveBothProp["exclusiveMaximum"]!.GetValue<double>().ShouldBe(100);
        exclusiveBothProp.ContainsKey("minimum").ShouldBeFalse();
        exclusiveBothProp.ContainsKey("maximum").ShouldBeFalse();
        
        // ExclusiveMin - only min exclusive
        var exclusiveMinProp = props["ExclusiveMin"]!.AsObject();
        exclusiveMinProp["exclusiveMinimum"]!.GetValue<double>().ShouldBe(0);
        exclusiveMinProp["maximum"]!.GetValue<double>().ShouldBe(100);
        exclusiveMinProp.ContainsKey("minimum").ShouldBeFalse();
        exclusiveMinProp.ContainsKey("exclusiveMaximum").ShouldBeFalse();
        
        // ExclusiveMax - only max exclusive
        var exclusiveMaxProp = props["ExclusiveMax"]!.AsObject();
        exclusiveMaxProp["minimum"]!.GetValue<double>().ShouldBe(0);
        exclusiveMaxProp["exclusiveMaximum"]!.GetValue<double>().ShouldBe(100);
        exclusiveMaxProp.ContainsKey("exclusiveMinimum").ShouldBeFalse();
        exclusiveMaxProp.ContainsKey("maximum").ShouldBeFalse();
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_WithEmailAddress_EmitsFormat()
    {
        var exporterOptions = new JsonStructureSchemaExporterOptions
        {
            UseExtendedValidation = true
        };

        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithEmailAddress>(
            exporterOptions: exporterOptions);

        var schemaObj = schema.AsObject();
        var props = schemaObj["properties"]!.AsObject();
        
        var emailProp = props["Email"]!.AsObject();
        emailProp["type"]!.GetValue<string>().ShouldBe("string");
        emailProp["format"]!.GetValue<string>().ShouldBe("email");
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_WithEmailAddress_NotEmittedWithoutExtendedValidation()
    {
        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithEmailAddress>();

        var schemaObj = schema.AsObject();
        var props = schemaObj["properties"]!.AsObject();
        
        var emailProp = props["Email"]!.AsObject();
        emailProp.ContainsKey("format").ShouldBeFalse();
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_ExcludesJsonIgnore()
    {
        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithIgnore>();

        var schemaObj = schema.AsObject();
        
        // Check root schema structure
        schemaObj["$schema"]!.GetValue<string>().ShouldBe("https://json-structure.org/meta/core/v0/#");
        schemaObj["type"]!.GetValue<string>().ShouldBe("object");
        schemaObj["title"]!.GetValue<string>().ShouldBe("ClassWithIgnore");
        
        var props = schemaObj["properties"]!.AsObject();
        props.Count.ShouldBe(1); // Only IncludedProp, not IgnoredProp
        
        props.ContainsKey("IgnoredProp").ShouldBeFalse();
        props.ContainsKey("IncludedProp").ShouldBeTrue();
        props["IncludedProp"]!.AsObject()["type"]!.GetValue<string>().ShouldBe("string");
        
        // Verify required only contains the included property
        var required = schemaObj["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        required.ShouldHaveSingleItem().ShouldBe("IncludedProp");
        required.ShouldNotContain("IgnoredProp");
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_WithCamelCase_TransformsPropertyNames()
    {
        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        };

        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<SimpleClass>(options);

        var schemaObj = schema.AsObject();
        
        // Check root schema structure
        schemaObj["$schema"]!.GetValue<string>().ShouldBe("https://json-structure.org/meta/core/v0/#");
        schemaObj["type"]!.GetValue<string>().ShouldBe("object");
        schemaObj["title"]!.GetValue<string>().ShouldBe("SimpleClass");
        
        var props = schemaObj["properties"]!.AsObject();
        props.Count.ShouldBe(2);
        
        // Property names should be camelCase
        props.ContainsKey("name").ShouldBeTrue();
        props.ContainsKey("Name").ShouldBeFalse();
        props["name"]!.AsObject()["type"]!.GetValue<string>().ShouldBe("string");
        
        props.ContainsKey("age").ShouldBeTrue();
        props.ContainsKey("Age").ShouldBeFalse();
        props["age"]!.AsObject()["type"]!.GetValue<string>().ShouldBe("int32");
        
        // Verify required uses camelCase names
        var required = schemaObj["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        required.Count.ShouldBe(2);
        required.ShouldContain("name");
        required.ShouldContain("age");
        required.ShouldNotContain("Name");
        required.ShouldNotContain("Age");
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_WithExtendedValidation_IncludesUsesClause()
    {
        var exporterOptions = new JsonStructureSchemaExporterOptions
        {
            UseExtendedValidation = true
        };

        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<SimpleClass>(
            exporterOptions: exporterOptions);

        var schemaObj = schema.AsObject();

        // Check that $schema is the extended meta-schema
        schemaObj["$schema"].ShouldNotBeNull();
        schemaObj["$schema"]!.GetValue<string>().ShouldBe("https://json-structure.org/meta/extended/v0/#");

        // Check that $uses includes JSONStructureValidation
        schemaObj["$uses"].ShouldNotBeNull();
        var uses = schemaObj["$uses"]!.AsArray();
        uses.Count.ShouldBe(1);
        uses[0]!.GetValue<string>().ShouldBe("JSONStructureValidation");

        // Verify other schema properties are still present
        schemaObj["type"]!.GetValue<string>().ShouldBe("object");
        schemaObj["properties"].ShouldNotBeNull();
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_WithoutExtendedValidation_UsesDefaultSchema()
    {
        var exporterOptions = new JsonStructureSchemaExporterOptions
        {
            UseExtendedValidation = false
        };

        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<SimpleClass>(
            exporterOptions: exporterOptions);

        var schemaObj = schema.AsObject();

        // Check that $schema is the core meta-schema
        schemaObj["$schema"].ShouldNotBeNull();
        schemaObj["$schema"]!.GetValue<string>().ShouldBe("https://json-structure.org/meta/core/v0/#");

        // Check that $uses is NOT present
        schemaObj.ContainsKey("$uses").ShouldBeFalse();
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_WithExtendedValidation_OverridesCustomSchemaUri()
    {
        var exporterOptions = new JsonStructureSchemaExporterOptions
        {
            UseExtendedValidation = true,
            SchemaUri = "https://custom.schema.uri/v1.0"  // This should be ignored when UseExtendedValidation is true
        };

        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<SimpleClass>(
            exporterOptions: exporterOptions);

        var schemaObj = schema.AsObject();

        // Extended validation should override the custom URI
        schemaObj["$schema"]!.GetValue<string>().ShouldBe("https://json-structure.org/meta/extended/v0/#");
        schemaObj["$uses"].ShouldNotBeNull();
    }

    // Test classes
    private class SimpleClass
    {
        public string Name { get; set; } = "";
        public int Age { get; set; }
    }

    private class TypeMappingClass
    {
        public string StringProp { get; set; } = "";
        public int IntProp { get; set; }
        public long LongProp { get; set; }
        public double DoubleProp { get; set; }
        public bool BoolProp { get; set; }
        public decimal DecimalProp { get; set; }
        public Guid GuidProp { get; set; }
        public Uri UriProp { get; set; } = null!;
        public DateOnly DateOnlyProp { get; set; }
        public TimeOnly TimeOnlyProp { get; set; }
        public TimeSpan TimeSpanProp { get; set; }
    }

    private enum Status { Active, Inactive, Pending }

    private class ClassWithEnum
    {
        public Status Status { get; set; }
    }

    private class ClassWithList
    {
        public List<string> Items { get; set; } = new();
    }

    private class ClassWithDictionary
    {
        public Dictionary<string, int> Data { get; set; } = new();
    }

    private class ClassWithHashSet
    {
        public HashSet<string> Tags { get; set; } = new();
    }

    private class ClassWithRequired
    {
        [System.ComponentModel.DataAnnotations.Required]
        public string Name { get; set; } = "";

        public string? OptionalField { get; set; }
    }

    [System.ComponentModel.Description("This is a test class")]
    private class ClassWithDescription
    {
        public string Value { get; set; } = "";
    }

    private class ClassWithJsonPropertyName
    {
        [System.Text.Json.Serialization.JsonPropertyName("custom_name")]
        public string CustomProperty { get; set; } = "";
    }

    private class ClassWithLargeIntegers
    {
        public Int128 BigInt { get; set; }
        public UInt128 BigUInt { get; set; }
    }

    private class ClassWithRange
    {
        [System.ComponentModel.DataAnnotations.Range(0, 100)]
        public int Value { get; set; }
    }

    private class ClassWithStringLength
    {
        [System.ComponentModel.DataAnnotations.StringLength(50, MinimumLength = 1)]
        public string Name { get; set; } = "";
    }

    private class ClassWithRegex
    {
        [System.ComponentModel.DataAnnotations.RegularExpression(@"^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$")]
        public string Email { get; set; } = "";
    }

    private class ClassWithMinLength
    {
        [System.ComponentModel.DataAnnotations.MinLength(5)]
        public string Value { get; set; } = "";
    }

    private class ClassWithMaxLength
    {
        [System.ComponentModel.DataAnnotations.MaxLength(100)]
        public string Value { get; set; } = "";
    }

    private class ClassWithAllValidationAnnotations
    {
        [System.ComponentModel.DataAnnotations.Range(0, 150)]
        public int Age { get; set; }

        [System.ComponentModel.DataAnnotations.StringLength(100, MinimumLength = 1)]
        public string Name { get; set; } = "";

        [System.ComponentModel.DataAnnotations.RegularExpression(@"^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$")]
        public string Email { get; set; } = "";

        [System.ComponentModel.DataAnnotations.Range(0.0, 100.0)]
        public double Score { get; set; }
    }

    private class ClassWithIgnore
    {
        [System.Text.Json.Serialization.JsonIgnore]
        public string IgnoredProp { get; set; } = "";

        public string IncludedProp { get; set; } = "";
    }

    private class ClassWithArrayLengthConstraints
    {
        [System.ComponentModel.DataAnnotations.MinLength(2)]
        public List<string> Tags { get; set; } = new();

        [System.ComponentModel.DataAnnotations.MaxLength(10)]
        public int[] Numbers { get; set; } = Array.Empty<int>();

        [System.ComponentModel.DataAnnotations.MinLength(1)]
        [System.ComponentModel.DataAnnotations.MaxLength(5)]
        public List<int> Scores { get; set; } = new();
    }

    private class ClassWithExclusiveRange
    {
        [System.ComponentModel.DataAnnotations.Range(0, 100, MinimumIsExclusive = true, MaximumIsExclusive = true)]
        public int ExclusiveBoth { get; set; }

        [System.ComponentModel.DataAnnotations.Range(0, 100, MinimumIsExclusive = true)]
        public int ExclusiveMin { get; set; }

        [System.ComponentModel.DataAnnotations.Range(0, 100, MaximumIsExclusive = true)]
        public int ExclusiveMax { get; set; }
    }

    private class ClassWithEmailAddress
    {
        [System.ComponentModel.DataAnnotations.EmailAddress]
        public string Email { get; set; } = "";
    }
}
