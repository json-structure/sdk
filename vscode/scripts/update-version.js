#!/usr/bin/env node
/**
 * Updates package.json version based on git tags.
 * 
 * Version format:
 * - If on a tag like "v1.2.3" or "vscode-v1.2.3": uses "1.2.3"
 * - If commits after tag: uses "1.2.4-dev.{commits}.{short-sha}"
 * - If no tags: uses "0.0.0-dev.{commits}.{short-sha}"
 * 
 * Set SKIP_VERSION_UPDATE=1 to skip updating (used in CI when version is set explicitly)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Skip if explicitly requested (e.g., in CI when version is set explicitly)
if (process.env.SKIP_VERSION_UPDATE === '1') {
    const packageJson = require(path.join(__dirname, '..', 'package.json'));
    console.log(`Skipping version update, keeping version: ${packageJson.version}`);
    process.exit(0);
}

// Get the vscode extension root directory (parent of scripts/)
const extensionRoot = path.dirname(__dirname);

function run(cmd) {
    try {
        return execSync(cmd, { encoding: 'utf8', cwd: extensionRoot }).trim();
    } catch (e) {
        return null;
    }
}

function getVersionFromGit() {
    // Try to get the current tag (if we're exactly on a tag)
    const exactTag = run('git describe --exact-match --tags HEAD 2>nul');
    
    if (exactTag) {
        // Extract version from tag like "v1.2.3" or "vscode-v1.2.3"
        const match = exactTag.match(/v?(\d+\.\d+\.\d+)$/);
        if (match) {
            console.log(`On tag ${exactTag}, using version ${match[1]}`);
            return match[1];
        }
    }
    
    // Get the most recent tag matching our pattern
    const describe = run('git describe --tags --match "v*" --abbrev=7 2>nul') ||
                     run('git describe --tags --match "vscode-v*" --abbrev=7 2>nul');
    
    if (describe) {
        // Format: v1.2.3-5-g1234567 (5 commits after tag, short sha)
        const match = describe.match(/v?(\d+)\.(\d+)\.(\d+)(?:-(\d+)-g([a-f0-9]+))?$/);
        if (match) {
            const [, major, minor, patch, commits, sha] = match;
            if (commits && sha) {
                // Increment patch for dev version
                const devVersion = `${major}.${minor}.${parseInt(patch) + 1}-dev.${commits}`;
                console.log(`${commits} commits after tag, using version ${devVersion}`);
                return devVersion;
            }
            console.log(`Using version ${major}.${minor}.${patch}`);
            return `${major}.${minor}.${patch}`;
        }
    }
    
    // No tags found, use commit count and sha
    const commitCount = run('git rev-list --count HEAD 2>nul') || '0';
    const shortSha = run('git rev-parse --short=7 HEAD 2>nul') || 'unknown';
    const devVersion = `0.0.1-dev.${commitCount}`;
    console.log(`No version tags found, using ${devVersion}`);
    return devVersion;
}

function updatePackageVersion() {
    const packagePath = path.join(extensionRoot, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    
    const newVersion = getVersionFromGit();
    const oldVersion = pkg.version;
    
    if (newVersion !== oldVersion) {
        pkg.version = newVersion;
        fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
        console.log(`Updated version: ${oldVersion} -> ${newVersion}`);
    } else {
        console.log(`Version unchanged: ${newVersion}`);
    }
    
    return newVersion;
}

// Run if called directly
if (require.main === module) {
    updatePackageVersion();
}

module.exports = { getVersionFromGit, updatePackageVersion };
