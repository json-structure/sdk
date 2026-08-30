import { describe, expect, it } from 'vitest';
import { parseDocument, resolveDocumentReferences, resolveReferences } from '../src/index.js';

function model(uri: string, value: unknown) {
  const parsed = parseDocument(uri, JSON.stringify({
    $schema: 'https://json-structure.org/meta/core/v0/#',
    $id: uri,
    name: 'TestDocument',
    ...(value as Record<string, unknown>)
  }));
  expect(parsed.model).toBeDefined();
  expect(parsed.diagnostics.filter((entry) => ['/$schema', '/$id', '/name'].includes(entry.location?.pointer ?? ''))).toEqual([]);
  return parsed.model!;
}

describe('host-neutral reference resolution', () => {
  it('distinguishes local missing targets from unavailable imported namespaces', () => {
    const local = model('memory://local', {
      definitions: { Use: { type: { $ref: '#/definitions/Missing' } } }
    });
    expect(resolveReferences(local).references).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: '#/definitions/Missing', status: 'unresolved' })
    ]));

    const imported = model('memory://importer', {
      definitions: {
        People: { $importdefs: 'https://example.org/people.json' },
        Use: { type: { $ref: '#/definitions/People/Person' } }
      }
    });
    const resolution = resolveReferences(imported);
    expect(resolution.imports[0]).toEqual(expect.objectContaining({ status: 'indeterminate' }));
    expect(resolution.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: '#/definitions/People/Person', status: 'indeterminate' })
    ]));
    expect(resolution.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  });

  it('resolves local $root, $ref, $extends, relation target, and qualifier references', () => {
    const document = model('memory://local-all', {
      $root: '#/definitions/Entity',
      definitions: {
        Base: { type: 'object', abstract: true, properties: { id: { type: 'string' } } },
        Qualifier: { type: 'object' },
        Entity: {
          type: 'object',
          $extends: '#/definitions/Base',
          properties: { id: { type: 'string' }, parent: { type: { $ref: '#/definitions/Entity' } } },
          identity: ['id'],
          relations: {
            parent: {
              targettype: { $ref: '#/definitions/Entity' },
              cardinality: 'single',
              qualifiertype: { $ref: '#/definitions/Qualifier' }
            }
          }
        }
      }
    });
    const resolution = resolveReferences(document);
    expect(resolution.references.map((fact) => [fact.kind, fact.status])).toEqual(expect.arrayContaining([
      ['root', 'resolved'],
      ['extends', 'resolved'],
      ['ref', 'resolved'],
      ['relation-target', 'resolved'],
      ['relation-qualifier', 'resolved']
    ]));
    expect(resolution.diagnostics).toEqual([]);
  });

  it('maps $import root and definitions into the destination namespace with provenance', () => {
    const external = model('memory://retrieved-people', {
      $id: 'https://example.org/people.json',
      name: 'Person',
      type: 'object',
      properties: { id: { type: 'string' } },
      identity: ['id'],
      definitions: { 'Address/Postal~Code': { type: 'string' } }
    });
    const importer = model('memory://import-root', {
      definitions: {
        People: { $import: 'https://example.org/people.json#' },
        PersonUse: { type: { $ref: '#/definitions/People/Person' } },
        AddressUse: { type: { $ref: '#/definitions/People/Address~1Postal~0Code' } }
      }
    });
    const resolution = resolveReferences(importer, [external]);
    expect(resolution.imports[0]).toEqual(expect.objectContaining({
      status: 'resolved',
      documentUri: 'memory://retrieved-people',
      importedPointers: expect.arrayContaining([
        '/definitions/People/Person',
        '/definitions/People/Address~1Postal~0Code'
      ])
    }));
    const person = resolution.references.find((fact) => fact.target.endsWith('/Person'));
    expect(person).toEqual(expect.objectContaining({
      status: 'resolved',
      targetDocumentUri: 'memory://retrieved-people',
      targetPointer: '',
      importOrigins: [expect.objectContaining({ provenance: 'import', importPointer: '/definitions/People/$import' })]
    }));
    expect(resolution.diagnostics).toEqual([]);
  });

  it('maps $importdefs definitions only and leaves the external root missing', () => {
    const external = model('https://example.org/library.json', {
      name: 'LibraryRoot',
      type: 'string',
      definitions: { Value: { type: 'string' } }
    });
    const importer = model('memory://import-defs', {
      definitions: {
        Lib: { $importdefs: 'https://example.org/library.json' },
        Good: { type: { $ref: '#/definitions/Lib/Value' } },
        MissingRoot: { type: { $ref: '#/definitions/Lib/LibraryRoot' } }
      }
    });
    const resolution = resolveReferences(importer, [external]);
    expect(resolution.references.find((fact) => fact.target.endsWith('/Value'))?.status).toBe('resolved');
    expect(resolution.references.find((fact) => fact.target.endsWith('/LibraryRoot'))?.status).toBe('unresolved');
  });

  it('recursively prefixes nested imported definitions and preserves the import chain', () => {
    const common = model('https://example.org/common.json', {
      definitions: { Code: { type: 'string' } }
    });
    const people = model('https://example.org/people.json', {
      definitions: {
        Common: { $importdefs: 'https://example.org/common.json' },
        Person: { type: { $ref: '#/definitions/Common/Code' } }
      }
    });
    const importer = model('memory://nested-imports', {
      definitions: {
        Domain: { $importdefs: 'https://example.org/people.json' },
        Use: { type: { $ref: '#/definitions/Domain/Common/Code' } }
      }
    });
    const resolution = resolveReferences(importer, [people, common]);
    const fact = resolution.references.find((entry) => entry.target.endsWith('/Common/Code'));
    expect(fact).toEqual(expect.objectContaining({ status: 'resolved', targetDocumentUri: 'https://example.org/common.json' }));
    expect(fact?.importOrigins.map((origin) => origin.importSource)).toEqual([
      'https://example.org/common.json',
      'https://example.org/people.json'
    ]);
    expect(resolution.references).toEqual(expect.arrayContaining([
      expect.objectContaining({
        pointer: '/definitions/Domain/Person/type/$ref',
        target: '#/definitions/Domain/Common/Code',
        normalizedTarget: '/definitions/Domain/Common/Code',
        status: 'resolved',
        targetDocumentUri: 'https://example.org/common.json'
      })
    ]));
  });

  it('distinguishes stale/incomplete snapshots from available documents with missing targets', () => {
    const importer = model('memory://snapshot-imports', {
      definitions: {
        Lib: { $importdefs: 'https://example.org/lib.json' },
        Use: { type: { $ref: '#/definitions/Lib/Missing' } }
      }
    });
    const stale = resolveReferences(importer, [{ uri: 'https://example.org/lib.json', availability: 'stale' }]);
    expect(stale.imports[0]?.status).toBe('indeterminate');
    expect(stale.references[0]?.status).toBe('indeterminate');

    const incomplete = resolveReferences(importer, [{
      uri: 'https://example.org/lib.json',
      text: '{',
      documentVersion: 3,
      recovery: 'incomplete',
      diagnostics: []
    }]);
    expect(incomplete.imports[0]?.status).toBe('indeterminate');

    const available = model('https://example.org/lib.json', { definitions: { Present: { type: 'string' } } });
    const missing = resolveReferences(importer, [available]);
    expect(missing.imports[0]?.status).toBe('resolved');
    expect(missing.references[0]?.status).toBe('unresolved');
    expect(missing.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(true);
  });

  it('parses and resolves a percent-encoded $root without double decoding', () => {
    const document = model('memory://fragment', {
      $root: '#%2Fdefinitions%2FT',
      definitions: {
        T: { type: 'string' },
        '%25': { type: 'string' },
        EncodedPercent: { type: { $ref: '#%2Fdefinitions%2F%2525' } }
      }
    });
    expect(document.rootPointer).toBe('/definitions/T');
    const resolution = resolveReferences(document);
    expect(resolution.references.find((fact) => fact.kind === 'root')).toEqual(expect.objectContaining({
      target: '#%2Fdefinitions%2FT',
      normalizedTarget: '/definitions/T',
      status: 'resolved'
    }));
    expect(resolution.references.find((fact) => fact.pointer.includes('/EncodedPercent/'))).toEqual(expect.objectContaining({
      normalizedTarget: '/definitions/%25',
      status: 'resolved'
    }));
  });

  it('rejects malformed URI fragments while preserving RFC 6901 pointer escaping', () => {
    const document = model('memory://fragment-controls', {
      definitions: {
        'A/B~C': { type: 'string' },
        Use: { type: { $ref: '#/definitions/A%7E1B%7E0C' } },
        BadPercent: { type: { $ref: '#/definitions/%ZZ' } },
        BadPointer: { type: { $ref: '#/definitions/A~2B' } },
        BadDecodedShape: { type: { $ref: '#definitions%2FT' } },
        Absolute: { type: { $ref: 'https://example.org/types.json#/definitions/A' } }
      }
    });
    const resolution = resolveReferences(document);
    expect(resolution.references.find((fact) => fact.pointer.includes('/Use/'))).toEqual(expect.objectContaining({
      normalizedTarget: '/definitions/A~1B~0C',
      status: 'resolved'
    }));
    for (const name of ['BadPercent', 'BadPointer', 'BadDecodedShape', 'Absolute']) {
      expect(resolution.references.find((fact) => fact.pointer.includes(`/${name}/`))?.status).toBe('unresolved');
    }
  });

  it('resolves recursive type references while rejecting inheritance and import cycles', () => {
    const selfReference = model('memory://self-reference', {
      definitions: { Node: { type: 'object', properties: { next: { type: { $ref: '#/definitions/Node' } } } } }
    });
    expect(resolveReferences(selfReference).references).toEqual([
      expect.objectContaining({ kind: 'ref', status: 'resolved' })
    ]);

    const mutualReferences = model('memory://reference-cycle', {
      definitions: {
        A: { type: { $ref: '#/definitions/B' } },
        B: { type: { $ref: '#/definitions/A' } }
      }
    });
    expect(resolveReferences(mutualReferences).references.every((fact) => fact.status === 'resolved')).toBe(true);

    const inheritance = model('memory://inheritance-cycle', {
      definitions: {
        A: { type: 'object', $extends: ['#/definitions/Base', '#/definitions/B'] },
        B: { type: 'object', $extends: '#/definitions/A' },
        Base: { type: 'object' }
      }
    });
    const inheritanceFacts = resolveReferences(inheritance).references.filter((fact) => fact.kind === 'extends');
    expect(inheritanceFacts.filter((fact) => fact.reason === 'Inheritance cycle detected.')).toHaveLength(2);
    expect(inheritanceFacts.find((fact) => fact.target.endsWith('/Base'))?.status).toBe('resolved');

    const first = model('https://example.org/first.json', { definitions: { Second: { $importdefs: 'https://example.org/second.json' } } });
    const second = model('https://example.org/second.json', { definitions: { First: { $importdefs: 'https://example.org/first.json' } } });
    const importer = model('memory://cycle-importer', { definitions: { Cycle: { $importdefs: 'https://example.org/first.json' } } });
    const resolution = resolveReferences(importer, [first, second]);
    expect(resolution.imports[0]).toEqual(expect.objectContaining({ status: 'unresolved', reason: 'Import cycle detected.' }));
  });

  it('detects duplicate paths and ambiguous supplied documents while allowing local shadows', () => {
    const duplicate = model('memory://duplicates', {
      definitions: { Value: { type: 'string' }, Use: { type: { $ref: '#/definitions/Value' } } }
    });
    const duplicateModel = {
      ...duplicate,
      nodes: [...duplicate.nodes, duplicate.nodes.find((node) => node.pointer === '/definitions/Value')!]
    };
    expect(resolveReferences(duplicateModel).references.find((fact) => fact.target.endsWith('/Value'))?.status).toBe('unresolved');

    const importer = model('memory://ambiguous-supply', { definitions: { Lib: { $importdefs: 'https://example.org/lib.json' } } });
    const first = model('https://example.org/lib.json', { definitions: { A: { type: 'string' } } });
    const second = model('memory://other-copy', { $id: 'https://example.org/lib.json', definitions: { B: { type: 'string' } } });
    expect(resolveReferences(importer, [first, second]).imports[0]?.status).toBe('unresolved');

    const shadowing = model('memory://shadowing', {
      definitions: {
        Lib: { $importdefs: 'https://example.org/lib.json', A: { type: 'number' } },
        Use: { type: { $ref: '#/definitions/Lib/A' } }
      }
    });
    const shadowed = resolveReferences(shadowing, [first]);
    expect(shadowed.references.find((fact) => fact.target.endsWith('/Lib/A'))).toEqual(expect.objectContaining({
      status: 'resolved',
      targetDocumentUri: 'memory://shadowing',
      importOrigins: []
    }));
  });

  it('marks every import unresolved when imported declarations collide without a reference', () => {
    const first = model('https://example.org/first.json', { definitions: { Value: { type: 'string' } } });
    const second = model('https://example.org/second.json', { name: 'Value', type: 'number' });
    const importer = model('memory://collision', {
      definitions: {
        Lib: {
          $importdefs: 'https://example.org/first.json',
          $import: 'https://example.org/second.json'
        }
      }
    });
    const resolution = resolveReferences(importer, [first, second]);
    expect(resolution.imports).toHaveLength(2);
    expect(resolution.imports.every((fact) => fact.status === 'unresolved' && fact.reason?.includes('/definitions/Lib/Value'))).toBe(true);
    expect(resolution.diagnostics.filter((diagnostic) => diagnostic.code === 'resolution.import-unresolved')).toHaveLength(2);
  });

  it('excludes inline schemas from reusable declarations and imports nested namespace members', () => {
    const external = model('https://example.org/inline.json', {
      type: 'object',
      properties: { inline: { type: 'string' } },
      definitions: {
        Namespace: { Nested: { type: 'string' } },
        Container: { type: 'array', items: { type: 'string' } }
      }
    });
    const local = model('memory://inline-local', {
      type: 'object',
      properties: { inline: { type: 'string' } },
      definitions: {
        Namespace: { Nested: { type: 'string' } },
        Good: { type: { $ref: '#/definitions/Namespace/Nested' } },
        BadProperty: { type: { $ref: '#/properties/inline' } },
        BadItems: { type: { $ref: '#/definitions/Container/items' } },
        Container: { type: 'array', items: { type: 'string' } }
      }
    });
    const localResolution = resolveReferences(local);
    expect(localResolution.references.find((fact) => fact.pointer.includes('/Good/'))?.status).toBe('resolved');
    expect(localResolution.references.find((fact) => fact.pointer.includes('/BadProperty/'))?.status).toBe('unresolved');
    expect(localResolution.references.find((fact) => fact.pointer.includes('/BadItems/'))?.status).toBe('unresolved');

    const importer = model('memory://inline-import', {
      definitions: {
        Lib: { $importdefs: 'https://example.org/inline.json' },
        Good: { type: { $ref: '#/definitions/Lib/Namespace/Nested' } },
        BadProperty: { type: { $ref: '#/definitions/Lib/properties/inline' } },
        BadItems: { type: { $ref: '#/definitions/Lib/Container/items' } }
      }
    });
    const imported = resolveReferences(importer, [external]);
    expect(imported.references.find((fact) => fact.pointer.includes('/Good/'))?.status).toBe('resolved');
    expect(imported.references.find((fact) => fact.pointer.includes('/BadProperty/'))?.status).toBe('unresolved');
    expect(imported.references.find((fact) => fact.pointer.includes('/BadItems/'))?.status).toBe('unresolved');
  });

  it('enforces relation target identity after import resolution without false external-instance errors', () => {
    const withIdentity = model('https://example.org/targets.json', {
      definitions: {
        Target: { type: 'object', properties: { id: { type: 'string' } }, identity: ['id'] },
        Qualifier: { type: 'object' }
      }
    });
    const withoutIdentity = model('https://example.org/no-identity.json', {
      definitions: { Target: { type: 'object' } }
    });
    const importing = (source: string) => model(`memory://${source}`, {
      definitions: {
        Types: { $importdefs: source },
        Source: {
          type: 'object',
          relations: {
            target: {
              targettype: { $ref: '#/definitions/Types/Target' },
              cardinality: 'single',
              qualifiertype: { $ref: '#/definitions/Types/Qualifier' }
            }
          }
        }
      }
    });
    expect(resolveReferences(importing('https://example.org/targets.json'), [withIdentity]).diagnostics).toEqual([]);
    const invalid = resolveReferences(importing('https://example.org/no-identity.json'), [withoutIdentity]);
    expect(invalid.references.find((fact) => fact.kind === 'relation-target')?.status).toBe('unresolved');
  });

  it('integrates facts into a new model and ignores $ref-shaped literal payloads', () => {
    const document = model('memory://integrated', {
      type: 'object',
      properties: { value: { type: { $ref: '#/definitions/Value' } } },
      default: { $ref: '#/definitions/NotASchemaReference' },
      examples: [{ $ref: '#/definitions/AlsoLiteral' }],
      definitions: { Value: { type: 'string' } }
    });
    const resolved = resolveDocumentReferences(document);
    expect(resolved.projections.resolution?.references).toHaveLength(1);
    expect(resolved.projections.resolution?.references[0]?.status).toBe('resolved');
    expect(resolved.projections.diagnostics.some((diagnostic) => diagnostic.code.startsWith('resolution.'))).toBe(false);
    expect(document.projections.resolution).toBeUndefined();
  });

  it('deduplicates parser-owned local relation errors without hiding external qualifier failures', () => {
    const external = model('https://example.org/qualifiers.json', {
      definitions: { Present: { type: 'object' } }
    });
    const document = model('memory://relation-diagnostic-integration', {
      definitions: {
        Target: { type: 'object' },
        Inline: { type: 'object', properties: { value: { type: 'string' } } },
        External: { $importdefs: 'https://example.org/qualifiers.json' },
        Source: {
          type: 'object',
          relations: {
            target: { targettype: { $ref: '#/definitions/Target' }, cardinality: 'single' },
            localQualifier: {
              targettype: { $ref: '#/definitions/Target' },
              cardinality: 'single',
              qualifiertype: { $ref: '#/definitions/Inline/properties/value' }
            },
            externalQualifier: {
              targettype: { $ref: '#/definitions/Target' },
              cardinality: 'single',
              qualifiertype: { $ref: '#/definitions/External/Missing' }
            }
          }
        }
      }
    });
    const targetPointer = '/definitions/Source/relations/target/targettype/$ref';
    const localQualifierPointer = '/definitions/Source/relations/localQualifier/qualifiertype/$ref';
    const externalQualifierPointer = '/definitions/Source/relations/externalQualifier/qualifiertype/$ref';
    const resolved = resolveDocumentReferences(document, [external]);

    for (const pointer of [targetPointer, localQualifierPointer]) {
      expect(document.projections.diagnostics.filter((diagnostic) => diagnostic.pointer === pointer)).toHaveLength(1);
      expect(resolved.projections.resolution?.references.find((fact) => fact.pointer === pointer)?.status).toBe('unresolved');
      expect(resolved.projections.diagnostics.filter((diagnostic) => diagnostic.pointer === pointer)).toHaveLength(1);
    }
    expect(document.projections.diagnostics.filter((diagnostic) => diagnostic.pointer === externalQualifierPointer)).toEqual([]);
    expect(resolved.projections.resolution?.references.find((fact) => fact.pointer === externalQualifierPointer)?.status).toBe('unresolved');
    expect(resolved.projections.diagnostics.filter((diagnostic) => diagnostic.pointer === externalQualifierPointer)).toEqual([
      expect.objectContaining({ code: 'resolution.reference-unresolved', severity: 'error' })
    ]);
  });
});