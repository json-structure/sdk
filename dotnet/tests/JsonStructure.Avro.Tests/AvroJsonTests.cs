using System.Text.Json.Nodes;
using Avro;
using Shouldly;
using Xunit;

namespace JsonStructure.Avro.Tests;

/// <summary>
/// The error paths of the Plain JSON decoder.
/// </summary>
/// <remarks>
/// The corpus only carries instances that are meant to decode, so it exercises
/// none of the decoder's guards: mutating any of them away leaves the corpus
/// green. These tests hold those guards, and each one corresponds to a mutation
/// the corpus was measured against and failed to catch.
/// </remarks>
public class AvroJsonTests
{
    private static string Rejects(string schema, string json)
    {
        var thrown = Should.Throw<InvalidOperationException>(
            () => AvroJson.Decode(Schema.Parse(schema), JsonNode.Parse(json)));
        return thrown.Message;
    }

    /// <summary>
    /// Two branches of the same shape are a decoding failure, not a race.
    /// </summary>
    /// <remarks>
    /// Plain JSON resolves a union by structure, so a union whose branches are
    /// not structurally distinguishable cannot be decoded by anybody. Taking the
    /// first match would hand back a plausible wrong answer instead of saying so.
    /// </remarks>
    [Fact]
    public void RefusesAUnionWhoseBranchesAreIndistinguishable()
    {
        Rejects(
            """
            ["null",
             {"type": "record", "name": "A", "fields": [{"name": "x", "type": "int"}]},
             {"type": "record", "name": "B", "fields": [{"name": "x", "type": "int"}]}]
            """,
            """{"x": 1}""")
        .ShouldContain("ambiguous union");
    }

    /// <summary>An unambiguous union still resolves.</summary>
    /// <remarks>
    /// Without this, the test above is satisfied by a decoder that rejects every
    /// union.
    /// </remarks>
    [Fact]
    public void ResolvesAUnionWhoseBranchesDiffer()
    {
        var schema = Schema.Parse(
            """
            ["null",
             {"type": "record", "name": "A", "fields": [{"name": "x", "type": "int"}]},
             {"type": "record", "name": "B", "fields": [{"name": "y", "type": "int"}]}]
            """);

        AvroJson.Decode(schema, JsonNode.Parse("""{"y": 1}""")).ShouldNotBeNull();
        AvroJson.Decode(schema, null).ShouldBeNull();
    }

    /// <summary>
    /// Only a field that can hold null may be left out.
    /// </summary>
    /// <remarks>
    /// Feature 5 lets a producer drop a null-valued property. Read too loosely,
    /// that turns every absent required field into a silent null and Avro then
    /// writes a record the schema does not describe.
    /// </remarks>
    [Fact]
    public void RefusesAnOmittedFieldThatCannotHoldNull()
    {
        Rejects(
            """{"type": "record", "name": "R", "fields": [{"name": "x", "type": "int"}]}""",
            "{}")
        .ShouldContain("missing field 'x'");
    }

    [Fact]
    public void AcceptsAnOmittedFieldThatCanHoldNull()
    {
        var schema = Schema.Parse(
            """
            {"type": "record", "name": "R",
             "fields": [{"name": "x", "type": ["null", "int"]}]}
            """);

        AvroJson.Decode(schema, JsonNode.Parse("{}")).ShouldNotBeNull();
    }

    /// <summary>
    /// A decimal carrying more precision than the schema declares is rejected.
    /// </summary>
    /// <remarks>
    /// Avro stores a decimal as an unscaled integer at a fixed scale, so an extra
    /// fraction digit has nowhere to go. Rounding it away would lose money
    /// quietly, which is the one thing a decimal type exists to prevent.
    /// </remarks>
    [Fact]
    public void RefusesADecimalFinerThanItsScale()
    {
        Rejects(
            """{"type": "bytes", "logicalType": "decimal", "precision": 9, "scale": 2}""",
            "\"1.234\"")
        .ShouldContain("more than the schema's scale");
    }

    [Fact]
    public void AcceptsADecimalWithinItsScale()
    {
        var schema = Schema.Parse(
            """{"type": "bytes", "logicalType": "decimal", "precision": 9, "scale": 2}""");

        AvroJson.Decode(schema, JsonNode.Parse("\"-1.2\"")).ShouldNotBeNull();
    }

    /// <summary>A long must be quoted, and bytes must be base64.</summary>
    /// <remarks>
    /// Both are places where Plain JSON deliberately departs from what a reader
    /// might assume, so both are places a lenient decoder would paper over a
    /// producer that got it wrong.
    /// </remarks>
    [Fact]
    public void RefusesAnUnquotedLongAndUnencodedBytes()
    {
        Rejects("\"long\"", "5000000000").ShouldContain("a long as a quoted number");
        Rejects("\"bytes\"", "\"not base64!\"").ShouldContain("base64 bytes");
    }
}
