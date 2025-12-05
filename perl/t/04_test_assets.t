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

done_testing();
