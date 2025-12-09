#!/bin/bash
# Publish Perl SDK to CPAN (v0.5.3)
# This script replicates what the GitHub workflow does

set -e

VERSION="0.5.3"

# Use Strawberry Perl explicitly on Windows/Git Bash
PERL="/c/Strawberry/perl/bin/perl.exe"
CPAN_UPLOAD="/c/Strawberry/perl/bin/cpan-upload"

if [ ! -f "$PERL" ]; then
    echo "Error: Strawberry Perl not found at $PERL"
    echo "Please install Strawberry Perl or adjust the path"
    exit 1
fi

# Prompt for PAUSE credentials
read -p "Enter your PAUSE username: " PAUSE_USERNAME
read -s -p "Enter your PAUSE password: " PAUSE_PASSWORD
echo ""

echo -e "\n\033[36mBuilding Perl distribution for v$VERSION...\033[0m"

cd perl

# Update version in all .pm files
echo -e "\033[33mUpdating version in .pm files...\033[0m"
find lib -name '*.pm' -exec sed -i "s/VERSION = '[^']*'/VERSION = '$VERSION'/" {} \;

# Build the distribution
echo -e "\033[33mRunning perl Makefile.PL...\033[0m"
"$PERL" Makefile.PL

echo -e "\033[33mRunning dmake...\033[0m"
/c/Strawberry/c/bin/dmake.exe

echo -e "\033[33mRunning dmake manifest...\033[0m"
/c/Strawberry/c/bin/dmake.exe manifest

echo -e "\033[33mRunning dmake dist...\033[0m"
/c/Strawberry/c/bin/dmake.exe dist

# Find the tarball
TARBALL=$(ls JSON-Structure-*.tar.gz 2>/dev/null | head -1)
if [ -z "$TARBALL" ]; then
    echo "Error: No distribution tarball found"
    exit 1
fi

echo -e "\n\033[32mBuilt: $TARBALL\033[0m"

# Confirm upload
read -p $'\nUpload '"$TARBALL"' to CPAN? (y/N): ' CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "Aborted."
    cd ..
    git checkout -- perl/lib/
    exit 0
fi

# Upload to CPAN
echo -e "\n\033[36mUploading to CPAN...\033[0m"
"$CPAN_UPLOAD" -u "$PAUSE_USERNAME" -p "$PAUSE_PASSWORD" "$TARBALL"

echo -e "\n\033[32mSuccessfully uploaded to CPAN!\033[0m"

cd ..

# Clean up - reset version changes
echo -e "\033[33mResetting version changes...\033[0m"
git checkout -- perl/lib/

echo -e "\n\033[32mDone! The package should appear on CPAN within a few hours.\033[0m"
echo -e "\033[36mYou can check status at: https://metacpan.org/author/${PAUSE_USERNAME^^}\033[0m"
