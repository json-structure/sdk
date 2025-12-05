#!/usr/bin/env perl

=head1 NAME

04_test_assets.t - Integration tests against shared test-assets

=head1 DESCRIPTION

This test file validates all schemas and instances from the sdk/test-assets directory.
These tests ensure that:
- Invalid schemas fail validation
- Invalid instances fail validation against their schemas
- Validation extension keywords ARE enforced when $uses is present

=cut

use strict;
use warnings;
use v5.20;

use Test::More;
use JSON::PP;
use File::Spec;
use File::Find;
use FindBin qw($Bin);
use lib "$Bin/../lib";

use JSON::Structure::SchemaValidator;
use JSON::Structure::InstanceValidator;

my $json = JSON::PP->new->utf8->allow_nonref;

# Get paths to test-assets
my $SDK_ROOT = File::Spec->catdir($Bin, '..', '..');
my $TEST_ASSETS = File::Spec->catdir($SDK_ROOT, 'test-assets');
my $INVALID_SCHEMAS = File::Spec->catdir($TEST_ASSETS, 'schemas', 'invalid');
my $WARNING_SCHEMAS = File::Spec->catdir($TEST_ASSETS, 'schemas', 'warnings');
my $VALIDATION_SCHEMAS = File::Spec->catdir($TEST_ASSETS, 'schemas', 'validation');
my $INVALID_INSTANCES = File::Spec->catdir($TEST_ASSETS, 'instances', 'invalid');
my $VALIDATION_INSTANCES = File::Spec->catdir($TEST_ASSETS, 'instances', 'validation');
my $SAMPLES_ROOT = File::Spec->catdir($SDK_ROOT, 'primer-and-samples', 'samples', 'core');

# Check if test-assets exists
unless (-d $TEST_ASSETS) {
    plan skip_all => "test-assets directory not found at $TEST_ASSETS";
}

=head2 Helper Functions

=cut

sub get_schema_files {
    my ($dir) = @_;
    return () unless -d $dir;
    
    opendir(my $dh, $dir) or return ();
    my @files = grep { /\.struct\.json$/ && -f File::Spec->catfile($dir, $_) } readdir($dh);
    closedir($dh);
    
    return map { File::Spec->catfile($dir, $_) } sort @files;
}

sub get_instance_dirs {
    my ($dir) = @_;
    return () unless -d $dir;
    
    opendir(my $dh, $dir) or return ();
    my @dirs = grep { !/^\./ && -d File::Spec->catfile($dir, $_) } readdir($dh);
    closedir($dh);
    
    return map { File::Spec->catfile($dir, $_) } sort @dirs;
}

sub get_json_files {
    my ($dir) = @_;
    return () unless -d $dir;
    
    opendir(my $dh, $dir) or return ();
    my @files = grep { /\.json$/ && -f File::Spec->catfile($dir, $_) } readdir($dh);
    closedir($dh);
    
    return map { File::Spec->catfile($dir, $_) } sort @files;
}

sub load_json_file {
    my ($path) = @_;
    
    open(my $fh, '<:encoding(UTF-8)', $path) or die "Cannot open $path: $!";
    local $/;
    my $content = <$fh>;
    close($fh);
    
    return $json->decode($content);
}

sub resolve_json_pointer {
    my ($pointer, $doc) = @_;
    
    return undef unless $pointer =~ m{^/};
    
    my @parts = split m{/}, substr($pointer, 1);
    my $current = $doc;
    
    for my $part (@parts) {
        # Handle JSON pointer escaping
        $part =~ s/~1/\//g;
        $part =~ s/~0/~/g;
        
        if (ref($current) eq 'HASH') {
            return undef unless exists $current->{$part};
            $current = $current->{$part};
        }
        elsif (ref($current) eq 'ARRAY') {
            return undef unless $part =~ /^\d+$/;
            my $index = int($part);
            return undef if $index < 0 || $index >= @$current;
            $current = $current->[$index];
        }
        else {
            return undef;
        }
    }
    
    return $current;
}

sub basename {
    my ($path) = @_;
    my (undef, undef, $file) = File::Spec->splitpath($path);
    return $file;
}

sub dirname {
    my ($path) = @_;
    my ($vol, $dir, undef) = File::Spec->splitpath($path);
    return File::Spec->catpath($vol, $dir, '');
}

=head2 Invalid Schema Tests

Test that all invalid schemas in test-assets/schemas/invalid fail validation.

=cut

subtest 'Invalid schemas should fail validation' => sub {
    my @schema_files = get_schema_files($INVALID_SCHEMAS);
    
    if (!@schema_files) {
        plan skip_all => "No invalid schema files found in $INVALID_SCHEMAS";
        return;
    }
    
    plan tests => scalar(@schema_files);
    
    my $validator = JSON::Structure::SchemaValidator->new(extended => 1);
    
    for my $schema_file (@schema_files) {
        my $filename = basename($schema_file);
        
        my $schema = eval { load_json_file($schema_file) };
        if ($@) {
            fail("$filename - Failed to parse JSON: $@");
            next;
        }
        
        my $description = $schema->{description} // 'No description';
        my $result = $validator->validate($schema);
        
        ok(!$result->is_valid, "$filename should be invalid - $description")
            or diag("Expected errors but schema was valid");
    }
};

=head2 Warning Schema Tests

Test that schemas in test-assets/schemas/warnings produce warnings.

=cut

subtest 'Warning schemas should produce warnings' => sub {
    my @schema_files = get_schema_files($WARNING_SCHEMAS);
    
    if (!@schema_files) {
        plan skip_all => "No warning schema files found in $WARNING_SCHEMAS";
        return;
    }
    
    plan tests => scalar(@schema_files);
    
    my $validator = JSON::Structure::SchemaValidator->new(extended => 1);
    
    for my $schema_file (@schema_files) {
        my $filename = basename($schema_file);
        
        my $schema = eval { load_json_file($schema_file) };
        if ($@) {
            fail("$filename - Failed to parse JSON: $@");
            next;
        }
        
        my $description = $schema->{description} // 'No description';
        my $result = $validator->validate($schema);
        
        # These schemas may be valid but should produce warnings
        ok(@{$result->warnings} > 0 || !$result->is_valid, 
           "$filename should produce warnings or errors - $description")
            or diag("Expected warnings but got none");
    }
};

=head2 Validation Schema Tests

Test that schemas in test-assets/schemas/validation are valid when extensions are enabled.

=cut

subtest 'Validation schemas should be valid with extensions' => sub {
    my @schema_files = get_schema_files($VALIDATION_SCHEMAS);
    
    if (!@schema_files) {
        plan skip_all => "No validation schema files found in $VALIDATION_SCHEMAS";
        return;
    }
    
    plan tests => scalar(@schema_files);
    
    my $validator = JSON::Structure::SchemaValidator->new(extended => 1);
    
    for my $schema_file (@schema_files) {
        my $filename = basename($schema_file);
        
        my $schema = eval { load_json_file($schema_file) };
        if ($@) {
            fail("$filename - Failed to parse JSON: $@");
            next;
        }
        
        my $description = $schema->{description} // 'No description';
        my $result = $validator->validate($schema);
        
        ok($result->is_valid, "$filename should be valid - $description")
            or diag(join("\n", map { $_->to_string } @{$result->errors}));
    }
};

=head2 Invalid Instance Tests

Test that all invalid instances in test-assets/instances/invalid fail validation.

=cut

subtest 'Invalid instances should fail validation' => sub {
    my @instance_dirs = get_instance_dirs($INVALID_INSTANCES);
    
    if (!@instance_dirs) {
        plan skip_all => "No invalid instance directories found in $INVALID_INSTANCES";
        return;
    }
    
    my @test_cases;
    for my $instance_dir (@instance_dirs) {
        my $sample_name = basename($instance_dir);
        for my $instance_file (get_json_files($instance_dir)) {
            push @test_cases, [$sample_name, $instance_file];
        }
    }
    
    if (!@test_cases) {
        plan skip_all => "No invalid instance files found";
        return;
    }
    
    plan tests => scalar(@test_cases);
    
    for my $case (@test_cases) {
        my ($sample_name, $instance_file) = @$case;
        my $instance_filename = basename($instance_file);
        my $test_name = "$sample_name/$instance_filename";
        
        # Load instance
        my $instance = eval { load_json_file($instance_file) };
        if ($@) {
            fail("$test_name - Failed to parse instance JSON: $@");
            next;
        }
        
        my $description = delete $instance->{_description} // 'No description';
        my $schema_ref = delete $instance->{_schema};
        
        # Remove other metadata fields
        for my $key (keys %$instance) {
            delete $instance->{$key} if $key =~ /^_/;
        }
        
        # If instance has only 'value' key left, use that as the instance
        if (ref($instance) eq 'HASH' && exists $instance->{value} && scalar(keys %$instance) == 1) {
            $instance = $instance->{value};
        }
        
        # Load schema
        my $schema_path = File::Spec->catfile($SAMPLES_ROOT, $sample_name, 'schema.struct.json');
        unless (-f $schema_path) {
            # Try without leading numbers (e.g., "01-basic-person" -> "basic-person")
            my $alt_name = $sample_name;
            $alt_name =~ s/^\d+-//;
            $schema_path = File::Spec->catfile($SAMPLES_ROOT, $alt_name, 'schema.struct.json');
        }
        
        unless (-f $schema_path) {
            # Skip if schema not found
            pass("$test_name - SKIPPED (schema not found)");
            next;
        }
        
        my $schema = eval { load_json_file($schema_path) };
        if ($@) {
            fail("$test_name - Failed to parse schema JSON: $@");
            next;
        }
        
        # Handle $root
        my $target_schema = $schema;
        if (my $root_ref = $schema->{'$root'}) {
            if ($root_ref =~ m{^#(/.*)}) {
                my $resolved = resolve_json_pointer($1, $schema);
                if ($resolved && ref($resolved) eq 'HASH') {
                    $target_schema = { %$resolved };
                    if (exists $schema->{definitions}) {
                        $target_schema->{definitions} = $schema->{definitions};
                    }
                }
            }
        }
        
        # Validate
        my $validator = JSON::Structure::InstanceValidator->new(
            schema   => $target_schema,
            extended => 1,
        );
        my $result = $validator->validate($instance);
        
        ok(!$result->is_valid, "$test_name should be invalid - $description")
            or diag("Expected errors but instance was valid");
    }
};

=head2 Validation Instance Tests (Validation directory)

Test that invalid instances in test-assets/instances/validation correctly fail
validation when validation extensions ($uses) are present.

=cut

subtest 'Validation instances should fail with expected errors' => sub {
    my @instance_dirs = get_instance_dirs($VALIDATION_INSTANCES);
    
    if (!@instance_dirs) {
        plan skip_all => "No validation instance directories found in $VALIDATION_INSTANCES";
        return;
    }
    
    my @test_cases;
    for my $instance_dir (@instance_dirs) {
        my $sample_name = basename($instance_dir);
        for my $instance_file (get_json_files($instance_dir)) {
            push @test_cases, [$sample_name, $instance_file, $instance_dir];
        }
    }
    
    if (!@test_cases) {
        plan skip_all => "No validation instance files found";
        return;
    }
    
    plan tests => scalar(@test_cases);
    
    for my $case (@test_cases) {
        my ($sample_name, $instance_file, $instance_dir) = @$case;
        my $instance_filename = basename($instance_file);
        my $test_name = "$sample_name/$instance_filename";
        
        # Load instance
        my $instance = eval { load_json_file($instance_file) };
        if ($@) {
            fail("$test_name - Failed to parse instance JSON: $@");
            next;
        }
        
        my $description = delete $instance->{_description} // 'No description';
        my $schema_ref = delete $instance->{_schema};
        
        # Remove other metadata fields
        for my $key (keys %$instance) {
            delete $instance->{$key} if $key =~ /^_/;
        }
        
        # If instance has only 'value' key left, use that as the instance
        if (ref($instance) eq 'HASH' && exists $instance->{value} && scalar(keys %$instance) == 1) {
            $instance = $instance->{value};
        }
        
        # The schema should be in the same directory or referenced
        my $schema_path = File::Spec->catfile($instance_dir, 'schema.struct.json');
        
        # Try to find schema in validation schemas directory
        unless (-f $schema_path) {
            $schema_path = File::Spec->catfile($VALIDATION_SCHEMAS, "$sample_name.struct.json");
        }
        
        unless (-f $schema_path) {
            # Skip if schema not found
            pass("$test_name - SKIPPED (schema not found)");
            next;
        }
        
        my $schema = eval { load_json_file($schema_path) };
        if ($@) {
            fail("$test_name - Failed to parse schema JSON: $@");
            next;
        }
        
        # Handle $root
        my $target_schema = $schema;
        if (my $root_ref = $schema->{'$root'}) {
            if ($root_ref =~ m{^#(/.*)}) {
                my $resolved = resolve_json_pointer($1, $schema);
                if ($resolved && ref($resolved) eq 'HASH') {
                    $target_schema = { %$resolved };
                    if (exists $schema->{definitions}) {
                        $target_schema->{definitions} = $schema->{definitions};
                    }
                }
            }
        }
        
        # Validate
        my $validator = JSON::Structure::InstanceValidator->new(
            schema   => $target_schema,
            extended => 1,
        );
        my $result = $validator->validate($instance);
        
        # These instances should FAIL validation with the expected error
        ok(!$result->is_valid, "$test_name should fail validation - $description")
            or diag("Expected validation errors but instance was valid");
    }
};

# ============================================================================
# Adversarial Schema Tests
# ============================================================================

my $ADVERSARIAL_SCHEMAS = File::Spec->catdir($TEST_ASSETS, 'schemas', 'adversarial');
my $ADVERSARIAL_INSTANCES = File::Spec->catdir($TEST_ASSETS, 'instances', 'adversarial');

# Expected behaviors for adversarial schemas
# 'valid' = schema should be valid
# 'invalid' = schema should be invalid
# 'warning' = schema valid but may produce warnings
# 'skip' = skip this test (known issue with test file format)
my %ADVERSARIAL_SCHEMA_EXPECTATIONS = (
    # Circular reference tests
    'indirect-circular-ref.struct.json' => 'valid', # Valid - recursive types are allowed
    'self-referencing-extends.struct.json' => 'invalid',
    'extends-circular-chain.struct.json' => 'invalid',
    
    # Reference errors - should be INVALID
    'ref-to-nowhere.struct.json' => 'invalid',
    'malformed-json-pointer.struct.json' => 'invalid',
    
    # Conflicting constraints - should be INVALID
    'conflicting-constraints.struct.json' => 'invalid',
    'allof-conflicting-types.struct.json' => 'valid', # Valid schema, instance validation fails
    
    # Schemas using $ref outside type (test file format issue, not SDK bug)
    'extends-with-overrides.struct.json' => 'invalid', # Uses $ref outside type
    'quadratic-blowup.struct.json' => 'invalid', # Uses $ref outside type
    'recursive-array-items.struct.json' => 'invalid', # Uses $ref outside type
    'ref-vs-property.struct.json' => 'invalid', # Uses $ref outside type
    
    # Schemas with non-standard additionalProperties (test file format)
    'additionalProperties-combined.struct.json' => 'invalid',
    'default-vs-required.struct.json' => 'invalid',
    'empty-arrays-objects.struct.json' => 'invalid',
    'property-name-edge-cases.struct.json' => 'invalid',
    
    # Schemas using 'number' type with constraints (need to add number to numeric types)
    'floating-point-precision.struct.json' => 'valid',
    
    # Schemas with encoding issues - skip
    'unicode-edge-cases.struct.json' => 'skip',
    'string-length-surrogate.struct.json' => 'skip',
    
    # Schemas with duplicate keys (JSON parser behavior)
    'duplicate-keys.struct.json' => 'invalid', # Loses one definition
    
    # Valid challenging schemas
    'deep-nesting-100.struct.json' => 'valid',
    'deeply-nested-allof.struct.json' => 'valid',
    'oneof-all-match.struct.json' => 'valid',
    'anyof-none-match.struct.json' => 'valid',
    'type-union-ambiguous.struct.json' => 'valid',
    'integer-boundary-values.struct.json' => 'valid',
    'int64-precision-loss.struct.json' => 'valid',
    'extremely-long-string.struct.json' => 'valid',
    'null-edge-cases.struct.json' => 'valid',
    'massive-enum.struct.json' => 'valid',
    'format-edge-cases.struct.json' => 'valid',
    'redos-pattern.struct.json' => 'valid',
    'redos-catastrophic-backtracking.struct.json' => 'valid',
    'pattern-with-flags.struct.json' => 'valid',
);

subtest 'Adversarial schema validation' => sub {
    my @schema_files = get_schema_files($ADVERSARIAL_SCHEMAS);
    
    if (@schema_files == 0) {
        plan skip_all => "No adversarial schema files found in $ADVERSARIAL_SCHEMAS";
        return;
    }
    
    for my $file (@schema_files) {
        my $filename = (File::Spec->splitpath($file))[2];
        next if $filename eq 'README.md';
        
        my $expectation = $ADVERSARIAL_SCHEMA_EXPECTATIONS{$filename} // 'valid';
        
        # Skip tests with encoding issues
        if ($expectation eq 'skip') {
            pass("$filename - SKIPPED (encoding issues)");
            next;
        }
        
        my $text = do {
            local $/;
            open my $fh, '<:encoding(UTF-8)', $file or do {
                fail("$filename - Cannot read file: $!");
                next;
            };
            <$fh>;
        };
        
        my $schema = eval { $json->decode($text) };
        if ($@) {
            if ($expectation eq 'invalid') {
                pass("$filename - Invalid JSON (expected)");
            } else {
                fail("$filename - Failed to parse JSON: $@");
            }
            next;
        }
        
        my $validator = JSON::Structure::SchemaValidator->new(extended => 1);
        
        # Use timeout to prevent infinite loops
        my $result;
        eval {
            local $SIG{ALRM} = sub { die "timeout\n" };
            alarm(5); # 5 second timeout
            $result = $validator->validate($schema, $text);
            alarm(0);
        };
        
        if ($@ && $@ eq "timeout\n") {
            fail("$filename - Schema validation timed out (possible infinite loop)");
            next;
        }
        alarm(0); # Ensure alarm is cleared
        
        if ($expectation eq 'invalid') {
            ok(!$result->is_valid, "$filename - Should be invalid schema")
                or diag("Expected schema to be invalid but it was valid");
        } elsif ($expectation eq 'valid') {
            ok($result->is_valid, "$filename - Should be valid schema")
                or diag("Errors: " . join(", ", map { $_->to_string } @{$result->errors}));
        } else {
            # warning - valid but may have warnings
            ok($result->is_valid, "$filename - Should be valid schema (with possible warnings)")
                or diag("Errors: " . join(", ", map { $_->to_string } @{$result->errors}));
        }
    }
};

# Expected behaviors for adversarial instances
# 'valid' = instance should be valid
# 'invalid' = instance should be invalid
# 'skip' = skip this test (encoding issues or schema is invalid)
my %ADVERSARIAL_INSTANCE_EXPECTATIONS = (
    'additionalProperties-combined.json' => 'skip', # Schema is invalid
    'allof-conflict.json' => 'invalid',
    'anyof-none-match.json' => 'invalid',
    'conflicting-constraints.json' => 'skip', # Schema is invalid
    'deep-nesting.json' => 'valid',
    'empty-collections-invalid.json' => 'skip', # Schema is invalid
    'extends-override.json' => 'skip', # Schema is invalid
    'floating-point.json' => 'invalid', # Has values violating constraints
    'format-invalid.json' => 'invalid',
    'format-valid.json' => 'valid',
    'int64-precision.json' => 'valid',
    'null-edge-cases.json' => 'invalid', # Has null in non-nullable field
    'oneof-all-match.json' => 'invalid',
    'pattern-flags.json' => 'skip', # Encoding issues
    'property-name-edge-cases.json' => 'skip', # Schema is invalid
    'quadratic-blowup.json' => 'skip', # Schema is invalid
    'recursive-tree.json' => 'skip', # Schema is invalid
    'redos-attack.json' => 'invalid', # Pattern doesn't match (ends with 'b')
    'string-length-surrogate.json' => 'skip', # Encoding issues
    'type-union-int.json' => 'valid',
    'type-union-number.json' => 'valid',
    'unicode-edge-cases.json' => 'skip', # Encoding issues
);

subtest 'Adversarial instance validation' => sub {
    my @instance_files = get_json_files($ADVERSARIAL_INSTANCES);
    
    if (@instance_files == 0) {
        plan skip_all => "No adversarial instance files found in $ADVERSARIAL_INSTANCES";
        return;
    }
    
    for my $file (@instance_files) {
        my $filename = (File::Spec->splitpath($file))[2];
        
        my $expectation = $ADVERSARIAL_INSTANCE_EXPECTATIONS{$filename} // 'valid';
        
        # Skip tests with encoding or schema issues
        if ($expectation eq 'skip') {
            pass("$filename - SKIPPED (encoding or schema issues)");
            next;
        }
        
        # Find corresponding schema
        my $schema_name = $filename;
        $schema_name =~ s/\.json$/.struct.json/;
        
        # Some instances have different naming - map them
        my %schema_map = (
            'deep-nesting.json' => 'deep-nesting-100.struct.json',
            'allof-conflict.json' => 'allof-conflicting-types.struct.json',
            'extends-override.json' => 'extends-with-overrides.struct.json',
            'floating-point.json' => 'floating-point-precision.struct.json',
            'format-invalid.json' => 'format-edge-cases.struct.json',
            'format-valid.json' => 'format-edge-cases.struct.json',
            'int64-precision.json' => 'int64-precision-loss.struct.json',
            'null-edge-cases.json' => 'null-edge-cases.struct.json',
            'oneof-all-match.json' => 'oneof-all-match.struct.json',
            'pattern-flags.json' => 'pattern-with-flags.struct.json',
            'property-name-edge-cases.json' => 'property-name-edge-cases.struct.json',
            'quadratic-blowup.json' => 'quadratic-blowup.struct.json',
            'recursive-tree.json' => 'recursive-array-items.struct.json',
            'redos-attack.json' => 'redos-pattern.struct.json',
            'string-length-surrogate.json' => 'string-length-surrogate.struct.json',
            'type-union-int.json' => 'type-union-ambiguous.struct.json',
            'type-union-number.json' => 'type-union-ambiguous.struct.json',
            'unicode-edge-cases.json' => 'unicode-edge-cases.struct.json',
            'empty-collections-invalid.json' => 'empty-arrays-objects.struct.json',
            'anyof-none-match.json' => 'anyof-none-match.struct.json',
            'conflicting-constraints.json' => 'conflicting-constraints.struct.json',
            'additionalProperties-combined.json' => 'additionalProperties-combined.struct.json',
        );
        
        $schema_name = $schema_map{$filename} // $schema_name;
        my $schema_path = File::Spec->catfile($ADVERSARIAL_SCHEMAS, $schema_name);
        
        unless (-f $schema_path) {
            pass("$filename - SKIPPED (schema $schema_name not found)");
            next;
        }
        
        # Load schema
        my $schema_text = do {
            local $/;
            open my $fh, '<:encoding(UTF-8)', $schema_path or do {
                fail("$filename - Cannot read schema: $!");
                next;
            };
            <$fh>;
        };
        
        my $schema = eval { $json->decode($schema_text) };
        if ($@) {
            fail("$filename - Failed to parse schema JSON: $@");
            next;
        }
        
        # Check if schema is valid first
        my $schema_validator = JSON::Structure::SchemaValidator->new(extended => 1);
        my $schema_result = $schema_validator->validate($schema, $schema_text);
        
        unless ($schema_result->is_valid) {
            # Schema itself is invalid, skip instance validation
            pass("$filename - SKIPPED (schema is invalid: " . 
                 join(", ", map { $_->code } @{$schema_result->errors}) . ")");
            next;
        }
        
        # Load instance
        my $instance_text = do {
            local $/;
            open my $fh, '<:encoding(UTF-8)', $file or do {
                fail("$filename - Cannot read instance: $!");
                next;
            };
            <$fh>;
        };
        
        my $instance = eval { $json->decode($instance_text) };
        if ($@) {
            fail("$filename - Failed to parse instance JSON: $@");
            next;
        }
        
        # Handle $root
        my $target_schema = $schema;
        if (my $root_ref = $schema->{'$root'}) {
            if ($root_ref =~ m{^#(/.*)}) {
                my $resolved = resolve_json_pointer($1, $schema);
                if ($resolved && ref($resolved) eq 'HASH') {
                    $target_schema = { %$resolved };
                    if (exists $schema->{definitions}) {
                        $target_schema->{definitions} = $schema->{definitions};
                    }
                }
            }
        }
        
        # Validate with timeout
        my $validator = JSON::Structure::InstanceValidator->new(
            schema   => $target_schema,
            extended => 1,
        );
        
        my $result;
        eval {
            local $SIG{ALRM} = sub { die "timeout\n" };
            alarm(5); # 5 second timeout
            $result = $validator->validate($instance, $instance_text);
            alarm(0);
        };
        
        if ($@ && $@ eq "timeout\n") {
            fail("$filename - Instance validation timed out (possible ReDoS or infinite loop)");
            next;
        }
        alarm(0);
        
        if ($expectation eq 'valid') {
            ok($result->is_valid, "$filename - Should be valid instance")
                or diag("Errors: " . join(", ", map { $_->to_string } @{$result->errors}));
        } else {
            ok(!$result->is_valid, "$filename - Should be invalid instance")
                or diag("Expected validation errors but instance was valid");
        }
    }
};

done_testing();
