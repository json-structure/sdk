#!/bin/bash
set -e

echo "=== Setting up JSON Structure SDK development environment ==="

# Python SDK
echo "Installing Python dependencies..."
cd /workspaces/sdk/python
pip install -e ".[dev]" 2>/dev/null || pip install pytest

# TypeScript SDK
echo "Installing TypeScript dependencies..."
cd /workspaces/sdk/typescript
npm install

# Java SDK
echo "Building Java SDK..."
cd /workspaces/sdk/java
mvn install -DskipTests -q || echo "Maven build skipped (may need configuration)"

# .NET SDK
echo "Restoring .NET packages..."
cd /workspaces/sdk/dotnet
dotnet restore || echo ".NET restore skipped (may need configuration)"

# Go SDK
echo "Setting up Go SDK..."
cd /workspaces/sdk/go
go mod download

echo "=== Development environment ready! ==="
echo ""
echo "Available SDKs:"
echo "  - Python:     cd python && pytest"
echo "  - TypeScript: cd typescript && npm test"
echo "  - Java:       cd java && mvn test"
echo "  - .NET:       cd dotnet && dotnet test"
echo "  - Go:         cd go && go test ./..."
