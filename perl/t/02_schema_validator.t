#!/usr/bin/env perl

use strict;
use warnings;
use v5.20;

use Test::More;
use JSON::PP;
use FindBin qw($Bin);
use lib "$Bin/../lib";

use JSON::Structure::SchemaValidator;
use JSON::Structure::ErrorCodes qw(:schema);

my $json = JSON::PP->new->utf8->allow_nonref;

# Helper to check if any error has the given code
sub has_error_code {
    my ($result, $code) = @_;
    return scalar(grep { $_->code eq $code } @{$result->errors});
}

# Helper to create a basic valid schema
sub basic_schema {
    my (%overrides) = @_;
    return {
        '$schema' => 'https://json-structure.org/meta/core/v0/#',
        '$id'     => 'https://example.com/test.struct.json',
        'name'    => 'Test',
        'type'    => 'object',
        'properties' => {},
        %overrides
    };
}

subtest 'Valid schemas' => sub {
    my $validator = JSON::Structure::SchemaValidator->new();
    
    # Basic valid schema
    my $schema = basic_schema();
    my $result = $validator->validate($schema);
    ok($result->is_valid, 'basic schema is valid') or diag(join("\n", map { $_->to_string } @{$result->errors}));
    
    # Schema with string type
    $schema = basic_schema(type => 'string');
    delete $schema->{properties};
    $result = $validator->validate($schema);
    ok($result->is_valid, 'string type schema is valid') or diag(join("\n", map { $_->to_string } @{$result->errors}));
    
    # Schema with all primitive types
    for my $type (qw(string boolean null int8 uint8 int16 uint16 int32 uint32 
                     int64 uint64 float double decimal date datetime time 
                     duration uuid uri binary jsonpointer)) {
        my $schema = basic_schema(type => $type);
        delete $schema->{properties};
        my $result = $validator->validate($schema);
        ok($result->is_valid, "$type type schema is valid") or diag(join("\n", map { $_->to_string } @{$result->errors}));
    }
};

subtest 'Missing required keywords' => sub {
    my $validator = JSON::Structure::SchemaValidator->new();
    
    # Missing $id
    my $schema = basic_schema();
    delete $schema->{'$id'};
    my $result = $validator->validate($schema);
    ok(!$result->is_valid, 'schema without $id is invalid');
    ok(has_error_code($result, SCHEMA_ROOT_MISSING_ID), 'reports missing $id error');
    
    # Missing name with type at root
    $schema = basic_schema();
    delete $schema->{name};
    $result = $validator->validate($schema);
    ok(!$result->is_valid, 'schema without name is invalid');
    ok(has_error_code($result, SCHEMA_ROOT_MISSING_NAME), 'reports missing name error');
};

subtest 'Invalid types' => sub {
    my $validator = JSON::Structure::SchemaValidator->new();
    
    my $schema = basic_schema(type => 'invalid_type');
    delete $schema->{properties};
    my $result = $validator->validate($schema);
    ok(!$result->is_valid, 'invalid type is rejected');
    ok(has_error_code($result, SCHEMA_TYPE_INVALID), 'reports invalid type error');
};

subtest 'Array type validation' => sub {
    my $validator = JSON::Structure::SchemaValidator->new();
    
    # Array without items
    my $schema = basic_schema(
        type => 'array',
    );
    delete $schema->{properties};
    my $result = $validator->validate($schema);
    ok(!$result->is_valid, 'array without items is invalid');
    ok(has_error_code($result, SCHEMA_ARRAY_MISSING_ITEMS), 'reports missing items error');
    
    # Array with items
    $schema = basic_schema(
        type  => 'array',
        items => { type => 'string' },
    );
    delete $schema->{properties};
    $result = $validator->validate($schema);
    ok($result->is_valid, 'array with items is valid') or diag(join("\n", map { $_->to_string } @{$result->errors}));
};

subtest 'Map type validation' => sub {
    my $validator = JSON::Structure::SchemaValidator->new();
    
    # Map without values
    my $schema = basic_schema(
        type => 'map',
    );
    delete $schema->{properties};
    my $result = $validator->validate($schema);
    ok(!$result->is_valid, 'map without values is invalid');
    ok(has_error_code($result, SCHEMA_MAP_MISSING_VALUES), 'reports missing values error');
    
    # Map with values
    $schema = basic_schema(
        type   => 'map',
        values => { type => 'int32' },
    );
    delete $schema->{properties};
    $result = $validator->validate($schema);
    ok($result->is_valid, 'map with values is valid') or diag(join("\n", map { $_->to_string } @{$result->errors}));
};

subtest 'Tuple type validation' => sub {
    my $validator = JSON::Structure::SchemaValidator->new();
    
    # Tuple without properties or tuple keyword
    my $schema = basic_schema(
        type => 'tuple',
    );
    delete $schema->{properties};
    my $result = $validator->validate($schema);
    ok(!$result->is_valid, 'tuple without properties/tuple is invalid');
    ok(has_error_code($result, SCHEMA_TUPLE_MISSING_DEFINITION), 'reports missing tuple definition error');
    
    # Valid tuple
    $schema = basic_schema(
        type => 'tuple',
        properties => {
            x => { type => 'int32' },
            y => { type => 'int32' },
        },
        tuple => ['x', 'y'],
    );
    $result = $validator->validate($schema);
    ok($result->is_valid, 'tuple with properties and tuple is valid') or diag(join("\n", map { $_->to_string } @{$result->errors}));
};

subtest 'Choice type validation' => sub {
    my $validator = JSON::Structure::SchemaValidator->new();
    
    # Choice without choices
    my $schema = basic_schema(
        type => 'choice',
    );
    delete $schema->{properties};
    my $result = $validator->validate($schema);
    ok(!$result->is_valid, 'choice without choices is invalid');
    ok(has_error_code($result, SCHEMA_CHOICE_MISSING_CHOICES), 'reports missing choices error');
    
    # Valid choice
    $schema = basic_schema(
        type => 'choice',
        selector => 'kind',
        choices => {
            circle => { type => 'object', properties => { radius => { type => 'number' } } },
            square => { type => 'object', properties => { side => { type => 'number' } } },
        },
    );
    delete $schema->{properties};
    $result = $validator->validate($schema);
    ok($result->is_valid, 'choice with choices is valid') or diag(join("\n", map { $_->to_string } @{$result->errors}));
};

subtest 'Enum validation' => sub {
    my $validator = JSON::Structure::SchemaValidator->new();
    
    # Empty enum
    my $schema = basic_schema(
        type => 'string',
        enum => [],
    );
    delete $schema->{properties};
    my $result = $validator->validate($schema);
    ok(!$result->is_valid, 'empty enum is invalid');
    ok(has_error_code($result, SCHEMA_ENUM_EMPTY), 'reports empty enum error');
    
    # Duplicate enum values
    $schema = basic_schema(
        type => 'string',
        enum => ['a', 'b', 'a'],
    );
    delete $schema->{properties};
    $result = $validator->validate($schema);
    ok(!$result->is_valid, 'duplicate enum values is invalid');
    ok(has_error_code($result, SCHEMA_ENUM_DUPLICATES), 'reports duplicate enum error');
    
    # Valid enum
    $schema = basic_schema(
        type => 'string',
        enum => ['a', 'b', 'c'],
    );
    delete $schema->{properties};
    $result = $validator->validate($schema);
    ok($result->is_valid, 'valid enum is valid') or diag(join("\n", map { $_->to_string } @{$result->errors}));
};

subtest 'Required properties validation' => sub {
    my $validator = JSON::Structure::SchemaValidator->new();
    
    # Required property not in properties
    my $schema = basic_schema(
        properties => {
            name => { type => 'string' },
        },
        required => ['name', 'nonexistent'],
    );
    my $result = $validator->validate($schema);
    ok(!$result->is_valid, 'required property not in properties is invalid');
    ok(has_error_code($result, SCHEMA_REQUIRED_PROPERTY_NOT_DEFINED), 'reports missing property error');
    
    # Valid required
    $schema = basic_schema(
        properties => {
            name => { type => 'string' },
            age  => { type => 'int32' },
        },
        required => ['name'],
    );
    $result = $validator->validate($schema);
    ok($result->is_valid, 'valid required is valid') or diag(join("\n", map { $_->to_string } @{$result->errors}));
};

subtest 'Definitions validation' => sub {
    my $validator = JSON::Structure::SchemaValidator->new();
    
    my $schema = basic_schema(
        definitions => {
            Address => {
                type => 'object',
                properties => {
                    street => { type => 'string' },
                    city   => { type => 'string' },
                },
            },
        },
        properties => {
            name    => { type => 'string' },
            address => { type => { '$ref' => '#/definitions/Address' } },
        },
    );
    my $result = $validator->validate($schema);
    ok($result->is_valid, 'schema with definitions is valid') or diag(join("\n", map { $_->to_string } @{$result->errors}));
};

subtest '$ref validation' => sub {
    my $validator = JSON::Structure::SchemaValidator->new();
    
    # $ref to non-existent definition
    my $schema = basic_schema(
        properties => {
            data => { type => { '$ref' => '#/definitions/NonExistent' } },
        },
    );
    my $result = $validator->validate($schema);
    ok(!$result->is_valid, '$ref to non-existent definition is invalid');
    ok(has_error_code($result, SCHEMA_REF_NOT_FOUND), 'reports ref not found error');
};

subtest 'Extended mode validation' => sub {
    my $validator = JSON::Structure::SchemaValidator->new(extended => 1);
    
    # Valid extended schema with pattern
    my $schema = basic_schema(
        type => 'string',
        pattern => '^[a-z]+$',
    );
    delete $schema->{properties};
    $schema->{'$uses'} = ['JSONStructureValidation'];
    my $result = $validator->validate($schema);
    ok($result->is_valid, 'extended schema with pattern is valid') or diag(join("\n", map { $_->to_string } @{$result->errors}));
    
    # Invalid pattern
    $schema = basic_schema(
        type => 'string',
        pattern => '[invalid',
    );
    delete $schema->{properties};
    $schema->{'$uses'} = ['JSONStructureValidation'];
    $result = $validator->validate($schema);
    ok(!$result->is_valid, 'invalid pattern is rejected');
    ok(has_error_code($result, SCHEMA_PATTERN_INVALID), 'reports invalid pattern error');
    
    # min > max validation
    $schema = basic_schema(
        type => 'int32',
        minimum => 100,
        maximum => 10,
    );
    delete $schema->{properties};
    $schema->{'$uses'} = ['JSONStructureValidation'];
    $result = $validator->validate($schema);
    ok(!$result->is_valid, 'min > max is invalid');
    ok(has_error_code($result, SCHEMA_MIN_GREATER_THAN_MAX), 'reports min > max error');
};

subtest 'Source location tracking' => sub {
    my $validator = JSON::Structure::SchemaValidator->new();
    
    my $schema_json = qq{
{
  "\$schema": "https://json-structure.org/meta/core/v0/#",
  "\$id": "https://example.com/test.struct.json",
  "name": "Test",
  "type": "invalid_type"
}
};
    
    my $schema = $json->decode($schema_json);
    my $result = $validator->validate($schema, $schema_json);
    
    ok(!$result->is_valid, 'invalid schema detected');
    
    my @errors = @{$result->errors};
    ok(@errors > 0, 'has errors');
    
    my $error = $errors[0];
    ok($error->location->is_known, 'error has location') or diag("Location: " . $error->location->to_string);
};

done_testing();

