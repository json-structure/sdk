#!/usr/bin/env perl

use strict;
use warnings FATAL => 'all';
use v5.20;

use Test::More;
use JSON::MaybeXS;
use FindBin qw($Bin);
use lib "$Bin/../lib";

use JSON::Structure::SchemaValidator;
use JSON::Structure::InstanceValidator;
use JSON::Structure::Types qw(:all);
use JSON::Structure::ErrorCodes qw(:schema :instance);

# Type aliases for convenience
use constant ValidationResult => 'JSON::Structure::Types::ValidationResult';
use constant ValidationError  => 'JSON::Structure::Types::ValidationError';
use constant ValidationSeverity => 'JSON::Structure::Types::ValidationSeverity';
use constant JsonLocation => 'JSON::Structure::Types::JsonLocation';

my $json = JSON::MaybeXS->new->utf8->allow_nonref;

# Helper to create a basic schema
sub schema {
    my (%overrides) = @_;
    return {
        '$schema' => 'https://json-structure.org/meta/extended/v0/#',
        '$id'     => 'https://example.com/test.struct.json',
        'name'    => 'Test',
        '$uses'   => ['JSONStructureValidation'],
        %overrides
    };
}

# Helper to create an instance validator in extended mode
sub validator {
    my ($s) = @_;
    return JSON::Structure::InstanceValidator->new(schema => $s, extended => 1);
}

#############################################################################
# PART 1: ValidationResult Tests
#############################################################################

subtest 'ValidationResult - basic functionality' => sub {
    # Success result
    my $success = ValidationResult->new(is_valid => 1);
    ok($success->is_valid, 'Success result is valid');
    is(scalar @{$success->errors}, 0, 'Success result has no errors');
    is(scalar @{$success->warnings}, 0, 'Success result has no warnings');
    
    # Failure result
    my $failure = ValidationResult->new(is_valid => 0);
    ok(!$failure->is_valid, 'Failure result is not valid');
    
    # Result with errors
    my $err = ValidationError->new(
        code => 'ERR001',
        message => 'Test error',
        path => '/test'
    );
    my $result_with_errors = ValidationResult->new(
        is_valid => 0,
        errors => [$err]
    );
    ok(!$result_with_errors->is_valid, 'Result with errors is not valid');
    is(scalar @{$result_with_errors->errors}, 1, 'Has one error');
    is($result_with_errors->errors->[0]->code, 'ERR001', 'Error code is correct');
    is($result_with_errors->errors->[0]->message, 'Test error', 'Error message is correct');
    is($result_with_errors->errors->[0]->path, '/test', 'Error path is correct');
};

subtest 'ValidationResult - add_error and add_warning' => sub {
    my $result = ValidationResult->new(is_valid => 1);
    
    $result->add_error(
        code => 'ERR002',
        message => 'Another error',
        path => '/another'
    );
    
    ok(!$result->is_valid, 'Adding error makes result invalid');
    is(scalar @{$result->errors}, 1, 'Has one error after add_error');
    
    $result->add_warning(
        code => 'WARN001',
        message => 'A warning',
        path => '/warn'
    );
    
    is(scalar @{$result->warnings}, 1, 'Has one warning after add_warning');
    ok(!$result->is_valid, 'Result still invalid (warnings don\'t affect validity)');
};

#############################################################################
# PART 2: ValidationError Tests
#############################################################################

subtest 'ValidationError - construction' => sub {
    my $error = ValidationError->new(
        code => 'TEST001',
        message => 'Test message',
        path => '/path/to/value'
    );
    
    is($error->code, 'TEST001', 'Error code is set');
    is($error->message, 'Test message', 'Error message is set');
    is($error->path, '/path/to/value', 'Error path is set');
    is($error->severity, ValidationSeverity->ERROR, 'Default severity is ERROR');
};

subtest 'ValidationError - with location' => sub {
    my $loc = JsonLocation->new(line => 10, column => 5);
    my $error = ValidationError->new(
        code => 'LOC001',
        message => 'Located error',
        path => '/loc',
        location => $loc
    );
    
    ok($error->location->is_known, 'Location is known');
    is($error->location->line, 10, 'Line is correct');
    is($error->location->column, 5, 'Column is correct');
};

subtest 'ValidationError - severity levels' => sub {
    my $err = ValidationError->new(
        code => 'E001',
        message => 'Error',
        path => '/',
        severity => ValidationSeverity->ERROR
    );
    is($err->severity, ValidationSeverity->ERROR, 'Error severity');
    
    my $warn = ValidationError->new(
        code => 'W001',
        message => 'Warning',
        path => '/',
        severity => ValidationSeverity->WARNING
    );
    is($warn->severity, ValidationSeverity->WARNING, 'Warning severity');
};

#############################################################################
# PART 3: JsonLocation Tests
#############################################################################

subtest 'JsonLocation - basic functionality' => sub {
    my $loc = JsonLocation->new(line => 5, column => 10);
    is($loc->line, 5, 'Line is set');
    is($loc->column, 10, 'Column is set');
    ok($loc->is_known, 'Location with line and column is known');
    
    my $unknown = JsonLocation->new();
    ok(!$unknown->is_known, 'Default location is unknown');
    is($unknown->line, 0, 'Unknown location has line 0');
    is($unknown->column, 0, 'Unknown location has column 0');
};

#############################################################################
# PART 4: Primitive Type Validation Tests
#############################################################################

subtest 'Integer types - int8' => sub {
    my $s = schema(type => 'int8');
    my $v = validator($s);
    
    ok($v->validate(0)->is_valid, 'int8: 0 is valid');
    ok($v->validate(127)->is_valid, 'int8: 127 is valid (max)');
    ok($v->validate(-128)->is_valid, 'int8: -128 is valid (min)');
    ok(!$v->validate(128)->is_valid, 'int8: 128 is invalid (too large)');
    ok(!$v->validate(-129)->is_valid, 'int8: -129 is invalid (too small)');
};

subtest 'Integer types - uint8' => sub {
    my $s = schema(type => 'uint8');
    my $v = validator($s);
    
    ok($v->validate(0)->is_valid, 'uint8: 0 is valid');
    ok($v->validate(255)->is_valid, 'uint8: 255 is valid (max)');
    ok(!$v->validate(256)->is_valid, 'uint8: 256 is invalid (too large)');
    ok(!$v->validate(-1)->is_valid, 'uint8: -1 is invalid (negative)');
};

subtest 'Integer types - int16' => sub {
    my $s = schema(type => 'int16');
    my $v = validator($s);
    
    ok($v->validate(0)->is_valid, 'int16: 0 is valid');
    ok($v->validate(32767)->is_valid, 'int16: 32767 is valid (max)');
    ok($v->validate(-32768)->is_valid, 'int16: -32768 is valid (min)');
    ok(!$v->validate(32768)->is_valid, 'int16: 32768 is invalid (too large)');
    ok(!$v->validate(-32769)->is_valid, 'int16: -32769 is invalid (too small)');
};

subtest 'Integer types - uint16' => sub {
    my $s = schema(type => 'uint16');
    my $v = validator($s);
    
    ok($v->validate(0)->is_valid, 'uint16: 0 is valid');
    ok($v->validate(65535)->is_valid, 'uint16: 65535 is valid (max)');
    ok(!$v->validate(65536)->is_valid, 'uint16: 65536 is invalid (too large)');
    ok(!$v->validate(-1)->is_valid, 'uint16: -1 is invalid (negative)');
};

subtest 'Integer types - int32' => sub {
    my $s = schema(type => 'int32');
    my $v = validator($s);
    
    ok($v->validate(0)->is_valid, 'int32: 0 is valid');
    ok($v->validate(2147483647)->is_valid, 'int32: 2147483647 is valid (max)');
    ok($v->validate(-2147483648)->is_valid, 'int32: -2147483648 is valid (min)');
    ok(!$v->validate(2147483648)->is_valid, 'int32: 2147483648 is invalid (too large)');
    ok(!$v->validate(-2147483649)->is_valid, 'int32: -2147483649 is invalid (too small)');
};

subtest 'Integer types - uint32' => sub {
    my $s = schema(type => 'uint32');
    my $v = validator($s);
    
    ok($v->validate(0)->is_valid, 'uint32: 0 is valid');
    ok($v->validate(4294967295)->is_valid, 'uint32: 4294967295 is valid (max)');
    ok(!$v->validate(4294967296)->is_valid, 'uint32: 4294967296 is invalid (too large)');
    ok(!$v->validate(-1)->is_valid, 'uint32: -1 is invalid (negative)');
};

subtest 'Integer types - int64' => sub {
    my $s = schema(type => 'int64');
    my $v = validator($s);
    
    # int64 accepts numeric values in safe integer range
    ok($v->validate(0)->is_valid, 'int64: 0 is valid');
    ok($v->validate(1000000)->is_valid, 'int64: large positive is valid');
    ok($v->validate(-1000000)->is_valid, 'int64: large negative is valid');
    ok(!$v->validate("not-a-number")->is_valid, 'int64: non-numeric string is invalid');
};

subtest 'Integer types - uint64' => sub {
    my $s = schema(type => 'uint64');
    my $v = validator($s);
    
    # uint64 accepts non-negative numeric values
    ok($v->validate(0)->is_valid, 'uint64: 0 is valid');
    ok($v->validate(1000000)->is_valid, 'uint64: large positive is valid');
    ok(!$v->validate(-1)->is_valid, 'uint64: -1 is invalid (negative)');
};

subtest 'Float types - float' => sub {
    my $s = schema(type => 'float');
    my $v = validator($s);
    
    ok($v->validate(3.14)->is_valid, 'float: 3.14 is valid');
    ok($v->validate(0)->is_valid, 'float: 0 is valid');
    ok($v->validate(-123.456)->is_valid, 'float: negative float is valid');
    ok(!$v->validate("3.14")->is_valid, 'float: string is invalid');
};

subtest 'Float types - double' => sub {
    my $s = schema(type => 'double');
    my $v = validator($s);
    
    ok($v->validate(3.14159265358979)->is_valid, 'double: pi is valid');
    ok($v->validate(0)->is_valid, 'double: 0 is valid');
    ok($v->validate(-1.7976931348623157e308)->is_valid, 'double: large negative is valid');
    ok(!$v->validate("3.14")->is_valid, 'double: string is invalid');
};

subtest 'Float types - number' => sub {
    my $s = schema(type => 'number');
    my $v = validator($s);
    
    ok($v->validate(42)->is_valid, 'number: integer is valid');
    ok($v->validate(3.14)->is_valid, 'number: float is valid');
    ok($v->validate(-100.5)->is_valid, 'number: negative is valid');
    ok(!$v->validate("42")->is_valid, 'number: string is invalid');
};

subtest 'Decimal type' => sub {
    my $s = schema(type => 'decimal');
    my $v = validator($s);
    
    # decimal accepts numeric values 
    ok($v->validate(100.50)->is_valid, 'decimal: as number is valid');
    ok($v->validate(12345.67890)->is_valid, 'decimal: precision number is valid');
    ok($v->validate(-999.999)->is_valid, 'decimal: negative as number is valid');
    ok(!$v->validate("not-a-decimal")->is_valid, 'decimal: invalid string is invalid');
};

subtest 'Boolean type' => sub {
    my $s = schema(type => 'boolean');
    my $v = validator($s);
    
    ok($v->validate(JSON::MaybeXS::true)->is_valid, 'boolean: true is valid');
    ok($v->validate(JSON::MaybeXS::false)->is_valid, 'boolean: false is valid');
    ok(!$v->validate(1)->is_valid, 'boolean: 1 is invalid');
    ok(!$v->validate(0)->is_valid, 'boolean: 0 is invalid');
    ok(!$v->validate("true")->is_valid, 'boolean: "true" string is invalid');
};

subtest 'Null type' => sub {
    my $s = schema(type => 'null');
    my $v = validator($s);
    
    ok($v->validate(undef)->is_valid, 'null: undef is valid');
    ok(!$v->validate(0)->is_valid, 'null: 0 is invalid');
    ok(!$v->validate("")->is_valid, 'null: empty string is invalid');
    ok(!$v->validate(JSON::MaybeXS::false)->is_valid, 'null: false is invalid');
};

subtest 'Any type' => sub {
    my $s = schema(type => 'any');
    my $v = validator($s);
    
    ok($v->validate("string")->is_valid, 'any: string is valid');
    ok($v->validate(42)->is_valid, 'any: number is valid');
    ok($v->validate(JSON::MaybeXS::true)->is_valid, 'any: boolean is valid');
    ok($v->validate([1, 2, 3])->is_valid, 'any: array is valid');
    ok($v->validate({a => 1})->is_valid, 'any: object is valid');
    ok($v->validate(undef)->is_valid, 'any: null is valid');
};

#############################################################################
# PART 5: String Constraint Tests
#############################################################################

subtest 'String - minLength' => sub {
    my $s = schema(type => 'string', minLength => 3);
    my $v = validator($s);
    
    ok($v->validate("abc")->is_valid, 'minLength: exactly 3 chars is valid');
    ok($v->validate("abcd")->is_valid, 'minLength: 4 chars is valid');
    ok(!$v->validate("ab")->is_valid, 'minLength: 2 chars is invalid');
    ok(!$v->validate("")->is_valid, 'minLength: empty string is invalid');
};

subtest 'String - maxLength' => sub {
    my $s = schema(type => 'string', maxLength => 5);
    my $v = validator($s);
    
    ok($v->validate("abc")->is_valid, 'maxLength: 3 chars is valid');
    ok($v->validate("abcde")->is_valid, 'maxLength: exactly 5 chars is valid');
    ok(!$v->validate("abcdef")->is_valid, 'maxLength: 6 chars is invalid');
};

subtest 'String - pattern' => sub {
    my $s = schema(type => 'string', pattern => '^[A-Z][a-z]+$');
    my $v = validator($s);
    
    ok($v->validate("Hello")->is_valid, 'pattern: matches is valid');
    ok($v->validate("World")->is_valid, 'pattern: matches is valid');
    ok(!$v->validate("hello")->is_valid, 'pattern: no uppercase start is invalid');
    ok(!$v->validate("HELLO")->is_valid, 'pattern: all uppercase is invalid');
    ok(!$v->validate("Hello123")->is_valid, 'pattern: with numbers is invalid');
};

subtest 'String - minLength and maxLength combined' => sub {
    my $s = schema(type => 'string', minLength => 2, maxLength => 5);
    my $v = validator($s);
    
    ok($v->validate("ab")->is_valid, 'combined: 2 chars is valid');
    ok($v->validate("abcde")->is_valid, 'combined: 5 chars is valid');
    ok($v->validate("abc")->is_valid, 'combined: 3 chars is valid');
    ok(!$v->validate("a")->is_valid, 'combined: 1 char is invalid');
    ok(!$v->validate("abcdef")->is_valid, 'combined: 6 chars is invalid');
};

#############################################################################
# PART 6: Number Constraint Tests
#############################################################################

subtest 'Number - minimum' => sub {
    my $s = schema(type => 'number', minimum => 10);
    my $v = validator($s);
    
    ok($v->validate(10)->is_valid, 'minimum: exactly 10 is valid');
    ok($v->validate(15)->is_valid, 'minimum: 15 is valid');
    ok($v->validate(10.5)->is_valid, 'minimum: 10.5 is valid');
    ok(!$v->validate(9)->is_valid, 'minimum: 9 is invalid');
    ok(!$v->validate(9.99)->is_valid, 'minimum: 9.99 is invalid');
};

subtest 'Number - maximum' => sub {
    my $s = schema(type => 'number', maximum => 100);
    my $v = validator($s);
    
    ok($v->validate(100)->is_valid, 'maximum: exactly 100 is valid');
    ok($v->validate(50)->is_valid, 'maximum: 50 is valid');
    ok(!$v->validate(101)->is_valid, 'maximum: 101 is invalid');
    ok(!$v->validate(100.1)->is_valid, 'maximum: 100.1 is invalid');
};

subtest 'Number - exclusiveMinimum' => sub {
    my $s = schema(type => 'number', exclusiveMinimum => 10);
    my $v = validator($s);
    
    ok($v->validate(11)->is_valid, 'exclusiveMinimum: 11 is valid');
    ok($v->validate(10.01)->is_valid, 'exclusiveMinimum: 10.01 is valid');
    ok(!$v->validate(10)->is_valid, 'exclusiveMinimum: exactly 10 is invalid');
    ok(!$v->validate(9)->is_valid, 'exclusiveMinimum: 9 is invalid');
};

subtest 'Number - exclusiveMaximum' => sub {
    my $s = schema(type => 'number', exclusiveMaximum => 100);
    my $v = validator($s);
    
    ok($v->validate(99)->is_valid, 'exclusiveMaximum: 99 is valid');
    ok($v->validate(99.99)->is_valid, 'exclusiveMaximum: 99.99 is valid');
    ok(!$v->validate(100)->is_valid, 'exclusiveMaximum: exactly 100 is invalid');
    ok(!$v->validate(101)->is_valid, 'exclusiveMaximum: 101 is invalid');
};

subtest 'Number - multipleOf' => sub {
    my $s = schema(type => 'number', multipleOf => 5);
    my $v = validator($s);
    
    ok($v->validate(0)->is_valid, 'multipleOf: 0 is valid');
    ok($v->validate(5)->is_valid, 'multipleOf: 5 is valid');
    ok($v->validate(15)->is_valid, 'multipleOf: 15 is valid');
    ok($v->validate(-10)->is_valid, 'multipleOf: -10 is valid');
    ok(!$v->validate(3)->is_valid, 'multipleOf: 3 is invalid');
    ok(!$v->validate(7)->is_valid, 'multipleOf: 7 is invalid');
};

subtest 'Number - multipleOf with decimals' => sub {
    my $s = schema(type => 'number', multipleOf => 0.5);
    my $v = validator($s);
    
    ok($v->validate(0)->is_valid, 'multipleOf 0.5: 0 is valid');
    ok($v->validate(0.5)->is_valid, 'multipleOf 0.5: 0.5 is valid');
    ok($v->validate(1)->is_valid, 'multipleOf 0.5: 1 is valid');
    ok($v->validate(2.5)->is_valid, 'multipleOf 0.5: 2.5 is valid');
    ok(!$v->validate(0.3)->is_valid, 'multipleOf 0.5: 0.3 is invalid');
};

#############################################################################
# PART 7: Array Constraint Tests
#############################################################################

subtest 'Array - minItems' => sub {
    my $s = schema(type => 'array', items => {type => 'int32'}, minItems => 2);
    my $v = validator($s);
    
    ok($v->validate([1, 2])->is_valid, 'minItems: 2 items is valid');
    ok($v->validate([1, 2, 3])->is_valid, 'minItems: 3 items is valid');
    ok(!$v->validate([1])->is_valid, 'minItems: 1 item is invalid');
    ok(!$v->validate([])->is_valid, 'minItems: empty array is invalid');
};

subtest 'Array - maxItems' => sub {
    my $s = schema(type => 'array', items => {type => 'int32'}, maxItems => 3);
    my $v = validator($s);
    
    ok($v->validate([1, 2, 3])->is_valid, 'maxItems: 3 items is valid');
    ok($v->validate([1])->is_valid, 'maxItems: 1 item is valid');
    ok($v->validate([])->is_valid, 'maxItems: empty array is valid');
    ok(!$v->validate([1, 2, 3, 4])->is_valid, 'maxItems: 4 items is invalid');
};

subtest 'Array - uniqueItems (via set type)' => sub {
    # Note: uniqueItems keyword not implemented, but 'set' type enforces uniqueness
    my $s = schema(type => 'set', items => {type => 'int32'});
    my $v = validator($s);
    
    ok($v->validate([1, 2, 3])->is_valid, 'set: all unique is valid');
    ok($v->validate([])->is_valid, 'set: empty array is valid');
    ok(!$v->validate([1, 2, 2])->is_valid, 'set: duplicates is invalid');
    ok(!$v->validate([1, 1, 1])->is_valid, 'set: all same is invalid');
};

#############################################################################
# PART 8: Object Constraint Tests
#############################################################################

subtest 'Object - required' => sub {
    my $s = schema(
        type => 'object',
        properties => {
            name => {type => 'string'},
            age => {type => 'int32'}
        },
        required => ['name']
    );
    my $v = validator($s);
    
    ok($v->validate({name => 'Alice'})->is_valid, 'required: has required prop is valid');
    ok($v->validate({name => 'Alice', age => 30})->is_valid, 'required: has all props is valid');
    ok(!$v->validate({age => 30})->is_valid, 'required: missing required is invalid');
    ok(!$v->validate({})->is_valid, 'required: empty object is invalid');
};

subtest 'Object - additionalProperties false' => sub {
    my $s = schema(
        type => 'object',
        properties => {
            name => {type => 'string'}
        },
        additionalProperties => JSON::MaybeXS::false
    );
    my $v = validator($s);
    
    ok($v->validate({name => 'Alice'})->is_valid, 'additionalProperties false: only known prop is valid');
    ok($v->validate({})->is_valid, 'additionalProperties false: empty is valid');
    ok(!$v->validate({name => 'Alice', extra => 'value'})->is_valid, 'additionalProperties false: extra prop is invalid');
};

subtest 'Object - additionalProperties schema' => sub {
    my $s = schema(
        type => 'object',
        properties => {
            name => {type => 'string'}
        },
        additionalProperties => {type => 'int32'}
    );
    my $v = validator($s);
    
    ok($v->validate({name => 'Alice', extra => 42})->is_valid, 'additionalProperties schema: int32 extra is valid');
    ok(!$v->validate({name => 'Alice', extra => 'string'})->is_valid, 'additionalProperties schema: string extra is invalid');
};

subtest 'Object - minProperties' => sub {
    my $s = schema(type => 'object', minProperties => 2);
    my $v = validator($s);
    
    ok($v->validate({a => 1, b => 2})->is_valid, 'minProperties: 2 props is valid');
    ok($v->validate({a => 1, b => 2, c => 3})->is_valid, 'minProperties: 3 props is valid');
    ok(!$v->validate({a => 1})->is_valid, 'minProperties: 1 prop is invalid');
    ok(!$v->validate({})->is_valid, 'minProperties: empty is invalid');
};

subtest 'Object - maxProperties' => sub {
    my $s = schema(type => 'object', maxProperties => 2);
    my $v = validator($s);
    
    ok($v->validate({})->is_valid, 'maxProperties: empty is valid');
    ok($v->validate({a => 1})->is_valid, 'maxProperties: 1 prop is valid');
    ok($v->validate({a => 1, b => 2})->is_valid, 'maxProperties: 2 props is valid');
    ok(!$v->validate({a => 1, b => 2, c => 3})->is_valid, 'maxProperties: 3 props is invalid');
};

#############################################################################
# PART 9: Set Type Tests
#############################################################################

subtest 'Set - unique items enforced' => sub {
    my $s = schema(type => 'set', items => {type => 'string'});
    my $v = validator($s);
    
    ok($v->validate(['a', 'b', 'c'])->is_valid, 'set: unique items is valid');
    ok($v->validate([])->is_valid, 'set: empty is valid');
    ok(!$v->validate(['a', 'b', 'a'])->is_valid, 'set: duplicate items is invalid');
};

subtest 'Set - item type validation' => sub {
    my $s = schema(type => 'set', items => {type => 'int32'});
    my $v = validator($s);
    
    ok($v->validate([1, 2, 3])->is_valid, 'set: int32 items is valid');
    ok(!$v->validate([1, 'two', 3])->is_valid, 'set: mixed types is invalid');
};

#############################################################################
# PART 10: Map Type Tests
#############################################################################

subtest 'Map - values validation' => sub {
    my $s = schema(type => 'map', values => {type => 'int32'});
    my $v = validator($s);
    
    ok($v->validate({a => 1, b => 2})->is_valid, 'map: int32 values is valid');
    ok($v->validate({})->is_valid, 'map: empty is valid');
    ok(!$v->validate({a => 1, b => 'two'})->is_valid, 'map: string value is invalid');
};

subtest 'Map - minEntries' => sub {
    my $s = schema(type => 'map', values => {type => 'int32'}, minEntries => 2);
    my $v = validator($s);
    
    ok($v->validate({a => 1, b => 2})->is_valid, 'map minEntries: 2 entries is valid');
    ok($v->validate({a => 1, b => 2, c => 3})->is_valid, 'map minEntries: 3 entries is valid');
    ok(!$v->validate({a => 1})->is_valid, 'map minEntries: 1 entry is invalid');
};

subtest 'Map - maxEntries' => sub {
    my $s = schema(type => 'map', values => {type => 'int32'}, maxEntries => 2);
    my $v = validator($s);
    
    ok($v->validate({})->is_valid, 'map maxEntries: 0 entries is valid');
    ok($v->validate({a => 1, b => 2})->is_valid, 'map maxEntries: 2 entries is valid');
    ok(!$v->validate({a => 1, b => 2, c => 3})->is_valid, 'map maxEntries: 3 entries is invalid');
};

subtest 'Map - keyNames pattern' => sub {
    my $s = schema(type => 'map', values => {type => 'int32'}, keyNames => {pattern => '^[a-z]+$'});
    my $v = validator($s);
    
    ok($v->validate({abc => 1, xyz => 2})->is_valid, 'map keyNames: lowercase keys is valid');
    ok(!$v->validate({ABC => 1})->is_valid, 'map keyNames: uppercase keys is invalid');
    ok(!$v->validate({key123 => 1})->is_valid, 'map keyNames: keys with numbers is invalid');
};

#############################################################################
# PART 11: Tuple Type Tests
#############################################################################

subtest 'Tuple - positional validation' => sub {
    my $s = schema(
        type => 'tuple',
        properties => {
            first => {type => 'string'},
            second => {type => 'int32'},
            third => {type => 'boolean'}
        },
        tuple => ['first', 'second', 'third']
    );
    my $v = validator($s);
    
    ok($v->validate(['hello', 42, JSON::MaybeXS::true])->is_valid, 'tuple: correct types is valid');
    ok(!$v->validate([42, 'hello', JSON::MaybeXS::true])->is_valid, 'tuple: wrong order is invalid');
    ok(!$v->validate(['hello', 42])->is_valid, 'tuple: missing element is invalid');
    ok(!$v->validate(['hello', 42, JSON::MaybeXS::true, 'extra'])->is_valid, 'tuple: extra element is invalid');
};

#############################################################################
# PART 12: Choice Type Tests
#############################################################################

subtest 'Choice - without selector (inferred)' => sub {
    # Choice without selector tries to match value against each choice schema
    my $s = schema(
        type => 'choice',
        choices => {
            stringType => {type => 'string'},
            numberType => {type => 'int32'}
        }
    );
    my $v = validator($s);
    
    # The value itself is matched against the choice schemas
    ok($v->validate('hello')->is_valid, 'choice: string matches stringType');
    ok($v->validate(42)->is_valid, 'choice: number matches numberType');
    ok(!$v->validate(JSON::MaybeXS::true)->is_valid, 'choice: boolean matches nothing');
};

subtest 'Choice - with selector' => sub {
    my $s = schema(
        type => 'choice',
        selector => 'paymentType',
        choices => {
            card => {
                type => 'object',
                properties => {
                    paymentType => {type => 'string'},
                    cardNumber => {type => 'string'}
                }
            },
            cash => {
                type => 'object',
                properties => {
                    paymentType => {type => 'string'},
                    amount => {type => 'int32'}
                }
            }
        }
    );
    my $v = validator($s);
    
    ok($v->validate({paymentType => 'card', cardNumber => '1234'})->is_valid, 
       'choice with selector: card payment is valid');
    ok($v->validate({paymentType => 'cash', amount => 50})->is_valid,
       'choice with selector: cash payment is valid');
    ok(!$v->validate({paymentType => 'unknown', data => 'x'})->is_valid,
       'choice with selector: unknown type is invalid');
    ok(!$v->validate({amount => 50})->is_valid,
       'choice with selector: missing selector is invalid');
};

#############################################################################
# PART 13: Enum and Const Tests
#############################################################################

subtest 'Enum - string values' => sub {
    my $s = schema(enum => ['red', 'green', 'blue']);
    my $v = validator($s);
    
    ok($v->validate('red')->is_valid, 'enum: "red" is valid');
    ok($v->validate('green')->is_valid, 'enum: "green" is valid');
    ok(!$v->validate('yellow')->is_valid, 'enum: "yellow" is invalid');
    ok(!$v->validate('RED')->is_valid, 'enum: case-sensitive, "RED" is invalid');
};

subtest 'Enum - mixed values' => sub {
    my $s = schema(enum => [1, 'one', JSON::MaybeXS::true]);
    my $v = validator($s);
    
    ok($v->validate(1)->is_valid, 'enum mixed: 1 is valid');
    ok($v->validate('one')->is_valid, 'enum mixed: "one" is valid');
    ok($v->validate(JSON::MaybeXS::true)->is_valid, 'enum mixed: true is valid');
    ok(!$v->validate(2)->is_valid, 'enum mixed: 2 is invalid');
};

subtest 'Const - exact match' => sub {
    my $s = schema(const => 'fixed-value');
    my $v = validator($s);
    
    ok($v->validate('fixed-value')->is_valid, 'const: exact match is valid');
    ok(!$v->validate('other-value')->is_valid, 'const: different string is invalid');
    ok(!$v->validate(42)->is_valid, 'const: number is invalid');
};

#############################################################################
# PART 14: Composition Tests (allOf, anyOf, oneOf, not)
#############################################################################

subtest 'allOf - all schemas must match' => sub {
    my $s = schema(
        allOf => [
            {type => 'object', properties => {id => {type => 'int32'}}},
            {type => 'object', properties => {name => {type => 'string'}}, required => ['name']}
        ]
    );
    my $v = validator($s);
    
    ok($v->validate({name => 'Alice', id => 1})->is_valid, 'allOf: meets all requirements is valid');
    ok(!$v->validate({id => 1})->is_valid, 'allOf: missing required from second schema is invalid');
};

subtest 'anyOf - at least one schema must match' => sub {
    my $s = schema(
        anyOf => [
            {type => 'string'},
            {type => 'int32'}
        ]
    );
    my $v = validator($s);
    
    ok($v->validate('hello')->is_valid, 'anyOf: string is valid');
    ok($v->validate(42)->is_valid, 'anyOf: int32 is valid');
    ok(!$v->validate(JSON::MaybeXS::true)->is_valid, 'anyOf: boolean is invalid');
    ok(!$v->validate([1, 2, 3])->is_valid, 'anyOf: array is invalid');
};

subtest 'oneOf - exactly one schema must match' => sub {
    my $s = schema(
        oneOf => [
            {type => 'string'},
            {type => 'int32'}
        ]
    );
    my $v = validator($s);
    
    ok($v->validate('hello')->is_valid, 'oneOf: string is valid');
    ok($v->validate(42)->is_valid, 'oneOf: int32 is valid');
    ok(!$v->validate(JSON::MaybeXS::true)->is_valid, 'oneOf: boolean is invalid');
};

subtest 'oneOf - fails when multiple match' => sub {
    my $s = schema(
        oneOf => [
            {type => 'int32'},
            {type => 'int32', minimum => 0}  # Both match for positive integers
        ]
    );
    my $v = validator($s);
    
    ok(!$v->validate(42)->is_valid, 'oneOf: multiple matches is invalid');
    # Negative numbers only match first schema
    ok($v->validate(-5)->is_valid, 'oneOf: single match is valid');
};

subtest 'not - must not match' => sub {
    my $s = schema(
        not => {type => 'string'}
    );
    my $v = validator($s);
    
    ok($v->validate(42)->is_valid, 'not: number is valid');
    ok($v->validate(JSON::MaybeXS::true)->is_valid, 'not: boolean is valid');
    ok($v->validate([1, 2, 3])->is_valid, 'not: array is valid');
    ok(!$v->validate('hello')->is_valid, 'not: string is invalid');
};

#############################################################################
# PART 15: if/then/else Tests
#############################################################################

subtest 'if/then/else - conditional validation' => sub {
    my $s = schema(
        type => 'object',
        'if' => {
            type => 'object',
            properties => {type => {const => 'premium'}},
            required => ['type']
        },
        'then' => {
            type => 'object',
            properties => {discount => {type => 'int32', minimum => 10}},
            required => ['discount']
        },
        'else' => {
            type => 'object',
            properties => {discount => {type => 'int32', maximum => 5}}
        }
    );
    my $v = validator($s);
    
    ok($v->validate({type => 'premium', discount => 15})->is_valid, 'if/then: premium with 15% discount is valid');
    ok(!$v->validate({type => 'premium', discount => 5})->is_valid, 'if/then: premium with 5% discount is invalid');
};

#############################################################################
# PART 16: $ref Tests
#############################################################################

subtest '$ref - local definition' => sub {
    my $s = schema(
        type => {
            '$ref' => '#/definitions/Name'
        },
        definitions => {
            Name => {type => 'string', minLength => 1}
        }
    );
    my $v = validator($s);
    
    ok($v->validate('Alice')->is_valid, '$ref: valid string is valid');
    ok(!$v->validate('')->is_valid, '$ref: empty string is invalid');
    ok(!$v->validate(42)->is_valid, '$ref: number is invalid');
};

subtest '$root - schema entry point' => sub {
    my $s = {
        '$schema' => 'https://json-structure.org/meta/core/v0/#',
        '$id' => 'https://example.com/test.struct.json',
        '$root' => '#/definitions/Person',
        definitions => {
            Person => {
                name => 'Person',
                type => 'object',
                properties => {
                    name => {type => 'string'},
                    age => {type => 'int32'}
                },
                required => ['name']
            }
        }
    };
    my $v = validator($s);
    
    ok($v->validate({name => 'Alice'})->is_valid, '$root: valid person is valid');
    ok(!$v->validate({})->is_valid, '$root: missing name is invalid');
    ok(!$v->validate('not-an-object')->is_valid, '$root: string is invalid');
};

#############################################################################
# PART 17: Boolean Schema Tests
#############################################################################

subtest 'Boolean schema - true accepts all' => sub {
    my $v = JSON::Structure::InstanceValidator->new(schema => JSON::MaybeXS::true);
    
    ok($v->validate('string')->is_valid, 'true schema: string is valid');
    ok($v->validate(42)->is_valid, 'true schema: number is valid');
    ok($v->validate([1, 2, 3])->is_valid, 'true schema: array is valid');
    ok($v->validate({a => 1})->is_valid, 'true schema: object is valid');
    ok($v->validate(undef)->is_valid, 'true schema: null is valid');
};

subtest 'Boolean schema - false rejects all' => sub {
    my $v = JSON::Structure::InstanceValidator->new(schema => JSON::MaybeXS::false);
    
    ok(!$v->validate('string')->is_valid, 'false schema: string is invalid');
    ok(!$v->validate(42)->is_valid, 'false schema: number is invalid');
    ok(!$v->validate([1, 2, 3])->is_valid, 'false schema: array is invalid');
    ok(!$v->validate({a => 1})->is_valid, 'false schema: object is invalid');
    ok(!$v->validate(undef)->is_valid, 'false schema: null is invalid');
};

#############################################################################
# PART 18: Schema Validation Tests
#############################################################################

subtest 'SchemaValidator - valid schemas' => sub {
    my $sv = JSON::Structure::SchemaValidator->new();
    
    my $simple = {
        '$schema' => 'https://json-structure.org/meta/core/v0/#',
        '$id' => 'https://example.com/test.struct.json',
        'name' => 'Test',
        'type' => 'string'
    };
    ok($sv->validate($simple)->is_valid, 'Simple string schema is valid');
    
    my $object = {
        '$schema' => 'https://json-structure.org/meta/core/v0/#',
        '$id' => 'https://example.com/test.struct.json',
        'name' => 'Test',
        'type' => 'object',
        'properties' => {
            'name' => {'type' => 'string'}
        }
    };
    ok($sv->validate($object)->is_valid, 'Object schema is valid');
};

subtest 'SchemaValidator - invalid type' => sub {
    my $sv = JSON::Structure::SchemaValidator->new();
    
    my $s = {
        '$schema' => 'https://json-structure.org/meta/core/v0/#',
        '$id' => 'https://example.com/test.struct.json',
        'name' => 'Test',
        'type' => 'invalid-type'
    };
    my $result = $sv->validate($s);
    ok(!$result->is_valid, 'Invalid type makes schema invalid');
    like($result->errors->[0]->code, qr/SCHEMA/, 'Error code contains SCHEMA');
};

subtest 'SchemaValidator - negative constraints' => sub {
    my $sv = JSON::Structure::SchemaValidator->new();
    
    my $neg_minLength = {
        '$id' => 'test',
        'name' => 'Test',
        'type' => 'string',
        'minLength' => -1
    };
    ok(!$sv->validate($neg_minLength)->is_valid, 'Negative minLength is invalid');
    
    my $neg_minItems = {
        '$id' => 'test',
        'name' => 'Test',
        'type' => 'array',
        'items' => {'type' => 'int32'},
        'minItems' => -1
    };
    ok(!$sv->validate($neg_minItems)->is_valid, 'Negative minItems is invalid');
    
    my $neg_multipleOf = {
        '$id' => 'test',
        'name' => 'Test',
        'type' => 'number',
        'multipleOf' => -5
    };
    ok(!$sv->validate($neg_multipleOf)->is_valid, 'Negative multipleOf is invalid');
    
    my $zero_multipleOf = {
        '$id' => 'test',
        'name' => 'Test',
        'type' => 'number',
        'multipleOf' => 0
    };
    ok(!$sv->validate($zero_multipleOf)->is_valid, 'Zero multipleOf is invalid');
};

subtest 'SchemaValidator - invalid pattern' => sub {
    my $sv = JSON::Structure::SchemaValidator->new();
    
    my $s = {
        '$id' => 'test',
        'name' => 'Test',
        'type' => 'string',
        'pattern' => '[invalid(regex'
    };
    ok(!$sv->validate($s)->is_valid, 'Invalid regex pattern makes schema invalid');
};

subtest 'SchemaValidator - empty composition arrays' => sub {
    my $sv = JSON::Structure::SchemaValidator->new();
    
    my $empty_allOf = {'$id' => 'test', 'allOf' => []};
    ok(!$sv->validate($empty_allOf)->is_valid, 'Empty allOf is invalid');
    
    my $empty_anyOf = {'$id' => 'test', 'anyOf' => []};
    ok(!$sv->validate($empty_anyOf)->is_valid, 'Empty anyOf is invalid');
    
    my $empty_oneOf = {'$id' => 'test', 'oneOf' => []};
    ok(!$sv->validate($empty_oneOf)->is_valid, 'Empty oneOf is invalid');
};

subtest 'SchemaValidator - empty enum' => sub {
    my $sv = JSON::Structure::SchemaValidator->new();
    
    my $s = {'$id' => 'test', 'name' => 'Test', 'enum' => []};
    ok(!$sv->validate($s)->is_valid, 'Empty enum is invalid');
};

#############################################################################
# PART 19: Error Path Tests
#############################################################################

subtest 'Error paths - nested objects' => sub {
    my $s = schema(
        type => 'object',
        properties => {
            address => {
                type => 'object',
                properties => {
                    city => {type => 'string'}
                }
            }
        }
    );
    my $v = validator($s);
    
    my $result = $v->validate({address => {city => 42}});
    ok(!$result->is_valid, 'Nested type error detected');
    like($result->errors->[0]->path, qr{/address/city}, 'Error path includes nested location');
};

subtest 'Error paths - array items' => sub {
    my $s = schema(type => 'array', items => {type => 'string'});
    my $v = validator($s);
    
    my $result = $v->validate(['ok', 42, 'also ok']);
    ok(!$result->is_valid, 'Array item error detected');
    like($result->errors->[0]->path, qr{/1}, 'Error path includes array index');
};

#############################################################################
# PART 20: Edge Cases
#############################################################################

subtest 'Edge cases - empty strings' => sub {
    my $s = schema(type => 'string');
    my $v = validator($s);
    
    ok($v->validate("")->is_valid, 'Empty string is valid string');
};

subtest 'Edge cases - zero values' => sub {
    my $s = schema(type => 'int32');
    my $v = validator($s);
    
    ok($v->validate(0)->is_valid, 'Zero is valid int32');
};

subtest 'Edge cases - empty arrays' => sub {
    my $s = schema(type => 'array', items => {type => 'string'});
    my $v = validator($s);
    
    ok($v->validate([])->is_valid, 'Empty array is valid');
};

subtest 'Edge cases - empty objects' => sub {
    my $s = schema(type => 'object');
    my $v = validator($s);
    
    ok($v->validate({})->is_valid, 'Empty object is valid');
};

subtest 'Edge cases - deeply nested validation' => sub {
    my $s = schema(
        type => 'object',
        properties => {
            level1 => {
                type => 'object',
                properties => {
                    level2 => {
                        type => 'object',
                        properties => {
                            level3 => {
                                type => 'object',
                                properties => {
                                    value => {type => 'string'}
                                }
                            }
                        }
                    }
                }
            }
        }
    );
    my $v = validator($s);
    
    ok($v->validate({level1 => {level2 => {level3 => {value => 'deep'}}}})->is_valid, 
       'Deeply nested valid structure passes');
    ok(!$v->validate({level1 => {level2 => {level3 => {value => 42}}}})->is_valid,
       'Deeply nested invalid value detected');
};

#############################################################################
# Done
#############################################################################

done_testing();
