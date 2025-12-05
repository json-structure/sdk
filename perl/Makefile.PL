use strict;
use warnings;
use ExtUtils::MakeMaker;

WriteMakefile(
    NAME             => 'JSON::Structure',
    VERSION_FROM     => 'lib/JSON/Structure.pm',
    ABSTRACT         => 'JSON Structure schema validation for Perl',
    AUTHOR           => 'JSON Structure Contributors',
    LICENSE          => 'mit',
    MIN_PERL_VERSION => '5.020',
    EXE_FILES        => ['bin/pjstruct'],
    
    PREREQ_PM => {
        'JSON::PP'      => '2.0',
        'MIME::Base64'  => '3.0',
        'Scalar::Util'  => '1.0',
        'Exporter'      => '5.0',
        'Math::BigInt'  => '1.9993',  # For int128/uint128 range validation
        'Time::Local'   => '1.25',    # For calendar date validation
        'B'             => '0',       # For SV flag inspection
        'Getopt::Long'  => '2.0',     # For CLI argument parsing
        'Pod::Usage'    => '1.0',     # For CLI help
    },
    
    TEST_REQUIRES => {
        'Test::More'    => '1.0',
        'Test::Deep'    => '0',
    },
    
    META_MERGE => {
        'meta-spec' => { version => 2 },
        resources => {
            repository => {
                type => 'git',
                url  => 'https://github.com/json-structure/sdk.git',
                web  => 'https://github.com/json-structure/sdk/tree/main/perl',
            },
            bugtracker => {
                web => 'https://github.com/json-structure/sdk/issues',
            },
            homepage => 'https://json-structure.github.io/',
        },
        provides => {
            'JSON::Structure' => {
                file    => 'lib/JSON/Structure.pm',
                version => '0.01',
            },
            'JSON::Structure::SchemaValidator' => {
                file    => 'lib/JSON/Structure/SchemaValidator.pm',
                version => '0.01',
            },
            'JSON::Structure::InstanceValidator' => {
                file    => 'lib/JSON/Structure/InstanceValidator.pm',
                version => '0.01',
            },
        },
        keywords => [qw(json schema validation structure)],
    },
    
    test => {
        TESTS => 't/*.t',
    },
    
    clean => {
        FILES => 'JSON-Structure-* MYMETA.*',
    },
);
