#!/bin/bash
#
# tag-release.sh - Tags a new version release for the JSON Structure SDK
#
# Creates all required Git tags for a release:
#   - v{VERSION}         - Main version tag (triggers SDK CI workflows)
#   - go/v{VERSION}      - Go module tag (required for Go package discovery)
#   - jstruct-v{VERSION} - CLI release tag (triggers CLI build and GitHub Release)
#
# Usage:
#   ./tag-release.sh 0.5.4           # Create tags locally
#   ./tag-release.sh 0.5.4 --push    # Create and push tags
#   ./tag-release.sh 0.5.4 --cli-only --push  # CLI tag only
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
VERSION=""
PUSH=false
CLI_ONLY=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --push)
            PUSH=true
            shift
            ;;
        --cli-only)
            CLI_ONLY=true
            shift
            ;;
        *)
            if [[ -z "$VERSION" ]]; then
                VERSION="$1"
            else
                echo -e "${RED}Unknown argument: $1${NC}"
                exit 1
            fi
            shift
            ;;
    esac
done

# Validate version
if [[ -z "$VERSION" ]]; then
    echo "Usage: $0 VERSION [--push] [--cli-only]"
    echo ""
    echo "Examples:"
    echo "  $0 0.5.4           # Create tags locally"
    echo "  $0 0.5.4 --push    # Create and push tags"
    echo "  $0 0.5.4 --cli-only --push  # CLI tag only"
    exit 1
fi

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo -e "${RED}Invalid version format. Expected: X.Y.Z (e.g., 0.5.4)${NC}"
    exit 1
fi

# Validate we're in a git repository
if [[ ! -d .git ]]; then
    echo -e "${RED}Not in a git repository root. Please run from the SDK repository root.${NC}"
    exit 1
fi

# Check for uncommitted changes
if [[ -n $(git status --porcelain) ]]; then
    echo -e "${YELLOW}Warning: You have uncommitted changes:${NC}"
    git status --porcelain | sed 's/^/  /'
    read -p "Continue anyway? (y/N) " confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        echo -e "${RED}Aborted.${NC}"
        exit 1
    fi
fi

# Define tags to create
if $CLI_ONLY; then
    TAGS=("jstruct-v$VERSION")
else
    TAGS=("v$VERSION" "go/v$VERSION" "jstruct-v$VERSION")
fi

echo -e "\n${CYAN}Tags to create:${NC}"
for tag in "${TAGS[@]}"; do
    echo "  - $tag"
done

# Check if tags already exist
EXISTING_TAGS=()
for tag in "${TAGS[@]}"; do
    if git tag -l "$tag" | grep -q .; then
        EXISTING_TAGS+=("$tag")
    fi
done

if [[ ${#EXISTING_TAGS[@]} -gt 0 ]]; then
    echo -e "\n${YELLOW}Warning: The following tags already exist:${NC}"
    for tag in "${EXISTING_TAGS[@]}"; do
        echo "  - $tag"
    done
    read -p "Delete and recreate them? (y/N) " confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        echo -e "${RED}Aborted.${NC}"
        exit 1
    fi
    
    # Delete existing tags locally
    for tag in "${EXISTING_TAGS[@]}"; do
        echo -e "${YELLOW}Deleting local tag: $tag${NC}"
        git tag -d "$tag"
    done
    
    # Delete from remote if pushing
    if $PUSH; then
        for tag in "${EXISTING_TAGS[@]}"; do
            echo -e "${YELLOW}Deleting remote tag: $tag${NC}"
            git push origin ":refs/tags/$tag" 2>/dev/null || true
        done
    fi
fi

# Create tags
echo -e "\n${CYAN}Creating tags...${NC}"
for tag in "${TAGS[@]}"; do
    echo -e "  ${GREEN}Creating: $tag${NC}"
    git tag "$tag"
done

# Push tags if requested
if $PUSH; then
    echo -e "\n${CYAN}Pushing tags to origin...${NC}"
    for tag in "${TAGS[@]}"; do
        echo -e "  ${GREEN}Pushing: $tag${NC}"
        git push origin "$tag"
    done
    
    echo -e "\n${GREEN}✓ All tags pushed successfully!${NC}"
    echo -e "\n${CYAN}Workflows triggered:${NC}"
    if ! $CLI_ONLY; then
        echo "  - SDK workflows (Python, .NET, Java, TypeScript, Go, Rust, etc.)"
    fi
    echo "  - CLI release workflow (builds binaries and creates GitHub Release)"
    echo -e "\n${BLUE}Monitor at: https://github.com/json-structure/sdk/actions${NC}"
else
    echo -e "\n${GREEN}✓ Tags created locally.${NC}"
    echo -e "${YELLOW}Run with --push to push tags to origin.${NC}"
fi
