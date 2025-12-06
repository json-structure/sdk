# Publishing to CPAN

This document describes how to publish the JSON::Structure Perl SDK to CPAN.

## Prerequisites

### 1. PAUSE Account

Request an account at https://pause.perl.org/pause/query?ACTION=request_id

PAUSE (Perl Authors Upload Server) is the gateway to CPAN. You'll need an account to upload modules.

### 2. GitHub Secrets

Configure these secrets in your repository settings (Settings → Secrets and variables → Actions):

- `PAUSE_USERNAME`: Your PAUSE username
- `PAUSE_PASSWORD`: Your PAUSE password

### 3. GitHub Environment

Create a protected environment named `cpan` for the secrets:

1. Go to Settings → Environments
2. Create a new environment named `cpan`
3. Optionally add required reviewers for additional security
4. The secrets will be scoped to this environment

## Automated Release Process

The CI workflow automatically publishes to CPAN when you push a version tag.

### Creating a Release

1. Ensure all tests pass on the `perl-sdk` branch
2. Update the version number in modules if needed
3. Create and push a version tag:

```bash
git tag v0.02
git push origin v0.02
```

### What Happens Automatically

The CI workflow will:

1. ✅ Run all tests across multiple Perl versions (5.20, 5.26, 5.32, 5.38)
2. ✅ Run tests on multiple platforms (Ubuntu, macOS, Windows)
3. ✅ Run Perl::Critic linting
4. ✅ Build the distribution tarball
5. ✅ Update version numbers in all `.pm` files from the tag
6. ✅ Upload to CPAN via PAUSE

### Tag Format

Tags must follow the pattern `v[0-9]+.[0-9]+.[0-9]+`:

- `v0.01` - Initial release
- `v0.02` - Patch release
- `v1.0.0` - Major release

## Manual Upload

You can also upload manually if needed:

### Building the Distribution

```bash
cd perl
perl Makefile.PL
make
make manifest
make dist
```

This creates `JSON-Structure-0.01.tar.gz`.

### Uploading to CPAN

Install the uploader:

```bash
cpanm CPAN::Uploader
```

Upload:

```bash
cpan-upload -u YOUR_PAUSE_USERNAME JSON-Structure-0.01.tar.gz
```

You'll be prompted for your PAUSE password.

### Using a .pause File

For convenience, create `~/.pause`:

```
user YOUR_PAUSE_USERNAME
password YOUR_PAUSE_PASSWORD
```

Then simply:

```bash
cpan-upload JSON-Structure-0.01.tar.gz
```

## Verification

After uploading:

1. Check https://pause.perl.org for indexing status
2. Wait 1-2 hours for CPAN mirrors to sync
3. Verify on https://metacpan.org/pod/JSON::Structure
4. Test installation: `cpanm JSON::Structure`

## Troubleshooting

### Upload Rejected

- Ensure your PAUSE account has permissions for the `JSON::Structure` namespace
- Check that the version number is higher than any previously uploaded version
- Verify the distribution passes `make test`

### Indexing Issues

- Check the PAUSE indexer logs in your PAUSE account
- Ensure all modules have proper `$VERSION` declarations
- Verify the package names match the file paths

### First-Time Upload

For the first upload of a new namespace:

1. PAUSE will send you an email to confirm namespace ownership
2. Respond to claim the namespace
3. Subsequent uploads will be automatic

## Version Management

The version is defined in each module:

```perl
our $VERSION = '0.01';
```

The CI workflow automatically updates this from the git tag during releases. For manual releases, update the version in:

- `lib/JSON/Structure.pm`
- `lib/JSON/Structure/SchemaValidator.pm`
- `lib/JSON/Structure/InstanceValidator.pm`
- `lib/JSON/Structure/Types.pm`
- `lib/JSON/Structure/ErrorCodes.pm`
- `lib/JSON/Structure/JsonSourceLocator.pm`
