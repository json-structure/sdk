package JSON::Structure::InstanceValidator;

use strict;
use warnings;
use v5.20;

use JSON::PP;
use B;
use MIME::Base64 ();
use Scalar::Util qw(looks_like_number blessed);

use JSON::Structure::Types;
use JSON::Structure::ErrorCodes qw(:all);
use JSON::Structure::JsonSourceLocator;

# Helper to check if a scalar was a number in the original JSON
# Uses B module to inspect internal flags
sub _is_numeric {
    my ($value) = @_;
    return 0 unless defined $value && !ref($value);
    my $b_obj = B::svref_2object(\$value);
    my $flags = $b_obj->FLAGS;
    # Check if the value has numeric flags set (IOK/NOK)
    return ($flags & (B::SVf_IOK | B::SVf_NOK)) ? 1 : 0;
}

# Helper to check if a value is a pure string (no numeric flags)
sub _is_pure_string {
    my ($value) = @_;
    return 0 unless defined $value && !ref($value);
    # If it's a boolean, it's not a pure string
    return 0 if JSON::PP::is_bool($value);
    my $b_obj = B::svref_2object(\$value);
    my $flags = $b_obj->FLAGS;
    # Check if POK (string) is set but not IOK/NOK (numeric)
    return ($flags & B::SVf_POK) && !($flags & (B::SVf_IOK | B::SVf_NOK));
}

=head1 NAME

JSON::Structure::InstanceValidator - Validate JSON instances against JSON Structure schemas

=head1 SYNOPSIS

    use JSON::Structure::InstanceValidator;
    use JSON::PP;
    
    my $schema = decode_json($schema_json);
    my $validator = JSON::Structure::InstanceValidator->new(schema => $schema);
    
    my $instance = decode_json($instance_json);
    my $result = $validator->validate($instance, $instance_json);
    
    if ($result->is_valid) {
        say "Instance is valid!";
    } else {
        for my $error (@{$result->errors}) {
            say $error->to_string;
        }
    }

=head1 DESCRIPTION

Validates JSON data instances against JSON Structure schemas.

=cut

# Integer type ranges
my %INT_RANGES = (
    int8    => { min => -128, max => 127 },
    uint8   => { min => 0, max => 255 },
    int16   => { min => -32768, max => 32767 },
    uint16  => { min => 0, max => 65535 },
    int32   => { min => -2147483648, max => 2147483647 },
    uint32  => { min => 0, max => 4294967295 },
    int64   => { min => -9223372036854775808, max => 9223372036854775807 },
    uint64  => { min => 0, max => 18446744073709551615 },
    integer => { min => -2147483648, max => 2147483647 },  # Alias for int32
);

# Regex patterns for format validation
my $DATE_REGEX = qr/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
my $TIME_REGEX = qr/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/i;
my $DATETIME_REGEX = qr/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/i;
my $DURATION_REGEX = qr/^P(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/;
my $UUID_REGEX = qr/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
my $URI_REGEX = qr/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//;
my $JSONPOINTER_REGEX = qr/^(?:\/(?:[^~\/]|~[01])*)*$/;
my $EMAIL_REGEX = qr/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
my $IPV4_REGEX = qr/^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
my $HOSTNAME_REGEX = qr/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

sub new {
    my ($class, %args) = @_;
    
    my $self = bless {
        schema               => $args{schema},
        schema_text          => $args{schema_text},
        extended             => $args{extended} // 0,
        allow_import         => $args{allow_import} // 0,
        max_validation_depth => $args{max_validation_depth} // 64,
        errors               => [],
        warnings             => [],
        source_locator       => undef,
        current_depth        => 0,
    }, $class;
    
    return $self;
}

=head2 validate($instance, $source_text)

Validates a JSON instance against the schema.

Returns a ValidationResult object with errors and warnings.

=cut

sub validate {
    my ($self, $instance, $source_text) = @_;
    
    # Reset state
    $self->{errors} = [];
    $self->{warnings} = [];
    $self->{current_depth} = 0;
    
    # Initialize source locator
    if (defined $source_text) {
        $self->{source_locator} = JSON::Structure::JsonSourceLocator->new($source_text);
    }
    else {
        $self->{source_locator} = undef;
    }
    
    my $schema = $self->{schema};
    
    # Handle null schema
    if (!defined $schema) {
        $self->_add_error(INSTANCE_SCHEMA_FALSE, 'Schema is null', '#');
        return $self->_make_result();
    }
    
    # Find the root schema to validate against
    my $root_schema = $schema;
    
    # Check for $root reference
    if (ref($schema) eq 'HASH' && exists $schema->{'$root'}) {
        my $resolved = $self->_resolve_ref($schema->{'$root'}, $schema);
        if (!defined $resolved) {
            $self->_add_error(
                INSTANCE_ROOT_UNRESOLVED,
                "Unable to resolve \$root reference: $schema->{'$root'}",
                '#'
            );
            return $self->_make_result();
        }
        $root_schema = $resolved;
    }
    
    # Validate the instance
    $self->_validate_value($instance, $root_schema, '#', '#');
    
    return $self->_make_result();
}

sub _make_result {
    my ($self) = @_;
    
    return JSON::Structure::Types::ValidationResult->new(
        is_valid => scalar(@{$self->{errors}}) == 0,
        errors   => $self->{errors},
        warnings => $self->{warnings},
    );
}

sub _add_error {
    my ($self, $code, $message, $path, $schema_path) = @_;
    
    my $location = $self->{source_locator}
        ? $self->{source_locator}->get_location($path)
        : JSON::Structure::Types::JsonLocation->unknown();
    
    push @{$self->{errors}}, JSON::Structure::Types::ValidationError->new(
        code        => $code,
        message     => $message,
        path        => $path,
        severity    => JSON::Structure::Types::ValidationSeverity::ERROR,
        location    => $location,
        schema_path => $schema_path,
    );
}

sub _validate_value {
    my ($self, $value, $schema, $path, $schema_path) = @_;
    
    # Check depth
    $self->{current_depth}++;
    if ($self->{current_depth} > $self->{max_validation_depth}) {
        $self->_add_error(
            INSTANCE_MAX_DEPTH_EXCEEDED,
            "Maximum validation depth ($self->{max_validation_depth}) exceeded",
            $path,
            $schema_path
        );
        $self->{current_depth}--;
        return;
    }
    
    # Handle boolean schemas
    if (!ref($schema)) {
        if (_is_false($schema)) {
            $self->_add_error(
                INSTANCE_SCHEMA_FALSE,
                "Schema 'false' rejects all values",
                $path,
                $schema_path
            );
        }
        # true schema accepts everything
        $self->{current_depth}--;
        return;
    }
    
    if (ref($schema) ne 'HASH') {
        $self->{current_depth}--;
        return;
    }
    
    # Handle type with $ref
    if (exists $schema->{type} && ref($schema->{type}) eq 'HASH' && exists $schema->{type}{'$ref'}) {
        my $resolved = $self->_resolve_ref($schema->{type}{'$ref'}, $self->{schema});
        if (!defined $resolved) {
            $self->_add_error(
                INSTANCE_REF_UNRESOLVED,
                "Unable to resolve reference: $schema->{type}{'$ref'}",
                $path,
                $schema_path
            );
            $self->{current_depth}--;
            return;
        }
        # Merge the resolved schema with any additional constraints
        my $merged = { %$resolved };
        for my $key (keys %$schema) {
            next if $key eq 'type';
            $merged->{$key} = $schema->{$key};
        }
        $self->_validate_value($value, $merged, $path, $schema_path);
        $self->{current_depth}--;
        return;
    }
    
    # Validate const
    if (exists $schema->{const}) {
        if (!$self->_values_equal($value, $schema->{const})) {
            $self->_add_error(
                INSTANCE_CONST_MISMATCH,
                'Value must equal const value',
                $path,
                $schema_path
            );
        }
        $self->{current_depth}--;
        return;
    }
    
    # Validate enum
    if (exists $schema->{enum}) {
        my $found = 0;
        for my $enum_val (@{$schema->{enum}}) {
            if ($self->_values_equal($value, $enum_val)) {
                $found = 1;
                last;
            }
        }
        if (!$found) {
            $self->_add_error(
                INSTANCE_ENUM_MISMATCH,
                'Value must be one of the enum values',
                $path,
                $schema_path
            );
        }
    }
    
    # Validate type
    my $type = $schema->{type};
    
    if (defined $type) {
        if (ref($type) eq 'ARRAY') {
            # Union type - value must match at least one
            my $matched = 0;
            for my $t (@$type) {
                if ($self->_check_type($value, $t)) {
                    $matched = 1;
                    last;
                }
            }
            if (!$matched) {
                $self->_add_error(
                    INSTANCE_TYPE_MISMATCH,
                    "Value must be one of: " . join(', ', @$type),
                    $path,
                    $schema_path
                );
            }
        }
        elsif (!ref($type)) {
            $self->_validate_type($value, $type, $schema, $path, $schema_path);
        }
    }
    
    # Validate composition keywords in extended mode
    if ($self->{extended}) {
        $self->_validate_composition($value, $schema, $path, $schema_path);
    }
    
    $self->{current_depth}--;
}

sub _validate_type {
    my ($self, $value, $type, $schema, $path, $schema_path) = @_;
    
    # Validate based on type
    if ($type eq 'null') {
        $self->_validate_null($value, $path, $schema_path);
    }
    elsif ($type eq 'boolean') {
        $self->_validate_boolean($value, $path, $schema_path);
    }
    elsif ($type eq 'string') {
        $self->_validate_string($value, $schema, $path, $schema_path);
    }
    elsif ($type eq 'number' || $type eq 'float' || $type eq 'double' || $type eq 'float8' || $type eq 'decimal') {
        $self->_validate_number($value, $type, $schema, $path, $schema_path);
    }
    elsif ($type eq 'integer' || exists $INT_RANGES{$type}) {
        $self->_validate_integer($value, $type, $schema, $path, $schema_path);
    }
    elsif ($type eq 'int128' || $type eq 'uint128') {
        $self->_validate_big_integer($value, $type, $schema, $path, $schema_path);
    }
    elsif ($type eq 'object') {
        $self->_validate_object($value, $schema, $path, $schema_path);
    }
    elsif ($type eq 'array') {
        $self->_validate_array($value, $schema, $path, $schema_path);
    }
    elsif ($type eq 'set') {
        $self->_validate_set($value, $schema, $path, $schema_path);
    }
    elsif ($type eq 'map') {
        $self->_validate_map($value, $schema, $path, $schema_path);
    }
    elsif ($type eq 'tuple') {
        $self->_validate_tuple($value, $schema, $path, $schema_path);
    }
    elsif ($type eq 'choice') {
        $self->_validate_choice($value, $schema, $path, $schema_path);
    }
    elsif ($type eq 'any') {
        # Any type accepts all values
    }
    elsif ($type eq 'date') {
        $self->_validate_date($value, $path, $schema_path);
    }
    elsif ($type eq 'time') {
        $self->_validate_time($value, $path, $schema_path);
    }
    elsif ($type eq 'datetime') {
        $self->_validate_datetime($value, $path, $schema_path);
    }
    elsif ($type eq 'duration') {
        $self->_validate_duration($value, $path, $schema_path);
    }
    elsif ($type eq 'uuid') {
        $self->_validate_uuid($value, $path, $schema_path);
    }
    elsif ($type eq 'uri') {
        $self->_validate_uri($value, $path, $schema_path);
    }
    elsif ($type eq 'binary') {
        $self->_validate_binary($value, $path, $schema_path);
    }
    elsif ($type eq 'jsonpointer') {
        $self->_validate_jsonpointer($value, $path, $schema_path);
    }
    else {
        $self->_add_error(
            INSTANCE_TYPE_UNKNOWN,
            "Unknown type: $type",
            $path,
            $schema_path
        );
    }
}

sub _check_type {
    my ($self, $value, $type) = @_;
    
    if ($type eq 'null') {
        return !defined $value || (ref($value) eq '' && $value eq 'null');
    }
    elsif ($type eq 'boolean') {
        return JSON::PP::is_bool($value) || 
               (defined $value && !ref($value) && ($value eq 'true' || $value eq 'false' || $value =~ /^[01]$/));
    }
    elsif ($type eq 'string') {
        return defined $value && !ref($value);
    }
    elsif ($type eq 'number' || $type eq 'float' || $type eq 'double' || $type eq 'float8' || $type eq 'decimal') {
        return defined $value && !ref($value) && looks_like_number($value);
    }
    elsif ($type eq 'integer' || exists $INT_RANGES{$type}) {
        return defined $value && !ref($value) && looks_like_number($value) && $value == int($value);
    }
    elsif ($type eq 'object' || $type eq 'map' || $type eq 'choice') {
        return ref($value) eq 'HASH';
    }
    elsif ($type eq 'array' || $type eq 'set' || $type eq 'tuple') {
        return ref($value) eq 'ARRAY';
    }
    elsif ($type eq 'any') {
        return 1;
    }
    else {
        return 0;
    }
}

sub _validate_null {
    my ($self, $value, $path, $schema_path) = @_;
    
    unless (!defined $value || (ref($value) eq '' && $value eq 'null')) {
        $self->_add_error(
            INSTANCE_NULL_EXPECTED,
            'Value must be null',
            $path,
            $schema_path
        );
    }
}

sub _validate_boolean {
    my ($self, $value, $path, $schema_path) = @_;
    
    # Only accept JSON::PP booleans (true/false from JSON parsing)
    unless (JSON::PP::is_bool($value)) {
        $self->_add_error(
            INSTANCE_BOOLEAN_EXPECTED,
            'Value must be a boolean',
            $path,
            $schema_path
        );
    }
}

sub _validate_string {
    my ($self, $value, $schema, $path, $schema_path) = @_;
    
    # Must be defined, non-reference, and a pure string (not a number)
    unless (defined $value && !ref($value) && _is_pure_string($value)) {
        $self->_add_error(
            INSTANCE_STRING_EXPECTED,
            'Value must be a string',
            $path,
            $schema_path
        );
        return;
    }
    
    my $len = length($value);
    
    # Extended validation
    if ($self->{extended}) {
        if (exists $schema->{minLength}) {
            if ($len < $schema->{minLength}) {
                $self->_add_error(
                    INSTANCE_STRING_MIN_LENGTH,
                    "String length $len is less than minimum $schema->{minLength}",
                    $path,
                    $schema_path
                );
            }
        }
        
        if (exists $schema->{maxLength}) {
            if ($len > $schema->{maxLength}) {
                $self->_add_error(
                    INSTANCE_STRING_MAX_LENGTH,
                    "String length $len exceeds maximum $schema->{maxLength}",
                    $path,
                    $schema_path
                );
            }
        }
        
        if (exists $schema->{pattern}) {
            my $pattern = $schema->{pattern};
            eval {
                if ($value !~ qr/$pattern/) {
                    $self->_add_error(
                        INSTANCE_STRING_PATTERN_MISMATCH,
                        "String does not match pattern: $pattern",
                        $path,
                        $schema_path
                    );
                }
            };
            if ($@) {
                $self->_add_error(
                    INSTANCE_PATTERN_INVALID,
                    "Invalid regex pattern: $pattern",
                    $path,
                    $schema_path
                );
            }
        }
        
        if (exists $schema->{format}) {
            $self->_validate_format($value, $schema->{format}, $path, $schema_path);
        }
    }
}

sub _validate_format {
    my ($self, $value, $format, $path, $schema_path) = @_;
    
    if ($format eq 'email') {
        unless ($value =~ $EMAIL_REGEX) {
            $self->_add_error(
                INSTANCE_FORMAT_EMAIL_INVALID,
                'String is not a valid email address',
                $path,
                $schema_path
            );
        }
    }
    elsif ($format eq 'uri') {
        unless ($value =~ $URI_REGEX) {
            $self->_add_error(
                INSTANCE_FORMAT_URI_INVALID,
                'String is not a valid URI',
                $path,
                $schema_path
            );
        }
    }
    elsif ($format eq 'date') {
        unless ($value =~ $DATE_REGEX) {
            $self->_add_error(
                INSTANCE_FORMAT_DATE_INVALID,
                'String is not a valid date',
                $path,
                $schema_path
            );
        }
    }
    elsif ($format eq 'time') {
        unless ($value =~ $TIME_REGEX) {
            $self->_add_error(
                INSTANCE_FORMAT_TIME_INVALID,
                'String is not a valid time',
                $path,
                $schema_path
            );
        }
    }
    elsif ($format eq 'date-time') {
        unless ($value =~ $DATETIME_REGEX) {
            $self->_add_error(
                INSTANCE_FORMAT_DATETIME_INVALID,
                'String is not a valid date-time',
                $path,
                $schema_path
            );
        }
    }
    elsif ($format eq 'uuid') {
        unless ($value =~ $UUID_REGEX) {
            $self->_add_error(
                INSTANCE_FORMAT_UUID_INVALID,
                'String is not a valid UUID',
                $path,
                $schema_path
            );
        }
    }
    elsif ($format eq 'ipv4') {
        unless ($value =~ $IPV4_REGEX) {
            $self->_add_error(
                INSTANCE_FORMAT_IPV4_INVALID,
                'String is not a valid IPv4 address',
                $path,
                $schema_path
            );
        }
    }
    elsif ($format eq 'hostname') {
        unless ($value =~ $HOSTNAME_REGEX) {
            $self->_add_error(
                INSTANCE_FORMAT_HOSTNAME_INVALID,
                'String is not a valid hostname',
                $path,
                $schema_path
            );
        }
    }
    # Other formats are not strictly enforced
}

sub _validate_number {
    my ($self, $value, $type, $schema, $path, $schema_path) = @_;
    
    # Must be a numeric value, not a string that looks like a number
    unless (defined $value && !ref($value) && _is_numeric($value)) {
        $self->_add_error(
            INSTANCE_NUMBER_EXPECTED,
            'Value must be a number',
            $path,
            $schema_path
        );
        return;
    }
    
    $self->_validate_numeric_constraints($value, $schema, $path, $schema_path);
}

sub _validate_integer {
    my ($self, $value, $type, $schema, $path, $schema_path) = @_;
    
    # Must be a numeric value, not a string
    unless (defined $value && !ref($value) && _is_numeric($value)) {
        $self->_add_error(
            INSTANCE_INTEGER_EXPECTED,
            'Value must be an integer',
            $path,
            $schema_path
        );
        return;
    }
    
    # Check it's actually an integer
    if ($value != int($value)) {
        $self->_add_error(
            INSTANCE_INTEGER_EXPECTED,
            'Value must be an integer',
            $path,
            $schema_path
        );
        return;
    }
    
    # Check range for specific integer types
    if (exists $INT_RANGES{$type}) {
        my $range = $INT_RANGES{$type};
        if ($value < $range->{min} || $value > $range->{max}) {
            $self->_add_error(
                INSTANCE_INT_RANGE_INVALID,
                "Value $value is not a valid $type",
                $path,
                $schema_path
            );
        }
    }
    
    $self->_validate_numeric_constraints($value, $schema, $path, $schema_path);
}

sub _validate_big_integer {
    my ($self, $value, $type, $schema, $path, $schema_path) = @_;
    
    # Big integers can be numbers or strings
    my $num_value;
    
    if (!defined $value) {
        $self->_add_error(
            INSTANCE_INTEGER_EXPECTED,
            "Value must be a valid $type",
            $path,
            $schema_path
        );
        return;
    }
    
    if (ref($value)) {
        $self->_add_error(
            INSTANCE_INTEGER_EXPECTED,
            "Value must be a valid $type",
            $path,
            $schema_path
        );
        return;
    }
    
    # Accept both number and string representation
    if (looks_like_number($value) || $value =~ /^-?\d+$/) {
        $num_value = $value;
    }
    else {
        $self->_add_error(
            INSTANCE_INTEGER_EXPECTED,
            "Value must be a valid $type",
            $path,
            $schema_path
        );
        return;
    }
    
    # Check for unsigned
    if ($type eq 'uint128' && $num_value < 0) {
        $self->_add_error(
            INSTANCE_INT_RANGE_INVALID,
            "Value $value is not a valid $type",
            $path,
            $schema_path
        );
    }
}

sub _validate_numeric_constraints {
    my ($self, $value, $schema, $path, $schema_path) = @_;
    
    return unless $self->{extended};
    
    if (exists $schema->{minimum}) {
        if ($value < $schema->{minimum}) {
            $self->_add_error(
                INSTANCE_NUMBER_MINIMUM,
                "Value $value is less than minimum $schema->{minimum}",
                $path,
                $schema_path
            );
        }
    }
    
    if (exists $schema->{maximum}) {
        if ($value > $schema->{maximum}) {
            $self->_add_error(
                INSTANCE_NUMBER_MAXIMUM,
                "Value $value exceeds maximum $schema->{maximum}",
                $path,
                $schema_path
            );
        }
    }
    
    if (exists $schema->{exclusiveMinimum}) {
        if ($value <= $schema->{exclusiveMinimum}) {
            $self->_add_error(
                INSTANCE_NUMBER_EXCLUSIVE_MINIMUM,
                "Value $value must be greater than $schema->{exclusiveMinimum}",
                $path,
                $schema_path
            );
        }
    }
    
    if (exists $schema->{exclusiveMaximum}) {
        if ($value >= $schema->{exclusiveMaximum}) {
            $self->_add_error(
                INSTANCE_NUMBER_EXCLUSIVE_MAXIMUM,
                "Value $value must be less than $schema->{exclusiveMaximum}",
                $path,
                $schema_path
            );
        }
    }
    
    if (exists $schema->{multipleOf}) {
        my $mult = $schema->{multipleOf};
        if ($mult != 0 && ($value / $mult) != int($value / $mult)) {
            $self->_add_error(
                INSTANCE_NUMBER_MULTIPLE_OF,
                "Value $value is not a multiple of $mult",
                $path,
                $schema_path
            );
        }
    }
}

sub _validate_object {
    my ($self, $value, $schema, $path, $schema_path) = @_;
    
    unless (ref($value) eq 'HASH') {
        $self->_add_error(
            INSTANCE_OBJECT_EXPECTED,
            'Value must be an object',
            $path,
            $schema_path
        );
        return;
    }
    
    my $properties = $schema->{properties} // {};
    my $required = $schema->{required} // [];
    my $additional = $schema->{additionalProperties};
    
    # Check required properties
    for my $prop (@$required) {
        unless (exists $value->{$prop}) {
            $self->_add_error(
                INSTANCE_REQUIRED_PROPERTY_MISSING,
                "Missing required property: $prop",
                $path,
                "$schema_path/required"
            );
        }
    }
    
    # Validate properties
    for my $prop_name (keys %$value) {
        my $prop_path = "$path/$prop_name";
        
        if (exists $properties->{$prop_name}) {
            my $prop_schema = $properties->{$prop_name};
            $self->_validate_value($value->{$prop_name}, $prop_schema, $prop_path, "$schema_path/properties/$prop_name");
        }
        elsif (defined $additional) {
            if (_is_false($additional)) {
                $self->_add_error(
                    INSTANCE_ADDITIONAL_PROPERTY_NOT_ALLOWED,
                    "Additional property not allowed: $prop_name",
                    $prop_path,
                    "$schema_path/additionalProperties"
                );
            }
            elsif (ref($additional) eq 'HASH') {
                $self->_validate_value($value->{$prop_name}, $additional, $prop_path, "$schema_path/additionalProperties");
            }
        }
    }
    
    # Extended validation
    if ($self->{extended}) {
        my $count = scalar(keys %$value);
        
        if (exists $schema->{minProperties}) {
            if ($count < $schema->{minProperties}) {
                $self->_add_error(
                    INSTANCE_MIN_PROPERTIES,
                    "Object has $count properties, minimum is $schema->{minProperties}",
                    $path,
                    $schema_path
                );
            }
        }
        
        if (exists $schema->{maxProperties}) {
            if ($count > $schema->{maxProperties}) {
                $self->_add_error(
                    INSTANCE_MAX_PROPERTIES,
                    "Object has $count properties, maximum is $schema->{maxProperties}",
                    $path,
                    $schema_path
                );
            }
        }
        
        if (exists $schema->{dependentRequired}) {
            for my $prop (keys %{$schema->{dependentRequired}}) {
                if (exists $value->{$prop}) {
                    my $deps = $schema->{dependentRequired}{$prop};
                    for my $dep (@$deps) {
                        unless (exists $value->{$dep}) {
                            $self->_add_error(
                                INSTANCE_DEPENDENT_REQUIRED,
                                "Property '$prop' requires property '$dep'",
                                $path,
                                $schema_path
                            );
                        }
                    }
                }
            }
        }
    }
}

sub _validate_array {
    my ($self, $value, $schema, $path, $schema_path) = @_;
    
    unless (ref($value) eq 'ARRAY') {
        $self->_add_error(
            INSTANCE_ARRAY_EXPECTED,
            'Value must be an array',
            $path,
            $schema_path
        );
        return;
    }
    
    # Validate items
    if (exists $schema->{items}) {
        my $items_schema = $schema->{items};
        for my $i (0 .. $#$value) {
            $self->_validate_value($value->[$i], $items_schema, "$path/$i", "$schema_path/items");
        }
    }
    
    # Extended validation
    if ($self->{extended}) {
        my $count = scalar(@$value);
        
        if (exists $schema->{minItems}) {
            if ($count < $schema->{minItems}) {
                $self->_add_error(
                    INSTANCE_MIN_ITEMS,
                    "Array has $count items, minimum is $schema->{minItems}",
                    $path,
                    $schema_path
                );
            }
        }
        
        if (exists $schema->{maxItems}) {
            if ($count > $schema->{maxItems}) {
                $self->_add_error(
                    INSTANCE_MAX_ITEMS,
                    "Array has $count items, maximum is $schema->{maxItems}",
                    $path,
                    $schema_path
                );
            }
        }
        
        if (exists $schema->{contains}) {
            my $contains_count = 0;
            for my $item (@$value) {
                # Create a temporary validator to check
                my $temp_errors = $self->{errors};
                $self->{errors} = [];
                $self->_validate_value($item, $schema->{contains}, "$path/contains", "$schema_path/contains");
                if (@{$self->{errors}} == 0) {
                    $contains_count++;
                }
                $self->{errors} = $temp_errors;
            }
            
            my $min_contains = $schema->{minContains} // 1;
            my $max_contains = $schema->{maxContains};
            
            if ($contains_count < $min_contains) {
                $self->_add_error(
                    INSTANCE_MIN_CONTAINS,
                    "Array must contain at least $min_contains matching items (found $contains_count)",
                    $path,
                    $schema_path
                );
            }
            
            if (defined $max_contains && $contains_count > $max_contains) {
                $self->_add_error(
                    INSTANCE_MAX_CONTAINS,
                    "Array must contain at most $max_contains matching items (found $contains_count)",
                    $path,
                    $schema_path
                );
            }
        }
    }
}

sub _validate_set {
    my ($self, $value, $schema, $path, $schema_path) = @_;
    
    unless (ref($value) eq 'ARRAY') {
        $self->_add_error(
            INSTANCE_SET_EXPECTED,
            'Value must be an array (set)',
            $path,
            $schema_path
        );
        return;
    }
    
    # Check for uniqueness
    my %seen;
    for my $i (0 .. $#$value) {
        my $key = $self->_value_to_key($value->[$i]);
        if (exists $seen{$key}) {
            $self->_add_error(
                INSTANCE_SET_DUPLICATE,
                "Set contains duplicate value at index $i",
                "$path/$i",
                $schema_path
            );
        }
        $seen{$key} = 1;
    }
    
    # Validate items
    if (exists $schema->{items}) {
        my $items_schema = $schema->{items};
        for my $i (0 .. $#$value) {
            $self->_validate_value($value->[$i], $items_schema, "$path/$i", "$schema_path/items");
        }
    }
}

sub _validate_map {
    my ($self, $value, $schema, $path, $schema_path) = @_;
    
    unless (ref($value) eq 'HASH') {
        $self->_add_error(
            INSTANCE_MAP_EXPECTED,
            'Value must be an object (map)',
            $path,
            $schema_path
        );
        return;
    }
    
    # Validate values
    if (exists $schema->{values}) {
        my $values_schema = $schema->{values};
        for my $key (keys %$value) {
            $self->_validate_value($value->{$key}, $values_schema, "$path/$key", "$schema_path/values");
        }
    }
    
    # Extended validation
    if ($self->{extended}) {
        my $count = scalar(keys %$value);
        
        if (exists $schema->{minProperties}) {
            if ($count < $schema->{minProperties}) {
                $self->_add_error(
                    INSTANCE_MAP_MIN_ENTRIES,
                    "Map has $count entries, minimum is $schema->{minProperties}",
                    $path,
                    $schema_path
                );
            }
        }
        
        if (exists $schema->{maxProperties}) {
            if ($count > $schema->{maxProperties}) {
                $self->_add_error(
                    INSTANCE_MAP_MAX_ENTRIES,
                    "Map has $count entries, maximum is $schema->{maxProperties}",
                    $path,
                    $schema_path
                );
            }
        }
    }
}

sub _validate_tuple {
    my ($self, $value, $schema, $path, $schema_path) = @_;
    
    unless (ref($value) eq 'ARRAY') {
        $self->_add_error(
            INSTANCE_TUPLE_EXPECTED,
            'Value must be an array (tuple)',
            $path,
            $schema_path
        );
        return;
    }
    
    my $properties = $schema->{properties} // {};
    my $tuple_order = $schema->{tuple} // [];
    my $expected_count = scalar(@$tuple_order);
    my $actual_count = scalar(@$value);
    
    # Check length
    if ($actual_count != $expected_count) {
        my $items = $schema->{items};
        if (!defined $items || _is_false($items)) {
            if ($actual_count > $expected_count) {
                $self->_add_error(
                    INSTANCE_TUPLE_ADDITIONAL_ITEMS,
                    "Tuple has $actual_count items but only $expected_count are defined",
                    $path,
                    $schema_path
                );
            }
            elsif ($actual_count < $expected_count) {
                $self->_add_error(
                    INSTANCE_TUPLE_LENGTH_MISMATCH,
                    "Tuple has $actual_count items but schema defines $expected_count",
                    $path,
                    $schema_path
                );
            }
        }
    }
    
    # Validate each tuple element
    for my $i (0 .. $#$tuple_order) {
        last if $i >= $actual_count;
        my $prop_name = $tuple_order->[$i];
        if (exists $properties->{$prop_name}) {
            $self->_validate_value($value->[$i], $properties->{$prop_name}, "$path/$i", "$schema_path/properties/$prop_name");
        }
    }
}

sub _validate_choice {
    my ($self, $value, $schema, $path, $schema_path) = @_;
    
    unless (ref($value) eq 'HASH') {
        $self->_add_error(
            INSTANCE_CHOICE_EXPECTED,
            'Value must be an object (choice)',
            $path,
            $schema_path
        );
        return;
    }
    
    my $choices = $schema->{choices};
    unless (defined $choices && ref($choices) eq 'HASH') {
        $self->_add_error(
            INSTANCE_CHOICE_MISSING_CHOICES,
            "Choice schema must have 'choices'",
            $path,
            $schema_path
        );
        return;
    }
    
    my $selector = $schema->{selector};
    
    if (defined $selector) {
        # Selector-based choice
        unless (exists $value->{$selector}) {
            $self->_add_error(
                INSTANCE_CHOICE_SELECTOR_MISSING,
                "Choice requires selector property: $selector",
                $path,
                $schema_path
            );
            return;
        }
        
        my $choice_name = $value->{$selector};
        unless (defined $choice_name && !ref($choice_name)) {
            $self->_add_error(
                INSTANCE_CHOICE_SELECTOR_NOT_STRING,
                'Selector value must be a string',
                "$path/$selector",
                $schema_path
            );
            return;
        }
        
        unless (exists $choices->{$choice_name}) {
            $self->_add_error(
                INSTANCE_CHOICE_UNKNOWN,
                "Unknown choice: $choice_name",
                "$path/$selector",
                $schema_path
            );
            return;
        }
        
        # Validate against the selected choice schema
        $self->_validate_value($value, $choices->{$choice_name}, $path, "$schema_path/choices/$choice_name");
    }
    else {
        # No selector - try to match against choices
        my $match_count = 0;
        my $matched_choice;
        
        for my $choice_name (keys %$choices) {
            my $temp_errors = $self->{errors};
            $self->{errors} = [];
            $self->_validate_value($value, $choices->{$choice_name}, $path, "$schema_path/choices/$choice_name");
            if (@{$self->{errors}} == 0) {
                $match_count++;
                $matched_choice = $choice_name;
            }
            $self->{errors} = $temp_errors;
        }
        
        if ($match_count == 0) {
            $self->_add_error(
                INSTANCE_CHOICE_NO_MATCH,
                'Value does not match any choice option',
                $path,
                $schema_path
            );
        }
        elsif ($match_count > 1) {
            $self->_add_error(
                INSTANCE_CHOICE_MULTIPLE_MATCHES,
                "Value matches $match_count choices (should match exactly one)",
                $path,
                $schema_path
            );
        }
    }
}

sub _validate_date {
    my ($self, $value, $path, $schema_path) = @_;
    
    unless (defined $value && !ref($value)) {
        $self->_add_error(
            INSTANCE_DATE_EXPECTED,
            'Date must be a string',
            $path,
            $schema_path
        );
        return;
    }
    
    unless ($value =~ $DATE_REGEX) {
        $self->_add_error(
            INSTANCE_DATE_FORMAT_INVALID,
            "Invalid date format: $value",
            $path,
            $schema_path
        );
    }
}

sub _validate_time {
    my ($self, $value, $path, $schema_path) = @_;
    
    unless (defined $value && !ref($value)) {
        $self->_add_error(
            INSTANCE_TIME_EXPECTED,
            'Time must be a string',
            $path,
            $schema_path
        );
        return;
    }
    
    unless ($value =~ $TIME_REGEX) {
        $self->_add_error(
            INSTANCE_TIME_FORMAT_INVALID,
            "Invalid time format: $value",
            $path,
            $schema_path
        );
    }
}

sub _validate_datetime {
    my ($self, $value, $path, $schema_path) = @_;
    
    unless (defined $value && !ref($value)) {
        $self->_add_error(
            INSTANCE_DATETIME_EXPECTED,
            'DateTime must be a string',
            $path,
            $schema_path
        );
        return;
    }
    
    unless ($value =~ $DATETIME_REGEX) {
        $self->_add_error(
            INSTANCE_DATETIME_FORMAT_INVALID,
            "Invalid datetime format: $value",
            $path,
            $schema_path
        );
    }
}

sub _validate_duration {
    my ($self, $value, $path, $schema_path) = @_;
    
    unless (defined $value && !ref($value)) {
        $self->_add_error(
            INSTANCE_DURATION_EXPECTED,
            'Duration must be a string',
            $path,
            $schema_path
        );
        return;
    }
    
    unless ($value =~ $DURATION_REGEX) {
        $self->_add_error(
            INSTANCE_DURATION_FORMAT_INVALID,
            "Invalid duration format: $value",
            $path,
            $schema_path
        );
    }
}

sub _validate_uuid {
    my ($self, $value, $path, $schema_path) = @_;
    
    unless (defined $value && !ref($value)) {
        $self->_add_error(
            INSTANCE_UUID_EXPECTED,
            'UUID must be a string',
            $path,
            $schema_path
        );
        return;
    }
    
    unless ($value =~ $UUID_REGEX) {
        $self->_add_error(
            INSTANCE_UUID_FORMAT_INVALID,
            "Invalid UUID format: $value",
            $path,
            $schema_path
        );
    }
}

sub _validate_uri {
    my ($self, $value, $path, $schema_path) = @_;
    
    unless (defined $value && !ref($value)) {
        $self->_add_error(
            INSTANCE_URI_EXPECTED,
            'URI must be a string',
            $path,
            $schema_path
        );
        return;
    }
    
    unless ($value =~ $URI_REGEX) {
        $self->_add_error(
            INSTANCE_URI_FORMAT_INVALID,
            "Invalid URI format: $value",
            $path,
            $schema_path
        );
    }
}

sub _validate_binary {
    my ($self, $value, $path, $schema_path) = @_;
    
    unless (defined $value && !ref($value)) {
        $self->_add_error(
            INSTANCE_BINARY_EXPECTED,
            'Binary must be a base64 string',
            $path,
            $schema_path
        );
        return;
    }
    
    # Validate base64 encoding
    eval {
        MIME::Base64::decode_base64($value);
    };
    if ($@) {
        $self->_add_error(
            INSTANCE_BINARY_ENCODING_INVALID,
            'Invalid base64 encoding',
            $path,
            $schema_path
        );
    }
}

sub _validate_jsonpointer {
    my ($self, $value, $path, $schema_path) = @_;
    
    unless (defined $value && !ref($value)) {
        $self->_add_error(
            INSTANCE_JSONPOINTER_EXPECTED,
            'JSON Pointer must be a string',
            $path,
            $schema_path
        );
        return;
    }
    
    # Empty string is valid JSON Pointer (root)
    return if $value eq '';
    
    unless ($value =~ $JSONPOINTER_REGEX) {
        $self->_add_error(
            INSTANCE_JSONPOINTER_FORMAT_INVALID,
            "Invalid JSON Pointer format: $value",
            $path,
            $schema_path
        );
    }
}

sub _validate_composition {
    my ($self, $value, $schema, $path, $schema_path) = @_;
    
    # allOf
    if (exists $schema->{allOf}) {
        for my $i (0 .. $#{$schema->{allOf}}) {
            $self->_validate_value($value, $schema->{allOf}[$i], $path, "$schema_path/allOf/$i");
        }
    }
    
    # anyOf
    if (exists $schema->{anyOf}) {
        my $matched = 0;
        my $temp_errors = $self->{errors};
        
        for my $sub_schema (@{$schema->{anyOf}}) {
            $self->{errors} = [];
            $self->_validate_value($value, $sub_schema, $path, "$schema_path/anyOf");
            if (@{$self->{errors}} == 0) {
                $matched = 1;
                last;
            }
        }
        
        $self->{errors} = $temp_errors;
        
        unless ($matched) {
            $self->_add_error(
                INSTANCE_ANY_OF_NONE_MATCHED,
                'Value must match at least one schema in anyOf',
                $path,
                $schema_path
            );
        }
    }
    
    # oneOf
    if (exists $schema->{oneOf}) {
        my $match_count = 0;
        my $temp_errors = $self->{errors};
        
        for my $sub_schema (@{$schema->{oneOf}}) {
            $self->{errors} = [];
            $self->_validate_value($value, $sub_schema, $path, "$schema_path/oneOf");
            if (@{$self->{errors}} == 0) {
                $match_count++;
            }
        }
        
        $self->{errors} = $temp_errors;
        
        if ($match_count != 1) {
            $self->_add_error(
                INSTANCE_ONE_OF_INVALID_COUNT,
                "Value must match exactly one schema in oneOf (matched $match_count)",
                $path,
                $schema_path
            );
        }
    }
    
    # not
    if (exists $schema->{not}) {
        my $temp_errors = $self->{errors};
        $self->{errors} = [];
        $self->_validate_value($value, $schema->{not}, $path, "$schema_path/not");
        my $matched = @{$self->{errors}} == 0;
        $self->{errors} = $temp_errors;
        
        if ($matched) {
            $self->_add_error(
                INSTANCE_NOT_MATCHED,
                "Value must not match the schema in 'not'",
                $path,
                $schema_path
            );
        }
    }
    
    # if/then/else
    if (exists $schema->{if}) {
        my $temp_errors = $self->{errors};
        $self->{errors} = [];
        $self->_validate_value($value, $schema->{if}, $path, "$schema_path/if");
        my $if_matched = @{$self->{errors}} == 0;
        $self->{errors} = $temp_errors;
        
        if ($if_matched && exists $schema->{then}) {
            $self->_validate_value($value, $schema->{then}, $path, "$schema_path/then");
        }
        elsif (!$if_matched && exists $schema->{else}) {
            $self->_validate_value($value, $schema->{else}, $path, "$schema_path/else");
        }
    }
}

sub _resolve_ref {
    my ($self, $ref, $root) = @_;
    
    # Handle # prefix
    $ref =~ s/^#//;
    
    return $root if $ref eq '' || $ref eq '/';
    
    my @segments = split m{/}, $ref;
    shift @segments if @segments && $segments[0] eq '';
    
    my $current = $root;
    
    for my $segment (@segments) {
        # Unescape JSON Pointer tokens
        $segment =~ s/~1/\//g;
        $segment =~ s/~0/~/g;
        
        if (ref($current) eq 'HASH') {
            return undef unless exists $current->{$segment};
            $current = $current->{$segment};
        }
        elsif (ref($current) eq 'ARRAY') {
            return undef unless $segment =~ /^\d+$/;
            my $idx = int($segment);
            return undef if $idx >= @$current;
            $current = $current->[$idx];
        }
        else {
            return undef;
        }
    }
    
    return $current;
}

sub _values_equal {
    my ($self, $a, $b) = @_;
    
    # Handle undefined
    if (!defined $a && !defined $b) {
        return 1;
    }
    if (!defined $a || !defined $b) {
        return 0;
    }
    
    # Handle different types
    my $ref_a = ref($a);
    my $ref_b = ref($b);
    
    if ($ref_a ne $ref_b) {
        return 0;
    }
    
    if ($ref_a eq '') {
        # Scalars
        return $a eq $b;
    }
    elsif ($ref_a eq 'ARRAY') {
        return 0 if @$a != @$b;
        for my $i (0 .. $#$a) {
            return 0 unless $self->_values_equal($a->[$i], $b->[$i]);
        }
        return 1;
    }
    elsif ($ref_a eq 'HASH') {
        my @keys_a = sort keys %$a;
        my @keys_b = sort keys %$b;
        return 0 if @keys_a != @keys_b;
        for my $i (0 .. $#keys_a) {
            return 0 if $keys_a[$i] ne $keys_b[$i];
            return 0 unless $self->_values_equal($a->{$keys_a[$i]}, $b->{$keys_b[$i]});
        }
        return 1;
    }
    
    # Fallback
    return $a eq $b;
}

sub _value_to_key {
    my ($self, $value) = @_;
    
    if (!defined $value) {
        return 'null';
    }
    elsif (!ref($value)) {
        if (JSON::PP::is_bool($value)) {
            return $value ? 'true' : 'false';
        }
        return "s:$value";
    }
    elsif (ref($value) eq 'ARRAY') {
        return 'a:[' . join(',', map { $self->_value_to_key($_) } @$value) . ']';
    }
    elsif (ref($value) eq 'HASH') {
        return 'o:{' . join(',', map { "$_:" . $self->_value_to_key($value->{$_}) } sort keys %$value) . '}';
    }
    else {
        return "?:$value";
    }
}

sub _is_false {
    my ($value) = @_;
    return 0 unless defined $value;
    return 1 if ref($value) eq '' && ($value eq '0' || $value eq 'false' || $value eq '');
    return 1 if JSON::PP::is_bool($value) && !$value;
    return 0;
}

1;

__END__

=head1 AUTHOR

JSON Structure Project

=head1 LICENSE

MIT License

=cut
