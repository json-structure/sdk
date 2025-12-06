#!/usr/bin/env perl
# Tests for pjstruct CLI

use strict;
use warnings FATAL => 'all';
use 5.020;

use Test::More;
use File::Temp qw(tempfile tempdir);
use File::Spec;
use JSON::MaybeXS;

# Path to the CLI script
my $cli = File::Spec->catfile($FindBin::Bin, '..', 'bin', 'pjstruct');

# Check if we can run the CLI
BEGIN {
    require FindBin;
}

# Skip if perl can't find the script
unless (-f $cli) {
    plan skip_all => "Cannot find pjstruct CLI at $cli";
}

plan tests => 28;

# Get the lib directory path
my $libdir = File::Spec->catdir($FindBin::Bin, '..', 'lib');

# Helper to run CLI and capture output
sub run_cli {
    my @args = @_;
    my $cmd = join(' ', $^X, "-I$libdir", $cli, map { qq{"$_"} } @args);
    my $output = `$cmd 2>&1`;
    my $exit_code = $? >> 8;
    return ($exit_code, $output);
}

# Create temp directory for test files
my $tmpdir = tempdir(CLEANUP => 1);

# Create test schema
my $schema_file = File::Spec->catfile($tmpdir, 'test.struct.json');
{
    open my $fh, '>', $schema_file or die "Cannot create schema: $!";
    print $fh JSON::MaybeXS->new->encode({
        '$schema' => 'https://json-structure.org/meta/core/v0/#',
        '$id'     => 'https://example.com/test-person',
        type      => 'object',
        name      => 'Person',
        properties => {
            name => { type => 'string' },
            age  => { type => 'int32' },
        },
        required => ['name'],
    });
    close $fh;
}

# Create valid instance
my $valid_file = File::Spec->catfile($tmpdir, 'valid.json');
{
    open my $fh, '>', $valid_file or die "Cannot create valid instance: $!";
    print $fh JSON::MaybeXS->new->encode({
        name => 'Alice',
        age  => 30,
    });
    close $fh;
}

# Create invalid instance
my $invalid_file = File::Spec->catfile($tmpdir, 'invalid.json');
{
    open my $fh, '>', $invalid_file or die "Cannot create invalid instance: $!";
    print $fh JSON::MaybeXS->new->encode({
        age => 'not a number',
    });
    close $fh;
}

# Create invalid JSON
my $bad_json_file = File::Spec->catfile($tmpdir, 'bad.json');
{
    open my $fh, '>', $bad_json_file or die "Cannot create bad json: $!";
    print $fh '{ invalid json }';
    close $fh;
}

# Create invalid schema
my $bad_schema_file = File::Spec->catfile($tmpdir, 'bad.struct.json');
{
    open my $fh, '>', $bad_schema_file or die "Cannot create bad schema: $!";
    print $fh JSON::MaybeXS->new->encode({
        type => 'invalid-type',
    });
    close $fh;
}

# Test: version
{
    my ($code, $out) = run_cli('--version');
    is($code, 0, '--version exits with 0');
    like($out, qr/pjstruct version/, '--version shows version');
}

# Test: help
{
    my ($code, $out) = run_cli('--help');
    is($code, 0, '--help exits with 0');
    like($out, qr/Usage:/, '--help shows usage');
    like($out, qr/validate/, '--help mentions validate command');
    like($out, qr/check/, '--help mentions check command');
}

# Test: help validate
{
    my ($code, $out) = run_cli('help', 'validate');
    is($code, 0, 'help validate exits with 0');
    like($out, qr/--schema/, 'help validate mentions --schema');
}

# Test: check valid schema
{
    my ($code, $out) = run_cli('check', $schema_file);
    is($code, 0, 'check valid schema exits with 0');
    like($out, qr/valid/, 'check valid schema shows valid');
}

# Test: check invalid schema
{
    my ($code, $out) = run_cli('check', $bad_schema_file);
    is($code, 1, 'check invalid schema exits with 1');
    like($out, qr/invalid/, 'check invalid schema shows invalid');
}

# Test: validate valid instance
{
    my ($code, $out) = run_cli('validate', '-s', $schema_file, $valid_file);
    is($code, 0, 'validate valid instance exits with 0');
    like($out, qr/valid/, 'validate valid instance shows valid');
}

# Test: validate invalid instance
{
    my ($code, $out) = run_cli('validate', '-s', $schema_file, $invalid_file);
    is($code, 1, 'validate invalid instance exits with 1');
    like($out, qr/invalid/, 'validate invalid instance shows invalid');
}

# Test: validate with JSON output
{
    my ($code, $out) = run_cli('validate', '-s', $schema_file, $valid_file, '-f', 'json');
    is($code, 0, 'validate with json format exits with 0');
    my $result = eval { JSON::MaybeXS->new->decode($out) };
    ok(defined $result, 'validate with json format outputs valid JSON');
    is($result->{valid}, JSON::MaybeXS::true, 'JSON output shows valid: true');
}

# Test: validate with TAP output
{
    my ($code, $out) = run_cli('validate', '-s', $schema_file, $valid_file, '-f', 'tap');
    is($code, 0, 'validate with tap format exits with 0');
    like($out, qr/^1\.\.1/m, 'TAP output has plan');
    like($out, qr/^ok 1/m, 'TAP output shows ok');
}

# Test: validate with quiet mode
{
    my ($code, $out) = run_cli('validate', '-s', $schema_file, $valid_file, '-q');
    is($code, 0, 'validate quiet mode exits with 0');
    is($out, '', 'validate quiet mode produces no output');
}

# Test: missing schema option
{
    my ($code, $out) = run_cli('validate', $valid_file);
    is($code, 2, 'validate without schema exits with 2');
    like($out, qr/missing.*--schema/i, 'validate without schema shows error');
}

# Test: file not found
{
    my ($code, $out) = run_cli('validate', '-s', $schema_file, 'nonexistent.json');
    is($code, 2, 'validate nonexistent file exits with 2');
    like($out, qr/not found/i, 'validate nonexistent file shows error');
}
