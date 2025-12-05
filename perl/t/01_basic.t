#!/usr/bin/env perl

use strict;
use warnings FATAL => 'all';
use v5.20;

use Test::More;
use JSON::PP;
use FindBin qw($Bin);
use lib "$Bin/../lib";

use JSON::Structure::Types qw(:all);
use JSON::Structure::ErrorCodes qw(:all);
use JSON::Structure::JsonSourceLocator;
use JSON::Structure::SchemaValidator;
use JSON::Structure::InstanceValidator;

# Test Types module
subtest 'Types module' => sub {
    # Test type checking functions
    ok(is_valid_type('string'), 'string is a valid type');
    ok(is_valid_type('int32'), 'int32 is a valid type');
    ok(is_valid_type('object'), 'object is a valid type');
    ok(!is_valid_type('invalid'), 'invalid is not a valid type');
    
    ok(is_primitive_type('string'), 'string is primitive');
    ok(is_primitive_type('int32'), 'int32 is primitive');
    ok(!is_primitive_type('object'), 'object is not primitive');
    
    ok(is_compound_type('object'), 'object is compound');
    ok(is_compound_type('array'), 'array is compound');
    ok(!is_compound_type('string'), 'string is not compound');
    
    ok(is_numeric_type('int32'), 'int32 is numeric');
    ok(is_numeric_type('number'), 'number is numeric');
    ok(!is_numeric_type('string'), 'string is not numeric');
};

# Test JsonLocation
subtest 'JsonLocation' => sub {
    my $loc = JSON::Structure::Types::JsonLocation->new(line => 5, column => 10);
    is($loc->line, 5, 'line accessor works');
    is($loc->column, 10, 'column accessor works');
    ok($loc->is_known, 'location is known');
    is($loc->to_string, '(5:10)', 'to_string formats correctly');
    
    my $unknown = JSON::Structure::Types::JsonLocation->unknown();
    ok(!$unknown->is_known, 'unknown location is not known');
    is($unknown->to_string, '', 'unknown location returns empty string');
};

# Test ValidationError
subtest 'ValidationError' => sub {
    my $error = JSON::Structure::Types::ValidationError->new(
        code    => 'TEST_ERROR',
        message => 'Test error message',
        path    => '#/test',
    );
    
    is($error->code, 'TEST_ERROR', 'code accessor works');
    is($error->message, 'Test error message', 'message accessor works');
    is($error->path, '#/test', 'path accessor works');
    like($error->to_string, qr/TEST_ERROR/, 'to_string includes code');
    like($error->to_string, qr/Test error message/, 'to_string includes message');
};

# Test ValidationResult
subtest 'ValidationResult' => sub {
    my $result = JSON::Structure::Types::ValidationResult->new();
    ok($result->is_valid, 'new result is valid');
    is_deeply($result->errors, [], 'errors is empty array');
    
    my $error = JSON::Structure::Types::ValidationError->new(
        code    => 'TEST',
        message => 'test',
    );
    $result->add_error($error);
    ok(!$result->is_valid, 'result with error is not valid');
    is(scalar(@{$result->errors}), 1, 'has one error');
};

# Test JsonSourceLocator
subtest 'JsonSourceLocator' => sub {
    my $json = '{"name": "test", "value": 42}';
    my $locator = JSON::Structure::JsonSourceLocator->new($json);
    
    my $loc = $locator->get_location('#');
    ok($loc->is_known, 'root location is known');
    is($loc->line, 1, 'root is on line 1');
    
    my $name_loc = $locator->get_location('#/name');
    ok($name_loc->is_known, 'name location is known');
    
    # Multi-line JSON
    my $multi_line = qq{{\n  "name": "test",\n  "value": 42\n}};
    my $ml_locator = JSON::Structure::JsonSourceLocator->new($multi_line);
    
    my $ml_name = $ml_locator->get_location('#/name');
    ok($ml_name->is_known, 'multi-line name location is known');
};

# Test Error Codes
subtest 'Error Codes' => sub {
    is(SCHEMA_NULL, 'SCHEMA_NULL', 'SCHEMA_NULL constant');
    is(SCHEMA_TYPE_INVALID, 'SCHEMA_TYPE_INVALID', 'SCHEMA_TYPE_INVALID constant');
    is(INSTANCE_TYPE_MISMATCH, 'INSTANCE_TYPE_MISMATCH', 'INSTANCE_TYPE_MISMATCH constant');
    
    my $msg = format_error_message(SCHEMA_TYPE_INVALID, typeName => 'foo');
    like($msg, qr/foo/, 'format_error_message replaces parameters');
};

done_testing();
