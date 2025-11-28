// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
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
        schemaObj["$schema"].Should().NotBeNull();
        schemaObj["$schema"]!.GetValue<string>().Should().Be("https://json-structure.org/meta/core/v1.0");
        
        // Check type is object
        schemaObj["type"].Should().NotBeNull();
        schemaObj["type"]!.GetValue<string>().Should().Be("object");
        
        // Check title is generated
        schemaObj["title"].Should().NotBeNull();
        schemaObj["title"]!.GetValue<string>().Should().Be("SimpleClass");
        
        // Check properties exist
        schemaObj["properties"].Should().NotBeNull();
        var props = schemaObj["properties"]!.AsObject();
        
        // Check Name property
        props.ContainsKey("Name").Should().BeTrue();
        var nameProp = props["Name"]!.AsObject();
        nameProp["type"]!.GetValue<string>().Should().Be("string");
        nameProp["title"]!.GetValue<string>().Should().Be("String");
        
        // Check Age property
        props.ContainsKey("Age").Should().BeTrue();
        var ageProp = props["Age"]!.AsObject();
        ageProp["type"]!.GetValue<string>().Should().Be("int32");
        ageProp["title"]!.GetValue<string>().Should().Be("Int32");
        
        // Check required array contains non-nullable properties
        schemaObj["required"].Should().NotBeNull();
        var required = schemaObj["required"]!.AsArray();
        var requiredProps = required.Select(v => v!.GetValue<string>()).ToList();
        requiredProps.Should().Contain("Name");
        requiredProps.Should().Contain("Age");
        
        // Verify no extra properties at root level
        schemaObj.Count.Should().Be(5); // $schema, type, title, properties, required
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_WithPrimitiveTypes_MapsCorrectly()
    {
        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<TypeMappingClass>();

        var schemaObj = schema.AsObject();
        
        // Check root schema structure
        schemaObj["$schema"]!.GetValue<string>().Should().Be("https://json-structure.org/meta/core/v1.0");
        schemaObj["type"]!.GetValue<string>().Should().Be("object");
        schemaObj["title"]!.GetValue<string>().Should().Be("TypeMappingClass");
        
        var props = schemaObj["properties"]!.AsObject();
        
        // Verify all 11 properties exist
        props.Count.Should().Be(11);

        // Check each property type mapping
        props["StringProp"]!.AsObject()["type"]!.GetValue<string>().Should().Be("string");
        props["StringProp"]!.AsObject()["title"]!.GetValue<string>().Should().Be("String");
        
        props["IntProp"]!.AsObject()["type"]!.GetValue<string>().Should().Be("int32");
        props["IntProp"]!.AsObject()["title"]!.GetValue<string>().Should().Be("Int32");
        
        props["LongProp"]!.AsObject()["type"]!.GetValue<string>().Should().Be("int64");
        props["LongProp"]!.AsObject()["title"]!.GetValue<string>().Should().Be("Int64");
        
        props["DoubleProp"]!.AsObject()["type"]!.GetValue<string>().Should().Be("double");
        props["DoubleProp"]!.AsObject()["title"]!.GetValue<string>().Should().Be("Double");
        
        props["BoolProp"]!.AsObject()["type"]!.GetValue<string>().Should().Be("boolean");
        props["BoolProp"]!.AsObject()["title"]!.GetValue<string>().Should().Be("Boolean");
        
        props["DecimalProp"]!.AsObject()["type"]!.GetValue<string>().Should().Be("decimal");
        props["DecimalProp"]!.AsObject()["title"]!.GetValue<string>().Should().Be("Decimal");
        
        props["GuidProp"]!.AsObject()["type"]!.GetValue<string>().Should().Be("uuid");
        props["GuidProp"]!.AsObject()["title"]!.GetValue<string>().Should().Be("Guid");
        
        props["UriProp"]!.AsObject()["type"]!.GetValue<string>().Should().Be("uri");
        props["UriProp"]!.AsObject()["title"]!.GetValue<string>().Should().Be("Uri");
        
        props["DateOnlyProp"]!.AsObject()["type"]!.GetValue<string>().Should().Be("date");
        props["DateOnlyProp"]!.AsObject()["title"]!.GetValue<string>().Should().Be("DateOnly");
        
        props["TimeOnlyProp"]!.AsObject()["type"]!.GetValue<string>().Should().Be("time");
        props["TimeOnlyProp"]!.AsObject()["title"]!.GetValue<string>().Should().Be("TimeOnly");
        
        props["TimeSpanProp"]!.AsObject()["type"]!.GetValue<string>().Should().Be("duration");
        props["TimeSpanProp"]!.AsObject()["title"]!.GetValue<string>().Should().Be("TimeSpan");
        
        // Verify required array contains all non-nullable value types and non-null reference types
        var required = schemaObj["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        required.Should().HaveCount(11);
        required.Should().Contain("StringProp");
        required.Should().Contain("IntProp");
        required.Should().Contain("LongProp");
        required.Should().Contain("DoubleProp");
        required.Should().Contain("BoolProp");
        required.Should().Contain("DecimalProp");
        required.Should().Contain("GuidProp");
        required.Should().Contain("UriProp");
        required.Should().Contain("DateOnlyProp");
        required.Should().Contain("TimeOnlyProp");
        required.Should().Contain("TimeSpanProp");
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_Enum_GeneratesEnumConstraint()
    {
        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithEnum>();

        var schemaObj = schema.AsObject();
        
        // Check root schema structure
        schemaObj["$schema"]!.GetValue<string>().Should().Be("https://json-structure.org/meta/core/v1.0");
        schemaObj["type"]!.GetValue<string>().Should().Be("object");
        schemaObj["title"]!.GetValue<string>().Should().Be("ClassWithEnum");
        
        var props = schemaObj["properties"]!.AsObject();
        props.Count.Should().Be(1);
        
        var statusProp = props["Status"]!.AsObject();
        statusProp["type"]!.GetValue<string>().Should().Be("string");
        statusProp["title"]!.GetValue<string>().Should().Be("Status");
        statusProp["enum"].Should().NotBeNull();
        
        var enumValues = statusProp["enum"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        enumValues.Should().HaveCount(3);
        enumValues.Should().ContainInOrder("Active", "Inactive", "Pending");
        
        // Verify required
        var required = schemaObj["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        required.Should().ContainSingle().Which.Should().Be("Status");
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_List_GeneratesArraySchema()
    {
        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithList>();

        var schemaObj = schema.AsObject();
        
        // Check root schema structure
        schemaObj["$schema"]!.GetValue<string>().Should().Be("https://json-structure.org/meta/core/v1.0");
        schemaObj["type"]!.GetValue<string>().Should().Be("object");
        schemaObj["title"]!.GetValue<string>().Should().Be("ClassWithList");
        
        var props = schemaObj["properties"]!.AsObject();
        props.Count.Should().Be(1);
        
        var itemsProp = props["Items"]!.AsObject();
        itemsProp["type"]!.GetValue<string>().Should().Be("array");
        itemsProp["title"]!.GetValue<string>().Should().Be("List<String>");
        itemsProp["items"].Should().NotBeNull();
        
        var itemsSchema = itemsProp["items"]!.AsObject();
        itemsSchema["type"]!.GetValue<string>().Should().Be("string");
        itemsSchema["title"]!.GetValue<string>().Should().Be("String");
        
        // Verify required
        var required = schemaObj["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        required.Should().ContainSingle().Which.Should().Be("Items");
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_Dictionary_GeneratesMapSchema()
    {
        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithDictionary>();

        var schemaObj = schema.AsObject();
        
        // Check root schema structure
        schemaObj["$schema"]!.GetValue<string>().Should().Be("https://json-structure.org/meta/core/v1.0");
        schemaObj["type"]!.GetValue<string>().Should().Be("object");
        schemaObj["title"]!.GetValue<string>().Should().Be("ClassWithDictionary");
        
        var props = schemaObj["properties"]!.AsObject();
        props.Count.Should().Be(1);
        
        var dataProp = props["Data"]!.AsObject();
        dataProp["type"]!.GetValue<string>().Should().Be("map");
        dataProp["title"]!.GetValue<string>().Should().Be("Dictionary<String, Int32>");
        dataProp["values"].Should().NotBeNull();
        
        var valuesSchema = dataProp["values"]!.AsObject();
        valuesSchema["type"]!.GetValue<string>().Should().Be("int32");
        valuesSchema["title"]!.GetValue<string>().Should().Be("Int32");
        
        // Verify required
        var required = schemaObj["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        required.Should().ContainSingle().Which.Should().Be("Data");
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_HashSet_GeneratesSetSchema()
    {
        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithHashSet>();

        var schemaObj = schema.AsObject();
        
        // Check root schema structure
        schemaObj["$schema"]!.GetValue<string>().Should().Be("https://json-structure.org/meta/core/v1.0");
        schemaObj["type"]!.GetValue<string>().Should().Be("object");
        schemaObj["title"]!.GetValue<string>().Should().Be("ClassWithHashSet");
        
        var props = schemaObj["properties"]!.AsObject();
        props.Count.Should().Be(1);
        
        var tagsProp = props["Tags"]!.AsObject();
        tagsProp["type"]!.GetValue<string>().Should().Be("set");
        tagsProp["title"]!.GetValue<string>().Should().Be("HashSet<String>");
        tagsProp["items"].Should().NotBeNull();
        
        var itemsSchema = tagsProp["items"]!.AsObject();
        itemsSchema["type"]!.GetValue<string>().Should().Be("string");
        itemsSchema["title"]!.GetValue<string>().Should().Be("String");
        
        // Verify required
        var required = schemaObj["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        required.Should().ContainSingle().Which.Should().Be("Tags");
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_RequiredAttribute_AddsToRequired()
    {
        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithRequired>();

        var schemaObj = schema.AsObject();
        
        // Check root schema structure
        schemaObj["$schema"]!.GetValue<string>().Should().Be("https://json-structure.org/meta/core/v1.0");
        schemaObj["type"]!.GetValue<string>().Should().Be("object");
        schemaObj["title"]!.GetValue<string>().Should().Be("ClassWithRequired");
        
        var props = schemaObj["properties"]!.AsObject();
        props.Count.Should().Be(2);
        
        // Check Name property
        props["Name"]!.AsObject()["type"]!.GetValue<string>().Should().Be("string");
        
        // Check OptionalField property
        props["OptionalField"]!.AsObject()["type"]!.GetValue<string>().Should().Be("string");
        
        // Verify only Name is required (has [Required] attribute), OptionalField is nullable
        var required = schemaObj["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        required.Should().ContainSingle().Which.Should().Be("Name");
        required.Should().NotContain("OptionalField");
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
        schemaObj["$schema"]!.GetValue<string>().Should().Be("https://json-structure.org/meta/core/v1.0");
        schemaObj["type"]!.GetValue<string>().Should().Be("object");
        schemaObj["title"]!.GetValue<string>().Should().Be("ClassWithDescription");
        schemaObj["description"]!.GetValue<string>().Should().Be("This is a test class");
        
        var props = schemaObj["properties"]!.AsObject();
        props.Count.Should().Be(1);
        props["Value"]!.AsObject()["type"]!.GetValue<string>().Should().Be("string");
        
        // Verify required
        var required = schemaObj["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        required.Should().ContainSingle().Which.Should().Be("Value");
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
        schemaObj["$schema"]!.GetValue<string>().Should().Be("https://json-structure.org/meta/core/v1.0");
        schemaObj["type"]!.GetValue<string>().Should().Be("object");
        schemaObj["title"]!.GetValue<string>().Should().Be("ClassWithJsonPropertyName");
        
        var props = schemaObj["properties"]!.AsObject();
        props.Count.Should().Be(1);
        
        // Should use explicit JsonPropertyName, not camelCase of property name
        props.ContainsKey("custom_name").Should().BeTrue();
        props.ContainsKey("customProperty").Should().BeFalse();
        props.ContainsKey("CustomProperty").Should().BeFalse();
        
        props["custom_name"]!.AsObject()["type"]!.GetValue<string>().Should().Be("string");
        
        // Verify required uses the JSON name
        var required = schemaObj["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        required.Should().ContainSingle().Which.Should().Be("custom_name");
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
        transformCalled.Should().BeTrue();
        
        // Check transformed properties
        schemaObj["$id"]!.GetValue<string>().Should().Be("https://example.com/schema");
        schemaObj["customProperty"]!.GetValue<string>().Should().Be("customValue");
        
        // Check original properties still exist
        schemaObj["$schema"]!.GetValue<string>().Should().Be("https://json-structure.org/meta/core/v1.0");
        schemaObj["type"]!.GetValue<string>().Should().Be("object");
        schemaObj["title"]!.GetValue<string>().Should().Be("SimpleClass");
        schemaObj["properties"].Should().NotBeNull();
        schemaObj["required"].Should().NotBeNull();
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_Int128_MapsCorrectly()
    {
        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithLargeIntegers>();

        var schemaObj = schema.AsObject();
        
        // Check root schema structure
        schemaObj["$schema"]!.GetValue<string>().Should().Be("https://json-structure.org/meta/core/v1.0");
        schemaObj["type"]!.GetValue<string>().Should().Be("object");
        schemaObj["title"]!.GetValue<string>().Should().Be("ClassWithLargeIntegers");
        
        var props = schemaObj["properties"]!.AsObject();
        props.Count.Should().Be(2);
        
        props["BigInt"]!.AsObject()["type"]!.GetValue<string>().Should().Be("int128");
        props["BigInt"]!.AsObject()["title"]!.GetValue<string>().Should().Be("Int128");
        
        props["BigUInt"]!.AsObject()["type"]!.GetValue<string>().Should().Be("uint128");
        props["BigUInt"]!.AsObject()["title"]!.GetValue<string>().Should().Be("UInt128");
        
        // Verify required
        var required = schemaObj["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        required.Should().HaveCount(2);
        required.Should().Contain("BigInt");
        required.Should().Contain("BigUInt");
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_WithRangeAttribute_IncludesMinMax()
    {
        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithRange>();

        var schemaObj = schema.AsObject();
        
        // Check root schema structure
        schemaObj["$schema"]!.GetValue<string>().Should().Be("https://json-structure.org/meta/core/v1.0");
        schemaObj["type"]!.GetValue<string>().Should().Be("object");
        schemaObj["title"]!.GetValue<string>().Should().Be("ClassWithRange");
        
        var props = schemaObj["properties"]!.AsObject();
        props.Count.Should().Be(1);
        
        var valueProp = props["Value"]!.AsObject();
        valueProp["type"]!.GetValue<string>().Should().Be("int32");
        valueProp["title"]!.GetValue<string>().Should().Be("Int32");
        valueProp["minimum"]!.GetValue<double>().Should().Be(0);
        valueProp["maximum"]!.GetValue<double>().Should().Be(100);
        
        // Verify required
        var required = schemaObj["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        required.Should().ContainSingle().Which.Should().Be("Value");
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_WithStringLength_IncludesLengthConstraints()
    {
        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithStringLength>();

        var schemaObj = schema.AsObject();
        
        // Check root schema structure
        schemaObj["$schema"]!.GetValue<string>().Should().Be("https://json-structure.org/meta/core/v1.0");
        schemaObj["type"]!.GetValue<string>().Should().Be("object");
        schemaObj["title"]!.GetValue<string>().Should().Be("ClassWithStringLength");
        
        var props = schemaObj["properties"]!.AsObject();
        props.Count.Should().Be(1);
        
        var nameProp = props["Name"]!.AsObject();
        nameProp["type"]!.GetValue<string>().Should().Be("string");
        nameProp["title"]!.GetValue<string>().Should().Be("String");
        nameProp["minLength"]!.GetValue<int>().Should().Be(1);
        nameProp["maxLength"]!.GetValue<int>().Should().Be(50);
        
        // Verify required
        var required = schemaObj["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        required.Should().ContainSingle().Which.Should().Be("Name");
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_WithRegex_IncludesPattern()
    {
        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithRegex>();

        var schemaObj = schema.AsObject();
        
        // Check root schema structure
        schemaObj["$schema"]!.GetValue<string>().Should().Be("https://json-structure.org/meta/core/v1.0");
        schemaObj["type"]!.GetValue<string>().Should().Be("object");
        schemaObj["title"]!.GetValue<string>().Should().Be("ClassWithRegex");
        
        var props = schemaObj["properties"]!.AsObject();
        props.Count.Should().Be(1);
        
        var emailProp = props["Email"]!.AsObject();
        emailProp["type"]!.GetValue<string>().Should().Be("string");
        emailProp["title"]!.GetValue<string>().Should().Be("String");
        emailProp["pattern"].Should().NotBeNull();
        emailProp["pattern"]!.GetValue<string>().Should().Be(@"^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$");
        
        // Verify required
        var required = schemaObj["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        required.Should().ContainSingle().Which.Should().Be("Email");
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_WithObsolete_MarksDeprecated()
    {
        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithObsolete>();

        var schemaObj = schema.AsObject();
        
        // Check root schema structure
        schemaObj["$schema"]!.GetValue<string>().Should().Be("https://json-structure.org/meta/core/v1.0");
        schemaObj["type"]!.GetValue<string>().Should().Be("object");
        schemaObj["title"]!.GetValue<string>().Should().Be("ClassWithObsolete");
        
        var props = schemaObj["properties"]!.AsObject();
        props.Count.Should().Be(2);
        
        var oldProp = props["OldProperty"]!.AsObject();
        oldProp["type"]!.GetValue<string>().Should().Be("string");
        oldProp["deprecated"]!.GetValue<bool>().Should().BeTrue();
        
        var newProp = props["NewProperty"]!.AsObject();
        newProp["type"]!.GetValue<string>().Should().Be("string");
        newProp.ContainsKey("deprecated").Should().BeFalse();
        
        // Verify required
        var required = schemaObj["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        required.Should().HaveCount(2);
        required.Should().Contain("OldProperty");
        required.Should().Contain("NewProperty");
    }

    [Fact]
    public void GetJsonStructureSchemaAsNode_ExcludesJsonIgnore()
    {
        var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<ClassWithIgnore>();

        var schemaObj = schema.AsObject();
        
        // Check root schema structure
        schemaObj["$schema"]!.GetValue<string>().Should().Be("https://json-structure.org/meta/core/v1.0");
        schemaObj["type"]!.GetValue<string>().Should().Be("object");
        schemaObj["title"]!.GetValue<string>().Should().Be("ClassWithIgnore");
        
        var props = schemaObj["properties"]!.AsObject();
        props.Count.Should().Be(1); // Only IncludedProp, not IgnoredProp
        
        props.ContainsKey("IgnoredProp").Should().BeFalse();
        props.ContainsKey("IncludedProp").Should().BeTrue();
        props["IncludedProp"]!.AsObject()["type"]!.GetValue<string>().Should().Be("string");
        
        // Verify required only contains the included property
        var required = schemaObj["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        required.Should().ContainSingle().Which.Should().Be("IncludedProp");
        required.Should().NotContain("IgnoredProp");
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
        schemaObj["$schema"]!.GetValue<string>().Should().Be("https://json-structure.org/meta/core/v1.0");
        schemaObj["type"]!.GetValue<string>().Should().Be("object");
        schemaObj["title"]!.GetValue<string>().Should().Be("SimpleClass");
        
        var props = schemaObj["properties"]!.AsObject();
        props.Count.Should().Be(2);
        
        // Property names should be camelCase
        props.ContainsKey("name").Should().BeTrue();
        props.ContainsKey("Name").Should().BeFalse();
        props["name"]!.AsObject()["type"]!.GetValue<string>().Should().Be("string");
        
        props.ContainsKey("age").Should().BeTrue();
        props.ContainsKey("Age").Should().BeFalse();
        props["age"]!.AsObject()["type"]!.GetValue<string>().Should().Be("int32");
        
        // Verify required uses camelCase names
        var required = schemaObj["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        required.Should().HaveCount(2);
        required.Should().Contain("name");
        required.Should().Contain("age");
        required.Should().NotContain("Name");
        required.Should().NotContain("Age");
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

    private class ClassWithObsolete
    {
        [Obsolete("Use NewProperty instead")]
        public string OldProperty { get; set; } = "";

        public string NewProperty { get; set; } = "";
    }

    private class ClassWithIgnore
    {
        [System.Text.Json.Serialization.JsonIgnore]
        public string IgnoredProp { get; set; } = "";

        public string IncludedProp { get; set; } = "";
    }
}
