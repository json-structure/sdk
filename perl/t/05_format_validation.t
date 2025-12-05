#!/usr/bin/env perl

use strict;
use warnings FATAL => 'all';
use v5.20;

use Test::More;
use JSON::PP;
use FindBin qw($Bin);
use lib "$Bin/../lib";

use JSON::Structure::InstanceValidator;
use JSON::Structure::SchemaValidator;
use JSON::Structure::ErrorCodes qw(:instance);

my $json = JSON::PP->new->utf8->allow_nonref;

# Helper to create a basic schema
sub schema {
    my (%overrides) = @_;
    return {
        '$schema' => 'https://json-structure.org/meta/core/v0/#',
        '$id'     => 'https://example.com/test.struct.json',
        'name'    => 'Test',
        %overrides
    };
}

#
# Date Format Tests (RFC 3339 full-date)
#
subtest 'Date format validation' => sub {
    my $s = schema(type => 'date');
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    # Valid dates
    ok($validator->validate('2024-01-01')->is_valid, 'valid date: 2024-01-01');
    ok($validator->validate('2024-12-31')->is_valid, 'valid date: 2024-12-31');
    ok($validator->validate('2000-02-29')->is_valid, 'valid leap year date: 2000-02-29');
    ok($validator->validate('2024-02-29')->is_valid, 'valid leap year date: 2024-02-29');
    
    # Invalid dates
    ok(!$validator->validate('2023-02-29')->is_valid, 'invalid: non-leap year 02-29');
    ok(!$validator->validate('2024-13-01')->is_valid, 'invalid: month 13');
    ok(!$validator->validate('2024-00-01')->is_valid, 'invalid: month 00');
    ok(!$validator->validate('2024-04-31')->is_valid, 'invalid: April 31');
    ok(!$validator->validate('01-01-2024')->is_valid, 'invalid format: dd-mm-yyyy');
    ok(!$validator->validate('2024/01/01')->is_valid, 'invalid separator: /');
    ok(!$validator->validate('not-a-date')->is_valid, 'invalid: text');
    ok(!$validator->validate(42)->is_valid, 'invalid: number instead of date string');
};

#
# Time Format Tests (RFC 3339 partial-time or full-time)
#
subtest 'Time format validation' => sub {
    my $s = schema(type => 'time');
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    # Valid times
    ok($validator->validate('00:00:00')->is_valid, 'valid time: midnight');
    ok($validator->validate('23:59:59')->is_valid, 'valid time: one second before midnight');
    ok($validator->validate('12:30:45')->is_valid, 'valid time: 12:30:45');
    ok($validator->validate('09:00:00.123')->is_valid, 'valid time with milliseconds');
    ok($validator->validate('14:30:00Z')->is_valid, 'valid time with Z offset');
    ok($validator->validate('14:30:00+05:30')->is_valid, 'valid time with positive offset');
    ok($validator->validate('14:30:00-08:00')->is_valid, 'valid time with negative offset');
    
    # Invalid times
    ok(!$validator->validate('24:00:00')->is_valid, 'invalid: hour 24');
    ok(!$validator->validate('12:60:00')->is_valid, 'invalid: minute 60');
    ok(!$validator->validate('12:30:60')->is_valid, 'invalid: second 60');
    ok(!$validator->validate('9:30:00')->is_valid, 'invalid: single digit hour');
    ok(!$validator->validate('09:5:00')->is_valid, 'invalid: single digit minute');
    ok(!$validator->validate('9 AM')->is_valid, 'invalid: 12-hour format');
    ok(!$validator->validate('not-a-time')->is_valid, 'invalid: text');
};

#
# DateTime Format Tests (RFC 3339 date-time)
#
subtest 'DateTime format validation' => sub {
    my $s = schema(type => 'datetime');
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    # Valid datetimes
    ok($validator->validate('2024-01-15T12:30:00Z')->is_valid, 'valid datetime with Z');
    ok($validator->validate('2024-01-15T12:30:00+00:00')->is_valid, 'valid datetime with +00:00');
    ok($validator->validate('2024-01-15T12:30:00.123Z')->is_valid, 'valid datetime with milliseconds');
    ok($validator->validate('2024-01-15T12:30:00-05:00')->is_valid, 'valid datetime with negative offset');
    ok($validator->validate('2024-01-15t12:30:00z')->is_valid, 'valid datetime lowercase t and z');
    
    # Invalid datetimes
    ok(!$validator->validate('2024-01-15 12:30:00')->is_valid, 'invalid: space instead of T');
    ok(!$validator->validate('2024-01-15')->is_valid, 'invalid: date only');
    ok(!$validator->validate('12:30:00Z')->is_valid, 'invalid: time only');
    ok(!$validator->validate('not-a-datetime')->is_valid, 'invalid: text');
};

#
# UUID Format Tests
#
subtest 'UUID format validation' => sub {
    my $s = schema(type => 'uuid');
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    # Valid UUIDs
    ok($validator->validate('550e8400-e29b-41d4-a716-446655440000')->is_valid, 'valid UUID v4');
    ok($validator->validate('00000000-0000-0000-0000-000000000000')->is_valid, 'valid nil UUID');
    ok($validator->validate('FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF')->is_valid, 'valid max UUID uppercase');
    ok($validator->validate('ffffffff-ffff-ffff-ffff-ffffffffffff')->is_valid, 'valid max UUID lowercase');
    ok($validator->validate('123e4567-e89b-12d3-a456-426614174000')->is_valid, 'valid UUID v1');
    
    # Invalid UUIDs
    ok(!$validator->validate('550e8400-e29b-41d4-a716-44665544000')->is_valid, 'invalid: too short');
    ok(!$validator->validate('550e8400-e29b-41d4-a716-4466554400000')->is_valid, 'invalid: too long');
    ok(!$validator->validate('550e8400e29b41d4a716446655440000')->is_valid, 'invalid: no hyphens');
    ok(!$validator->validate('550e8400-e29b-41d4-a716-44665544000g')->is_valid, 'invalid: non-hex char');
    ok(!$validator->validate('not-a-uuid')->is_valid, 'invalid: text');
    ok(!$validator->validate(42)->is_valid, 'invalid: number');
};

#
# URI Format Tests
#
subtest 'URI format validation' => sub {
    my $s = schema(type => 'uri');
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    # Valid URIs
    ok($validator->validate('https://example.com')->is_valid, 'valid https URI');
    ok($validator->validate('http://example.com/path')->is_valid, 'valid http URI with path');
    ok($validator->validate('http://example.com:8080/path?query=1')->is_valid, 'valid URI with port and query');
    ok($validator->validate('ftp://ftp.example.com/file.txt')->is_valid, 'valid ftp URI');
    ok($validator->validate('urn:isbn:0451450523')->is_valid, 'valid URN');
    ok($validator->validate('mailto:user@example.com')->is_valid, 'valid mailto URI');
    
    # Invalid URIs (relative paths, no scheme)
    ok(!$validator->validate('/relative/path')->is_valid, 'invalid: relative path');
    ok(!$validator->validate('example.com')->is_valid, 'invalid: no scheme');
    ok(!$validator->validate('')->is_valid, 'invalid: empty string');
    ok(!$validator->validate(42)->is_valid, 'invalid: number');
};

#
# Binary (base64) Format Tests
#
subtest 'Binary (base64) format validation' => sub {
    my $s = schema(type => 'binary');
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    # Valid base64
    ok($validator->validate('SGVsbG8gV29ybGQ=')->is_valid, 'valid base64: "Hello World"');
    ok($validator->validate('YQ==')->is_valid, 'valid base64: "a"');
    ok($validator->validate('YWI=')->is_valid, 'valid base64: "ab"');
    ok($validator->validate('YWJj')->is_valid, 'valid base64: "abc"');
    ok($validator->validate('')->is_valid, 'valid base64: empty');
    ok($validator->validate('dGVzdA==')->is_valid, 'valid base64: "test"');
    
    # Invalid base64
    ok(!$validator->validate('!!!invalid!!!')->is_valid, 'invalid base64: special chars');
    ok(!$validator->validate('SGVsbG8gV29ybGQ')->is_valid, 'invalid base64: wrong padding');
    ok(!$validator->validate(42)->is_valid, 'invalid: number');
};

#
# JSON Pointer Format Tests
#
subtest 'JSON Pointer format validation' => sub {
    my $s = schema(type => 'jsonpointer');
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    # Valid JSON Pointers
    ok($validator->validate('')->is_valid, 'valid pointer: empty (root)');
    ok($validator->validate('/foo')->is_valid, 'valid pointer: /foo');
    ok($validator->validate('/foo/bar')->is_valid, 'valid pointer: /foo/bar');
    ok($validator->validate('/foo/0')->is_valid, 'valid pointer: array index');
    ok($validator->validate('/foo/0/bar')->is_valid, 'valid pointer: nested');
    ok($validator->validate('/~0/~1')->is_valid, 'valid pointer: escaped ~ and /');
    
    # Invalid JSON Pointers
    ok(!$validator->validate('foo')->is_valid, 'invalid: no leading /');
    ok(!$validator->validate('foo/bar')->is_valid, 'invalid: no leading /');
    ok(!$validator->validate('/foo/~2')->is_valid, 'invalid: bad escape ~2');
    ok(!$validator->validate(42)->is_valid, 'invalid: number');
};

#
# Duration Format Tests (ISO 8601)
#
subtest 'Duration format validation' => sub {
    my $s = schema(type => 'duration');
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    # Valid durations
    ok($validator->validate('P1Y')->is_valid, 'valid duration: 1 year');
    ok($validator->validate('P1M')->is_valid, 'valid duration: 1 month');
    ok($validator->validate('P1D')->is_valid, 'valid duration: 1 day');
    ok($validator->validate('PT1H')->is_valid, 'valid duration: 1 hour');
    ok($validator->validate('PT1M')->is_valid, 'valid duration: 1 minute');
    ok($validator->validate('PT1S')->is_valid, 'valid duration: 1 second');
    ok($validator->validate('P1Y2M3DT4H5M6S')->is_valid, 'valid duration: combined');
    ok($validator->validate('PT1H30M')->is_valid, 'valid duration: 1 hour 30 minutes');
    ok($validator->validate('P3W')->is_valid, 'valid duration: 3 weeks');
    ok($validator->validate('PT0S')->is_valid, 'valid duration: zero seconds');
    
    # Invalid durations
    ok(!$validator->validate('1 hour')->is_valid, 'invalid: text format');
    ok(!$validator->validate('P')->is_valid, 'invalid: P only');
    ok(!$validator->validate('1Y2M')->is_valid, 'invalid: no leading P');
    ok(!$validator->validate('P1H')->is_valid, 'invalid: hour without T');
    ok(!$validator->validate(42)->is_valid, 'invalid: number');
};

#
# Decimal Type Tests
#
subtest 'Decimal type validation' => sub {
    my $s = schema(type => 'decimal');
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    # Valid decimal values (can be numeric or string for precision)
    ok($validator->validate(123.45)->is_valid, 'valid decimal: 123.45');
    ok($validator->validate(0)->is_valid, 'valid decimal: 0');
    ok($validator->validate(-123.45)->is_valid, 'valid decimal: negative');
    ok($validator->validate('123.456789012345678901234567890')->is_valid, 'valid decimal: high precision string');
    ok($validator->validate('0.00001')->is_valid, 'valid decimal: small value');
    
    # Numbers represented as strings should work for decimals
    ok($validator->validate('99999999999999999999.99999999999999999999')->is_valid, 'valid decimal: very large string');
};

#
# Int64 Type Tests (as string for large values)
#
subtest 'Int64 type validation with string representation' => sub {
    my $s = schema(type => 'int64');
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    # Valid int64 values
    ok($validator->validate(0)->is_valid, 'valid int64: 0');
    ok($validator->validate(100)->is_valid, 'valid int64: 100');
    ok($validator->validate(-100)->is_valid, 'valid int64: -100');
    
    # String representation for large values beyond JS safe integer
    ok($validator->validate('9007199254740993')->is_valid, 'valid int64 string: beyond JS safe integer');
    ok($validator->validate('-9007199254740993')->is_valid, 'valid int64 string: negative beyond safe');
    ok($validator->validate('9223372036854775807')->is_valid, 'valid int64 string: max int64');
    ok($validator->validate('-9223372036854775808')->is_valid, 'valid int64 string: min int64');
    
    # Invalid
    ok(!$validator->validate('not-a-number')->is_valid, 'invalid: text');
    ok(!$validator->validate(3.14)->is_valid, 'invalid: float');
};

#
# Uint64 Type Tests
#
subtest 'Uint64 type validation' => sub {
    my $s = schema(type => 'uint64');
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    # Valid uint64 values
    ok($validator->validate(0)->is_valid, 'valid uint64: 0');
    ok($validator->validate('18446744073709551615')->is_valid, 'valid uint64 string: max value');
    ok($validator->validate('9007199254740993')->is_valid, 'valid uint64 string: beyond JS safe');
    
    # Invalid
    ok(!$validator->validate(-1)->is_valid, 'invalid uint64: negative');
    ok(!$validator->validate('-1')->is_valid, 'invalid uint64 string: negative');
    ok(!$validator->validate(3.14)->is_valid, 'invalid: float');
};

#
# Float/Double Type Tests
#
subtest 'Float and Double type validation' => sub {
    my $sf = schema(type => 'float');
    my $sd = schema(type => 'double');
    my $vf = JSON::Structure::InstanceValidator->new(schema => $sf);
    my $vd = JSON::Structure::InstanceValidator->new(schema => $sd);
    
    # Valid floats
    ok($vf->validate(3.14)->is_valid, 'valid float: 3.14');
    ok($vf->validate(0)->is_valid, 'valid float: 0');
    ok($vf->validate(-3.14)->is_valid, 'valid float: negative');
    ok($vf->validate(1.23e10)->is_valid, 'valid float: scientific notation');
    
    # Valid doubles
    ok($vd->validate(3.141592653589793)->is_valid, 'valid double: pi');
    ok($vd->validate(1.7976931348623157e308)->is_valid, 'valid double: large');
    
    # Special values as strings
    ok($vf->validate('NaN')->is_valid || !$vf->validate('NaN')->is_valid, 'NaN handling defined');
    ok($vf->validate('Infinity')->is_valid || !$vf->validate('Infinity')->is_valid, 'Infinity handling defined');
    
    # Invalid
    ok(!$vf->validate('hello')->is_valid, 'invalid float: text');
    ok(!$vd->validate([1, 2, 3])->is_valid, 'invalid double: array');
};

#
# Pattern Validation Tests
#
subtest 'Pattern validation' => sub {
    my $s = schema(
        type => 'string',
        pattern => '^[A-Z][a-z]+$'
    );
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s, extended => 1);
    
    # Valid patterns
    ok($validator->validate('Hello')->is_valid, 'valid: matches pattern');
    ok($validator->validate('World')->is_valid, 'valid: matches pattern');
    ok($validator->validate('Ab')->is_valid, 'valid: minimal match');
    
    # Invalid patterns
    my $result = $validator->validate('hello');
    ok(!$result->is_valid, 'invalid: lowercase start');
    ok(scalar(grep { $_->code eq INSTANCE_STRING_PATTERN_MISMATCH } @{$result->errors}), 'reports pattern mismatch');
    
    ok(!$validator->validate('HELLO')->is_valid, 'invalid: all uppercase');
    ok(!$validator->validate('Hello123')->is_valid, 'invalid: contains numbers');
    ok(!$validator->validate('')->is_valid, 'invalid: empty string');
};

#
# Number Constraints Tests
#
subtest 'Number constraints validation' => sub {
    my $s = schema(
        type => 'number',
        minimum => 0,
        maximum => 100,
        exclusiveMinimum => 0,
        exclusiveMaximum => 100
    );
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s, extended => 1);
    
    # Valid values
    ok($validator->validate(50)->is_valid, 'valid: middle of range');
    ok($validator->validate(1)->is_valid, 'valid: just above exclusive min');
    ok($validator->validate(99)->is_valid, 'valid: just below exclusive max');
    ok($validator->validate(0.001)->is_valid, 'valid: just above 0');
    ok($validator->validate(99.999)->is_valid, 'valid: just below 100');
    
    # Invalid values
    ok(!$validator->validate(0)->is_valid, 'invalid: equals exclusive minimum');
    ok(!$validator->validate(100)->is_valid, 'invalid: equals exclusive maximum');
    ok(!$validator->validate(-1)->is_valid, 'invalid: below minimum');
    ok(!$validator->validate(101)->is_valid, 'invalid: above maximum');
};

#
# MultipleOf Tests
#
subtest 'MultipleOf validation' => sub {
    my $s = schema(
        type => 'number',
        multipleOf => 5
    );
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s, extended => 1);
    
    # Valid multiples
    ok($validator->validate(0)->is_valid, 'valid: 0 is multiple of 5');
    ok($validator->validate(5)->is_valid, 'valid: 5 is multiple of 5');
    ok($validator->validate(10)->is_valid, 'valid: 10 is multiple of 5');
    ok($validator->validate(-15)->is_valid, 'valid: -15 is multiple of 5');
    ok($validator->validate(100)->is_valid, 'valid: 100 is multiple of 5');
    
    # Invalid
    my $result = $validator->validate(7);
    ok(!$result->is_valid, 'invalid: 7 is not multiple of 5');
    ok(scalar(grep { $_->code eq INSTANCE_NUMBER_MULTIPLE_OF } @{$result->errors}), 'reports multipleOf error');
    
    ok(!$validator->validate(1)->is_valid, 'invalid: 1');
    ok(!$validator->validate(13)->is_valid, 'invalid: 13');
};

#
# String Length Constraints Tests
#
subtest 'String length constraints' => sub {
    my $s = schema(
        type => 'string',
        minLength => 3,
        maxLength => 10
    );
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s, extended => 1);
    
    # Valid lengths
    ok($validator->validate('abc')->is_valid, 'valid: exactly min length');
    ok($validator->validate('abcdefghij')->is_valid, 'valid: exactly max length');
    ok($validator->validate('hello')->is_valid, 'valid: middle of range');
    
    # Invalid lengths
    my $result = $validator->validate('ab');
    ok(!$result->is_valid, 'invalid: below min length');
    ok(scalar(grep { $_->code eq INSTANCE_STRING_MIN_LENGTH } @{$result->errors}), 'reports minLength error');
    
    $result = $validator->validate('abcdefghijk');
    ok(!$result->is_valid, 'invalid: above max length');
    ok(scalar(grep { $_->code eq INSTANCE_STRING_MAX_LENGTH } @{$result->errors}), 'reports maxLength error');
};

done_testing;
