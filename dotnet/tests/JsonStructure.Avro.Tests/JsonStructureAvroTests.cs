using System.Text.Json.Nodes;
using Avro;
using Avro.Generic;
using Avro.IO;
using Shouldly;
using Xunit;

namespace JsonStructure.Avro.Tests;

/// <summary>
/// The public seam, exercised the way the README tells people to use it.
/// </summary>
/// <remarks>
/// The corpus tests go through <see cref="AvroCompiler"/> directly, which leaves
/// the entry points an application actually calls — the string, node and file
/// overloads — covered only by inference. A documented example that no longer
/// compiles is worse than no example.
/// </remarks>
public sealed class JsonStructureAvroTests
{
    private const string Person = """
        {
          "$schema": "https://json-structure.org/meta/core/v0/#",
          "$id": "https://example.com/person",
          "name": "Person",
          "type": "object",
          "properties": {
            "name": { "type": "string" },
            "age": { "type": "int32" }
          },
          "required": ["name", "age"]
        }
        """;

    [Fact]
    public void CompilesFromAString()
    {
        var schema = (RecordSchema)JsonStructureAvro.SchemaFrom(Person);

        schema.Name.ShouldBe("Person");
        schema.Fields.Select(f => f.Name).ShouldBe(["name", "age"]);
    }

    [Fact]
    public void CompilesFromAParsedDocument()
    {
        var schema = JsonStructureAvro.SchemaFrom(JsonNode.Parse(Person)!);
        schema.ShouldBe(JsonStructureAvro.SchemaFrom(Person));
    }

    [Fact]
    public void CompilesFromAFile()
    {
        var path = Path.Combine(Path.GetTempPath(), $"person-{Guid.NewGuid():N}.struct.json");
        File.WriteAllText(path, Person);
        try
        {
            JsonStructureAvro.SchemaFromFile(path).ShouldBe(JsonStructureAvro.SchemaFrom(Person));
        }
        finally
        {
            File.Delete(path);
        }
    }

    /// <summary>
    /// The README's opening example, run rather than merely displayed.
    /// </summary>
    [Fact]
    public void WritesAndReadsARecordThroughTheCompiledSchema()
    {
        var schema = (RecordSchema)JsonStructureAvro.SchemaFrom(Person);

        var person = new GenericRecord(schema);
        person.Add("name", "Alice");
        person.Add("age", 42);

        using var stream = new MemoryStream();
        new GenericDatumWriter<GenericRecord>(schema).Write(person, new BinaryEncoder(stream));

        var bytes = stream.ToArray();
        bytes.ShouldNotBeEmpty();

        var readBack = (GenericRecord)new GenericDatumReader<object>(schema, schema)
            .Read(null!, new BinaryDecoder(new MemoryStream(bytes)));

        readBack["name"].ShouldBe("Alice");
        readBack["age"].ShouldBe(42);
    }

    [Fact]
    public void ReportsTheOffendingPointerWhenTheDocumentCannotBeMapped()
    {
        var thrown = Should.Throw<AvroCompileException>(() => JsonStructureAvro.SchemaFrom("""
            {
              "$schema": "https://json-structure.org/meta/core/v0/#",
              "$id": "https://example.com/broken",
              "name": "Broken",
              "type": "object",
              "properties": {
                "who": { "type": { "$ref": "#/definitions/Nobody" } }
              },
              "required": ["who"]
            }
            """));

        thrown.Kind.ShouldBe(AvroErrorKind.UnresolvedRef);
        thrown.Path.ShouldNotBeNull();
    }

    /// <summary>
    /// Losing something in the mapping is reported, not swallowed.
    /// </summary>
    [Fact]
    public void WarnsWhereTheMappingLosesSomething()
    {
        var result = AvroCompiler.Compile(JsonNode.Parse("""
            {
              "$schema": "https://json-structure.org/meta/core/v0/#",
              "$id": "https://example.com/tags",
              "name": "Tagged",
              "type": "object",
              "properties": {
                "tags": { "type": "set", "items": { "type": "string" } }
              },
              "required": ["tags"]
            }
            """)!);

        // Avro has no set type, so uniqueness stops being enforced by the schema.
        result.Warnings.ShouldNotBeEmpty();
        result.Warnings[0].ToString().ShouldContain("#/properties/tags");
    }

    /// <summary>
    /// A semantic annotation that names properties is dropped, in both modes.
    /// </summary>
    /// <remarks>
    /// A corpus case pins this in <c>full</c> mode. The claim is that the
    /// warning does not depend on the mode, and a corpus case cannot say that:
    /// it carries one options file.
    /// </remarks>
    [Theory]
    [InlineData(AvroMode.Compact)]
    [InlineData(AvroMode.Full)]
    public void DropsANameBindingAnnotationWithAWarningInBothModes(AvroMode mode)
    {
        var result = AvroCompiler.Compile(
            JsonNode.Parse("""
                {
                  "$schema": "https://json-structure.org/meta/core/v0/#",
                  "$id": "https://example.com/track",
                  "name": "Track",
                  "type": "object",
                  "coordinateReferenceSystem": {
                    "reference": "http://www.opengis.net/def/crs/EPSG/0/4326",
                    "kind": "epsg",
                    "coordinates": ["lat", "lon"]
                  },
                  "properties": {
                    "lat": { "type": "double" },
                    "lon": { "type": "double" }
                  },
                  "required": ["lat", "lon"]
                }
                """)!,
            new AvroOptions { Mode = mode });

        result.Warnings.ShouldContain(w => w.ToString().Contains("coordinateReferenceSystem"));
        result.Schema["annotations"].ShouldBeNull();
    }

    /// <summary>
    /// The warning list and the emission list must not overlap, or every
    /// annotated schema would produce noise.
    /// </summary>
    [Fact]
    public void DoesNotWarnAboutAnAnnotationItCarries()
    {
        var result = AvroCompiler.Compile(
            JsonNode.Parse("""
                {
                  "$schema": "https://json-structure.org/meta/core/v0/#",
                  "$id": "https://example.com/reading",
                  "$uses": ["JSONStructureUnits"],
                  "name": "Reading",
                  "type": "object",
                  "properties": { "distance": { "type": "double", "unit": "m" } },
                  "required": ["distance"]
                }
                """)!,
            new AvroOptions { Mode = AvroMode.Full });

        result.Warnings.ShouldBeEmpty();
        result.Schema["fields"]![0]!["annotations"]!["unit"]!.ToString().ShouldBe("m");
    }

    [Fact]
    public void RejectsANullSource()
    {
        Should.Throw<ArgumentNullException>(() => JsonStructureAvro.SchemaFrom((string)null!));
    }
}
