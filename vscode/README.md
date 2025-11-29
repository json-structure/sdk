# JSON Structure Extension for Visual Studio Code

This extension provides validation support for [JSON Structure](https://json-structure.org) schema documents and instance documents.

## Features

### Schema Validation

Files with the `.struct.json` extension are automatically validated as JSON Structure schema documents. The extension checks for:

- Valid JSON Structure schema syntax
- Correct type definitions
- Valid references (`$ref`)
- Proper use of validation keywords
- And more...

### Instance Validation

JSON documents containing a `$schema` property are automatically validated against their referenced schema:

```json
{
  "$schema": "https://example.com/schemas/person.struct.json",
  "name": "John Doe",
  "age": 30
}
```

The extension will:
1. Look for a matching schema in the workspace (by `$id`)
2. Fetch the schema from the URI if not found locally (with caching)
3. Validate the document against the schema
4. Report any validation errors as VS Code diagnostics

### Workspace Schema Discovery

The extension automatically discovers all `.struct.json` files in your workspace and indexes them by their `$id`. This means you can reference schemas by their canonical URI and the extension will automatically find the local file:

```json
// schemas/person.struct.json
{
  "$schema": "https://json-structure.org/meta/core/v0/#",
  "$id": "https://example.com/schemas/person",
  "type": "object",
  "properties": { ... }
}

// data/john.json - automatically validated against the local schema!
{
  "$schema": "https://example.com/schemas/person",
  "name": "John Doe"
}
```

This enables:
- **Offline development**: No need for remote schema fetching during development
- **Schema-first workflows**: Define schemas with canonical URIs, reference them anywhere
- **Automatic updates**: Changes to local schemas are immediately reflected

## Configuration

### Schema Mapping

Map remote schema URIs to local files for development or offline use:

```json
{
  "jsonStructure.schemaMapping": {
    "https://example.com/schemas/person.struct.json": "${workspaceFolder}/schemas/person.struct.json"
  }
}
```

### Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `jsonStructure.enableSchemaValidation` | Enable validation of `.struct.json` files | `true` |
| `jsonStructure.enableInstanceValidation` | Enable validation of JSON documents with `$schema` | `true` |
| `jsonStructure.schemaMapping` | Map of `$schema` URIs to local file paths | `{}` |
| `jsonStructure.cacheTTLMinutes` | Cache TTL for remote schemas (in minutes) | `60` |
| `jsonStructure.trace.server` | Trace level for debugging | `"off"` |

## Commands

| Command | Description |
|---------|-------------|
| `JSON Structure: Clear Schema Cache` | Clear the cached remote schemas |
| `JSON Structure: Validate Document` | Manually trigger validation for the active document |

## Schema Caching

Remote schemas are cached for improved performance:

- Default cache TTL: 1 hour
- ETag support for efficient cache validation
- 404 responses are cached to avoid repeated requests
- Use "Clear Schema Cache" command to reset the cache

## Requirements

- VS Code 1.85.0 or higher

## Related

- [JSON Structure Specification](https://json-structure.org)
- [JSON Structure SDK (TypeScript)](https://github.com/json-structure/sdk/tree/main/typescript)

## License

MIT
