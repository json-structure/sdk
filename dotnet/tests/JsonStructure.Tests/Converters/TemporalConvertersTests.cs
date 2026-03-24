// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using Shouldly;
using JsonStructure.Converters;
using Xunit;

namespace JsonStructure.Tests.Converters;

public class TemporalConvertersTests
{
    private readonly JsonSerializerOptions _options;

    public TemporalConvertersTests()
    {
        _options = new JsonSerializerOptions();
        _options.Converters.Add(new DurationStringConverter());
        _options.Converters.Add(new NullableDurationStringConverter());
        _options.Converters.Add(new DateOnlyConverter());
        _options.Converters.Add(new NullableDateOnlyConverter());
        _options.Converters.Add(new TimeOnlyConverter());
        _options.Converters.Add(new NullableTimeOnlyConverter());
    }

    [Fact]
    public void DurationStringConverter_SerializesToISO8601()
    {
        var duration = TimeSpan.FromHours(1) + TimeSpan.FromMinutes(30) + TimeSpan.FromSeconds(45);
        var json = JsonSerializer.Serialize(duration, _options);
        // XmlConvert.ToString produces ISO 8601 format
        json.ShouldContain("PT1H30M45S");
    }

    [Fact]
    public void DurationStringConverter_DeserializesFromISO8601()
    {
        var json = "\"PT1H30M45S\"";
        var duration = JsonSerializer.Deserialize<TimeSpan>(json, _options);
        duration.ShouldBe(TimeSpan.FromHours(1) + TimeSpan.FromMinutes(30) + TimeSpan.FromSeconds(45));
    }

    [Fact]
    public void DurationStringConverter_HandlesDays()
    {
        var duration = TimeSpan.FromDays(2) + TimeSpan.FromHours(5);
        var json = JsonSerializer.Serialize(duration, _options);
        var deserialized = JsonSerializer.Deserialize<TimeSpan>(json, _options);
        deserialized.ShouldBe(duration);
    }

    [Fact]
    public void NullableDurationStringConverter_HandlesNull()
    {
        TimeSpan? value = null;
        var json = JsonSerializer.Serialize(value, _options);
        json.ShouldBe("null");

        var deserialized = JsonSerializer.Deserialize<TimeSpan?>(json, _options);
        deserialized.ShouldBeNull();
    }

    [Fact]
    public void DateOnlyConverter_SerializesToRFC3339()
    {
        var date = new DateOnly(2024, 6, 15);
        var json = JsonSerializer.Serialize(date, _options);
        json.ShouldBe("\"2024-06-15\"");
    }

    [Fact]
    public void DateOnlyConverter_DeserializesFromRFC3339()
    {
        var json = "\"2024-06-15\"";
        var date = JsonSerializer.Deserialize<DateOnly>(json, _options);
        date.ShouldBe(new DateOnly(2024, 6, 15));
    }

    [Fact]
    public void NullableDateOnlyConverter_HandlesNull()
    {
        DateOnly? value = null;
        var json = JsonSerializer.Serialize(value, _options);
        json.ShouldBe("null");

        var deserialized = JsonSerializer.Deserialize<DateOnly?>(json, _options);
        deserialized.ShouldBeNull();
    }

    [Fact]
    public void TimeOnlyConverter_SerializesToTimeString()
    {
        var time = new TimeOnly(14, 30, 45, 123);
        var json = JsonSerializer.Serialize(time, _options);
        json.ShouldContain("14:30:45");
    }

    [Fact]
    public void TimeOnlyConverter_DeserializesFromTimeString()
    {
        var json = "\"14:30:45\"";
        var time = JsonSerializer.Deserialize<TimeOnly>(json, _options);
        time.Hour.ShouldBe(14);
        time.Minute.ShouldBe(30);
        time.Second.ShouldBe(45);
    }

    [Fact]
    public void NullableTimeOnlyConverter_HandlesNull()
    {
        TimeOnly? value = null;
        var json = JsonSerializer.Serialize(value, _options);
        json.ShouldBe("null");

        var deserialized = JsonSerializer.Deserialize<TimeOnly?>(json, _options);
        deserialized.ShouldBeNull();
    }

    [Fact]
    public void DateOnlyConverter_ThrowsOnInvalidDate()
    {
        var json = "\"not-a-date\"";
        Action act = () => JsonSerializer.Deserialize<DateOnly>(json, _options);
        Should.Throw<JsonException>(act);
    }

    [Fact]
    public void DurationStringConverter_ThrowsOnEmptyString()
    {
        var json = "\"\"";
        Action act = () => JsonSerializer.Deserialize<TimeSpan>(json, _options);
        Should.Throw<JsonException>(act);
    }
}
