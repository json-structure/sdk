// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package jsonstructure

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/url"
	"strconv"
	"time"
)

// JSON Structure Serialization Helpers
//
// This file provides wrapper types and utilities for correctly serializing
// JSON Structure types according to the specification. Per the JSON Structure spec,
// certain types must be serialized as strings because JSON numbers (IEEE 754 double)
// cannot accurately represent their full range.
//
// Types that serialize as strings:
// - int64, uint64: Full 64-bit range exceeds JSON number precision
// - int128, uint128: Represented as big.Int, serialized as strings
// - decimal: Arbitrary precision, serialized as strings
// - duration: ISO 8601 duration format (e.g., "PT1H30M")
// - date, time, datetime: ISO 8601/RFC 3339 formats
// - binary: Base64 encoded
// - uuid, uri, jsonpointer: String representations

// Int64String is a wrapper for int64 that serializes to/from a JSON string.
// Use this for JSON Structure int64 fields to preserve precision.
type Int64String int64

// MarshalJSON implements json.Marshaler.
func (i Int64String) MarshalJSON() ([]byte, error) {
	return json.Marshal(strconv.FormatInt(int64(i), 10))
}

// UnmarshalJSON implements json.Unmarshaler.
func (i *Int64String) UnmarshalJSON(data []byte) error {
	// Try string first
	var s string
	if err := json.Unmarshal(data, &s); err == nil {
		v, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			return fmt.Errorf("invalid int64 string: %w", err)
		}
		*i = Int64String(v)
		return nil
	}
	// Fall back to number for backwards compatibility
	var n int64
	if err := json.Unmarshal(data, &n); err != nil {
		return fmt.Errorf("invalid int64: %w", err)
	}
	*i = Int64String(n)
	return nil
}

// Value returns the underlying int64 value.
func (i Int64String) Value() int64 {
	return int64(i)
}

// UInt64String is a wrapper for uint64 that serializes to/from a JSON string.
// Use this for JSON Structure uint64 fields to preserve precision.
type UInt64String uint64

// MarshalJSON implements json.Marshaler.
func (u UInt64String) MarshalJSON() ([]byte, error) {
	return json.Marshal(strconv.FormatUint(uint64(u), 10))
}

// UnmarshalJSON implements json.Unmarshaler.
func (u *UInt64String) UnmarshalJSON(data []byte) error {
	// Try string first
	var s string
	if err := json.Unmarshal(data, &s); err == nil {
		v, err := strconv.ParseUint(s, 10, 64)
		if err != nil {
			return fmt.Errorf("invalid uint64 string: %w", err)
		}
		*u = UInt64String(v)
		return nil
	}
	// Fall back to number for backwards compatibility
	var n uint64
	if err := json.Unmarshal(data, &n); err != nil {
		return fmt.Errorf("invalid uint64: %w", err)
	}
	*u = UInt64String(n)
	return nil
}

// Value returns the underlying uint64 value.
func (u UInt64String) Value() uint64 {
	return uint64(u)
}

// BigIntString is a wrapper for *big.Int that serializes to/from a JSON string.
// Use this for JSON Structure int128/uint128 fields.
type BigIntString struct {
	*big.Int
}

// NewBigIntString creates a new BigIntString from an int64.
func NewBigIntString(v int64) BigIntString {
	return BigIntString{big.NewInt(v)}
}

// NewBigIntStringFromString creates a new BigIntString from a string.
func NewBigIntStringFromString(s string) (BigIntString, error) {
	i := new(big.Int)
	_, ok := i.SetString(s, 10)
	if !ok {
		return BigIntString{}, fmt.Errorf("invalid big.Int string: %s", s)
	}
	return BigIntString{i}, nil
}

// MarshalJSON implements json.Marshaler.
func (b BigIntString) MarshalJSON() ([]byte, error) {
	if b.Int == nil {
		return json.Marshal(nil)
	}
	return json.Marshal(b.Int.String())
}

// UnmarshalJSON implements json.Unmarshaler.
func (b *BigIntString) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		// Check for null
		var n interface{}
		if json.Unmarshal(data, &n) == nil && n == nil {
			b.Int = nil
			return nil
		}
		return fmt.Errorf("invalid big.Int: %w", err)
	}
	i := new(big.Int)
	_, ok := i.SetString(s, 10)
	if !ok {
		return fmt.Errorf("invalid big.Int string: %s", s)
	}
	b.Int = i
	return nil
}

// DecimalString is a wrapper for decimal values serialized as strings.
// For full decimal support, consider using a library like shopspring/decimal.
// This basic implementation uses float64 with string serialization.
type DecimalString struct {
	Value string
}

// NewDecimalString creates a DecimalString from a float64.
func NewDecimalString(v float64) DecimalString {
	return DecimalString{Value: strconv.FormatFloat(v, 'f', -1, 64)}
}

// NewDecimalStringFromString creates a DecimalString from a string.
func NewDecimalStringFromString(s string) DecimalString {
	return DecimalString{Value: s}
}

// MarshalJSON implements json.Marshaler.
func (d DecimalString) MarshalJSON() ([]byte, error) {
	return json.Marshal(d.Value)
}

// UnmarshalJSON implements json.Unmarshaler.
func (d *DecimalString) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		// Try number
		var n float64
		if err := json.Unmarshal(data, &n); err != nil {
			return fmt.Errorf("invalid decimal: %w", err)
		}
		d.Value = strconv.FormatFloat(n, 'f', -1, 64)
		return nil
	}
	d.Value = s
	return nil
}

// Float64 returns the decimal as a float64 (may lose precision).
func (d DecimalString) Float64() (float64, error) {
	return strconv.ParseFloat(d.Value, 64)
}

// Duration is a wrapper for time.Duration that serializes to/from ISO 8601 duration strings.
// Format examples: "PT1H30M", "P1DT12H", "PT0.5S"
type Duration time.Duration

// MarshalJSON implements json.Marshaler.
func (d Duration) MarshalJSON() ([]byte, error) {
	return json.Marshal(FormatDuration(time.Duration(d)))
}

// UnmarshalJSON implements json.Unmarshaler.
func (d *Duration) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return fmt.Errorf("invalid duration: %w", err)
	}
	parsed, err := ParseDuration(s)
	if err != nil {
		return fmt.Errorf("invalid ISO 8601 duration: %w", err)
	}
	*d = Duration(parsed)
	return nil
}

// Value returns the underlying time.Duration.
func (d Duration) Value() time.Duration {
	return time.Duration(d)
}

// Date represents a date without time (JSON Structure "date" type).
// Serializes as RFC 3339 date string (YYYY-MM-DD).
type Date struct {
	Year  int
	Month time.Month
	Day   int
}

// NewDate creates a Date from year, month, day.
func NewDate(year int, month time.Month, day int) Date {
	return Date{Year: year, Month: month, Day: day}
}

// NewDateFromTime creates a Date from a time.Time.
func NewDateFromTime(t time.Time) Date {
	return Date{Year: t.Year(), Month: t.Month(), Day: t.Day()}
}

// MarshalJSON implements json.Marshaler.
func (d Date) MarshalJSON() ([]byte, error) {
	s := fmt.Sprintf("%04d-%02d-%02d", d.Year, d.Month, d.Day)
	return json.Marshal(s)
}

// UnmarshalJSON implements json.Unmarshaler.
func (d *Date) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return fmt.Errorf("invalid date: %w", err)
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return fmt.Errorf("invalid date format: %w", err)
	}
	d.Year = t.Year()
	d.Month = t.Month()
	d.Day = t.Day()
	return nil
}

// Time returns the Date as a time.Time at midnight UTC.
func (d Date) Time() time.Time {
	return time.Date(d.Year, d.Month, d.Day, 0, 0, 0, 0, time.UTC)
}

// String returns the date in RFC 3339 format.
func (d Date) String() string {
	return fmt.Sprintf("%04d-%02d-%02d", d.Year, d.Month, d.Day)
}

// TimeOfDay represents a time without date (JSON Structure "time" type).
// Serializes as RFC 3339 time string (HH:MM:SS or HH:MM:SS.sss).
type TimeOfDay struct {
	Hour       int
	Minute     int
	Second     int
	Nanosecond int
}

// NewTimeOfDay creates a TimeOfDay from hour, minute, second.
func NewTimeOfDay(hour, minute, second int) TimeOfDay {
	return TimeOfDay{Hour: hour, Minute: minute, Second: second}
}

// NewTimeOfDayFromTime creates a TimeOfDay from a time.Time.
func NewTimeOfDayFromTime(t time.Time) TimeOfDay {
	return TimeOfDay{
		Hour:       t.Hour(),
		Minute:     t.Minute(),
		Second:     t.Second(),
		Nanosecond: t.Nanosecond(),
	}
}

// MarshalJSON implements json.Marshaler.
func (t TimeOfDay) MarshalJSON() ([]byte, error) {
	var s string
	if t.Nanosecond > 0 {
		s = fmt.Sprintf("%02d:%02d:%02d.%09d", t.Hour, t.Minute, t.Second, t.Nanosecond)
		// Trim trailing zeros
		for len(s) > 8 && s[len(s)-1] == '0' {
			s = s[:len(s)-1]
		}
	} else {
		s = fmt.Sprintf("%02d:%02d:%02d", t.Hour, t.Minute, t.Second)
	}
	return json.Marshal(s)
}

// UnmarshalJSON implements json.Unmarshaler.
func (t *TimeOfDay) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return fmt.Errorf("invalid time: %w", err)
	}
	
	// Try parsing with nanoseconds first
	parsed, err := time.Parse("15:04:05.999999999", s)
	if err != nil {
		// Try without fractional seconds
		parsed, err = time.Parse("15:04:05", s)
		if err != nil {
			return fmt.Errorf("invalid time format: %w", err)
		}
	}
	t.Hour = parsed.Hour()
	t.Minute = parsed.Minute()
	t.Second = parsed.Second()
	t.Nanosecond = parsed.Nanosecond()
	return nil
}

// String returns the time in RFC 3339 format.
func (t TimeOfDay) String() string {
	if t.Nanosecond > 0 {
		s := fmt.Sprintf("%02d:%02d:%02d.%09d", t.Hour, t.Minute, t.Second, t.Nanosecond)
		// Trim trailing zeros
		for len(s) > 8 && s[len(s)-1] == '0' {
			s = s[:len(s)-1]
		}
		return s
	}
	return fmt.Sprintf("%02d:%02d:%02d", t.Hour, t.Minute, t.Second)
}

// DateTime is an alias for time.Time with RFC 3339 serialization.
// This is already the default behavior of time.Time in encoding/json,
// but this type makes the intent explicit.
type DateTime time.Time

// MarshalJSON implements json.Marshaler.
func (dt DateTime) MarshalJSON() ([]byte, error) {
	return json.Marshal(time.Time(dt).Format(time.RFC3339Nano))
}

// UnmarshalJSON implements json.Unmarshaler.
func (dt *DateTime) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return fmt.Errorf("invalid datetime: %w", err)
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		// Try without nanoseconds
		t, err = time.Parse(time.RFC3339, s)
		if err != nil {
			return fmt.Errorf("invalid datetime format: %w", err)
		}
	}
	*dt = DateTime(t)
	return nil
}

// Time returns the underlying time.Time.
func (dt DateTime) Time() time.Time {
	return time.Time(dt)
}

// Binary represents binary data that serializes as base64.
type Binary []byte

// MarshalJSON implements json.Marshaler.
func (b Binary) MarshalJSON() ([]byte, error) {
	if b == nil {
		return json.Marshal(nil)
	}
	return json.Marshal(base64.StdEncoding.EncodeToString(b))
}

// UnmarshalJSON implements json.Unmarshaler.
func (b *Binary) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		// Check for null
		var n interface{}
		if json.Unmarshal(data, &n) == nil && n == nil {
			*b = nil
			return nil
		}
		return fmt.Errorf("invalid binary: %w", err)
	}
	decoded, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return fmt.Errorf("invalid base64: %w", err)
	}
	*b = decoded
	return nil
}

// UUID represents a UUID that serializes as a string.
// This is a simple string wrapper - for full UUID support,
// consider using a library like google/uuid.
type UUID string

// MarshalJSON implements json.Marshaler.
func (u UUID) MarshalJSON() ([]byte, error) {
	return json.Marshal(string(u))
}

// UnmarshalJSON implements json.Unmarshaler.
func (u *UUID) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return fmt.Errorf("invalid uuid: %w", err)
	}
	// Basic UUID format validation
	if !uuidRegex.MatchString(s) {
		return fmt.Errorf("invalid uuid format: %s", s)
	}
	*u = UUID(s)
	return nil
}

// String returns the UUID as a string.
func (u UUID) String() string {
	return string(u)
}

// URI represents a URI that serializes as a string.
type URI struct {
	*url.URL
}

// NewURI creates a URI from a string.
func NewURI(s string) (URI, error) {
	u, err := url.Parse(s)
	if err != nil {
		return URI{}, err
	}
	return URI{u}, nil
}

// MarshalJSON implements json.Marshaler.
func (u URI) MarshalJSON() ([]byte, error) {
	if u.URL == nil {
		return json.Marshal(nil)
	}
	return json.Marshal(u.URL.String())
}

// UnmarshalJSON implements json.Unmarshaler.
func (u *URI) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		// Check for null
		var n interface{}
		if json.Unmarshal(data, &n) == nil && n == nil {
			u.URL = nil
			return nil
		}
		return fmt.Errorf("invalid uri: %w", err)
	}
	parsed, err := url.Parse(s)
	if err != nil {
		return fmt.Errorf("invalid uri: %w", err)
	}
	u.URL = parsed
	return nil
}

// JSONPointer represents a JSON Pointer (RFC 6901) as a string.
type JSONPointer string

// MarshalJSON implements json.Marshaler.
func (p JSONPointer) MarshalJSON() ([]byte, error) {
	return json.Marshal(string(p))
}

// UnmarshalJSON implements json.Unmarshaler.
func (p *JSONPointer) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return fmt.Errorf("invalid jsonpointer: %w", err)
	}
	// Basic JSON Pointer validation
	if s != "" && !jsonPtrRegex.MatchString(s) {
		return fmt.Errorf("invalid jsonpointer format: %s", s)
	}
	*p = JSONPointer(s)
	return nil
}

// String returns the JSON Pointer as a string.
func (p JSONPointer) String() string {
	return string(p)
}

// FormatDuration formats a time.Duration as an ISO 8601 duration string.
func FormatDuration(d time.Duration) string {
	if d == 0 {
		return "PT0S"
	}

	negative := d < 0
	if negative {
		d = -d
	}

	hours := d / time.Hour
	d -= hours * time.Hour
	minutes := d / time.Minute
	d -= minutes * time.Minute
	seconds := d / time.Second
	d -= seconds * time.Second
	nanos := d

	var result string
	if negative {
		result = "-"
	}
	result += "PT"

	if hours > 0 {
		result += strconv.FormatInt(int64(hours), 10) + "H"
	}
	if minutes > 0 {
		result += strconv.FormatInt(int64(minutes), 10) + "M"
	}
	if seconds > 0 || nanos > 0 {
		if nanos > 0 {
			result += strconv.FormatFloat(float64(seconds)+float64(nanos)/1e9, 'f', -1, 64) + "S"
		} else {
			result += strconv.FormatInt(int64(seconds), 10) + "S"
		}
	} else if hours == 0 && minutes == 0 {
		result += "0S"
	}

	return result
}

// ParseDuration parses an ISO 8601 duration string to time.Duration.
func ParseDuration(s string) (time.Duration, error) {
	if !durationRegex.MatchString(s) {
		return 0, fmt.Errorf("invalid ISO 8601 duration: %s", s)
	}

	negative := false
	if len(s) > 0 && s[0] == '-' {
		negative = true
		s = s[1:]
	}

	if len(s) < 2 || s[0] != 'P' {
		return 0, fmt.Errorf("invalid ISO 8601 duration: must start with P")
	}
	s = s[1:]

	var d time.Duration
	var inTime bool

	for len(s) > 0 {
		if s[0] == 'T' {
			inTime = true
			s = s[1:]
			continue
		}

		// Find the number
		i := 0
		for i < len(s) && ((s[i] >= '0' && s[i] <= '9') || s[i] == '.') {
			i++
		}
		if i == 0 || i >= len(s) {
			break
		}

		numStr := s[:i]
		unit := s[i]
		s = s[i+1:]

		var num float64
		var err error
		num, err = strconv.ParseFloat(numStr, 64)
		if err != nil {
			return 0, fmt.Errorf("invalid number in duration: %s", numStr)
		}

		switch unit {
		case 'Y':
			d += time.Duration(num * 365.25 * 24 * float64(time.Hour))
		case 'M':
			if inTime {
				d += time.Duration(num * float64(time.Minute))
			} else {
				d += time.Duration(num * 30.44 * 24 * float64(time.Hour))
			}
		case 'W':
			d += time.Duration(num * 7 * 24 * float64(time.Hour))
		case 'D':
			d += time.Duration(num * 24 * float64(time.Hour))
		case 'H':
			d += time.Duration(num * float64(time.Hour))
		case 'S':
			d += time.Duration(num * float64(time.Second))
		}
	}

	if negative {
		d = -d
	}

	return d, nil
}
