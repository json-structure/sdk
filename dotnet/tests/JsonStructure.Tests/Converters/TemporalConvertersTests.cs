// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using FluentAssertions;
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
        json.Should().Contain("PT1H30M45S");
    }

    [Fact]
    public void DurationStringConverter_DeserializesFromISO8601()
    {
        var json = "\"PT1H30M45S\"";
        var duration = JsonSerializer.Deserialize<TimeSpan>(json, _options);
        duration.Should().Be(TimeSpan.FromHours(1) + TimeSpan.FromMinutes(30) + TimeSpan.FromSeconds(45));
    }

    [Fact]
    public void DurationStringConverter_HandlesDays()
    {
        var duration = TimeSpan.FromDays(2) + TimeSpan.FromHours(5);
        var json = JsonSerializer.Serialize(duration, _options);
        var deserialized = JsonSerializer.Deserialize<TimeSpan>(json, _options);
        deserialized.Should().Be(duration);
    }

    [Fact]
    public void NullableDurationStringConverter_HandlesNull()
    {
        TimeSpan? value = null;
        var json = JsonSerializer.Serialize(value, _options);
        json.Should().Be("null");

        var deserialized = JsonSerializer.Deserialize<TimeSpan?>(json, _options);
        deserialized.Should().BeNull();
    }

    [Fact]
    public void DateOnlyConverter_SerializesToRFC3339()
    {
        var date = new DateOnly(2024, 6, 15);
        var json = JsonSerializer.Serialize(date, _options);
        json.Should().Be("\"2024-06-15\"");
    }

    [Fact]
    public void DateOnlyConverter_DeserializesFromRFC3339()
    {
        var json = "\"2024-06-15\"";
        var date = JsonSerializer.Deserialize<DateOnly>(json, _options);
        date.Should().Be(new DateOnly(2024, 6, 15));
    }

    [Fact]
    public void NullableDateOnlyConverter_HandlesNull()
    {
        DateOnly? value = null;
        var json = JsonSerializer.Serialize(value, _options);
        json.Should().Be("null");

        var deserialized = JsonSerializer.Deserialize<DateOnly?>(json, _options);
        deserialized.Should().BeNull();
    }

    [Fact]
    public void TimeOnlyConverter_SerializesToTimeString()
    {
        var time = new TimeOnly(14, 30, 45, 123);
        var json = JsonSerializer.Serialize(time, _options);
        json.Should().Contain("14:30:45");
    }

    [Fact]
    public void TimeOnlyConverter_DeserializesFromTimeString()
    {
        var json = "\"14:30:45\"";
        var time = JsonSerializer.Deserialize<TimeOnly>(json, _options);
        time.Hour.Should().Be(14);
        time.Minute.Should().Be(30);
        time.Second.Should().Be(45);
    }

    [Fact]
    public void NullableTimeOnlyConverter_HandlesNull()
    {
        TimeOnly? value = null;
        var json = JsonSerializer.Serialize(value, _options);
        json.Should().Be("null");

        var deserialized = JsonSerializer.Deserialize<TimeOnly?>(json, _options);
        deserialized.Should().BeNull();
    }

    [Fact]
    public void DateOnlyConverter_ThrowsOnInvalidDate()
    {
        var json = "\"not-a-date\"";
        var act = () => JsonSerializer.Deserialize<DateOnly>(json, _options);
        act.Should().Throw<JsonException>();
    }

    [Fact]
    public void DurationStringConverter_ThrowsOnEmptyString()
    {
        var json = "\"\"";
        var act = () => JsonSerializer.Deserialize<TimeSpan>(json, _options);
        act.Should().Throw<JsonException>();
    }
}
