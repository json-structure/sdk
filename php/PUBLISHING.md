# Publishing to Packagist

This document describes how to publish the PHP SDK to Packagist.

## Prerequisites

### 1. Packagist Account

Create an account at https://packagist.org/

Packagist is the main Composer repository for PHP packages. You'll need an account to register and manage packages.

### 2. Register Package on Packagist

1. Log in to https://packagist.org/
2. Go to "Submit" or "Submit Package"
3. Enter the GitHub repository URL: `https://github.com/json-structure/sdk`
4. Submit the package

### 3. Generate Packagist API Token

1. Go to your Packagist profile settings
2. Navigate to "API Token" section
3. Generate a new API token with "Update" permission
4. Copy the token - you'll need it for GitHub secrets

### 4. GitHub Secrets

Configure these secrets in your repository settings (Settings → Secrets and variables → Actions):

- `PACKAGIST_USERNAME`: Your Packagist username
- `PACKAGIST_API_TOKEN`: Your Packagist API token (from step 3)

## Automated Release Process

The CI workflow automatically notifies Packagist when you push a version tag.

### Creating a Release

1. Ensure all tests pass on the main branch
2. Create and push a version tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

### What Happens Automatically

The CI workflow will:

1. ✅ Run all tests across multiple PHP versions (8.1, 8.2, 8.3)
2. ✅ Validate composer.json
3. ✅ Extract version from the git tag
4. ✅ Trigger Packagist update via API

### Tag Format

Tags must follow the pattern `v[0-9]+.[0-9]+.[0-9]+`:

- `v0.1.0` - Initial release
- `v0.1.1` - Patch release
- `v1.0.0` - Major release

## How Packagist Works

Packagist reads version information directly from your GitHub repository tags. You don't need to manually update the version in `composer.json` - Packagist automatically:

1. Detects git tags matching semantic versioning (e.g., `v1.0.0`, `1.0.0`)
2. Creates corresponding package versions
3. Makes them available via `composer require json-structure/sdk`

### Version Detection

When you push a tag like `v1.2.3`, Packagist will:
- Create version `1.2.3` for users to install
- Read package metadata from `composer.json` on that tagged commit
- Make it installable via: `composer require json-structure/sdk:^1.2.3`

## Manual Trigger

If you need to manually trigger a Packagist update:

### Using the API

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  "https://packagist.org/api/update-package?username=YOUR_USERNAME&apiToken=YOUR_API_TOKEN" \
  -d '{"repository":{"url":"https://github.com/json-structure/sdk"}}'
```

### Using the Web Interface

1. Log in to Packagist
2. Go to your package page
3. Click "Update" button to force a sync

## Verification

After publishing:

1. Check https://packagist.org/packages/json-structure/sdk
2. Verify the new version appears in the versions list
3. Test installation:

```bash
composer require json-structure/sdk
```

Or for a specific version:

```bash
composer require json-structure/sdk:^0.1.0
```

## Troubleshooting

### Package Not Updating

- Verify the GitHub webhook is configured (Packagist should set this automatically)
- Manually trigger an update using the Packagist web interface
- Check that the API credentials in GitHub secrets are correct

### Version Not Appearing

- Ensure your tag follows semantic versioning (e.g., `v1.0.0` or `1.0.0`)
- Check that `composer.json` is valid: `composer validate --strict`
- Wait a few minutes - Packagist may take time to index

### First-Time Setup

For the first publication:

1. Register the package on Packagist manually
2. Packagist will set up a GitHub webhook automatically
3. Subsequent updates will be automatic (or use the CI workflow)

## GitHub Webhook (Recommended)

For fully automatic updates without CI:

1. Packagist sets up a GitHub webhook when you register your package
2. Every push to GitHub (including tags) triggers Packagist to re-index
3. No manual intervention or API calls needed

To verify the webhook:
1. Go to your GitHub repo → Settings → Webhooks
2. Look for a webhook pointing to `packagist.org`
3. Check recent deliveries to ensure it's working

## Version Management

The version is managed through git tags. The `composer.json` file does not need a version field when publishing via Packagist, as versions are determined by your git tags.

However, if you want to include a version field in `composer.json` for local development, you can add:

```json
{
  "version": "0.1.0"
}
```

Note: This version field is ignored by Packagist in favor of git tags.
