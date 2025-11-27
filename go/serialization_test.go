// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package jsonstructure

import (
	"encoding/json"
	"math/big"
	"testing"
	"time"
)

func TestInt64StringMarshal(t *testing.T) {
	tests := []struct {
		name     string
		value    Int64String
		expected string
	}{
		{"zero", Int64String(0), `"0"`},
		{"positive", Int64String(9223372036854775807), `"9223372036854775807"`},
		{"negative", Int64String(-9223372036854775808), `"-9223372036854775808"`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.value)
			if err != nil {
				t.Fatalf("Marshal failed: %v", err)
			}
			if string(data) != tt.expected {
				t.Errorf("Expected %s, got %s", tt.expected, string(data))
			}
		})
	}
}

func TestInt64StringUnmarshal(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected int64
	}{
		{"string", `"9223372036854775807"`, 9223372036854775807},
		{"number", `12345`, 12345},
		{"negative_string", `"-9223372036854775808"`, -9223372036854775808},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var v Int64String
			if err := json.Unmarshal([]byte(tt.input), &v); err != nil {
				t.Fatalf("Unmarshal failed: %v", err)
			}
			if v.Value() != tt.expected {
				t.Errorf("Expected %d, got %d", tt.expected, v.Value())
			}
		})
	}
}

func TestUInt64StringMarshal(t *testing.T) {
	tests := []struct {
		name     string
		value    UInt64String
		expected string
	}{
		{"zero", UInt64String(0), `"0"`},
		{"max", UInt64String(18446744073709551615), `"18446744073709551615"`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.value)
			if err != nil {
				t.Fatalf("Marshal failed: %v", err)
			}
			if string(data) != tt.expected {
				t.Errorf("Expected %s, got %s", tt.expected, string(data))
			}
		})
	}
}

func TestBigIntStringMarshal(t *testing.T) {
	large := new(big.Int)
	large.SetString("170141183460469231731687303715884105727", 10) // int128 max

	tests := []struct {
		name     string
		value    BigIntString
		expected string
	}{
		{"small", NewBigIntString(123), `"123"`},
		{"large", BigIntString{large}, `"170141183460469231731687303715884105727"`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.value)
			if err != nil {
				t.Fatalf("Marshal failed: %v", err)
			}
			if string(data) != tt.expected {
				t.Errorf("Expected %s, got %s", tt.expected, string(data))
			}
		})
	}
}

func TestBigIntStringUnmarshal(t *testing.T) {
	t.Run("large_number", func(t *testing.T) {
		input := `"170141183460469231731687303715884105727"`
		var v BigIntString
		if err := json.Unmarshal([]byte(input), &v); err != nil {
			t.Fatalf("Unmarshal failed: %v", err)
		}
		expected := "170141183460469231731687303715884105727"
		if v.Int.String() != expected {
			t.Errorf("Expected %s, got %s", expected, v.Int.String())
		}
	})
}

func TestDurationMarshal(t *testing.T) {
	tests := []struct {
		name     string
		value    Duration
		expected string
	}{
		{"zero", Duration(0), `"PT0S"`},
		{"one_hour", Duration(time.Hour), `"PT1H"`},
		{"one_minute", Duration(time.Minute), `"PT1M"`},
		{"complex", Duration(2*time.Hour + 30*time.Minute + 15*time.Second), `"PT2H30M15S"`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.value)
			if err != nil {
				t.Fatalf("Marshal failed: %v", err)
			}
			if string(data) != tt.expected {
				t.Errorf("Expected %s, got %s", tt.expected, string(data))
			}
		})
	}
}

func TestDurationUnmarshal(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected time.Duration
	}{
		{"zero", `"PT0S"`, 0},
		{"one_hour", `"PT1H"`, time.Hour},
		{"complex", `"PT2H30M15S"`, 2*time.Hour + 30*time.Minute + 15*time.Second},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var v Duration
			if err := json.Unmarshal([]byte(tt.input), &v); err != nil {
				t.Fatalf("Unmarshal failed: %v", err)
			}
			if v.Value() != tt.expected {
				t.Errorf("Expected %v, got %v", tt.expected, v.Value())
			}
		})
	}
}

func TestDateMarshal(t *testing.T) {
	d := NewDate(2024, time.March, 15)
	data, err := json.Marshal(d)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}
	expected := `"2024-03-15"`
	if string(data) != expected {
		t.Errorf("Expected %s, got %s", expected, string(data))
	}
}

func TestDateUnmarshal(t *testing.T) {
	input := `"2024-03-15"`
	var d Date
	if err := json.Unmarshal([]byte(input), &d); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}
	if d.Year != 2024 || d.Month != time.March || d.Day != 15 {
		t.Errorf("Expected 2024-03-15, got %v", d)
	}
}

func TestTimeOfDayMarshal(t *testing.T) {
	tests := []struct {
		name     string
		value    TimeOfDay
		expected string
	}{
		{"simple", NewTimeOfDay(14, 30, 15), `"14:30:15"`},
		{"with_nanos", TimeOfDay{Hour: 14, Minute: 30, Second: 15, Nanosecond: 500000000}, `"14:30:15.5"`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.value)
			if err != nil {
				t.Fatalf("Marshal failed: %v", err)
			}
			if string(data) != tt.expected {
				t.Errorf("Expected %s, got %s", tt.expected, string(data))
			}
		})
	}
}

func TestTimeOfDayUnmarshal(t *testing.T) {
	input := `"14:30:15"`
	var tod TimeOfDay
	if err := json.Unmarshal([]byte(input), &tod); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}
	if tod.Hour != 14 || tod.Minute != 30 || tod.Second != 15 {
		t.Errorf("Expected 14:30:15, got %v", tod)
	}
}

func TestDateTimeMarshal(t *testing.T) {
	dt := DateTime(time.Date(2024, 3, 15, 14, 30, 15, 0, time.UTC))
	data, err := json.Marshal(dt)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}
	expected := `"2024-03-15T14:30:15Z"`
	if string(data) != expected {
		t.Errorf("Expected %s, got %s", expected, string(data))
	}
}

func TestDateTimeUnmarshal(t *testing.T) {
	input := `"2024-03-15T14:30:15Z"`
	var dt DateTime
	if err := json.Unmarshal([]byte(input), &dt); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}
	expected := time.Date(2024, 3, 15, 14, 30, 15, 0, time.UTC)
	if !dt.Time().Equal(expected) {
		t.Errorf("Expected %v, got %v", expected, dt.Time())
	}
}

func TestBinaryMarshal(t *testing.T) {
	b := Binary([]byte("Hello, World!"))
	data, err := json.Marshal(b)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}
	expected := `"SGVsbG8sIFdvcmxkIQ=="`
	if string(data) != expected {
		t.Errorf("Expected %s, got %s", expected, string(data))
	}
}

func TestBinaryUnmarshal(t *testing.T) {
	input := `"SGVsbG8sIFdvcmxkIQ=="`
	var b Binary
	if err := json.Unmarshal([]byte(input), &b); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}
	expected := "Hello, World!"
	if string(b) != expected {
		t.Errorf("Expected %s, got %s", expected, string(b))
	}
}

func TestUUIDMarshal(t *testing.T) {
	u := UUID("550e8400-e29b-41d4-a716-446655440000")
	data, err := json.Marshal(u)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}
	expected := `"550e8400-e29b-41d4-a716-446655440000"`
	if string(data) != expected {
		t.Errorf("Expected %s, got %s", expected, string(data))
	}
}

func TestUUIDUnmarshal(t *testing.T) {
	input := `"550e8400-e29b-41d4-a716-446655440000"`
	var u UUID
	if err := json.Unmarshal([]byte(input), &u); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}
	expected := UUID("550e8400-e29b-41d4-a716-446655440000")
	if u != expected {
		t.Errorf("Expected %s, got %s", expected, u)
	}
}

func TestURIMarshal(t *testing.T) {
	u, _ := NewURI("https://example.com/path?query=value")
	data, err := json.Marshal(u)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}
	expected := `"https://example.com/path?query=value"`
	if string(data) != expected {
		t.Errorf("Expected %s, got %s", expected, string(data))
	}
}

func TestURIUnmarshal(t *testing.T) {
	input := `"https://example.com/path?query=value"`
	var u URI
	if err := json.Unmarshal([]byte(input), &u); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}
	if u.URL.String() != "https://example.com/path?query=value" {
		t.Errorf("Expected https://example.com/path?query=value, got %s", u.URL.String())
	}
}

func TestJSONPointerMarshal(t *testing.T) {
	p := JSONPointer("/foo/bar/0")
	data, err := json.Marshal(p)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}
	expected := `"/foo/bar/0"`
	if string(data) != expected {
		t.Errorf("Expected %s, got %s", expected, string(data))
	}
}

func TestJSONPointerUnmarshal(t *testing.T) {
	input := `"/foo/bar/0"`
	var p JSONPointer
	if err := json.Unmarshal([]byte(input), &p); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}
	expected := JSONPointer("/foo/bar/0")
	if p != expected {
		t.Errorf("Expected %s, got %s", expected, p)
	}
}

func TestDecimalStringMarshal(t *testing.T) {
	d := NewDecimalString(123.456)
	data, err := json.Marshal(d)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}
	expected := `"123.456"`
	if string(data) != expected {
		t.Errorf("Expected %s, got %s", expected, string(data))
	}
}

func TestDecimalStringUnmarshal(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"string", `"123.456"`, "123.456"},
		{"number", `123.456`, "123.456"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var d DecimalString
			if err := json.Unmarshal([]byte(tt.input), &d); err != nil {
				t.Fatalf("Unmarshal failed: %v", err)
			}
			if d.Value != tt.expected {
				t.Errorf("Expected %s, got %s", tt.expected, d.Value)
			}
		})
	}
}

// Test round-trip serialization
func TestRoundTrip(t *testing.T) {
	type TestStruct struct {
		Int64Val   Int64String   `json:"int64"`
		UInt64Val  UInt64String  `json:"uint64"`
		Duration   Duration      `json:"duration"`
		Date       Date          `json:"date"`
		Time       TimeOfDay     `json:"time"`
		DateTime   DateTime      `json:"datetime"`
		Binary     Binary        `json:"binary"`
		UUID       UUID          `json:"uuid"`
		URI        URI           `json:"uri"`
		Pointer    JSONPointer   `json:"pointer"`
		Decimal    DecimalString `json:"decimal"`
		BigInt     BigIntString  `json:"bigint"`
	}

	uri, _ := NewURI("https://example.com")
	bigInt, _ := NewBigIntStringFromString("170141183460469231731687303715884105727")

	original := TestStruct{
		Int64Val:  Int64String(9223372036854775807),
		UInt64Val: UInt64String(18446744073709551615),
		Duration:  Duration(2*time.Hour + 30*time.Minute),
		Date:      NewDate(2024, time.March, 15),
		Time:      NewTimeOfDay(14, 30, 15),
		DateTime:  DateTime(time.Date(2024, 3, 15, 14, 30, 15, 0, time.UTC)),
		Binary:    Binary([]byte("Hello")),
		UUID:      UUID("550e8400-e29b-41d4-a716-446655440000"),
		URI:       uri,
		Pointer:   JSONPointer("/foo/bar"),
		Decimal:   NewDecimalString(123.456),
		BigInt:    bigInt,
	}

	// Marshal
	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	// Unmarshal
	var decoded TestStruct
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}

	// Verify
	if decoded.Int64Val.Value() != original.Int64Val.Value() {
		t.Errorf("Int64 mismatch: expected %d, got %d", original.Int64Val.Value(), decoded.Int64Val.Value())
	}
	if decoded.UInt64Val.Value() != original.UInt64Val.Value() {
		t.Errorf("UInt64 mismatch: expected %d, got %d", original.UInt64Val.Value(), decoded.UInt64Val.Value())
	}
	if decoded.Duration.Value() != original.Duration.Value() {
		t.Errorf("Duration mismatch: expected %v, got %v", original.Duration.Value(), decoded.Duration.Value())
	}
	if decoded.Date != original.Date {
		t.Errorf("Date mismatch: expected %v, got %v", original.Date, decoded.Date)
	}
	if decoded.UUID != original.UUID {
		t.Errorf("UUID mismatch: expected %s, got %s", original.UUID, decoded.UUID)
	}
}
