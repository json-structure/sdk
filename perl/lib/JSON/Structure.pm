package JSON::Structure;

use strict;
use warnings;
use v5.20;

our $VERSION = '0.01';

use JSON::Structure::Types qw(:all);
use JSON::Structure::ErrorCodes qw(:all);
use JSON::Structure::JsonSourceLocator;
use JSON::Structure::SchemaValidator;
use JSON::Structure::InstanceValidator;

use Exporter 'import';

our @EXPORT_OK = qw(
    validate_schema
    validate_instance
    SchemaValidator
    InstanceValidator
    JsonSourceLocator
);

our %EXPORT_TAGS = (
    all => \@EXPORT_OK,
);

=head1 NAME

JSON::Structure - JSON Structure validation library for Perl

=head1 SYNOPSIS

    use JSON::Structure qw(:all);
    use JSON::MaybeXS;
    
    # Validate a schema
    my $schema = decode_json($schema_json);
    my $validator = JSON::Structure::SchemaValidator->new();
    my $result = $validator->validate($schema, $schema_json);
    
    if ($result->is_valid) {
        say "Schema is valid!";
    } else {
        for my $error (@{$result->errors}) {
            say $error->to_string;
        }
    }
    
    # Validate an instance against a schema
    my $instance_validator = JSON::Structure::InstanceValidator->new(schema => $schema);
    my $instance = decode_json($instance_json);
    my $result = $instance_validator->validate($instance, $instance_json);

=head1 DESCRIPTION

This module provides validators for JSON Structure schemas and instances,
conforming to the JSON Structure Core specification.

JSON Structure is a type-oriented schema language for JSON, designed for
defining data structures that can be validated and mapped to programming
language types.

=head1 FUNCTIONS

=head2 validate_schema($schema, $source_text)

Convenience function to validate a JSON Structure schema.

    my $result = validate_schema($schema, $schema_json);

=head2 validate_instance($instance, $schema, $source_text)

Convenience function to validate a JSON instance against a schema.

    my $result = validate_instance($instance, $schema, $instance_json);

=head1 SEE ALSO

=over 4

=item * L<JSON::Structure::SchemaValidator>

=item * L<JSON::Structure::InstanceValidator>

=item * L<JSON::Structure::Types>

=item * L<https://json-structure.org/>

=back

=head1 AUTHOR

JSON Structure Project

=head1 LICENSE

MIT License

=cut

sub validate_schema {
    my ($schema, $source_text) = @_;
    my $validator = JSON::Structure::SchemaValidator->new();
    return $validator->validate($schema, $source_text);
}

sub validate_instance {
    my ($instance, $schema, $source_text) = @_;
    my $validator = JSON::Structure::InstanceValidator->new(schema => $schema);
    return $validator->validate($instance, $source_text);
}

1;
