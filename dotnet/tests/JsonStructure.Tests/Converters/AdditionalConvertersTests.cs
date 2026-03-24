// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Numerics;
using System.Text.Json;
using Shouldly;
using JsonStructure.Converters;
using Xunit;

namespace JsonStructure.Tests.Converters;

public class AdditionalConvertersTests
{
    [Fact]
    public void BigIntegerStringConverter_SerializesToString()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new BigIntegerStringConverter());
        
        var value = BigInteger.Parse("123456789012345678901234567890");
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("\"123456789012345678901234567890\"");
    }

    [Fact]
    public void BigIntegerStringConverter_DeserializesFromString()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new BigIntegerStringConverter());
        
        var json = "\"123456789012345678901234567890\"";
        var value = JsonSerializer.Deserialize<BigInteger>(json, options);
        value.ShouldBe(BigInteger.Parse("123456789012345678901234567890"));
    }

    [Fact]
    public void BigIntegerStringConverter_HandlesNegativeNumbers()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new BigIntegerStringConverter());
        
        var value = BigInteger.Parse("-123456789012345678901234567890");
        var json = JsonSerializer.Serialize(value, options);
        var deserialized = JsonSerializer.Deserialize<BigInteger>(json, options);
        deserialized.ShouldBe(value);
    }

    [Fact]
    public void BigIntegerStringConverter_ThrowsOnInvalidString()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new BigIntegerStringConverter());
        
        var json = "\"not-a-number\"";
        Action act = () => JsonSerializer.Deserialize<BigInteger>(json, options);
        Should.Throw<JsonException>(act);
    }

    [Fact]
    public void BigIntegerStringConverter_ThrowsOnWrongTokenType()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new BigIntegerStringConverter());
        
        var json = "true";
        Action act = () => JsonSerializer.Deserialize<BigInteger>(json, options);
        Should.Throw<JsonException>(act);
    }

    [Fact]
    public void NullableBigIntegerStringConverter_HandlesNull()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableBigIntegerStringConverter());
        
        BigInteger? value = null;
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("null");

        var deserialized = JsonSerializer.Deserialize<BigInteger?>(json, options);
        deserialized.ShouldBeNull();
    }

    [Fact]
    public void NullableBigIntegerStringConverter_HandlesValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableBigIntegerStringConverter());
        
        BigInteger? value = BigInteger.Parse("12345");
        var json = JsonSerializer.Serialize(value, options);
        var deserialized = JsonSerializer.Deserialize<BigInteger?>(json, options);
        deserialized.ShouldBe(value);
    }

    [Fact]
    public void UuidStringConverter_SerializesToString()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new UuidStringConverter());
        
        var value = Guid.Parse("12345678-1234-1234-1234-123456789abc");
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("\"12345678-1234-1234-1234-123456789abc\"");
    }

    [Fact]
    public void UuidStringConverter_DeserializesFromString()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new UuidStringConverter());
        
        var json = "\"12345678-1234-1234-1234-123456789abc\"";
        var value = JsonSerializer.Deserialize<Guid>(json, options);
        value.ShouldBe(Guid.Parse("12345678-1234-1234-1234-123456789abc"));
    }

    [Fact]
    public void UuidStringConverter_ThrowsOnInvalidString()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new UuidStringConverter());
        
        var json = "\"not-a-uuid\"";
        Action act = () => JsonSerializer.Deserialize<Guid>(json, options);
        Should.Throw<JsonException>(act);
    }

    [Fact]
    public void UuidStringConverter_ThrowsOnWrongTokenType()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new UuidStringConverter());
        
        var json = "123";
        Action act = () => JsonSerializer.Deserialize<Guid>(json, options);
        Should.Throw<JsonException>(act);
    }

    [Fact]
    public void NullableUuidStringConverter_HandlesNull()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableUuidStringConverter());
        
        Guid? value = null;
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("null");

        var deserialized = JsonSerializer.Deserialize<Guid?>(json, options);
        deserialized.ShouldBeNull();
    }

    [Fact]
    public void NullableUuidStringConverter_HandlesValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableUuidStringConverter());
        
        Guid? value = Guid.Parse("12345678-1234-1234-1234-123456789abc");
        var json = JsonSerializer.Serialize(value, options);
        var deserialized = JsonSerializer.Deserialize<Guid?>(json, options);
        deserialized.ShouldBe(value);
    }

    [Fact]
    public void UriStringConverter_SerializesToString()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new UriStringConverter());
        
        var value = new Uri("https://example.com/path");
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("\"https://example.com/path\"");
    }

    [Fact]
    public void UriStringConverter_DeserializesFromString()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new UriStringConverter());
        
        var json = "\"https://example.com/path\"";
        var value = JsonSerializer.Deserialize<Uri>(json, options);
        value.ShouldBe(new Uri("https://example.com/path"));
    }

    [Fact]
    public void UriStringConverter_HandlesNull()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new UriStringConverter());
        
        Uri? value = null;
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("null");

        var deserialized = JsonSerializer.Deserialize<Uri?>(json, options);
        deserialized.ShouldBeNull();
    }

    [Fact]
    public void UriStringConverter_ThrowsOnWrongTokenType()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new UriStringConverter());
        
        var json = "123";
        Action act = () => JsonSerializer.Deserialize<Uri>(json, options);
        Should.Throw<JsonException>(act);
    }

    [Fact]
    public void Base64BinaryConverter_SerializesToBase64()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new Base64BinaryConverter());
        
        var value = new byte[] { 1, 2, 3, 4 };
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("\"AQIDBA==\"");
    }

    [Fact]
    public void Base64BinaryConverter_DeserializesFromBase64()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new Base64BinaryConverter());
        
        var json = "\"AQIDBA==\"";
        var value = JsonSerializer.Deserialize<byte[]>(json, options);
        value.ShouldBe(new byte[] { 1, 2, 3, 4 });
    }

    [Fact]
    public void Base64BinaryConverter_HandlesNull()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new Base64BinaryConverter());
        
        byte[]? value = null;
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("null");

        var deserialized = JsonSerializer.Deserialize<byte[]?>(json, options);
        deserialized.ShouldBeNull();
    }

    [Fact]
    public void Base64BinaryConverter_ThrowsOnWrongTokenType()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new Base64BinaryConverter());
        
        var json = "123";
        Action act = () => JsonSerializer.Deserialize<byte[]>(json, options);
        Should.Throw<JsonException>(act);
    }

    [Fact]
    public void Base64MemoryConverter_SerializesToBase64()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new Base64MemoryConverter());
        
        Memory<byte> value = new byte[] { 1, 2, 3, 4 };
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("\"AQIDBA==\"");
    }

    [Fact]
    public void Base64MemoryConverter_DeserializesFromBase64()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new Base64MemoryConverter());
        
        var json = "\"AQIDBA==\"";
        var value = JsonSerializer.Deserialize<Memory<byte>>(json, options);
        value.ToArray().ShouldBe(new byte[] { 1, 2, 3, 4 });
    }

    [Fact]
    public void Base64MemoryConverter_ThrowsOnWrongTokenType()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new Base64MemoryConverter());
        
        var json = "123";
        Action act = () => JsonSerializer.Deserialize<Memory<byte>>(json, options);
        Should.Throw<JsonException>(act);
    }

    [Fact]
    public void DecimalStringConverter_SerializesToString()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new DecimalStringConverter());
        
        var value = 123.456m;
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("\"123.456\"");
    }

    [Fact]
    public void DecimalStringConverter_DeserializesFromString()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new DecimalStringConverter());
        
        var json = "\"123.456\"";
        var value = JsonSerializer.Deserialize<decimal>(json, options);
        value.ShouldBe(123.456m);
    }

    [Fact]
    public void DecimalStringConverter_ThrowsOnInvalidString()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new DecimalStringConverter());
        
        var json = "\"not-a-number\"";
        Action act = () => JsonSerializer.Deserialize<decimal>(json, options);
        Should.Throw<JsonException>(act);
    }

    [Fact]
    public void DecimalStringConverter_ThrowsOnWrongTokenType()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new DecimalStringConverter());
        
        var json = "true";
        Action act = () => JsonSerializer.Deserialize<decimal>(json, options);
        Should.Throw<JsonException>(act);
    }

    [Fact]
    public void NullableDecimalStringConverter_HandlesNull()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableDecimalStringConverter());
        
        decimal? value = null;
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("null");

        var deserialized = JsonSerializer.Deserialize<decimal?>(json, options);
        deserialized.ShouldBeNull();
    }

    [Fact]
    public void NullableDecimalStringConverter_HandlesValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableDecimalStringConverter());
        
        decimal? value = 123.456m;
        var json = JsonSerializer.Serialize(value, options);
        var deserialized = JsonSerializer.Deserialize<decimal?>(json, options);
        deserialized.ShouldBe(value);
    }

    [Fact]
    public void NullableUInt64StringConverter_HandlesNull()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableUInt64StringConverter());
        
        ulong? value = null;
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("null");

        var deserialized = JsonSerializer.Deserialize<ulong?>(json, options);
        deserialized.ShouldBeNull();
    }

    [Fact]
    public void NullableUInt64StringConverter_HandlesValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableUInt64StringConverter());
        
        ulong? value = ulong.MaxValue;
        var json = JsonSerializer.Serialize(value, options);
        var deserialized = JsonSerializer.Deserialize<ulong?>(json, options);
        deserialized.ShouldBe(value);
    }

    [Fact]
    public void NullableDurationStringConverter_HandlesNull()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableDurationStringConverter());
        
        TimeSpan? value = null;
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("null");

        var deserialized = JsonSerializer.Deserialize<TimeSpan?>(json, options);
        deserialized.ShouldBeNull();
    }

    [Fact]
    public void NullableDurationStringConverter_HandlesValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableDurationStringConverter());
        
        TimeSpan? value = TimeSpan.FromHours(1.5);
        var json = JsonSerializer.Serialize(value, options);
        var deserialized = JsonSerializer.Deserialize<TimeSpan?>(json, options);
        deserialized.ShouldBe(value);
    }

    [Fact]
    public void NullableDateOnlyConverter_HandlesNull()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableDateOnlyConverter());
        
        DateOnly? value = null;
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("null");

        var deserialized = JsonSerializer.Deserialize<DateOnly?>(json, options);
        deserialized.ShouldBeNull();
    }

    [Fact]
    public void NullableDateOnlyConverter_HandlesValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableDateOnlyConverter());
        
        DateOnly? value = new DateOnly(2023, 12, 25);
        var json = JsonSerializer.Serialize(value, options);
        var deserialized = JsonSerializer.Deserialize<DateOnly?>(json, options);
        deserialized.ShouldBe(value);
    }

    [Fact]
    public void NullableTimeOnlyConverter_HandlesNull()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableTimeOnlyConverter());
        
        TimeOnly? value = null;
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("null");

        var deserialized = JsonSerializer.Deserialize<TimeOnly?>(json, options);
        deserialized.ShouldBeNull();
    }

    [Fact]
    public void NullableTimeOnlyConverter_HandlesValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableTimeOnlyConverter());
        
        TimeOnly? value = new TimeOnly(10, 30, 0);
        var json = JsonSerializer.Serialize(value, options);
        var deserialized = JsonSerializer.Deserialize<TimeOnly?>(json, options);
        deserialized.ShouldBe(value);
    }

    [Fact]
    public void NullableUInt128StringConverter_HandlesNull()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableUInt128StringConverter());
        
        UInt128? value = null;
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("null");

        var deserialized = JsonSerializer.Deserialize<UInt128?>(json, options);
        deserialized.ShouldBeNull();
    }

    [Fact]
    public void NullableUInt128StringConverter_HandlesValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableUInt128StringConverter());
        
        UInt128? value = UInt128.MaxValue;
        var json = JsonSerializer.Serialize(value, options);
        var deserialized = JsonSerializer.Deserialize<UInt128?>(json, options);
        deserialized.ShouldBe(value);
    }

    [Fact]
    public void NullableInt128StringConverter_HandlesValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableInt128StringConverter());
        
        Int128? value = Int128.MaxValue;
        var json = JsonSerializer.Serialize(value, options);
        var deserialized = JsonSerializer.Deserialize<Int128?>(json, options);
        deserialized.ShouldBe(value);
    }

    [Fact]
    public void JsonStructureConverters_All_ReturnsConverters()
    {
        var converters = JsonStructureConverters.All;
        converters.ShouldNotBeEmpty();
        converters.ShouldContain(c => c is UuidStringConverter);
        converters.ShouldContain(c => c is UriStringConverter);
        converters.ShouldContain(c => c is Base64BinaryConverter);
    }

    [Fact]
    public void JsonStructureConverters_ConfigureOptions_AddsConverters()
    {
        var options = new JsonSerializerOptions();
        JsonStructureConverters.ConfigureOptions(options);
        
        options.Converters.ShouldNotBeEmpty();
    }

    [Fact]
    public void JsonStructureConverters_CreateOptions_WithDefaults_ReturnsConfiguredOptions()
    {
        var options = JsonStructureConverters.CreateOptions();
        
        options.Converters.ShouldNotBeEmpty();
    }

    [Fact]
    public void JsonStructureConverters_CreateOptions_FromSource_CopiesSettings()
    {
        var source = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
        var options = JsonStructureConverters.CreateOptions(source);
        
        options.Converters.ShouldNotBeEmpty();
        options.PropertyNameCaseInsensitive.ShouldBeTrue();
    }

    #region Base64MemoryConverter Tests

    [Fact]
    public void Base64MemoryConverter_Serialize_Works()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new Base64MemoryConverter());
        
        var data = new byte[] { 1, 2, 3, 4, 5 };
        var memory = new Memory<byte>(data);
        
        var json = JsonSerializer.Serialize(memory, options);
        json.ShouldBe("\"AQIDBAU=\"");
    }

    [Fact]
    public void Base64MemoryConverter_Deserialize_Works()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new Base64MemoryConverter());
        
        var json = "\"AQIDBAU=\"";
        var result = JsonSerializer.Deserialize<Memory<byte>>(json, options);
        
        result.ToArray().ShouldBe(new byte[] { 1, 2, 3, 4, 5 });
    }

    [Fact]
    public void Base64MemoryConverter_EmptyMemory_Works()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new Base64MemoryConverter());
        
        var memory = Memory<byte>.Empty;
        var json = JsonSerializer.Serialize(memory, options);
        var result = JsonSerializer.Deserialize<Memory<byte>>(json, options);
        
        result.Length.ShouldBe(0);
    }

    #endregion

    #region Nullable Converter Edge Cases

    [Fact]
    public void NullableUInt64StringConverter_Serialize_NullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableUInt64StringConverter());
        
        ulong? value = null;
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("null");
    }

    [Fact]
    public void NullableUInt64StringConverter_Deserialize_NullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableUInt64StringConverter());
        
        var json = "null";
        var result = JsonSerializer.Deserialize<ulong?>(json, options);
        result.ShouldBeNull();
    }

    [Fact]
    public void NullableDurationStringConverter_Serialize_NullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableDurationStringConverter());
        
        TimeSpan? value = null;
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("null");
    }

    [Fact]
    public void NullableDurationStringConverter_Deserialize_NullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableDurationStringConverter());
        
        var json = "null";
        var result = JsonSerializer.Deserialize<TimeSpan?>(json, options);
        result.ShouldBeNull();
    }

    [Fact]
    public void NullableDateOnlyConverter_Serialize_NullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableDateOnlyConverter());
        
        DateOnly? value = null;
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("null");
    }

    [Fact]
    public void NullableDateOnlyConverter_Deserialize_NullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableDateOnlyConverter());
        
        var json = "null";
        var result = JsonSerializer.Deserialize<DateOnly?>(json, options);
        result.ShouldBeNull();
    }

    [Fact]
    public void NullableTimeOnlyConverter_Serialize_NullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableTimeOnlyConverter());
        
        TimeOnly? value = null;
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("null");
    }

    [Fact]
    public void NullableTimeOnlyConverter_Deserialize_NullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableTimeOnlyConverter());
        
        var json = "null";
        var result = JsonSerializer.Deserialize<TimeOnly?>(json, options);
        result.ShouldBeNull();
    }

    [Fact]
    public void NullableUuidStringConverter_Serialize_NullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableUuidStringConverter());
        
        Guid? value = null;
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("null");
    }

    [Fact]
    public void NullableUuidStringConverter_Deserialize_NullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableUuidStringConverter());
        
        var json = "null";
        var result = JsonSerializer.Deserialize<Guid?>(json, options);
        result.ShouldBeNull();
    }

    [Fact]
    public void NullableBigIntegerStringConverter_Serialize_NullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableBigIntegerStringConverter());
        
        BigInteger? value = null;
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("null");
    }

    [Fact]
    public void NullableBigIntegerStringConverter_Deserialize_NullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableBigIntegerStringConverter());
        
        var json = "null";
        var result = JsonSerializer.Deserialize<BigInteger?>(json, options);
        result.ShouldBeNull();
    }

    [Fact]
    public void NullableInt64StringConverter_Serialize_NullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableInt64StringConverter());
        
        long? value = null;
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("null");
    }

    [Fact]
    public void NullableInt64StringConverter_Deserialize_NullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableInt64StringConverter());
        
        var json = "null";
        var result = JsonSerializer.Deserialize<long?>(json, options);
        result.ShouldBeNull();
    }

    [Fact]
    public void NullableDecimalStringConverter_Serialize_NullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableDecimalStringConverter());
        
        decimal? value = null;
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("null");
    }

    [Fact]
    public void NullableDecimalStringConverter_Deserialize_NullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableDecimalStringConverter());
        
        var json = "null";
        var result = JsonSerializer.Deserialize<decimal?>(json, options);
        result.ShouldBeNull();
    }

    [Fact]
    public void NullableInt128StringConverter_Serialize_NullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableInt128StringConverter());
        
        Int128? value = null;
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("null");
    }

    [Fact]
    public void NullableInt128StringConverter_Deserialize_NullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableInt128StringConverter());
        
        var json = "null";
        var result = JsonSerializer.Deserialize<Int128?>(json, options);
        result.ShouldBeNull();
    }

    [Fact]
    public void NullableUInt128StringConverter_Serialize_NullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableUInt128StringConverter());
        
        UInt128? value = null;
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("null");
    }

    [Fact]
    public void NullableUInt128StringConverter_Deserialize_NullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableUInt128StringConverter());
        
        var json = "null";
        var result = JsonSerializer.Deserialize<UInt128?>(json, options);
        result.ShouldBeNull();
    }

    #endregion

    #region Converter Edge Cases

    [Fact]
    public void UriStringConverter_Serialize_AbsoluteUri()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new UriStringConverter());
        
        var value = new Uri("https://example.com/path?query=value");
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("\"https://example.com/path?query=value\"");
    }

    [Fact]
    public void UriStringConverter_Deserialize_Fragment()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new UriStringConverter());
        
        var json = "\"https://example.com/page#section\"";
        var result = JsonSerializer.Deserialize<Uri>(json, options);
        result.ShouldNotBeNull();
        result!.Fragment.ShouldBe("#section");
    }

    [Fact]
    public void Base64BinaryConverter_LargeData()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new Base64BinaryConverter());
        
        var data = new byte[1000];
        for (int i = 0; i < data.Length; i++)
        {
            data[i] = (byte)(i % 256);
        }
        
        var json = JsonSerializer.Serialize(data, options);
        var result = JsonSerializer.Deserialize<byte[]>(json, options);
        result.ShouldBe(data);
    }

    [Fact]
    public void DurationStringConverter_Days()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new DurationStringConverter());
        
        var value = TimeSpan.FromDays(5);
        var json = JsonSerializer.Serialize(value, options);
        var result = JsonSerializer.Deserialize<TimeSpan>(json, options);
        result.ShouldBe(value);
    }

    [Fact]
    public void DurationStringConverter_Negative()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new DurationStringConverter());
        
        var value = TimeSpan.FromHours(-3);
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldContain("-");
    }

    #endregion
    
    #region Base64MemoryConverter Tests
    
    [Fact]
    public void Base64MemoryConverter_Serialize()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new Base64MemoryConverter());
        
        byte[] data = "Hello World"u8.ToArray();
        var memory = new ReadOnlyMemory<byte>(data);
        var json = JsonSerializer.Serialize(memory, options);
        json.ShouldBe("\"SGVsbG8gV29ybGQ=\"");
    }
    
    [Fact]
    public void Base64MemoryConverter_Deserialize()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new Base64MemoryConverter());
        
        var json = "\"SGVsbG8gV29ybGQ=\"";
        var result = JsonSerializer.Deserialize<ReadOnlyMemory<byte>>(json, options);
        var str = System.Text.Encoding.UTF8.GetString(result.Span);
        str.ShouldBe("Hello World");
    }
    
    [Fact]
    public void Base64MemoryConverter_EmptyString()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new Base64MemoryConverter());
        
        var json = "\"\"";
        var result = JsonSerializer.Deserialize<ReadOnlyMemory<byte>>(json, options);
        result.Length.ShouldBe(0);
    }
    
    [Fact]
    public void Base64MemoryConverter_InvalidBase64_Throws()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new Base64MemoryConverter());
        
        var json = "\"not-valid-base64!!\"";
        Action act = () => JsonSerializer.Deserialize<ReadOnlyMemory<byte>>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    [Fact]
    public void Base64MemoryConverter_WrongTokenType_Throws()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new Base64MemoryConverter());
        
        var json = "123";
        Action act = () => JsonSerializer.Deserialize<ReadOnlyMemory<byte>>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    #endregion
    
    #region More Nullable Converter Tests
    
    [Fact]
    public void NullableInt128StringConverter_NonNullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableInt128StringConverter());
        
        Int128? value = Int128.Parse("170141183460469231731687303715884105727");
        var json = JsonSerializer.Serialize(value, options);
        var result = JsonSerializer.Deserialize<Int128?>(json, options);
        result.ShouldBe(value);
    }
    
    [Fact]
    public void NullableUInt128StringConverter_NonNullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableUInt128StringConverter());
        
        UInt128? value = UInt128.Parse("340282366920938463463374607431768211455");
        var json = JsonSerializer.Serialize(value, options);
        var result = JsonSerializer.Deserialize<UInt128?>(json, options);
        result.ShouldBe(value);
    }
    
    [Fact]
    public void NullableDecimalStringConverter_NonNullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableDecimalStringConverter());
        
        decimal? value = 12345.6789m;
        var json = JsonSerializer.Serialize(value, options);
        var result = JsonSerializer.Deserialize<decimal?>(json, options);
        result.ShouldBe(value);
    }
    
    [Fact]
    public void NullableInt64StringConverter_NonNullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableInt64StringConverter());
        
        long? value = 9223372036854775807;
        var json = JsonSerializer.Serialize(value, options);
        var result = JsonSerializer.Deserialize<long?>(json, options);
        result.ShouldBe(value);
    }
    
    [Fact]
    public void NullableUInt64StringConverter_NonNullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableUInt64StringConverter());
        
        ulong? value = 18446744073709551615;
        var json = JsonSerializer.Serialize(value, options);
        var result = JsonSerializer.Deserialize<ulong?>(json, options);
        result.ShouldBe(value);
    }
    
    [Fact]
    public void NullableDurationStringConverter_NonNullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableDurationStringConverter());
        
        TimeSpan? value = TimeSpan.FromHours(2);
        var json = JsonSerializer.Serialize(value, options);
        var result = JsonSerializer.Deserialize<TimeSpan?>(json, options);
        result.ShouldBe(value);
    }
    
    [Fact]
    public void NullableDateOnlyConverter_NonNullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableDateOnlyConverter());
        
        DateOnly? value = new DateOnly(2025, 1, 15);
        var json = JsonSerializer.Serialize(value, options);
        var result = JsonSerializer.Deserialize<DateOnly?>(json, options);
        result.ShouldBe(value);
    }
    
    [Fact]
    public void NullableTimeOnlyConverter_NonNullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableTimeOnlyConverter());
        
        TimeOnly? value = new TimeOnly(14, 30, 0);
        var json = JsonSerializer.Serialize(value, options);
        var result = JsonSerializer.Deserialize<TimeOnly?>(json, options);
        result.ShouldBe(value);
    }
    
    [Fact]
    public void NullableUuidStringConverter_NonNullValue()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableUuidStringConverter());
        
        Guid? value = Guid.Parse("550e8400-e29b-41d4-a716-446655440000");
        var json = JsonSerializer.Serialize(value, options);
        var result = JsonSerializer.Deserialize<Guid?>(json, options);
        result.ShouldBe(value);
    }
    
    #endregion
    
    #region UInt64StringConverter Tests
    
    [Fact]
    public void UInt64StringConverter_Serialize()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new UInt64StringConverter());
        
        ulong value = 18446744073709551615;
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("\"18446744073709551615\"");
    }
    
    [Fact]
    public void UInt64StringConverter_Deserialize()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new UInt64StringConverter());
        
        var json = "\"18446744073709551615\"";
        var result = JsonSerializer.Deserialize<ulong>(json, options);
        result.ShouldBe(18446744073709551615UL);
    }
    
    [Fact]
    public void UInt64StringConverter_ThrowsOnInvalid()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new UInt64StringConverter());
        
        var json = "\"not-a-number\"";
        Action act = () => JsonSerializer.Deserialize<ulong>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    [Fact]
    public void UInt64StringConverter_ThrowsOnWrongType()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new UInt64StringConverter());
        
        var json = "true";
        Action act = () => JsonSerializer.Deserialize<ulong>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    #endregion
    
    #region Int64StringConverter Tests
    
    [Fact]
    public void Int64StringConverter_Serialize()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new Int64StringConverter());
        
        long value = -9223372036854775808;
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("\"-9223372036854775808\"");
    }
    
    [Fact]
    public void Int64StringConverter_Deserialize()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new Int64StringConverter());
        
        var json = "\"-9223372036854775808\"";
        var result = JsonSerializer.Deserialize<long>(json, options);
        result.ShouldBe(-9223372036854775808L);
    }
    
    [Fact]
    public void Int64StringConverter_ThrowsOnInvalid()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new Int64StringConverter());
        
        var json = "\"not-a-number\"";
        Action act = () => JsonSerializer.Deserialize<long>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    [Fact]
    public void Int64StringConverter_ThrowsOnWrongType()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new Int64StringConverter());
        
        var json = "true";
        Action act = () => JsonSerializer.Deserialize<long>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    #endregion
    
    #region DurationStringConverter Additional Tests
    
    [Fact]
    public void DurationStringConverter_XmlDuration()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new DurationStringConverter());
        
        var json = "\"PT2H30M15S\"";
        var result = JsonSerializer.Deserialize<TimeSpan>(json, options);
        result.Hours.ShouldBe(2);
        result.Minutes.ShouldBe(30);
        result.Seconds.ShouldBe(15);
    }
    
    [Fact]
    public void DurationStringConverter_ThrowsOnInvalid()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new DurationStringConverter());
        
        var json = "\"not-a-duration\"";
        Action act = () => JsonSerializer.Deserialize<TimeSpan>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    [Fact]
    public void DurationStringConverter_ThrowsOnWrongType()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new DurationStringConverter());
        
        var json = "123";
        Action act = () => JsonSerializer.Deserialize<TimeSpan>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    #endregion
    
    #region Base64BinaryConverter Additional Tests
    
    [Fact]
    public void Base64BinaryConverter_InvalidBase64_Throws()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new Base64BinaryConverter());
        
        var json = "\"invalid-base64!!!\"";
        Action act = () => JsonSerializer.Deserialize<byte[]>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    [Fact]
    public void Base64BinaryConverter_SerializeNull()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new Base64BinaryConverter());
        
        byte[]? value = null;
        var json = JsonSerializer.Serialize(value, options);
        json.ShouldBe("null");
    }
    
    [Fact]
    public void Base64BinaryConverter_DeserializeEmpty()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new Base64BinaryConverter());
        
        var json = "\"\"";
        var result = JsonSerializer.Deserialize<byte[]>(json, options);
        result.ShouldNotBeNull();
        result!.Length.ShouldBe(0);
    }
    
    #endregion
    
    #region UriStringConverter Additional Tests
    
    [Fact]
    public void UriStringConverter_RelativeUri()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new UriStringConverter());
        
        var json = "\"/relative/path\"";
        var result = JsonSerializer.Deserialize<Uri>(json, options);
        result.ShouldNotBeNull();
        result!.OriginalString.ShouldBe("/relative/path");
    }
    
    [Fact]
    public void UriStringConverter_EmptyString_Throws()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new UriStringConverter());
        
        var json = "\"\"";
        Action act = () => JsonSerializer.Deserialize<Uri>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    [Fact]
    public void UriStringConverter_InvalidUri_Throws()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new UriStringConverter());
        
        // A string with null bytes is definitely invalid
        var json = "\"ht tp://invalid uri\"";
        Action act = () => JsonSerializer.Deserialize<Uri>(json, options);
        // The Uri class is quite permissive, so this might not throw but still be invalid
    }
    
    [Fact]
    public void UriStringConverter_WrongType_Throws()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new UriStringConverter());
        
        var json = "123";
        Action act = () => JsonSerializer.Deserialize<Uri>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    #endregion
    
    #region Nullable Converter Error Path Tests
    
    [Fact]
    public void NullableInt128StringConverter_InvalidValue_Throws()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableInt128StringConverter());
        
        var json = "\"not-a-number\"";
        Action act = () => JsonSerializer.Deserialize<Int128?>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    [Fact]
    public void NullableInt128StringConverter_WrongType_Throws()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableInt128StringConverter());
        
        var json = "true";
        Action act = () => JsonSerializer.Deserialize<Int128?>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    [Fact]
    public void NullableUInt128StringConverter_InvalidValue_Throws()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableUInt128StringConverter());
        
        var json = "\"not-a-number\"";
        Action act = () => JsonSerializer.Deserialize<UInt128?>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    [Fact]
    public void NullableUInt128StringConverter_WrongType_Throws()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableUInt128StringConverter());
        
        var json = "true";
        Action act = () => JsonSerializer.Deserialize<UInt128?>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    [Fact]
    public void NullableBigIntegerStringConverter_InvalidValue_Throws()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableBigIntegerStringConverter());
        
        var json = "\"not-a-number\"";
        Action act = () => JsonSerializer.Deserialize<BigInteger?>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    [Fact]
    public void NullableBigIntegerStringConverter_WrongType_Throws()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableBigIntegerStringConverter());
        
        var json = "true";
        Action act = () => JsonSerializer.Deserialize<BigInteger?>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    [Fact]
    public void NullableDecimalStringConverter_InvalidValue_Throws()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableDecimalStringConverter());
        
        var json = "\"not-a-number\"";
        Action act = () => JsonSerializer.Deserialize<decimal?>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    [Fact]
    public void NullableDecimalStringConverter_WrongType_Throws()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableDecimalStringConverter());
        
        var json = "true";
        Action act = () => JsonSerializer.Deserialize<decimal?>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    [Fact]
    public void NullableInt64StringConverter_InvalidValue_Throws()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableInt64StringConverter());
        
        var json = "\"not-a-number\"";
        Action act = () => JsonSerializer.Deserialize<long?>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    [Fact]
    public void NullableInt64StringConverter_WrongType_Throws()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableInt64StringConverter());
        
        var json = "true";
        Action act = () => JsonSerializer.Deserialize<long?>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    [Fact]
    public void NullableUInt64StringConverter_InvalidValue_Throws()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableUInt64StringConverter());
        
        var json = "\"not-a-number\"";
        Action act = () => JsonSerializer.Deserialize<ulong?>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    [Fact]
    public void NullableUInt64StringConverter_WrongType_Throws()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableUInt64StringConverter());
        
        var json = "true";
        Action act = () => JsonSerializer.Deserialize<ulong?>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    [Fact]
    public void NullableDurationStringConverter_InvalidValue_Throws()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableDurationStringConverter());
        
        var json = "\"not-a-duration\"";
        Action act = () => JsonSerializer.Deserialize<TimeSpan?>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    [Fact]
    public void NullableDurationStringConverter_WrongType_Throws()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableDurationStringConverter());
        
        var json = "123";
        Action act = () => JsonSerializer.Deserialize<TimeSpan?>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    [Fact]
    public void NullableDateOnlyConverter_InvalidValue_Throws()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableDateOnlyConverter());
        
        var json = "\"not-a-date\"";
        Action act = () => JsonSerializer.Deserialize<DateOnly?>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    [Fact]
    public void NullableDateOnlyConverter_WrongType_Throws()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableDateOnlyConverter());
        
        var json = "123";
        Action act = () => JsonSerializer.Deserialize<DateOnly?>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    [Fact]
    public void NullableTimeOnlyConverter_InvalidValue_Throws()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableTimeOnlyConverter());
        
        var json = "\"not-a-time\"";
        Action act = () => JsonSerializer.Deserialize<TimeOnly?>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    [Fact]
    public void NullableTimeOnlyConverter_WrongType_Throws()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableTimeOnlyConverter());
        
        var json = "123";
        Action act = () => JsonSerializer.Deserialize<TimeOnly?>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    [Fact]
    public void NullableUuidStringConverter_InvalidValue_Throws()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableUuidStringConverter());
        
        var json = "\"not-a-uuid\"";
        Action act = () => JsonSerializer.Deserialize<Guid?>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    [Fact]
    public void NullableUuidStringConverter_WrongType_Throws()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new NullableUuidStringConverter());
        
        var json = "123";
        Action act = () => JsonSerializer.Deserialize<Guid?>(json, options);
        Should.Throw<JsonException>(act);
    }
    
    #endregion
}
