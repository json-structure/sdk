package JSON::Structure::SchemaValidator;

use strict;
use warnings;
use v5.20;

our $VERSION = '0.01';

use JSON::MaybeXS;
use Scalar::Util qw(blessed);
use JSON::Structure::Types;
use JSON::Structure::ErrorCodes qw(:all);
use JSON::Structure::JsonSourceLocator;

=head1 NAME

JSON::Structure::SchemaValidator - Validate JSON Structure schema documents

=head1 SYNOPSIS

    use JSON::Structure::SchemaValidator;
    use JSON::PP;
    
    my $validator = JSON::Structure::SchemaValidator->new(
        extended     => 1,    # Enable extended validation
        allow_import => 1,    # Enable $import/$importdefs
    );
    
    my $schema = decode_json($schema_json);
    my $result = $validator->validate($schema, $schema_json);
    
    if ($result->is_valid) {
        say "Schema is valid!";
    } else {
        for my $error (@{$result->errors}) {
            say $error->to_string;
        }
    }

=head1 DESCRIPTION

Validates JSON Structure Core documents for conformance with the specification.
Provides error messages annotated with line and column numbers.

=cut

# Regular expressions
my $ABSOLUTE_URI_REGEX = qr/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//;
my $IDENTIFIER_REGEX = qr/^[A-Za-z_][A-Za-z0-9_]*$/;
my $IDENTIFIER_DOLLAR_REGEX = qr/^[A-Za-z_\$][A-Za-z0-9_\$]*$/;
my $MAP_KEY_REGEX = qr/^[A-Za-z0-9._-]+$/;

# Type definitions
my %PRIMITIVE_TYPES = map { $_ => 1 } @{JSON::Structure::Types::PRIMITIVE_TYPES()};
my %COMPOUND_TYPES = map { $_ => 1 } @{JSON::Structure::Types::COMPOUND_TYPES()};
my %NUMERIC_TYPES = map { $_ => 1 } @{JSON::Structure::Types::NUMERIC_TYPES()};

# Reserved keywords
my %RESERVED_KEYWORDS = map { $_ => 1 } qw(
    definitions $extends $id $ref $root $schema $uses
    $offers abstract additionalProperties const default
    description enum examples format items maxLength
    name precision properties required scale type
    values choices selector tuple
);

# Extended keywords for conditional composition
my %COMPOSITION_KEYWORDS = map { $_ => 1 } qw(allOf anyOf oneOf not if then else);

# Extended keywords for validation - combined for warning generation
my %VALIDATION_EXTENSION_KEYWORDS = map { $_ => 1 } qw(
    pattern format minLength maxLength
    minimum maximum exclusiveMinimum exclusiveMaximum multipleOf
    minItems maxItems uniqueItems contains minContains maxContains
    minProperties maxProperties dependentRequired patternProperties
    propertyNames default contentEncoding contentMediaType
    minEntries maxEntries patternKeys keyNames has
);

# Extended keywords for validation - categorized for constraint validation
my %NUMERIC_VALIDATION_KEYWORDS = map { $_ => 1 } qw(
    minimum maximum exclusiveMinimum exclusiveMaximum multipleOf
);
my %STRING_VALIDATION_KEYWORDS = map { $_ => 1 } qw(
    minLength maxLength pattern format contentEncoding contentMediaType
);
my %ARRAY_VALIDATION_KEYWORDS = map { $_ => 1 } qw(
    minItems maxItems uniqueItems contains minContains maxContains
);
my %OBJECT_VALIDATION_KEYWORDS = map { $_ => 1 } qw(
    minProperties maxProperties minEntries maxEntries
    dependentRequired patternProperties patternKeys
    propertyNames keyNames has default
);

# Combined validation keywords for warning detection
my %ALL_VALIDATION_KEYWORDS = (
    %NUMERIC_VALIDATION_KEYWORDS,
    %STRING_VALIDATION_KEYWORDS,
    %ARRAY_VALIDATION_KEYWORDS,
    %OBJECT_VALIDATION_KEYWORDS,
);

# Valid format values
my %VALID_FORMATS = map { $_ => 1 } qw(
    ipv4 ipv6 email idn-email hostname idn-hostname
    iri iri-reference uri-template relative-json-pointer regex
);

# Known extensions
my %KNOWN_EXTENSIONS = map { $_ => 1 } qw(
    JSONStructureImport JSONStructureAlternateNames JSONStructureUnits
    JSONStructureConditionalComposition JSONStructureValidation
);

sub new {
    my ($class, %args) = @_;
    
    my $self = bless {
        allow_dollar             => $args{allow_dollar} // 0,
        allow_import             => $args{allow_import} // 0,
        import_map               => $args{import_map} // {},
        extended                 => $args{extended} // 0,
        external_schemas         => {},
        warn_on_unused_extensions => $args{warn_on_unused_extension_keywords} // 1,
        max_validation_depth     => $args{max_validation_depth} // 64,
        enabled_extensions       => {},
        errors                   => [],
        warnings                 => [],
        doc                      => undef,
        source_text              => undef,
        source_locator           => undef,
        seen_extends             => {},
        seen_refs                => {},
        current_depth            => 0,
    }, $class;
    
    # Build lookup for external schemas by $id
    if ($args{external_schemas}) {
        for my $schema (@{$args{external_schemas}}) {
            if (ref($schema) eq 'HASH' && exists $schema->{'$id'}) {
                $self->{external_schemas}{$schema->{'$id'}} = $schema;
            }
        }
    }
    
    return $self;
}

=head2 validate($doc, $source_text)

Validates a JSON Structure schema document.

Returns a ValidationResult object with errors and warnings.

=cut

sub validate {
    my ($self, $doc, $source_text) = @_;
    
    # Reset state
    $self->{errors} = [];
    $self->{warnings} = [];
    $self->{doc} = $doc;
    $self->{source_text} = $source_text;
    $self->{seen_extends} = {};
    $self->{seen_refs} = {};
    $self->{enabled_extensions} = {};
    $self->{current_depth} = 0;
    
    # Initialize source locator
    if (defined $source_text) {
        $self->{source_locator} = JSON::Structure::JsonSourceLocator->new($source_text);
    }
    else {
        $self->{source_locator} = undef;
    }
    
    # Check for null/undefined
    if (!defined $doc) {
        $self->_add_error(SCHEMA_NULL, 'Schema cannot be null', '#');
        return $self->_make_result();
    }
    
    # Check document is an object
    if (ref($doc) ne 'HASH') {
        $self->_add_error(SCHEMA_INVALID_TYPE, 'Root of the document must be a JSON object', '#');
        return $self->_make_result();
    }
    
    # Process $import and $importdefs
    $self->_process_imports($doc, '#') if $self->{allow_import};
    
    # Check enabled extensions
    $self->_check_enabled_extensions($doc) if $self->{extended};
    
    # Validate required top-level keywords
    $self->_check_required_top_level_keywords($doc, '#');
    
    # Validate $schema
    if (exists $doc->{'$schema'}) {
        $self->_check_is_absolute_uri($doc->{'$schema'}, '$schema', '#/$schema');
    }
    
    # Validate $id
    if (exists $doc->{'$id'}) {
        $self->_check_is_absolute_uri($doc->{'$id'}, '$id', '#/$id');
    }
    
    # Validate $uses
    if (exists $doc->{'$uses'}) {
        $self->_check_uses($doc->{'$uses'}, '#/$uses');
    }
    
    # Check for conflicting type and $root
    if (exists $doc->{type} && exists $doc->{'$root'}) {
        $self->_add_error(
            SCHEMA_ROOT_CONFLICT,
            "Document cannot have both 'type' at root and '\$root' at the same time",
            '#'
        );
    }
    
    # Validate type if present
    if (exists $doc->{type}) {
        $self->_validate_schema($doc, 1, '#', undef);
    }
    
    # Validate $root if present
    if (exists $doc->{'$root'}) {
        $self->_check_json_pointer($doc->{'$root'}, $self->{doc}, '#/$root');
    }
    
    # Validate definitions
    if (exists $doc->{definitions}) {
        if (ref($doc->{definitions}) ne 'HASH') {
            $self->_add_error(
                SCHEMA_KEYWORD_INVALID_TYPE,
                'definitions must be an object',
                '#/definitions'
            );
        }
        else {
            $self->_validate_namespace($doc->{definitions}, '#/definitions');
        }
    }
    
    # Validate $offers
    if (exists $doc->{'$offers'}) {
        $self->_check_offers($doc->{'$offers'}, '#/$offers');
    }
    
    # Check composition keywords at root if no type
    if ($self->{extended} && !exists $doc->{type}) {
        $self->_check_composition_keywords($doc, '#');
    }
    
    # Ensure document has type, $root, or composition keywords
    my $has_type = exists $doc->{type};
    my $has_root = exists $doc->{'$root'};
    my $has_composition = $self->{extended} && $self->_has_composition_keywords($doc);
    
    if (!$has_type && !$has_root && !$has_composition) {
        $self->_add_error(
            SCHEMA_ROOT_MISSING_TYPE,
            "Document must have 'type', '\$root', or composition keywords at root",
            '#'
        );
    }
    
    # Check for validation extension keywords without $uses (warnings)
    if ($self->{extended}) {
        $self->_check_validation_keyword_warnings($doc, '#');
    }
    
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

sub _add_warning {
    my ($self, $code, $message, $path) = @_;
    
    my $location = $self->{source_locator}
        ? $self->{source_locator}->get_location($path)
        : JSON::Structure::Types::JsonLocation->unknown();
    
    push @{$self->{warnings}}, JSON::Structure::Types::ValidationError->new(
        code     => $code,
        message  => $message,
        path     => $path,
        severity => JSON::Structure::Types::ValidationSeverity::WARNING,
        location => $location,
    );
}

sub _check_validation_keyword_warnings {
    my ($self, $schema, $path) = @_;
    
    return unless ref($schema) eq 'HASH';
    
    # Check if $uses is present at this level
    my $has_uses = exists $schema->{'$uses'};
    
    # Check for validation keywords without $uses
    for my $key (keys %$schema) {
        if (exists $ALL_VALIDATION_KEYWORDS{$key} && !$has_uses) {
            $self->_add_warning(
                SCHEMA_EXTENSION_KEYWORD_NOT_ENABLED,
                "Validation keyword '$key' found but no '\$uses' declaration in scope. Add '\$uses' with an appropriate validation extension to enable this keyword.",
                "$path/$key"
            );
        }
    }
    
    # Recurse into nested schemas
    if (exists $schema->{type}) {
        my $type = $schema->{type};
        
        if ($type eq 'array' && exists $schema->{items}) {
            $self->_check_validation_keyword_warnings($schema->{items}, "$path/items");
        }
        elsif ($type eq 'map' && exists $schema->{values}) {
            $self->_check_validation_keyword_warnings($schema->{values}, "$path/values");
        }
        elsif ($type eq 'object') {
            if (exists $schema->{properties} && ref($schema->{properties}) eq 'HASH') {
                for my $prop (keys %{$schema->{properties}}) {
                    $self->_check_validation_keyword_warnings($schema->{properties}{$prop}, "$path/properties/$prop");
                }
            }
            if (exists $schema->{optionalProperties} && ref($schema->{optionalProperties}) eq 'HASH') {
                for my $prop (keys %{$schema->{optionalProperties}}) {
                    $self->_check_validation_keyword_warnings($schema->{optionalProperties}{$prop}, "$path/optionalProperties/$prop");
                }
            }
        }
        elsif ($type eq 'tuple' && exists $schema->{items} && ref($schema->{items}) eq 'ARRAY') {
            for my $i (0 .. $#{$schema->{items}}) {
                $self->_check_validation_keyword_warnings($schema->{items}[$i], "$path/items/$i");
            }
        }
    }
    
    # Check composition keywords
    for my $comp_key (qw(allOf anyOf oneOf)) {
        if (exists $schema->{$comp_key} && ref($schema->{$comp_key}) eq 'ARRAY') {
            for my $i (0 .. $#{$schema->{$comp_key}}) {
                $self->_check_validation_keyword_warnings($schema->{$comp_key}[$i], "$path/$comp_key/$i");
            }
        }
    }
    
    # Check if keyword
    if (exists $schema->{if}) {
        $self->_check_validation_keyword_warnings($schema->{if}, "$path/if");
        $self->_check_validation_keyword_warnings($schema->{then}, "$path/then") if exists $schema->{then};
        $self->_check_validation_keyword_warnings($schema->{else}, "$path/else") if exists $schema->{else};
    }
    
    # Check definitions
    if (exists $schema->{definitions} && ref($schema->{definitions}) eq 'HASH') {
        $self->_check_definitions_warnings($schema->{definitions}, "$path/definitions");
    }
}

sub _check_definitions_warnings {
    my ($self, $defs, $path) = @_;
    
    return unless ref($defs) eq 'HASH';
    
    for my $key (keys %$defs) {
        my $val = $defs->{$key};
        if (ref($val) eq 'HASH') {
            if (exists $val->{type}) {
                # This is a schema
                $self->_check_validation_keyword_warnings($val, "$path/$key");
            }
            else {
                # This might be a namespace
                $self->_check_definitions_warnings($val, "$path/$key");
            }
        }
    }
}

sub _check_required_top_level_keywords {
    my ($self, $obj, $location) = @_;
    
    # $id is required at root
    if (!exists $obj->{'$id'}) {
        $self->_add_error(
            SCHEMA_ROOT_MISSING_ID,
            "Missing required '\$id' keyword at root",
            $location
        );
    }
    
    # Root schema with 'type' must have 'name'
    if (exists $obj->{type} && !exists $obj->{name}) {
        $self->_add_error(
            SCHEMA_ROOT_MISSING_NAME,
            "Root schema with 'type' must have a 'name' property",
            $location
        );
    }
}

sub _check_is_absolute_uri {
    my ($self, $value, $keyword, $location) = @_;
    
    if (!defined $value || ref($value)) {
        $self->_add_error(
            SCHEMA_KEYWORD_INVALID_TYPE,
            "'$keyword' must be a string",
            $location
        );
        return;
    }
    
    if ($value !~ $ABSOLUTE_URI_REGEX) {
        $self->_add_error(
            SCHEMA_KEYWORD_INVALID_TYPE,
            "'$keyword' must be an absolute URI",
            $location
        );
    }
}

sub _check_enabled_extensions {
    my ($self, $doc) = @_;
    
    my $schema_uri = $doc->{'$schema'} // '';
    my $uses = $doc->{'$uses'} // [];
    
    # Check if using extended or validation meta-schema
    if ($schema_uri =~ /extended|validation/) {
        if ($schema_uri =~ /validation/) {
            $self->{enabled_extensions}{JSONStructureConditionalComposition} = 1;
            $self->{enabled_extensions}{JSONStructureValidation} = 1;
        }
    }
    
    # Check $uses array
    if (ref($uses) eq 'ARRAY') {
        for my $ext (@$uses) {
            if (exists $KNOWN_EXTENSIONS{$ext}) {
                $self->{enabled_extensions}{$ext} = 1;
            }
        }
    }
}

sub _check_uses {
    my ($self, $uses, $path) = @_;
    
    if (ref($uses) ne 'ARRAY') {
        $self->_add_error(
            SCHEMA_KEYWORD_INVALID_TYPE,
            '$uses must be an array',
            $path
        );
        return;
    }
    
    for my $i (0 .. $#$uses) {
        my $ext = $uses->[$i];
        if (!defined $ext || ref($ext)) {
            $self->_add_error(
                SCHEMA_KEYWORD_INVALID_TYPE,
                "\$uses[$i] must be a string",
                "$path\[$i]"
            );
        }
        elsif ($self->{extended} && !exists $KNOWN_EXTENSIONS{$ext}) {
            $self->_add_error(
                SCHEMA_USES_UNKNOWN_EXTENSION,
                "Unknown extension '$ext' in \$uses",
                "$path\[$i]"
            );
        }
    }
}

sub _check_offers {
    my ($self, $offers, $path) = @_;
    
    if (ref($offers) ne 'ARRAY') {
        $self->_add_error(
            SCHEMA_KEYWORD_INVALID_TYPE,
            '$offers must be an array',
            $path
        );
        return;
    }
    
    for my $i (0 .. $#$offers) {
        my $ext = $offers->[$i];
        if (!defined $ext || ref($ext)) {
            $self->_add_error(
                SCHEMA_KEYWORD_INVALID_TYPE,
                "\$offers[$i] must be a string",
                "$path\[$i]"
            );
        }
    }
}

sub _has_composition_keywords {
    my ($self, $obj) = @_;
    
    return 0 unless ref($obj) eq 'HASH';
    
    for my $key (keys %COMPOSITION_KEYWORDS) {
        return 1 if exists $obj->{$key};
    }
    
    return 0;
}

sub _check_composition_keywords {
    my ($self, $obj, $path) = @_;
    
    for my $keyword (qw(allOf anyOf oneOf)) {
        if (exists $obj->{$keyword}) {
            $self->_validate_composition_array($obj->{$keyword}, $keyword, "$path/$keyword");
        }
    }
    
    if (exists $obj->{not}) {
        if (ref($obj->{not}) ne 'HASH') {
            $self->_add_error(
                SCHEMA_KEYWORD_INVALID_TYPE,
                "'not' must be a schema object",
                "$path/not"
            );
        }
        else {
            $self->_validate_schema($obj->{not}, 0, "$path/not", undef);
        }
    }
    
    # if/then/else
    if (exists $obj->{if}) {
        if (ref($obj->{if}) ne 'HASH') {
            $self->_add_error(
                SCHEMA_KEYWORD_INVALID_TYPE,
                "'if' must be a schema object",
                "$path/if"
            );
        }
        else {
            $self->_validate_schema($obj->{if}, 0, "$path/if", undef);
        }
    }
    
    if (exists $obj->{then}) {
        if (ref($obj->{then}) ne 'HASH') {
            $self->_add_error(
                SCHEMA_KEYWORD_INVALID_TYPE,
                "'then' must be a schema object",
                "$path/then"
            );
        }
        else {
            $self->_validate_schema($obj->{then}, 0, "$path/then", undef);
        }
    }
    
    if (exists $obj->{else}) {
        if (ref($obj->{else}) ne 'HASH') {
            $self->_add_error(
                SCHEMA_KEYWORD_INVALID_TYPE,
                "'else' must be a schema object",
                "$path/else"
            );
        }
        else {
            $self->_validate_schema($obj->{else}, 0, "$path/else", undef);
        }
    }
}

sub _validate_composition_array {
    my ($self, $arr, $keyword, $path) = @_;
    
    if (ref($arr) ne 'ARRAY') {
        $self->_add_error(
            SCHEMA_COMPOSITION_NOT_ARRAY,
            "$keyword must be an array",
            $path
        );
        return;
    }
    
    if (@$arr == 0) {
        $self->_add_error(
            SCHEMA_COMPOSITION_EMPTY,
            "$keyword array cannot be empty",
            $path
        );
        return;
    }
    
    for my $i (0 .. $#$arr) {
        my $schema = $arr->[$i];
        if (ref($schema) ne 'HASH') {
            $self->_add_error(
                SCHEMA_KEYWORD_INVALID_TYPE,
                "$keyword\[$i] must be a schema object",
                "$path\[$i]"
            );
        }
        else {
            $self->_validate_schema($schema, 0, "$path\[$i]", undef);
        }
    }
}

sub _check_json_pointer {
    my ($self, $pointer, $doc, $path) = @_;
    
    if (!defined $pointer || ref($pointer)) {
        $self->_add_error(
            SCHEMA_KEYWORD_INVALID_TYPE,
            '$root must be a string',
            $path
        );
        return;
    }
    
    # Validate the pointer resolves
    my $target = $self->_resolve_json_pointer($pointer, $doc);
    if (!defined $target) {
        $self->_add_error(
            SCHEMA_REF_NOT_FOUND,
            "\$root target does not exist: $pointer",
            $path
        );
    }
}

sub _resolve_json_pointer {
    my ($self, $pointer, $doc) = @_;
    
    # Handle # prefix
    $pointer =~ s/^#//;
    
    return $doc if $pointer eq '' || $pointer eq '/';
    
    my @segments = split m{/}, $pointer;
    shift @segments if @segments && $segments[0] eq '';
    
    my $current = $doc;
    
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

sub _validate_namespace {
    my ($self, $definitions, $path) = @_;
    
    for my $name (keys %$definitions) {
        my $def = $definitions->{$name};
        my $def_path = "$path/$name";
        
        # Validate identifier
        my $id_regex = $self->{allow_dollar} ? $IDENTIFIER_DOLLAR_REGEX : $IDENTIFIER_REGEX;
        if ($name !~ $id_regex) {
            $self->_add_error(
                SCHEMA_NAME_INVALID,
                "Definition name '$name' must be a valid identifier",
                $def_path
            );
        }
        
        if (ref($def) ne 'HASH') {
            $self->_add_error(
                SCHEMA_INVALID_TYPE,
                'Definition must be an object',
                $def_path
            );
            next;
        }
        
        # Check for nested definitions (namespace)
        if (!exists $def->{type} && !exists $def->{'$ref'} && !$self->_has_composition_keywords($def)) {
            # Could be a namespace with nested definitions
            my $has_nested = 0;
            for my $key (keys %$def) {
                if (ref($def->{$key}) eq 'HASH' && 
                    (exists $def->{$key}{type} || exists $def->{$key}{'$ref'})) {
                    $has_nested = 1;
                    last;
                }
            }
            
            if ($has_nested) {
                $self->_validate_namespace($def, $def_path);
                next;
            }
            
            # Not a namespace - must have type or $ref
            $self->_add_error(
                SCHEMA_MISSING_TYPE,
                "Definition must have 'type' or '\$ref'",
                $def_path
            );
            next;
        }
        
        $self->_validate_schema($def, 0, $def_path, $name);
    }
}

sub _validate_schema {
    my ($self, $schema, $is_root, $path, $name_in_namespace) = @_;
    
    # Check depth
    $self->{current_depth}++;
    if ($self->{current_depth} > $self->{max_validation_depth}) {
        $self->_add_error(
            SCHEMA_MAX_DEPTH_EXCEEDED,
            "Maximum validation depth ($self->{max_validation_depth}) exceeded",
            $path
        );
        $self->{current_depth}--;
        return;
    }
    
    # Handle boolean schemas
    if (!ref($schema)) {
        if ($schema eq '1' || $schema eq '0' || 
            _is_json_bool($schema) || 
            $schema eq 'true' || $schema eq 'false') {
            $self->{current_depth}--;
            return;  # Boolean schema is valid
        }
    }
    
    if (ref($schema) ne 'HASH') {
        $self->_add_error(
            SCHEMA_INVALID_TYPE,
            'Schema must be a boolean or object',
            $path
        );
        $self->{current_depth}--;
        return;
    }
    
    # Validate name if present
    if (exists $schema->{name}) {
        my $id_regex = $self->{allow_dollar} ? $IDENTIFIER_DOLLAR_REGEX : $IDENTIFIER_REGEX;
        if (!defined $schema->{name} || ref($schema->{name}) || $schema->{name} !~ $id_regex) {
            $self->_add_error(
                SCHEMA_NAME_INVALID,
                "'name' must be a valid identifier",
                "$path/name"
            );
        }
    }
    
    # Validate type
    my $type = $schema->{type};
    
    if (!defined $type) {
        # Check for composition keywords in extended mode
        if ($self->{extended} && $self->_has_composition_keywords($schema)) {
            $self->_check_composition_keywords($schema, $path);
            $self->{current_depth}--;
            return;
        }
        
        # Check for $ref in type object form - this is allowed
        if (exists $schema->{'$ref'}) {
            $self->_add_error(
                SCHEMA_REF_NOT_IN_TYPE,
                "\$ref is only permitted inside the 'type' attribute",
                $path
            );
        }
        
        if (!$is_root) {
            # Non-root schemas without type are OK if they have other defining keywords
            my $has_defining = 0;
            for my $kw (qw(properties items values choices const enum)) {
                if (exists $schema->{$kw}) {
                    $has_defining = 1;
                    last;
                }
            }
            
            if (!$has_defining && !exists $schema->{'$ref'}) {
                # Could be just metadata - that's OK in some contexts
            }
        }
    }
    else {
        $self->_validate_type($type, $schema, $path);
    }
    
    # Validate properties
    if (exists $schema->{properties}) {
        $self->_validate_properties($schema->{properties}, $path);
    }
    
    # Validate required
    if (exists $schema->{required}) {
        $self->_validate_required($schema->{required}, $schema->{properties}, $path);
    }
    
    # Validate items
    if (exists $schema->{items}) {
        $self->_validate_items($schema->{items}, "$path/items");
    }
    
    # Validate values (for map type)
    if (exists $schema->{values}) {
        $self->_validate_values($schema->{values}, "$path/values");
    }
    
    # Validate choices (for choice type)
    if (exists $schema->{choices}) {
        $self->_validate_choices($schema->{choices}, $schema->{selector}, $path);
    }
    
    # Validate tuple
    if (exists $schema->{tuple}) {
        $self->_validate_tuple($schema->{tuple}, $schema->{properties}, $path);
    }
    
    # Validate enum
    if (exists $schema->{enum}) {
        $self->_validate_enum($schema->{enum}, "$path/enum");
    }
    
    # Validate const
    if (exists $schema->{const}) {
        # const can be any value, no specific validation needed
    }
    
    # Validate additionalProperties
    if (exists $schema->{additionalProperties}) {
        $self->_validate_additional_properties($schema->{additionalProperties}, "$path/additionalProperties");
    }
    
    # Validate $extends
    if (exists $schema->{'$extends'}) {
        $self->_validate_extends($schema->{'$extends'}, $path);
    }
    
    # Validate definitions within schema
    if (exists $schema->{definitions}) {
        if (ref($schema->{definitions}) ne 'HASH') {
            $self->_add_error(
                SCHEMA_KEYWORD_INVALID_TYPE,
                'definitions must be an object',
                "$path/definitions"
            );
        }
        else {
            $self->_validate_namespace($schema->{definitions}, "$path/definitions");
        }
    }
    
    # Validate extended keywords if enabled
    if ($self->{extended}) {
        $self->_validate_extended_keywords($schema, $type, $path);
        # Also check composition keywords within schemas with type
        $self->_check_composition_keywords($schema, $path);
    }
    
    # Validate altnames
    if (exists $schema->{altnames}) {
        $self->_validate_altnames($schema->{altnames}, "$path/altnames");
    }
    
    $self->{current_depth}--;
}

sub _validate_type {
    my ($self, $type, $schema, $path) = @_;
    
    my $type_path = "$path/type";
    
    # Type can be a string, array of strings, or object with $ref
    if (!defined $type) {
        return;  # No type is OK in some contexts
    }
    
    if (!ref($type)) {
        # Simple string type
        $self->_validate_type_name($type, $type_path);
        $self->_validate_type_constraints($type, $schema, $path);
    }
    elsif (ref($type) eq 'ARRAY') {
        # Array of types (union)
        if (@$type == 0) {
            $self->_add_error(
                SCHEMA_TYPE_ARRAY_EMPTY,
                'type array cannot be empty',
                $type_path
            );
            return;
        }
        
        for my $i (0 .. $#$type) {
            my $t = $type->[$i];
            if (!defined $t || ref($t)) {
                $self->_add_error(
                    SCHEMA_KEYWORD_INVALID_TYPE,
                    "type[$i] must be a string",
                    "$type_path\[$i]"
                );
            }
            else {
                $self->_validate_type_name($t, "$type_path\[$i]");
            }
        }
    }
    elsif (ref($type) eq 'HASH') {
        # Object type with $ref
        if (!exists $type->{'$ref'}) {
            $self->_add_error(
                SCHEMA_TYPE_OBJECT_MISSING_REF,
                'type object must contain $ref',
                $type_path
            );
        }
        else {
            $self->_validate_ref($type->{'$ref'}, "$type_path/\$ref");
        }
    }
    else {
        $self->_add_error(
            SCHEMA_KEYWORD_INVALID_TYPE,
            'type must be a string, array, or object with $ref',
            $type_path
        );
    }
}

sub _validate_type_name {
    my ($self, $type_name, $path) = @_;
    
    return if exists $PRIMITIVE_TYPES{$type_name};
    return if exists $COMPOUND_TYPES{$type_name};
    
    $self->_add_error(
        SCHEMA_TYPE_INVALID,
        "Invalid type: '$type_name'",
        $path
    );
}

sub _validate_type_constraints {
    my ($self, $type, $schema, $path) = @_;
    
    # Validate compound type requirements
    if ($type eq 'array' || $type eq 'set') {
        if (!exists $schema->{items} && !exists $schema->{contains}) {
            $self->_add_error(
                SCHEMA_ARRAY_MISSING_ITEMS,
                "$type type requires 'items' or 'contains' schema",
                $path
            );
        }
    }
    elsif ($type eq 'map') {
        if (!exists $schema->{values}) {
            $self->_add_error(
                SCHEMA_MAP_MISSING_VALUES,
                "map type requires 'values' schema",
                $path
            );
        }
    }
    elsif ($type eq 'tuple') {
        if (!exists $schema->{properties} || !exists $schema->{tuple}) {
            $self->_add_error(
                SCHEMA_TUPLE_MISSING_DEFINITION,
                "tuple type requires 'properties' and 'tuple' keywords",
                $path
            );
        }
    }
    elsif ($type eq 'choice') {
        if (!exists $schema->{choices}) {
            $self->_add_error(
                SCHEMA_CHOICE_MISSING_CHOICES,
                "choice type requires 'choices' keyword",
                $path
            );
        }
    }
}

sub _validate_ref {
    my ($self, $ref, $path) = @_;
    
    if (!defined $ref || ref($ref)) {
        $self->_add_error(
            SCHEMA_REF_INVALID,
            '$ref must be a string',
            $path
        );
        return;
    }
    
    # Check for circular references
    if (exists $self->{seen_refs}{$ref}) {
        $self->_add_error(
            SCHEMA_CIRCULAR_REF,
            "Circular reference detected: $ref",
            $path
        );
        return;
    }
    
    # Mark this ref as being processed
    $self->{seen_refs}{$ref} = 1;
    
    # Check if reference resolves
    my $target = $self->_resolve_json_pointer($ref, $self->{doc});
    if (!defined $target) {
        # Check external schemas
        my $found = 0;
        for my $id (keys %{$self->{external_schemas}}) {
            my $ext = $self->{external_schemas}{$id};
            if ($ref =~ /^$id/) {
                $found = 1;
                last;
            }
        }
        
        if (!$found) {
            $self->_add_error(
                SCHEMA_REF_NOT_FOUND,
                "\$ref target does not exist: $ref",
                $path
            );
        }
    }
    else {
        # Validate the target schema, checking for circular refs
        if (ref($target) eq 'HASH' && exists $target->{type}) {
            $self->_check_type_for_circular_ref($target, $ref, $path);
        }
    }
    
    # Clear the seen ref after processing
    delete $self->{seen_refs}{$ref};
}

sub _check_type_for_circular_ref {
    my ($self, $schema, $original_ref, $path) = @_;
    
    return unless ref($schema) eq 'HASH';
    
    my $type = $schema->{type};
    return unless defined $type;
    
    if (ref($type) eq 'HASH' && exists $type->{'$ref'}) {
        my $nested_ref = $type->{'$ref'};
        if ($nested_ref eq $original_ref) {
            $self->_add_error(
                SCHEMA_CIRCULAR_REF,
                "Direct circular reference detected: type references $nested_ref which references itself",
                $path
            );
        }
        elsif (exists $self->{seen_refs}{$nested_ref}) {
            $self->_add_error(
                SCHEMA_CIRCULAR_REF,
                "Circular reference chain detected involving: $nested_ref",
                $path
            );
        }
    }
}

sub _validate_properties {
    my ($self, $properties, $path) = @_;
    
    if (ref($properties) ne 'HASH') {
        $self->_add_error(
            SCHEMA_PROPERTIES_NOT_OBJECT,
            'properties must be an object',
            "$path/properties"
        );
        return;
    }
    
    for my $prop_name (keys %$properties) {
        my $prop_schema = $properties->{$prop_name};
        my $prop_path = "$path/properties/$prop_name";
        
        if (ref($prop_schema) eq 'HASH') {
            $self->_validate_schema($prop_schema, 0, $prop_path, undef);
        }
        elsif (!ref($prop_schema)) {
            # Boolean schema is valid
        }
        else {
            $self->_add_error(
                SCHEMA_INVALID_TYPE,
                'Property schema must be a boolean or object',
                $prop_path
            );
        }
    }
}

sub _validate_required {
    my ($self, $required, $properties, $path) = @_;
    
    if (ref($required) ne 'ARRAY') {
        $self->_add_error(
            SCHEMA_REQUIRED_NOT_ARRAY,
            'required must be an array',
            "$path/required"
        );
        return;
    }
    
    for my $i (0 .. $#$required) {
        my $prop = $required->[$i];
        
        if (!defined $prop || ref($prop)) {
            $self->_add_error(
                SCHEMA_REQUIRED_ITEM_NOT_STRING,
                'required array items must be strings',
                "$path/required[$i]"
            );
            next;
        }
        
        # Check if property exists in properties
        if (defined $properties && ref($properties) eq 'HASH') {
            if (!exists $properties->{$prop}) {
                $self->_add_error(
                    SCHEMA_REQUIRED_PROPERTY_NOT_DEFINED,
                    "Required property '$prop' is not defined in properties",
                    "$path/required[$i]"
                );
            }
        }
    }
}

sub _validate_items {
    my ($self, $items, $path) = @_;
    
    if (ref($items) eq 'HASH') {
        $self->_validate_schema($items, 0, $path, undef);
    }
    elsif (!ref($items)) {
        # Boolean schema is valid
    }
    else {
        $self->_add_error(
            SCHEMA_KEYWORD_INVALID_TYPE,
            'items must be a boolean or schema object',
            $path
        );
    }
}

sub _validate_values {
    my ($self, $values, $path) = @_;
    
    if (ref($values) eq 'HASH') {
        $self->_validate_schema($values, 0, $path, undef);
    }
    elsif (!ref($values)) {
        # Boolean schema is valid
    }
    else {
        $self->_add_error(
            SCHEMA_KEYWORD_INVALID_TYPE,
            'values must be a boolean or schema object',
            $path
        );
    }
}

sub _validate_choices {
    my ($self, $choices, $selector, $path) = @_;
    
    if (ref($choices) ne 'HASH') {
        $self->_add_error(
            SCHEMA_CHOICES_NOT_OBJECT,
            'choices must be an object',
            "$path/choices"
        );
        return;
    }
    
    if (keys %$choices == 0) {
        $self->_add_error(
            SCHEMA_KEYWORD_EMPTY,
            'choices cannot be empty',
            "$path/choices"
        );
        return;
    }
    
    for my $choice_name (keys %$choices) {
        my $choice_schema = $choices->{$choice_name};
        if (ref($choice_schema) eq 'HASH') {
            $self->_validate_schema($choice_schema, 0, "$path/choices/$choice_name", undef);
        }
        elsif (!ref($choice_schema)) {
            # Boolean schema is valid
        }
        else {
            $self->_add_error(
                SCHEMA_INVALID_TYPE,
                'Choice schema must be a boolean or object',
                "$path/choices/$choice_name"
            );
        }
    }
}

sub _validate_tuple {
    my ($self, $tuple, $properties, $path) = @_;
    
    if (ref($tuple) ne 'ARRAY') {
        $self->_add_error(
            SCHEMA_TUPLE_ORDER_NOT_ARRAY,
            "'tuple' keyword must be an array of property names",
            "$path/tuple"
        );
        return;
    }
    
    # Validate each tuple entry exists in properties
    if (defined $properties && ref($properties) eq 'HASH') {
        for my $i (0 .. $#$tuple) {
            my $prop = $tuple->[$i];
            if (!defined $prop || ref($prop)) {
                $self->_add_error(
                    SCHEMA_KEYWORD_INVALID_TYPE,
                    "tuple[$i] must be a string",
                    "$path/tuple[$i]"
                );
                next;
            }
            
            if (!exists $properties->{$prop}) {
                $self->_add_error(
                    SCHEMA_REQUIRED_PROPERTY_NOT_DEFINED,
                    "Tuple property '$prop' is not defined in properties",
                    "$path/tuple[$i]"
                );
            }
        }
    }
}

sub _validate_enum {
    my ($self, $enum, $path) = @_;
    
    if (ref($enum) ne 'ARRAY') {
        $self->_add_error(
            SCHEMA_ENUM_NOT_ARRAY,
            'enum must be an array',
            $path
        );
        return;
    }
    
    if (@$enum == 0) {
        $self->_add_error(
            SCHEMA_ENUM_EMPTY,
            'enum array cannot be empty',
            $path
        );
        return;
    }
    
    # Check for duplicates
    my %seen;
    for my $i (0 .. $#$enum) {
        my $value = $enum->[$i];
        my $key = _value_to_key($value);
        
        if (exists $seen{$key}) {
            $self->_add_error(
                SCHEMA_ENUM_DUPLICATES,
                'enum array contains duplicate values',
                $path
            );
            last;
        }
        $seen{$key} = 1;
    }
}

sub _value_to_key {
    my ($value) = @_;
    
    # Create a string key for comparison
    if (!defined $value) {
        return 'null';
    }
    elsif (!ref($value)) {
        return "s:$value";
    }
    elsif (ref($value) eq 'ARRAY') {
        return 'a:' . join(',', map { _value_to_key($_) } @$value);
    }
    elsif (ref($value) eq 'HASH') {
        return 'o:' . join(',', map { "$_:" . _value_to_key($value->{$_}) } sort keys %$value);
    }
    else {
        return "?:$value";
    }
}

sub _validate_additional_properties {
    my ($self, $additional, $path) = @_;
    
    if (ref($additional) eq 'HASH') {
        $self->_validate_schema($additional, 0, $path, undef);
    }
    elsif (!ref($additional)) {
        # Boolean is valid
        if ($additional !~ /^[01]$/ && 
            !_is_json_bool($additional) &&
            $additional ne 'true' && $additional ne 'false') {
            # Plain strings that aren't booleans aren't valid
            $self->_add_error(
                SCHEMA_ADDITIONAL_PROPERTIES_INVALID,
                'additionalProperties must be a boolean or schema',
                $path
            );
        }
    }
    else {
        $self->_add_error(
            SCHEMA_ADDITIONAL_PROPERTIES_INVALID,
            'additionalProperties must be a boolean or schema',
            $path
        );
    }
}

sub _validate_extends {
    my ($self, $extends, $path) = @_;
    
    if (!defined $extends || ref($extends)) {
        $self->_add_error(
            SCHEMA_KEYWORD_INVALID_TYPE,
            '$extends must be a string',
            "$path/\$extends"
        );
        return;
    }
    
    # Check for circular extends
    if (exists $self->{seen_extends}{$extends}) {
        $self->_add_error(
            SCHEMA_EXTENDS_CIRCULAR,
            "Circular \$extends reference detected: $extends",
            "$path/\$extends"
        );
        return;
    }
    
    $self->{seen_extends}{$extends} = 1;
    
    # Check if reference resolves
    my $target = $self->_resolve_json_pointer($extends, $self->{doc});
    if (!defined $target) {
        $self->_add_error(
            SCHEMA_EXTENDS_NOT_FOUND,
            "\$extends reference not found: $extends",
            "$path/\$extends"
        );
    }
}

sub _check_constraint_type_mismatch {
    my ($self, $schema, $type, $path) = @_;
    
    # Numeric constraints can only be on numeric types
    my @numeric_types = qw(int8 int16 int32 int64 uint8 uint16 uint32 uint64 float16 float32 float64 decimal integer double number float);
    my $is_numeric = grep { $_ eq $type } @numeric_types;
    
    for my $keyword (qw(minimum maximum exclusiveMinimum exclusiveMaximum multipleOf)) {
        if (exists $schema->{$keyword} && !$is_numeric) {
            $self->_add_error(
                SCHEMA_CONSTRAINT_TYPE_MISMATCH,
                "Constraint '$keyword' is only valid for numeric types, not '$type'",
                "$path/$keyword"
            );
        }
    }
    
    # String constraints can only be on string types
    my @string_types = qw(string date time datetime duration uri base64 binary uuid jsonpointer name);
    my $is_string = grep { $_ eq $type } @string_types;
    
    for my $keyword (qw(minLength maxLength pattern format contentEncoding contentMediaType)) {
        if (exists $schema->{$keyword} && !$is_string) {
            $self->_add_error(
                SCHEMA_CONSTRAINT_TYPE_MISMATCH,
                "Constraint '$keyword' is only valid for string types, not '$type'",
                "$path/$keyword"
            );
        }
    }
}

sub _validate_extended_keywords {
    my ($self, $schema, $type, $path) = @_;
    
    $type //= '';
    
    # Check constraint-type mismatches
    $self->_check_constraint_type_mismatch($schema, $type, $path);
    
    # Check numeric constraints
    for my $keyword (keys %NUMERIC_VALIDATION_KEYWORDS) {
        if (exists $schema->{$keyword}) {
            my $value = $schema->{$keyword};
            if (!defined $value || ref($value) || $value !~ /^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/) {
                $self->_add_error(
                    SCHEMA_NUMBER_CONSTRAINT_INVALID,
                    "$keyword must be a number",
                    "$path/$keyword"
                );
            }
        }
    }
    
    # Check min/max relationships
    if (exists $schema->{minimum} && exists $schema->{maximum}) {
        if ($schema->{minimum} > $schema->{maximum}) {
            $self->_add_error(
                SCHEMA_MIN_GREATER_THAN_MAX,
                "'minimum' cannot be greater than 'maximum'",
                $path
            );
        }
    }
    
    if (exists $schema->{minLength} && exists $schema->{maxLength}) {
        if ($schema->{minLength} > $schema->{maxLength}) {
            $self->_add_error(
                SCHEMA_MIN_GREATER_THAN_MAX,
                "'minLength' cannot be greater than 'maxLength'",
                $path
            );
        }
    }
    
    if (exists $schema->{minItems} && exists $schema->{maxItems}) {
        if ($schema->{minItems} > $schema->{maxItems}) {
            $self->_add_error(
                SCHEMA_MIN_GREATER_THAN_MAX,
                "'minItems' cannot be greater than 'maxItems'",
                $path
            );
        }
    }
    
    # Check for negative values where not allowed
    if (exists $schema->{minItems}) {
        my $value = $schema->{minItems};
        if (defined $value && !ref($value) && $value =~ /^-?\d+$/ && $value < 0) {
            $self->_add_error(
                SCHEMA_MIN_ITEMS_NEGATIVE,
                'minItems cannot be negative',
                "$path/minItems"
            );
        }
    }
    
    if (exists $schema->{minLength}) {
        my $value = $schema->{minLength};
        if (defined $value && !ref($value) && $value =~ /^-?\d+$/ && $value < 0) {
            $self->_add_error(
                SCHEMA_MIN_LENGTH_NEGATIVE,
                'minLength cannot be negative',
                "$path/minLength"
            );
        }
    }
    
    # Check multipleOf must be positive
    if (exists $schema->{multipleOf}) {
        my $value = $schema->{multipleOf};
        if (defined $value && !ref($value) && $value =~ /^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/) {
            if ($value <= 0) {
                $self->_add_error(
                    SCHEMA_MULTIPLE_OF_NOT_POSITIVE,
                    'multipleOf must be greater than 0',
                    "$path/multipleOf"
                );
            }
        }
    }
    
    # Check pattern
    if (exists $schema->{pattern}) {
        my $pattern = $schema->{pattern};
        if (!defined $pattern || ref($pattern)) {
            $self->_add_error(
                SCHEMA_PATTERN_NOT_STRING,
                'pattern must be a string',
                "$path/pattern"
            );
        }
        else {
            eval { qr/$pattern/ };
            if ($@) {
                $self->_add_error(
                    SCHEMA_PATTERN_INVALID,
                    "pattern is not a valid regular expression: '$pattern'",
                    "$path/pattern"
                );
            }
        }
    }
    
    # Check uniqueItems
    if (exists $schema->{uniqueItems}) {
        my $value = $schema->{uniqueItems};
        if (!_is_boolean($value)) {
            $self->_add_error(
                SCHEMA_UNIQUE_ITEMS_NOT_BOOLEAN,
                'uniqueItems must be a boolean',
                "$path/uniqueItems"
            );
        }
    }
}

# List of known JSON boolean classes from various JSON implementations
my @JSON_BOOL_CLASSES = qw(
    JSON::PP::Boolean
    JSON::XS::Boolean
    Cpanel::JSON::XS::Boolean
    JSON::Tiny::_Bool
    Mojo::JSON::_Bool
    Types::Serialiser::Boolean
);

# Helper to check if a value is a JSON boolean from any JSON parser
sub _is_json_bool {
    my ($value) = @_;
    return 0 unless defined $value && blessed($value);
    for my $class (@JSON_BOOL_CLASSES) {
        return 1 if $value->isa($class);
    }
    return 1 if JSON::MaybeXS::is_bool($value);
    return 0;
}

sub _is_boolean {
    my ($value) = @_;
    # JSON booleans are blessed references
    return 1 if _is_json_bool($value);
    return 0 if ref($value);
    return 1 if $value =~ /^[01]$/;
    return 1 if $value eq 'true' || $value eq 'false';
    return 0;
}

sub _validate_altnames {
    my ($self, $altnames, $path) = @_;
    
    if (ref($altnames) ne 'HASH') {
        $self->_add_error(
            SCHEMA_ALTNAMES_NOT_OBJECT,
            'altnames must be an object',
            $path
        );
        return;
    }
    
    for my $key (keys %$altnames) {
        my $value = $altnames->{$key};
        if (!defined $value || ref($value)) {
            $self->_add_error(
                SCHEMA_ALTNAMES_VALUE_NOT_STRING,
                'altnames values must be strings',
                "$path/$key"
            );
        }
    }
}

sub _process_imports {
    my ($self, $obj, $path) = @_;
    
    # Process $import and $importdefs recursively
    return unless ref($obj) eq 'HASH';
    
    for my $key (keys %$obj) {
        if ($key eq '$import' || $key eq '$importdefs') {
            # Handle import (implementation would fetch external schemas)
            # For now, just validate the URI is a string
            my $uri = $obj->{$key};
            if (!defined $uri || ref($uri)) {
                $self->_add_error(
                    SCHEMA_KEYWORD_INVALID_TYPE,
                    "$key must be a string",
                    "$path/$key"
                );
            }
        }
        elsif (ref($obj->{$key}) eq 'HASH') {
            $self->_process_imports($obj->{$key}, "$path/$key");
        }
        elsif (ref($obj->{$key}) eq 'ARRAY') {
            for my $i (0 .. $#{$obj->{$key}}) {
                if (ref($obj->{$key}[$i]) eq 'HASH') {
                    $self->_process_imports($obj->{$key}[$i], "$path/$key\[$i]");
                }
            }
        }
    }
}

1;

__END__

=head1 AUTHOR

JSON Structure Project

=head1 LICENSE

MIT License

=cut
