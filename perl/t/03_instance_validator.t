#!/usr/bin/env perl

use strict;
use warnings;
use v5.20;

use Test::More;
use JSON::PP;
use FindBin qw($Bin);
use lib "$Bin/../lib";

use JSON::Structure::InstanceValidator;
use JSON::Structure::ErrorCodes qw(:instance);

my $json = JSON::PP->new->utf8->allow_nonref;

# Helper to check if any error has the given code
sub has_error_code {
    my ($result, $code) = @_;
    return scalar(grep { $_->code eq $code } @{$result->errors});
}

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

subtest 'Null type validation' => sub {
    my $s = schema(type => 'null');
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    ok($validator->validate(undef)->is_valid, 'undef is valid null');
    ok(!$validator->validate('not null')->is_valid, 'string is not valid null');
    ok(!$validator->validate(42)->is_valid, 'number is not valid null');
};

subtest 'Boolean type validation' => sub {
    my $s = schema(type => 'boolean');
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    ok($validator->validate(JSON::PP::true)->is_valid, 'JSON true is valid');
    ok($validator->validate(JSON::PP::false)->is_valid, 'JSON false is valid');
    ok(!$validator->validate('true')->is_valid, 'string "true" is not valid boolean');
    ok(!$validator->validate(1)->is_valid, 'number 1 is not valid boolean');
};

subtest 'String type validation' => sub {
    my $s = schema(type => 'string');
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    ok($validator->validate('hello')->is_valid, 'string is valid');
    ok($validator->validate('')->is_valid, 'empty string is valid');
    ok(!$validator->validate(42)->is_valid, 'number is not valid string');
    ok(!$validator->validate([1, 2, 3])->is_valid, 'array is not valid string');
};

subtest 'Integer type validation' => sub {
    my $s = schema(type => 'integer');
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    ok($validator->validate(42)->is_valid, 'integer is valid');
    ok($validator->validate(0)->is_valid, 'zero is valid');
    ok($validator->validate(-10)->is_valid, 'negative integer is valid');
    ok(!$validator->validate(3.14)->is_valid, 'float is not valid integer');
    ok(!$validator->validate('42')->is_valid, 'string number is not valid integer');
};

subtest 'Int8/Int16/Int32/Int64 range validation' => sub {
    # int8: -128 to 127
    my $s = schema(type => 'int8');
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    ok($validator->validate(0)->is_valid, 'int8: 0 is valid');
    ok($validator->validate(127)->is_valid, 'int8: 127 is valid');
    ok($validator->validate(-128)->is_valid, 'int8: -128 is valid');
    ok(!$validator->validate(128)->is_valid, 'int8: 128 is out of range');
    ok(!$validator->validate(-129)->is_valid, 'int8: -129 is out of range');
    
    # uint8: 0 to 255
    $s = schema(type => 'uint8');
    $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    ok($validator->validate(0)->is_valid, 'uint8: 0 is valid');
    ok($validator->validate(255)->is_valid, 'uint8: 255 is valid');
    ok(!$validator->validate(-1)->is_valid, 'uint8: -1 is out of range');
    ok(!$validator->validate(256)->is_valid, 'uint8: 256 is out of range');
};

subtest 'Number type validation' => sub {
    my $s = schema(type => 'number');
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    ok($validator->validate(42)->is_valid, 'integer is valid number');
    ok($validator->validate(3.14)->is_valid, 'float is valid number');
    ok($validator->validate(-2.5)->is_valid, 'negative float is valid');
    ok($validator->validate(1e10)->is_valid, 'scientific notation is valid');
    ok(!$validator->validate('3.14')->is_valid, 'string number is not valid number');
};

subtest 'Object type validation' => sub {
    my $s = schema(
        type => 'object',
        properties => {
            name => { type => 'string' },
            age  => { type => 'int32' },
        },
    );
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    ok($validator->validate({ name => 'John', age => 30 })->is_valid, 'valid object');
    ok($validator->validate({ name => 'John' })->is_valid, 'object with missing optional property');
    ok($validator->validate({})->is_valid, 'empty object is valid');
    ok(!$validator->validate('not an object')->is_valid, 'string is not valid object');
    ok(!$validator->validate([1, 2, 3])->is_valid, 'array is not valid object');
    
    # Invalid property type
    my $result = $validator->validate({ name => 123, age => 30 });
    ok(!$result->is_valid, 'object with wrong property type is invalid');
};

subtest 'Required properties' => sub {
    my $s = schema(
        type => 'object',
        properties => {
            name => { type => 'string' },
            age  => { type => 'int32' },
        },
        required => ['name'],
    );
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    ok($validator->validate({ name => 'John', age => 30 })->is_valid, 'object with all required');
    ok($validator->validate({ name => 'John' })->is_valid, 'object with only required');
    
    my $result = $validator->validate({ age => 30 });
    ok(!$result->is_valid, 'object missing required property is invalid');
    ok(has_error_code($result, INSTANCE_REQUIRED_PROPERTY_MISSING), 'reports missing required');
};

subtest 'Additional properties' => sub {
    my $s = schema(
        type => 'object',
        properties => {
            name => { type => 'string' },
        },
        additionalProperties => JSON::PP::false,
    );
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    ok($validator->validate({ name => 'John' })->is_valid, 'object without extra properties');
    
    my $result = $validator->validate({ name => 'John', extra => 'value' });
    ok(!$result->is_valid, 'object with extra properties is invalid');
    ok(has_error_code($result, INSTANCE_ADDITIONAL_PROPERTY_NOT_ALLOWED), 'reports additional property');
};

subtest 'Array type validation' => sub {
    my $s = schema(
        type => 'array',
        items => { type => 'int32' },
    );
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    ok($validator->validate([1, 2, 3])->is_valid, 'valid array of integers');
    ok($validator->validate([])->is_valid, 'empty array is valid');
    ok(!$validator->validate([1, 'two', 3])->is_valid, 'array with wrong type item is invalid');
    ok(!$validator->validate({ a => 1 })->is_valid, 'object is not valid array');
};

subtest 'Set type validation (uniqueness)' => sub {
    my $s = schema(
        type => 'set',
        items => { type => 'int32' },
    );
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    ok($validator->validate([1, 2, 3])->is_valid, 'set with unique items');
    
    my $result = $validator->validate([1, 2, 1]);
    ok(!$result->is_valid, 'set with duplicate items is invalid');
    ok(has_error_code($result, INSTANCE_SET_DUPLICATE), 'reports duplicate');
};

subtest 'Map type validation' => sub {
    my $s = schema(
        type => 'map',
        values => { type => 'int32' },
    );
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    ok($validator->validate({ a => 1, b => 2 })->is_valid, 'valid map');
    ok($validator->validate({})->is_valid, 'empty map is valid');
    ok(!$validator->validate({ a => 'not a number' })->is_valid, 'map with wrong value type is invalid');
};

subtest 'Tuple type validation' => sub {
    my $s = schema(
        type => 'tuple',
        properties => {
            x => { type => 'int32' },
            y => { type => 'int32' },
        },
        tuple => ['x', 'y'],
    );
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    ok($validator->validate([10, 20])->is_valid, 'valid tuple');
    
    my $result = $validator->validate([10]);
    ok(!$result->is_valid, 'tuple with wrong length is invalid');
    
    $result = $validator->validate(['not a number', 20]);
    ok(!$result->is_valid, 'tuple with wrong type is invalid');
};

subtest 'Choice type validation' => sub {
    my $s = schema(
        type => 'choice',
        selector => 'kind',
        choices => {
            circle => {
                type => 'object',
                properties => {
                    kind   => { type => 'string' },
                    radius => { type => 'number' },
                },
            },
            square => {
                type => 'object',
                properties => {
                    kind => { type => 'string' },
                    side => { type => 'number' },
                },
            },
        },
    );
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    ok($validator->validate({ kind => 'circle', radius => 10 })->is_valid, 'valid circle choice');
    ok($validator->validate({ kind => 'square', side => 5 })->is_valid, 'valid square choice');
    
    my $result = $validator->validate({ kind => 'triangle', side => 3 });
    ok(!$result->is_valid, 'unknown choice is invalid');
    ok(has_error_code($result, INSTANCE_CHOICE_UNKNOWN), 'reports unknown choice');
    
    $result = $validator->validate({ radius => 10 });
    ok(!$result->is_valid, 'missing selector is invalid');
};

subtest 'Enum validation' => sub {
    my $s = schema(
        type => 'string',
        enum => ['red', 'green', 'blue'],
    );
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    ok($validator->validate('red')->is_valid, 'enum value is valid');
    ok($validator->validate('green')->is_valid, 'another enum value is valid');
    
    my $result = $validator->validate('yellow');
    ok(!$result->is_valid, 'non-enum value is invalid');
    ok(has_error_code($result, INSTANCE_ENUM_MISMATCH), 'reports enum mismatch');
};

subtest 'Const validation' => sub {
    my $s = schema(
        type => 'string',
        const => 'fixed',
    );
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    ok($validator->validate('fixed')->is_valid, 'const value is valid');
    
    my $result = $validator->validate('different');
    ok(!$result->is_valid, 'non-const value is invalid');
    ok(has_error_code($result, INSTANCE_CONST_MISMATCH), 'reports const mismatch');
};

subtest 'Date/Time type validation' => sub {
    # Date
    my $s = schema(type => 'date');
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    ok($validator->validate('2024-01-15')->is_valid, 'valid date');
    ok(!$validator->validate('2024-13-01')->is_valid, 'invalid month');
    ok(!$validator->validate('not a date')->is_valid, 'invalid date format');
    
    # Time
    $s = schema(type => 'time');
    $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    ok($validator->validate('14:30:00')->is_valid, 'valid time');
    ok($validator->validate('14:30:00.123')->is_valid, 'time with milliseconds');
    ok($validator->validate('14:30:00Z')->is_valid, 'time with Z');
    ok(!$validator->validate('25:00:00')->is_valid, 'invalid hour');
    
    # DateTime
    $s = schema(type => 'datetime');
    $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    ok($validator->validate('2024-01-15T14:30:00Z')->is_valid, 'valid datetime');
    ok($validator->validate('2024-01-15T14:30:00+05:00')->is_valid, 'datetime with offset');
    ok(!$validator->validate('2024-01-15 14:30:00')->is_valid, 'datetime without T');
    
    # Duration
    $s = schema(type => 'duration');
    $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    ok($validator->validate('P1Y2M3D')->is_valid, 'valid duration');
    ok($validator->validate('PT1H30M')->is_valid, 'time-only duration');
    ok(!$validator->validate('1 day')->is_valid, 'invalid duration format');
};

subtest 'UUID type validation' => sub {
    my $s = schema(type => 'uuid');
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    ok($validator->validate('550e8400-e29b-41d4-a716-446655440000')->is_valid, 'valid UUID');
    ok($validator->validate('550E8400-E29B-41D4-A716-446655440000')->is_valid, 'uppercase UUID');
    ok(!$validator->validate('not-a-uuid')->is_valid, 'invalid UUID');
    ok(!$validator->validate('550e8400-e29b-41d4-a716')->is_valid, 'short UUID');
};

subtest 'URI type validation' => sub {
    my $s = schema(type => 'uri');
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    ok($validator->validate('https://example.com/path')->is_valid, 'valid HTTPS URI');
    ok($validator->validate('http://localhost:8080')->is_valid, 'localhost URI');
    ok($validator->validate('ftp://files.example.com')->is_valid, 'FTP URI');
    ok(!$validator->validate('not a uri')->is_valid, 'invalid URI');
    ok(!$validator->validate('/relative/path')->is_valid, 'relative path is not URI');
};

subtest 'Binary type validation' => sub {
    my $s = schema(type => 'binary');
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    ok($validator->validate('SGVsbG8gV29ybGQ=')->is_valid, 'valid base64');
    ok($validator->validate('')->is_valid, 'empty string is valid base64');
};

subtest 'JSON Pointer type validation' => sub {
    my $s = schema(type => 'jsonpointer');
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    ok($validator->validate('')->is_valid, 'empty string is valid (root)');
    ok($validator->validate('/foo/bar')->is_valid, 'valid JSON Pointer');
    ok($validator->validate('/foo/0')->is_valid, 'JSON Pointer with array index');
    ok($validator->validate('/a~0b/c~1d')->is_valid, 'JSON Pointer with escapes');
};

subtest 'Extended validation - string constraints' => sub {
    my $s = schema(
        type      => 'string',
        minLength => 3,
        maxLength => 10,
        pattern   => '^[a-z]+$',
    );
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s, extended => 1);
    
    ok($validator->validate('hello')->is_valid, 'string meeting all constraints');
    
    my $result = $validator->validate('hi');
    ok(!$result->is_valid, 'string too short');
    ok(has_error_code($result, INSTANCE_STRING_MIN_LENGTH), 'reports min length');
    
    $result = $validator->validate('toolongstring');
    ok(!$result->is_valid, 'string too long');
    ok(has_error_code($result, INSTANCE_STRING_MAX_LENGTH), 'reports max length');
    
    $result = $validator->validate('Hello');
    ok(!$result->is_valid, 'string not matching pattern');
    ok(has_error_code($result, INSTANCE_STRING_PATTERN_MISMATCH), 'reports pattern mismatch');
};

subtest 'Extended validation - numeric constraints' => sub {
    my $s = schema(
        type    => 'number',
        minimum => 0,
        maximum => 100,
    );
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s, extended => 1);
    
    ok($validator->validate(50)->is_valid, 'number in range');
    ok($validator->validate(0)->is_valid, 'number at minimum');
    ok($validator->validate(100)->is_valid, 'number at maximum');
    
    my $result = $validator->validate(-1);
    ok(!$result->is_valid, 'number below minimum');
    ok(has_error_code($result, INSTANCE_NUMBER_MINIMUM), 'reports minimum');
    
    $result = $validator->validate(101);
    ok(!$result->is_valid, 'number above maximum');
    ok(has_error_code($result, INSTANCE_NUMBER_MAXIMUM), 'reports maximum');
};

subtest 'Extended validation - array constraints' => sub {
    my $s = schema(
        type     => 'array',
        items    => { type => 'int32' },
        minItems => 2,
        maxItems => 5,
    );
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s, extended => 1);
    
    ok($validator->validate([1, 2, 3])->is_valid, 'array in range');
    
    my $result = $validator->validate([1]);
    ok(!$result->is_valid, 'array too short');
    ok(has_error_code($result, INSTANCE_MIN_ITEMS), 'reports min items');
    
    $result = $validator->validate([1, 2, 3, 4, 5, 6]);
    ok(!$result->is_valid, 'array too long');
    ok(has_error_code($result, INSTANCE_MAX_ITEMS), 'reports max items');
};

subtest '$ref resolution' => sub {
    my $s = schema(
        definitions => {
            Address => {
                type => 'object',
                properties => {
                    street => { type => 'string' },
                    city   => { type => 'string' },
                },
                required => ['street', 'city'],
            },
        },
        type => 'object',
        properties => {
            name    => { type => 'string' },
            address => { type => { '$ref' => '#/definitions/Address' } },
        },
    );
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    my $instance = {
        name    => 'John',
        address => { street => '123 Main St', city => 'Springfield' },
    };
    ok($validator->validate($instance)->is_valid, 'instance with ref is valid');
    
    $instance = {
        name    => 'John',
        address => { street => '123 Main St' },  # missing city
    };
    my $result = $validator->validate($instance);
    ok(!$result->is_valid, 'instance with invalid ref is invalid');
};

subtest 'Source location tracking' => sub {
    my $s = schema(
        type => 'object',
        properties => {
            name => { type => 'string' },
            age  => { type => 'int32' },
        },
    );
    my $validator = JSON::Structure::InstanceValidator->new(schema => $s);
    
    my $instance_json = qq{
{
  "name": "John",
  "age": "not a number"
}
};
    
    my $instance = $json->decode($instance_json);
    my $result = $validator->validate($instance, $instance_json);
    
    ok(!$result->is_valid, 'invalid instance detected');
    
    my @errors = @{$result->errors};
    ok(@errors > 0, 'has errors');
    
    my $error = $errors[0];
    like($error->to_string, qr/age/, 'error mentions property');
};

done_testing();
