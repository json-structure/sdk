#!/bin/bash
#
# Updates vcpkg port files for a new release.
#
# Usage:
#   ./update-port.sh [VERSION] [--calculate-sha]
#
# Arguments:
#   VERSION        The version to update to (e.g., "0.1.0"). 
#                  If not specified, uses the latest git tag.
#   --calculate-sha  Download the release tarball and calculate SHA512.
#
# Examples:
#   ./update-port.sh 0.1.0 --calculate-sha
#   ./update-port.sh --calculate-sha

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION=""
CALCULATE_SHA=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --calculate-sha)
            CALCULATE_SHA=true
            shift
            ;;
        *)
            VERSION="$1"
            shift
            ;;
    esac
done

# Get version from latest git tag if not specified
if [[ -z "$VERSION" ]]; then
    tag=$(git describe --tags --abbrev=0 2>/dev/null || true)
    if [[ -n "$tag" ]]; then
        VERSION="${tag#v}"
        echo "Using version from git tag: $VERSION"
    else
        echo "Error: No version specified and no git tags found" >&2
        exit 1
    fi
fi

# Update vcpkg.json
VCPKG_JSON="$SCRIPT_DIR/vcpkg.json"
if command -v jq &> /dev/null; then
    jq --arg v "$VERSION" '.version = $v' "$VCPKG_JSON" > "$VCPKG_JSON.tmp"
    mv "$VCPKG_JSON.tmp" "$VCPKG_JSON"
    echo "Updated vcpkg.json to version $VERSION"
else
    # Fallback using sed
    sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$VCPKG_JSON"
    rm -f "$VCPKG_JSON.bak"
    echo "Updated vcpkg.json to version $VERSION"
fi

# Calculate SHA512 if requested
if [[ "$CALCULATE_SHA" == true ]]; then
    TARBALL_URL="https://github.com/json-structure/sdk/archive/refs/tags/v$VERSION.tar.gz"
    echo "Downloading: $TARBALL_URL"
    
    HASH=$(curl -sL "$TARBALL_URL" | sha512sum | cut -d' ' -f1)
    
    if [[ -n "$HASH" && "$HASH" != *"Not Found"* ]]; then
        echo "SHA512: $HASH"
        
        # Update portfile.cmake
        PORTFILE="$SCRIPT_DIR/portfile.cmake"
        sed -i.bak "s/SHA512 [a-fA-F0-9]*/SHA512 $HASH/" "$PORTFILE"
        rm -f "$PORTFILE.bak"
        echo "Updated portfile.cmake with SHA512"
    else
        echo "Warning: Could not download tarball. You may need to create the release first." >&2
        echo ""
        echo "To get SHA512 manually, run:"
        echo "  vcpkg install json-structure --overlay-ports=$SCRIPT_DIR"
        echo "The error message will show the correct SHA512."
    fi
fi

echo ""
echo "Port files updated. Next steps:"
echo "  1. Commit and push the changes"
echo "  2. Copy files to your vcpkg fork: ports/json-structure/"
echo "  3. Run: vcpkg x-add-version json-structure"
echo "  4. Submit PR to microsoft/vcpkg"
