// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using Shouldly;
using JsonStructure.Converters;
using Xunit;

namespace JsonStructure.Tests.Converters;

public class BigIntegerConvertersTests
{
    private readonly JsonSerializerOptions _options;

    public BigIntegerConvertersTests()
    {
        _options = new JsonSerializerOptions();
        _options.Converters.Add(new Int128StringConverter());
        _options.Converters.Add(new NullableInt128StringConverter());
        _options.Converters.Add(new UInt128StringConverter());
        _options.Converters.Add(new NullableUInt128StringConverter());
    }

    [Fact]
    public void Int128StringConverter_SerializesToString()
    {
        Int128 value = Int128.MaxValue;
        var json = JsonSerializer.Serialize(value, _options);
        json.ShouldBe($"\"{Int128.MaxValue}\"");
    }

    [Fact]
    public void Int128StringConverter_DeserializesFromString()
    {
        var json = $"\"{Int128.MaxValue}\"";
        var value = JsonSerializer.Deserialize<Int128>(json, _options);
        value.ShouldBe(Int128.MaxValue);
    }

    [Fact]
    public void Int128StringConverter_HandlesNegativeNumbers()
    {
        Int128 value = Int128.MinValue;
        var json = JsonSerializer.Serialize(value, _options);
        var deserialized = JsonSerializer.Deserialize<Int128>(json, _options);
        deserialized.ShouldBe(value);
    }

    [Fact]
    public void NullableInt128StringConverter_HandlesNull()
    {
        Int128? value = null;
        var json = JsonSerializer.Serialize(value, _options);
        json.ShouldBe("null");

        var deserialized = JsonSerializer.Deserialize<Int128?>(json, _options);
        deserialized.ShouldBeNull();
    }

    [Fact]
    public void UInt128StringConverter_SerializesToString()
    {
        UInt128 value = UInt128.MaxValue;
        var json = JsonSerializer.Serialize(value, _options);
        json.ShouldBe($"\"{UInt128.MaxValue}\"");
    }

    [Fact]
    public void UInt128StringConverter_DeserializesFromString()
    {
        var json = $"\"{UInt128.MaxValue}\"";
        var value = JsonSerializer.Deserialize<UInt128>(json, _options);
        value.ShouldBe(UInt128.MaxValue);
    }

    [Fact]
    public void NullableUInt128StringConverter_HandlesNull()
    {
        UInt128? value = null;
        var json = JsonSerializer.Serialize(value, _options);
        json.ShouldBe("null");

        var deserialized = JsonSerializer.Deserialize<UInt128?>(json, _options);
        deserialized.ShouldBeNull();
    }

    [Fact]
    public void Int128StringConverter_ThrowsOnInvalidString()
    {
        var json = "\"not-a-number\"";
        Action act = () => JsonSerializer.Deserialize<Int128>(json, _options);
        Should.Throw<JsonException>(act);
    }
}
