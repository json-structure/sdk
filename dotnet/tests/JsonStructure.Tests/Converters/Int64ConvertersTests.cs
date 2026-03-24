// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using Shouldly;
using JsonStructure.Converters;
using Xunit;

namespace JsonStructure.Tests.Converters;

public class Int64ConvertersTests
{
    private readonly JsonSerializerOptions _options;

    public Int64ConvertersTests()
    {
        _options = new JsonSerializerOptions();
        _options.Converters.Add(new Int64StringConverter());
        _options.Converters.Add(new NullableInt64StringConverter());
        _options.Converters.Add(new UInt64StringConverter());
        _options.Converters.Add(new NullableUInt64StringConverter());
    }

    [Fact]
    public void Int64StringConverter_SerializesToString()
    {
        var value = 9007199254740993L; // Beyond JavaScript safe integer
        var json = JsonSerializer.Serialize(value, _options);
        json.ShouldBe("\"9007199254740993\"");
    }

    [Fact]
    public void Int64StringConverter_DeserializesFromString()
    {
        var json = "\"9007199254740993\"";
        var value = JsonSerializer.Deserialize<long>(json, _options);
        value.ShouldBe(9007199254740993L);
    }

    [Fact]
    public void Int64StringConverter_HandlesNegativeNumbers()
    {
        var value = -9007199254740993L;
        var json = JsonSerializer.Serialize(value, _options);
        json.ShouldBe("\"-9007199254740993\"");

        var deserialized = JsonSerializer.Deserialize<long>(json, _options);
        deserialized.ShouldBe(value);
    }

    [Fact]
    public void Int64StringConverter_HandlesMinMaxValues()
    {
        var minJson = JsonSerializer.Serialize(long.MinValue, _options);
        var maxJson = JsonSerializer.Serialize(long.MaxValue, _options);

        JsonSerializer.Deserialize<long>(minJson, _options).ShouldBe(long.MinValue);
        JsonSerializer.Deserialize<long>(maxJson, _options).ShouldBe(long.MaxValue);
    }

    [Fact]
    public void NullableInt64StringConverter_HandlesNull()
    {
        long? value = null;
        var json = JsonSerializer.Serialize(value, _options);
        json.ShouldBe("null");

        var deserialized = JsonSerializer.Deserialize<long?>(json, _options);
        deserialized.ShouldBeNull();
    }

    [Fact]
    public void NullableInt64StringConverter_HandlesValue()
    {
        long? value = 12345L;
        var json = JsonSerializer.Serialize(value, _options);
        json.ShouldBe("\"12345\"");

        var deserialized = JsonSerializer.Deserialize<long?>(json, _options);
        deserialized.ShouldBe(12345L);
    }

    [Fact]
    public void UInt64StringConverter_SerializesToString()
    {
        var value = 18446744073709551615UL; // Max UInt64
        var json = JsonSerializer.Serialize(value, _options);
        json.ShouldBe("\"18446744073709551615\"");
    }

    [Fact]
    public void UInt64StringConverter_DeserializesFromString()
    {
        var json = "\"18446744073709551615\"";
        var value = JsonSerializer.Deserialize<ulong>(json, _options);
        value.ShouldBe(18446744073709551615UL);
    }

    [Fact]
    public void NullableUInt64StringConverter_HandlesNull()
    {
        ulong? value = null;
        var json = JsonSerializer.Serialize(value, _options);
        json.ShouldBe("null");

        var deserialized = JsonSerializer.Deserialize<ulong?>(json, _options);
        deserialized.ShouldBeNull();
    }

    [Fact]
    public void Int64StringConverter_ThrowsOnInvalidString()
    {
        var json = "\"not-a-number\"";
        Action act = () => JsonSerializer.Deserialize<long>(json, _options);
        Should.Throw<JsonException>(act);
    }
}
