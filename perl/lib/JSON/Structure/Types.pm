    package JSON::Structure::Types;

    use strict;
    use warnings;
    use v5.20;

    our $VERSION = '0.01';

    use Exporter 'import';

    our @EXPORT_OK = qw(
      make_validation_result
      make_validation_error
      make_json_location
      SEVERITY_ERROR
      SEVERITY_WARNING
      PRIMITIVE_TYPES
      COMPOUND_TYPES
      ALL_TYPES
      NUMERIC_TYPES
      is_valid_type
      is_numeric_type
      is_primitive_type
      is_compound_type
    );

    our %EXPORT_TAGS = ( all => \@EXPORT_OK, );

=head1 NAME

JSON::Structure::Types - Type definitions for JSON Structure validation

=head1 DESCRIPTION

This module provides type definitions and constants used throughout
the JSON Structure validation library.

=cut

    # Primitive types from JSON Structure Core specification
    use constant PRIMITIVE_TYPES => [
        qw(
          string boolean null
          int8 uint8 int16 uint16 int32 uint32 int64 uint64 int128 uint128
          float float8 double decimal
          number integer
          date datetime time duration
          uuid uri binary jsonpointer
        )
    ];

    # Compound types from JSON Structure Core specification
    use constant COMPOUND_TYPES => [
        qw(
          object array set map tuple choice any
        )
    ];

    # All valid types
    use constant ALL_TYPES => [ @{ PRIMITIVE_TYPES() }, @{ COMPOUND_TYPES() } ];

    # Numeric types
    use constant NUMERIC_TYPES => [
        qw(
          number integer float double decimal float8
          int8 uint8 int16 uint16 int32 uint32 int64 uint64 int128 uint128
        )
    ];

    # Create lookup hashes for O(1) type checking
    my %_primitive_types = map { $_ => 1 } @{ PRIMITIVE_TYPES() };
    my %_compound_types  = map { $_ => 1 } @{ COMPOUND_TYPES() };
    my %_all_types       = map { $_ => 1 } @{ ALL_TYPES() };
    my %_numeric_types   = map { $_ => 1 } @{ NUMERIC_TYPES() };

=head1 FUNCTIONS

=head2 is_valid_type($type)

Returns true if the given type name is a valid JSON Structure type.

=cut

    sub is_valid_type {
        my ($type) = @_;
        return exists $_all_types{$type};
    }

=head2 is_primitive_type($type)

Returns true if the given type is a primitive type.

=cut

    sub is_primitive_type {
        my ($type) = @_;
        return exists $_primitive_types{$type};
    }

=head2 is_compound_type($type)

Returns true if the given type is a compound type.

=cut

    sub is_compound_type {
        my ($type) = @_;
        return exists $_compound_types{$type};
    }

=head2 is_numeric_type($type)

Returns true if the given type is a numeric type.

=cut

    sub is_numeric_type {
        my ($type) = @_;
        return exists $_numeric_types{$type};
    }

#############################################################################
    # JsonLocation - Represents a location in a JSON document
#############################################################################

    package JSON::Structure::Types::JsonLocation;

    use strict;
    use warnings;

=head1 JSON::Structure::Types::JsonLocation

Represents a location in a JSON document with line and column information.

=cut

    sub new {
        my ( $class, %args ) = @_;
        my $self = bless {
            line   => $args{line}   // 0,
            column => $args{column} // 0,
        }, $class;
        return $self;
    }

    sub unknown {
        my ($class) = @_;
        return $class->new( line => 0, column => 0 );
    }

    sub line   { $_[0]->{line} }
    sub column { $_[0]->{column} }

    sub is_known {
        my ($self) = @_;
        return $self->{line} > 0 && $self->{column} > 0;
    }

    sub to_string {
        my ($self) = @_;
        return $self->is_known ? "($self->{line}:$self->{column})" : "";
    }

#############################################################################
    # ValidationSeverity - Enum for validation severity levels
#############################################################################

    package JSON::Structure::Types::ValidationSeverity;

    use strict;
    use warnings;

    use constant ERROR   => 'error';
    use constant WARNING => 'warning';

#############################################################################
    # ValidationError - Represents a single validation error
#############################################################################

    package JSON::Structure::Types::ValidationError;

    use strict;
    use warnings;

=head1 JSON::Structure::Types::ValidationError

Represents a validation error with code, message, and location information.

=cut

    sub new {
        my ( $class, %args ) = @_;
        my $self = bless {
            code     => $args{code}    // '',
            message  => $args{message} // '',
            path     => $args{path}    // '',
            severity => $args{severity}
              // JSON::Structure::Types::ValidationSeverity::ERROR,
            location => $args{location}
              // JSON::Structure::Types::JsonLocation->unknown(),
            schema_path => $args{schema_path},
        }, $class;
        return $self;
    }

    sub code        { $_[0]->{code} }
    sub message     { $_[0]->{message} }
    sub path        { $_[0]->{path} }
    sub severity    { $_[0]->{severity} }
    sub location    { $_[0]->{location} }
    sub schema_path { $_[0]->{schema_path} }

    sub to_string {
        my ($self) = @_;
        my @parts;

        push @parts, $self->{path} if $self->{path};
        push @parts, $self->{location}->to_string
          if $self->{location}->is_known;
        push @parts, "[$self->{code}]";
        push @parts, $self->{message};
        push @parts, "(schema: $self->{schema_path})"
          if defined $self->{schema_path};

        return join( ' ', @parts );
    }

#############################################################################
    # ValidationResult - Represents the result of a validation operation
#############################################################################

    package JSON::Structure::Types::ValidationResult;

    use strict;
    use warnings;

=head1 JSON::Structure::Types::ValidationResult

Represents the result of a validation operation.

=cut

    sub new {
        my ( $class, %args ) = @_;
        my $self = bless {
            is_valid => $args{is_valid} // 1,
            errors   => $args{errors}   // [],
            warnings => $args{warnings} // [],
        }, $class;
        return $self;
    }

    sub is_valid { $_[0]->{is_valid} }
    sub errors   { $_[0]->{errors} }
    sub warnings { $_[0]->{warnings} }

    sub add_error {
        my ( $self, $error ) = @_;
        push @{ $self->{errors} }, $error;
        $self->{is_valid} = 0;
    }

    sub add_warning {
        my ( $self, $warning ) = @_;
        push @{ $self->{warnings} }, $warning;
    }

    sub merge {
        my ( $self, $other ) = @_;
        push @{ $self->{errors} },   @{ $other->errors };
        push @{ $self->{warnings} }, @{ $other->warnings };
        $self->{is_valid} = 0 if !$other->is_valid;
    }

    # Export convenience constructors and constants
    package JSON::Structure::Types;

    sub make_validation_result {
        JSON::Structure::Types::ValidationResult->new(@_);
    }

    sub make_validation_error {
        JSON::Structure::Types::ValidationError->new(@_);
    }
    sub make_json_location { JSON::Structure::Types::JsonLocation->new(@_) }

    # Severity constants
    use constant SEVERITY_ERROR =>
      JSON::Structure::Types::ValidationSeverity::ERROR;
    use constant SEVERITY_WARNING =>
      JSON::Structure::Types::ValidationSeverity::WARNING;

    1;

__END__

=head1 AUTHOR

JSON Structure Project

=head1 LICENSE

MIT License

=cut
