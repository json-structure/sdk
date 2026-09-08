import { describe, expect, it } from 'vitest';
import type { DocumentSnapshot } from '../src/contracts.js';
import { parseDocument, resolveDocumentReferences } from '../src/index.js';
import type { NormalizedDocument } from '../src/model.js';
import { GRAPH_DOCUMENT_NODE_ID, projectGraph } from '../src/ui/helpers.js';

function resolvedSnapshot(uri: string, value: Record<string, unknown>, externals: readonly NormalizedDocument[] = []): DocumentSnapshot {
  const text = JSON.stringify({ $schema: 'https://json-structure.org/meta/extended/v0/#', $id: uri, name: 'GraphDocument', ...value });
  const parsed = parseDocument(uri, text);
  expect(parsed.model).toBeDefined();
  return { uri, text, documentVersion: 1, recovery: 'valid', diagnostics: parsed.diagnostics, model: resolveDocumentReferences(parsed.model!, externals) };
}

describe('graph projection', () => {
  it('projects every reference-bearing schema container from resolution facts', () => {
    const schema = (target: string) => ({ type: { $ref: target } });
    const graph = projectGraph(resolvedSnapshot('memory://edge-families', {
      $uses: ['JSONStructureValidation', 'JSONStructureConditionalComposition'], $root: '#/definitions/Owner',
      definitions: {
        Target: { type: 'string' },
        Owner: {
          type: 'object',
          properties: {
            propertyRef: schema('#/definitions/Target'),
            tupleCarrier: { type: 'tuple', properties: { slot: schema('#/definitions/Target') }, tuple: ['slot'] },
            choiceCarrier: { type: 'choice', selector: 'kind', choices: { selected: schema('#/definitions/Target') } }
          },
          additionalProperties: schema('#/definitions/Target'),
          allOf: [{ $ref: '#/definitions/Target' }], anyOf: [{ $ref: '#/definitions/Target' }], oneOf: [{ $ref: '#/definitions/Target' }],
          not: { $ref: '#/definitions/Target' }, if: { $ref: '#/definitions/Target' }, then: { $ref: '#/definitions/Target' }, else: { $ref: '#/definitions/Target' },
          contains: schema('#/definitions/Target'), propertyNames: schema('#/definitions/Target'), keyNames: schema('#/definitions/Target'), has: schema('#/definitions/Target'),
          patternProperties: { '^x': schema('#/definitions/Target') }, patternKeys: { '^k': schema('#/definitions/Target') }
        },
        ArrayOwner: { type: 'array', items: schema('#/definitions/Target') },
        MapOwner: { type: 'map', values: schema('#/definitions/Target') }
      }
    }));
    const labels = graph.edges.filter((edge) => edge.kind === 'reference').map((edge) => edge.label);
    for (const label of ['propertyRef', 'slot', 'selected', 'additionalProperties', 'allOf[0]', 'anyOf[0]', 'oneOf[0]', 'not', 'if', 'then', 'else', 'contains', 'propertyNames', 'keyNames', 'has', 'patternProperties:^x', 'patternKeys:^k', 'items', 'values']) {
      expect(labels, `missing ${label}`).toContain(label);
    }
  });

  it('retains relation, import, external, unresolved, and indeterminate metadata without graphing the document envelope', () => {
    const external = parseDocument('https://example.org/types.json', JSON.stringify({
      $schema: 'https://json-structure.org/meta/relations/v0/#', $uses: ['JSONStructureRelations'], $id: 'https://example.org/types.json', name: 'Types',
      definitions: { External: { type: 'object', properties: { id: { type: 'string' } }, identity: ['id'] }, Qualifier: { type: 'object', properties: { code: { type: 'string' } } } }
    })).model!;
    const graph = projectGraph(resolvedSnapshot('memory://statuses', {
      $schema: 'https://json-structure.org/meta/relations/v0/#',
      $uses: ['JSONStructureRelations'],
      $root: '#/definitions/Source',
      definitions: {
        Imported: { $importdefs: 'https://example.org/types.json' }, MissingImport: { $importdefs: 'https://example.org/missing.json' },
        Base: { type: 'object', abstract: true, properties: { id: { type: 'string' } } },
        Source: {
          type: 'object', $extends: '#/definitions/Base', properties: { missing: { type: { $ref: '#/definitions/Nope' } }, pending: { type: { $ref: '#/definitions/MissingImport/Later' } } },
          relations: { external: { targettype: { $ref: '#/definitions/Imported/External' }, cardinality: 'single', qualifiertype: { $ref: '#/definitions/Imported/Qualifier' } } }
        }
      }
    }, [external]));
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '/definitions/Imported', kind: 'namespace' }),
      expect.objectContaining({ id: '/definitions/Imported/External', kind: 'type', status: 'external', documentUri: 'https://example.org/types.json' }),
      expect.objectContaining({ kind: 'target', status: 'unresolved', target: '#/definitions/Nope' }),
      expect.objectContaining({ kind: 'target', status: 'indeterminate', target: '#/definitions/MissingImport/Later' })
    ]));
    expect(graph.nodes).not.toContainEqual(expect.objectContaining({ id: GRAPH_DOCUMENT_NODE_ID }));
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'inheritance', status: 'resolved', to: '/definitions/Base' }),
      expect.objectContaining({
        kind: 'relation', label: 'external', status: 'external', targetPointer: '/definitions/External',
        relationPointer: '/definitions/Source/relations/external', relationName: 'external', declaringSource: '/definitions/Source',
        cardinality: 'single', targetIdentity: expect.objectContaining({ reference: '#/definitions/Imported/External', status: 'external' }),
        qualifierIdentity: expect.objectContaining({ reference: '#/definitions/Imported/Qualifier', status: 'external' }),
      }),
      expect.objectContaining({ kind: 'relation-qualifier', label: 'external qualifier', status: 'external', targetPointer: '/definitions/Qualifier', qualifierReference: '#/definitions/Imported/Qualifier' }),
      expect.objectContaining({ kind: 'reference', label: 'missing', status: 'unresolved', reason: expect.any(String) }),
      expect.objectContaining({ kind: 'reference', label: 'pending', status: 'indeterminate', reason: expect.any(String) }),
      expect.objectContaining({ kind: 'import', status: 'external', documentUri: 'https://example.org/types.json', provenance: 'importdefs' }),
      expect.objectContaining({ kind: 'import', status: 'indeterminate', provenance: 'importdefs' })
    ]));
    expect(graph.edges).not.toContainEqual(expect.objectContaining({ kind: 'root', pointer: '/$root' }));
  });
  it('anchors resolved and unresolved root imports to one selectable document node', () => {
    const externalUri = 'https://example.org/root-import.json';
    const external = parseDocument(externalUri, JSON.stringify({
      $schema: 'https://json-structure.org/meta/core/v0/#', $id: externalUri, name: 'Imported',
      definitions: { Value: { type: 'string' } }
    })).model!;
    const resolved = projectGraph(resolvedSnapshot('memory://root-import', {
      $import: externalUri,
      definitions: {}
    }, [external]));
    const resolvedRoot = resolved.nodes.find((node) => node.id === GRAPH_DOCUMENT_NODE_ID);
    expect(resolvedRoot).toEqual(expect.objectContaining({ kind: 'document', pointer: '', selectable: true }));
    const resolvedImports = resolved.edges.filter((edge) => edge.kind === 'import');
    expect(resolvedImports.length).toBeGreaterThan(0);
    expect(resolvedImports.every((edge) => edge.from === GRAPH_DOCUMENT_NODE_ID && resolved.nodes.some((node) => node.id === edge.to))).toBe(true);

    const unresolved = projectGraph(resolvedSnapshot('memory://root-import-missing', {
      $import: 'https://example.org/missing-root-import.json',
      definitions: {}
    }));
    expect(unresolved.nodes.find((node) => node.id === GRAPH_DOCUMENT_NODE_ID)).toEqual(expect.objectContaining({ kind: 'document', selectable: true }));
    expect(unresolved.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'import', from: GRAPH_DOCUMENT_NODE_ID, status: 'indeterminate' })
    ]));
    expect(unresolved.edges.filter((edge) => edge.kind === 'import').every((edge) => unresolved.nodes.some((node) => node.id === edge.to))).toBe(true);
  });
});
