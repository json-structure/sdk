import { describe, expect, it } from 'vitest';
import { discoverImportSources, loadExternalDocuments, resourceSnapshot } from '../src/external-documents.js';
import { parseDocument } from '../src/parser.js';
import { resolveEffectiveDocument, resolveReferences } from '../src/resolver.js';
import { resolveEffectiveMembers } from '../src/phase4/effective-members.js';
import { materializeEffectiveImports, ResolvedSchemaContext } from '../src/phase4/resolved-schema.js';

describe('import-aware schema resolution', () => {
  it('resolves an imported namespace against the importing document URI', () => {
    const rootUri = 'file:///workspace/main.struct.json';
    const libraryUri = 'file:///workspace/library.struct.json';
    const root = parseDocument(rootUri, JSON.stringify({
      $schema: 'https://json-structure.org/meta/extended/v0/#',
      $id: rootUri,
      name: 'Main',
      definitions: {
        Library: { $importdefs: 'https://example.test/library.struct.json' },
        Use: { type: { $ref: '#/definitions/Library/Value' } }
      }
    })).model!;
    const relativeRoot = {
      ...root,
      projections: {
        ...root.projections,
        imports: root.projections.imports.map((projection) => ({ ...projection, source: './library.struct.json' }))
      }
    };
    const library = parseDocument(libraryUri, JSON.stringify({
      $schema: 'https://json-structure.org/meta/core/v0/#',
      $id: libraryUri,
      name: 'Library',
      definitions: { Value: { type: 'string' } }
    })).model!;

    const result = resolveReferences(relativeRoot, [library]);
    const aliased = resolveReferences(relativeRoot, [{ uri: 'https://example.test/catalogue.struct.json', model: library, availability: 'available' }]);
    expect(aliased.imports[0]?.status).toBe('resolved');
    expect(aliased.references.find((reference) => reference.target.endsWith('/Value'))?.targetDocumentUri).toBe(libraryUri);
    const effective = resolveEffectiveDocument(relativeRoot, [library]);
    expect(effective.status).toBe('resolved');
    expect(effective.declarations.find((declaration) => declaration.pointer === '/definitions/Library/Value')).toEqual(expect.objectContaining({
      documentUri: libraryUri,
      sourcePointer: '/definitions/Value',
      importOrigins: [expect.objectContaining({ importSource: './library.struct.json' })]
    }));
    expect(result.imports[0]).toEqual(expect.objectContaining({ status: 'resolved', documentUri: libraryUri }));
    expect(result.references.find((reference) => reference.target.endsWith('/Value'))).toEqual(expect.objectContaining({
      status: 'resolved',
      targetDocumentUri: libraryUri,
      targetPointer: '/definitions/Value'
    }));
  });

  it('discovers imports only at active namespace locations', () => {
    expect(discoverImportSources({
      $schema: 'https://json-structure.org/meta/extended/v0/#',
      definitions: {
        Library: { $importdefs: './library.struct.json' },
        Literal: { type: 'string', default: { $import: './not-an-import.struct.json' } }
      }
    })).toEqual(['./library.struct.json']);
    expect(discoverImportSources({
      $schema: 'https://json-structure.org/meta/core/v0/#',
      $import: './inactive.struct.json'
    })).toEqual([]);
  });

  it('preserves effective namespace provenance for a root imported type inheritance chain', () => {
    const libraryUri = 'https://example.test/library.struct.json';
    const library = {
      $id: libraryUri,
      name: 'Child',
      type: 'object',
      $extends: '#/definitions/Base',
      properties: { name: { type: 'string' } },
      definitions: {
        Base: { type: 'object', abstract: true, properties: { id: { type: 'string' } }, required: ['id'] }
      }
    };
    const result = resolveEffectiveMembers({
      $schema: 'https://json-structure.org/meta/extended/v0/#',
      definitions: { Library: { $import: libraryUri } }
    }, '#/definitions/Library/Child', {
      documentUri: 'https://example.test/main.struct.json',
      resolvedDocuments: [{ uri: libraryUri, document: library }]
    });

    expect(result.status).toBe('resolved');
    expect(result.members.map((member) => member.name)).toEqual(['id', 'name']);
    expect(result.members[0]).toEqual(expect.objectContaining({
      declaredAt: '/definitions/Library/Base/properties/id',
      sourcePointer: '/definitions/Base/properties/id',
      documentUri: libraryUri,
      imports: [expect.objectContaining({ keyword: '$import', importPointer: '/definitions/Library/$import' })]
    }));
  });

  it('resolves URI-relative closure entries parsed from imported documents', async () => {
    const base = 'file:///workspace/';
    const resources = new Map([
      [base + 'invalid.struct.json', JSON.stringify({
        $schema: 'https://json-structure.org/meta/extended/v0/#',
        $id: base + 'invalid.struct.json',
        name: 'Invalid',
        definitions: { Nested: { $importdefs: './nested.struct.json' } }
      })],
      [base + 'nested.struct.json', JSON.stringify({
        $schema: 'https://json-structure.org/meta/core/v0/#',
        $id: base + 'nested.struct.json',
        name: 'Nested',
        definitions: { Value: { type: 'string' } }
      })]
    ]);
    const loaded = await loadExternalDocuments(base + 'main.struct.json', ['./invalid.struct.json'], async (uri) =>
      resourceSnapshot('import-test', uri, resources.get(uri)!));
    expect(loaded[0]).toMatchObject({ uri: base + 'invalid.struct.json', availability: 'available' });
    expect(loaded[1]).toMatchObject({ uri: base + 'nested.struct.json', availability: 'available' });
  });
  it('materializes imported declarations and rewrites imported local references', () => {
    const root = {
      $schema: 'https://json-structure.org/meta/extended/v0/#',
      definitions: { Library: { $import: './library.struct.json' } }
    };
    const libraryUri = 'https://example.test/library.struct.json';
    const context = new ResolvedSchemaContext(root, {
      documentUri: 'https://example.test/main.struct.json',
      resolvedDocuments: [{ uri: libraryUri, document: {
        name: 'Library',
        definitions: {
          Value: { type: 'string' },
          Alias: { type: { $ref: '#/definitions/Value' } }
        }
      } }]
    });
    const result = materializeEffectiveImports(root, context);
    expect(result).not.toHaveProperty('definitions.Library.$import');
    expect(result).toHaveProperty('definitions.Library.Value');
    expect(result).toHaveProperty('definitions.Library.Alias.type.$ref', '#/definitions/Library/Value');
  });

  it('materializes nested imports and rewrites only schema reference positions', () => {
    const root = {
      $schema: 'https://json-structure.org/meta/extended/v0/#',
      definitions: { vendor: { $import: 'https://example.test/outer.struct.json' } }
    };
    const outerUri = 'https://example.test/outer.struct.json';
    const innerUri = 'https://example.test/inner.struct.json';
    const payload = {
      $import: 'https://example.test/payload.struct.json',
      $importdefs: 'https://example.test/payload-defs.struct.json',
      ref: '#/definitions/nested/Value'
    };
    const context = new ResolvedSchemaContext(root, {
      documentUri: 'https://example.test/main.struct.json',
      resolvedDocuments: [
        { uri: outerUri, document: {
          $schema: 'https://json-structure.org/meta/validation/v0/#',
          definitions: {
            nested: { $importdefs: innerUri },
            nestedDefinitions: { definitions: { deeper: { $importdefs: innerUri } } },
            Use: {
              type: 'object',
              $extends: '#/definitions/nested/Base',
              default: payload,
              properties: {
                value: { type: { $ref: '#/definitions/nested/Value' }, default: payload },
                deep: { type: { $ref: '#/definitions/nestedDefinitions/definitions/deeper/Value' } },
                list: { type: 'array', items: { type: { $ref: '#/definitions/nested/Value' } } },
                map: { type: 'map', values: { type: { $ref: '#/definitions/nested/Value' } } },
                branch: { allOf: [{ $ref: '#/definitions/nested/Value' }] },
                union: { type: [{ $ref: '#/definitions/nested/Value' }, { type: 'string' }] },
                choice: { type: 'choice', choices: { value: { type: { $ref: '#/definitions/nested/Value' } } } },
                nestedSchemas: {
                  type: 'object',
                  additionalProperties: { type: { $ref: '#/definitions/nested/Value' } },
                  contains: { type: { $ref: '#/definitions/nested/Value' } },
                  propertyNames: { type: { $ref: '#/definitions/nested/Value' } },
                  keyNames: { type: { $ref: '#/definitions/nested/Value' } },
                  has: { type: { $ref: '#/definitions/nested/Value' } },
                  patternProperties: { '^value$': { type: { $ref: '#/definitions/nested/Value' } } },
                  patternKeys: { '^value$': { type: { $ref: '#/definitions/nested/Value' } } }
              }
        }
            }
          }
        } },
        { uri: innerUri, document: {
          $schema: 'https://json-structure.org/meta/core/v0/#',
          definitions: { Base: { type: 'object', abstract: true }, Value: { type: 'string', description: '#/definitions/nested/Value', default: payload, const: { $import: 'https://example.test/const-payload.struct.json', ref: '#/definitions/nested/Value' }, enum: ['#/definitions/nested/Value', payload], extension: { $importdefs: 'https://example.test/extension-payload.struct.json', value: '#/definitions/nested/Value' } }, Alias: { type: { $ref: '#/definitions/Value' } } }
        } }
      ]
    });

    const result = materializeEffectiveImports(root, context);
    expect(result).toEqual(expect.objectContaining({ definitions: expect.objectContaining({ vendor: expect.objectContaining({ nested: expect.not.objectContaining({ $importdefs: expect.anything() }) }) }) }));
    expect(result).toHaveProperty('definitions.vendor.nested.Value');
    expect(result).toHaveProperty('definitions.vendor.Use.$extends', '#/definitions/vendor/nested/Base');
    expect(result).toHaveProperty('definitions.vendor.Use.properties.value.type.$ref', '#/definitions/vendor/nested/Value');
    expect(result).toHaveProperty('definitions.vendor.Use.properties.deep.type.$ref', '#/definitions/vendor/nestedDefinitions/definitions/deeper/Value');
    expect(result).toHaveProperty('definitions.vendor.nestedDefinitions.definitions.deeper.Value');
    expect(result).toHaveProperty('definitions.vendor.Use.properties.list.items.type.$ref', '#/definitions/vendor/nested/Value');
    expect(result).toHaveProperty('definitions.vendor.Use.properties.map.values.type.$ref', '#/definitions/vendor/nested/Value');
    expect(result).toHaveProperty('definitions.vendor.Use.properties.branch.allOf.0.$ref', '#/definitions/vendor/nested/Value');
    expect(result).toHaveProperty('definitions.vendor.Use.properties.union.type.0.$ref', '#/definitions/vendor/nested/Value');
    expect(result).toHaveProperty('definitions.vendor.Use.properties.choice.choices.value.type.$ref', '#/definitions/vendor/nested/Value');
    expect(result).toHaveProperty('definitions.vendor.Use.properties.nestedSchemas.additionalProperties.type.$ref', '#/definitions/vendor/nested/Value');
    expect(result).toHaveProperty('definitions.vendor.Use.properties.nestedSchemas.contains.type.$ref', '#/definitions/vendor/nested/Value');
    expect(result).toHaveProperty('definitions.vendor.Use.properties.nestedSchemas.propertyNames.type.$ref', '#/definitions/vendor/nested/Value');
    expect(result).toHaveProperty('definitions.vendor.Use.properties.nestedSchemas.keyNames.type.$ref', '#/definitions/vendor/nested/Value');
    expect(result).toHaveProperty('definitions.vendor.Use.properties.nestedSchemas.has.type.$ref', '#/definitions/vendor/nested/Value');
    expect(result).toHaveProperty('definitions.vendor.Use.properties.nestedSchemas.patternProperties.^value$.type.$ref', '#/definitions/vendor/nested/Value');
    expect(result).toHaveProperty('definitions.vendor.Use.properties.nestedSchemas.patternKeys.^value$.type.$ref', '#/definitions/vendor/nested/Value');
    expect(result).toHaveProperty('definitions.vendor.Use.default', payload);
    expect(result).toHaveProperty('definitions.vendor.Use.properties.value.default', payload);
    expect(result).toHaveProperty('definitions.vendor.nested.Value.default', payload);
    expect(result).toHaveProperty('definitions.vendor.nested.Value.description', '#/definitions/nested/Value');
    expect(result).toHaveProperty('definitions.vendor.nested.Value.const', { $import: 'https://example.test/const-payload.struct.json', ref: '#/definitions/nested/Value' });
    expect(result).toHaveProperty('definitions.vendor.nested.Value.enum', ['#/definitions/nested/Value', payload]);
    expect(result).toHaveProperty('definitions.vendor.nested.Value.extension', { $importdefs: 'https://example.test/extension-payload.struct.json', value: '#/definitions/nested/Value' });
    expect(result).toHaveProperty('definitions.vendor.nested.Alias.type.$ref', '#/definitions/vendor/nested/Value');
  });

  it('keeps references scoped when one document is imported into multiple namespaces', () => {
    const libraryUri = 'https://example.test/reused.struct.json';
    const root = {
      $schema: 'https://json-structure.org/meta/extended/v0/#',
      definitions: {
        first: { $importdefs: libraryUri },
        second: { $importdefs: libraryUri }
      }
    };
    const context = new ResolvedSchemaContext(root, {
      documentUri: 'https://example.test/main.struct.json',
      resolvedDocuments: [{ uri: libraryUri, document: {
        $schema: 'https://json-structure.org/meta/core/v0/#',
        definitions: {
          Value: { type: 'string' },
          Alias: { type: { $ref: '#/definitions/Value' } }
        }
      } }]
    });

    const result = materializeEffectiveImports(root, context);
    expect(result).toHaveProperty('definitions.first.Alias.type.$ref', '#/definitions/first/Value');
    expect(result).toHaveProperty('definitions.second.Alias.type.$ref', '#/definitions/second/Value');
  });

  it('indexes active composition-only declarations without treating them as empty namespaces', () => {
    const document = {
      $schema: 'https://json-structure.org/meta/validation/v0/#',
      allOf: [{ type: 'string' }]
    };
    const context = new ResolvedSchemaContext(document, { documentUri: 'https://example.test/composition.struct.json' });
    expect(context.resolve('#')?.schema).toBe(document);
    expect(context.resolveSchema('#/allOf/0')?.schema).toEqual({ type: 'string' });
    expect(context.declarations()).toEqual([]);
  });

  it('preserves special JSON keys in local, imported, and payload objects during materialization', () => {
    const specialSchemas = {
      ['__proto__']: { type: 'string' },
      constructor: { type: 'number' },
      prototype: { type: 'boolean' }
    };
    const localPayload = {
      ['__proto__']: 'local-proto',
      constructor: 'local-constructor',
      prototype: 'local-prototype'
    };
    const importedPayload = {
      ['__proto__']: 'imported-proto',
      constructor: 'imported-constructor',
      prototype: 'imported-prototype'
    };
    const libraryUri = 'https://example.test/special-keys.struct.json';
    const root = {
      $schema: 'https://json-structure.org/meta/extended/v0/#',
      definitions: {
        Local: { type: 'object', properties: specialSchemas, default: localPayload },
        library: { $importdefs: libraryUri }
      }
    };
    const context = new ResolvedSchemaContext(root, {
      documentUri: 'https://example.test/special-keys-root.struct.json',
      resolvedDocuments: [{ uri: libraryUri, document: {
        definitions: {
          ['__proto__']: { type: 'object', properties: specialSchemas, default: importedPayload },
          constructor: { type: 'string' },
          prototype: { type: 'number' }
        }
      } }]
    });

    const result = materializeEffectiveImports(root, context);
    const roundTripped = JSON.parse(JSON.stringify(result));
    const names = ['__proto__', 'constructor', 'prototype'];

    expect(Object.keys(roundTripped.definitions.Local.properties)).toEqual(names);
    expect(Object.keys(roundTripped.definitions.Local.default)).toEqual(names);
    expect(Object.keys(roundTripped.definitions.library)).toEqual(names);
    expect(Object.keys(roundTripped.definitions.library.__proto__.properties)).toEqual(names);
    expect(roundTripped.definitions.Local.default).toEqual(localPayload);
    expect(roundTripped.definitions.library.__proto__.default).toEqual(importedPayload);
    for (const value of [
      roundTripped.definitions.Local.properties,
      roundTripped.definitions.Local.default,
      roundTripped.definitions.library,
      roundTripped.definitions.library.__proto__.properties,
      roundTripped.definitions.library.__proto__.default
    ]) {
      for (const name of names) expect(Object.prototype.hasOwnProperty.call(value, name)).toBe(true);
    }
  });

  it('marks local/import effective declaration collisions indeterminate and refuses materialization', () => {
    const libraryUri = 'https://example.test/colliding-library.struct.json';
    const root = {
      $schema: 'https://json-structure.org/meta/extended/v0/#',
      $importdefs: libraryUri,
      definitions: { Value: { type: 'number' } }
    };
    const context = new ResolvedSchemaContext(root, {
      documentUri: 'https://example.test/colliding-root.struct.json',
      resolvedDocuments: [{ uri: libraryUri, document: { definitions: { Value: { type: 'string' } } } }]
    });

    expect(context.indeterminate).toBe(true);
    expect(context.resolve('#/definitions/Value')).toBeUndefined();
    expect(context.declarations()).toEqual([]);
    expect(context.collisions).toEqual([expect.objectContaining({
      effectivePointer: '/definitions/Value',
      locations: expect.arrayContaining([
        expect.objectContaining({ documentUri: 'https://example.test/colliding-root.struct.json', sourcePointer: '/definitions/Value', imports: [] }),
        expect.objectContaining({ documentUri: libraryUri, sourcePointer: '/definitions/Value', imports: [expect.objectContaining({ importPointer: '/$importdefs' })] })
      ])
    })]);
    expect(() => materializeEffectiveImports(root, context)).toThrow(/Declaration collisions: .*\/definitions\/Value/);
  });

  it('marks identical import/import declarations indeterminate instead of silently choosing one', () => {
    const firstUri = 'https://example.test/first-library.struct.json';
    const secondUri = 'https://example.test/second-library.struct.json';
    const root = {
      $schema: 'https://json-structure.org/meta/extended/v0/#',
      $importdefs: firstUri,
      $import: secondUri,
      definitions: {}
    };
    const context = new ResolvedSchemaContext(root, {
      documentUri: 'https://example.test/duplicate-imports-root.struct.json',
      resolvedDocuments: [
        { uri: firstUri, document: { definitions: { Value: { type: 'string' } } } },
        { uri: secondUri, document: { definitions: { Value: { type: 'string' } } } }
      ]
    });

    expect(context.indeterminate).toBe(true);
    expect(context.resolve('#/definitions/Value')).toBeUndefined();
    expect(context.collisions).toEqual([expect.objectContaining({
      effectivePointer: '/definitions/Value',
      locations: expect.arrayContaining([
        expect.objectContaining({ documentUri: firstUri, sourcePointer: '/definitions/Value' }),
        expect.objectContaining({ documentUri: secondUri, sourcePointer: '/definitions/Value' })
      ])
    })]);
    expect(() => materializeEffectiveImports(root, context)).toThrow(/Declaration collisions: .*\/definitions\/Value/);
  });

  it('rejects dual root imports before materialization even when sources do not collide', () => {
    const rootUri = 'https://example.test/dual-root.struct.json';
    const importUri = 'https://example.test/root-import.struct.json';
    const importDefsUri = 'https://example.test/root-importdefs.struct.json';
    const root = {
      $schema: 'https://json-structure.org/meta/extended/v0/#',
      $import: importUri,
      $importdefs: importDefsUri,
      definitions: {}
    };
    const context = new ResolvedSchemaContext(root, {
      documentUri: rootUri,
      resolvedDocuments: [
        { uri: importUri, document: { definitions: { Imported: { type: 'string' } } } },
        { uri: importDefsUri, document: { definitions: { ImportedDefs: { type: 'number' } } } }
      ]
    });

    expect(context.indeterminate).toBe(true);
    expect(context.collisions).toEqual([]);
    expect(context.diagnostics).toEqual([{
      code: 'json.keyword-invalid',
      message: 'Only one of $import or $importdefs is permitted at a single namespace location.',
      severity: 'error',
      location: { uri: rootUri, pointer: '' }
    }]);
    expect(context.importCollisions).toEqual([expect.objectContaining({
      documentUri: rootUri,
      namespacePointer: '',
      imports: [
        { documentUri: rootUri, namespacePointer: '', importPointer: '/$import', importSource: importUri, keyword: '$import' },
        { documentUri: rootUri, namespacePointer: '', importPointer: '/$importdefs', importSource: importDefsUri, keyword: '$importdefs' }
      ],
      diagnostic: context.diagnostics[0]
    })]);
    expect(() => materializeEffectiveImports(root, context)).toThrow(/Import collisions: .*\/\$import.*root-import.*\/\$importdefs.*root-importdefs/);
  });

  it('retains the parser diagnostic contract when parser diagnostics are supplied', () => {
    const rootUri = 'https://example.test/parser-diagnostic.struct.json';
    const parserDiagnostic = {
      code: 'json.keyword-invalid',
      message: 'Only one of $import or $importdefs is permitted at a single namespace location.',
      severity: 'error' as const,
      location: { uri: rootUri, pointer: '' }
    };
    const root = {
      $schema: 'https://json-structure.org/meta/extended/v0/#',
      $import: 'https://example.test/parser-import.struct.json',
      $importdefs: 'https://example.test/parser-importdefs.struct.json'
    };
    const context = new ResolvedSchemaContext(root, { documentUri: rootUri, diagnostics: [parserDiagnostic] });

    expect(context.diagnostics).toEqual([parserDiagnostic]);
    expect(context.importCollisions[0]?.diagnostic).toBe(parserDiagnostic);
  });

  it('rejects dual imports at nested active namespaces with exact source provenance', () => {
    const rootUri = 'https://example.test/dual-nested.struct.json';
    const importUri = 'https://example.test/nested-import.struct.json';
    const importDefsUri = 'https://example.test/nested-importdefs.struct.json';
    const root = {
      $schema: 'https://json-structure.org/meta/extended/v0/#',
      definitions: {
        Namespace: {
          $import: importUri,
          $importdefs: importDefsUri
        }
      }
    };
    const context = new ResolvedSchemaContext(root, {
      documentUri: rootUri,
      resolvedDocuments: [
        { uri: importUri, document: { definitions: { Imported: { type: 'string' } } } },
        { uri: importDefsUri, document: { definitions: { ImportedDefs: { type: 'number' } } } }
      ]
    });

    expect(context.indeterminate).toBe(true);
    expect(context.collisions).toEqual([]);
    expect(context.diagnostics).toEqual([expect.objectContaining({
      code: 'json.keyword-invalid',
      severity: 'error',
      location: { uri: rootUri, pointer: '/definitions/Namespace' }
    })]);
    expect(context.importCollisions).toEqual([expect.objectContaining({
      documentUri: rootUri,
      namespacePointer: '/definitions/Namespace',
      imports: [
        { documentUri: rootUri, namespacePointer: '/definitions/Namespace', importPointer: '/definitions/Namespace/$import', importSource: importUri, keyword: '$import' },
        { documentUri: rootUri, namespacePointer: '/definitions/Namespace', importPointer: '/definitions/Namespace/$importdefs', importSource: importDefsUri, keyword: '$importdefs' }
      ]
    })]);
    expect(() => materializeEffectiveImports(root, context)).toThrow(/\/definitions\/Namespace.*Only one of \$import or \$importdefs is permitted/);
  });

  it('allows active namespaces with only one import keyword', () => {
    const root = {
      $schema: 'https://json-structure.org/meta/extended/v0/#',
      definitions: {
        ImportNamespace: { $import: 'https://example.test/single-import.struct.json' },
        ImportDefsNamespace: { $importdefs: 'https://example.test/single-importdefs.struct.json' }
      }
    };
    const context = new ResolvedSchemaContext(root, {
      documentUri: 'https://example.test/single-keyword.struct.json',
      resolvedDocuments: [
        { uri: 'https://example.test/single-import.struct.json', document: { definitions: { Imported: { type: 'string' } } } },
        { uri: 'https://example.test/single-importdefs.struct.json', document: { definitions: { ImportedDefs: { type: 'number' } } } }
      ]
    });

    expect(context.indeterminate).toBe(false);
    expect(context.importCollisions).toEqual([]);
    expect(context.diagnostics).toEqual([]);
    expect(materializeEffectiveImports(root, context)).toEqual(expect.objectContaining({
      definitions: expect.objectContaining({
        ImportNamespace: expect.objectContaining({ Imported: { type: 'string' } }),
        ImportDefsNamespace: expect.objectContaining({ ImportedDefs: { type: 'number' } })
      })
    }));
  });
});
