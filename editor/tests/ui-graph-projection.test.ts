import { describe, expect, it } from 'vitest';
import type { DocumentSnapshot } from '../src/contracts.js';
import { parseDocument, resolveDocumentReferences } from '../src/index.js';
import type { NormalizedDocument } from '../src/model.js';
import { projectGraph } from '../src/ui/helpers.js';

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

  it('retains root, relation, import, external, unresolved, and indeterminate metadata', () => {
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
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'root', status: 'resolved', to: '/definitions/Source' }),
      expect.objectContaining({ kind: 'inheritance', status: 'resolved', to: '/definitions/Base' }),
      expect.objectContaining({ kind: 'relation', label: 'external', status: 'external', targetPointer: '/definitions/External' }),
      expect.objectContaining({ kind: 'relation-qualifier', label: 'external qualifier', status: 'external', targetPointer: '/definitions/Qualifier' }),
      expect.objectContaining({ kind: 'reference', label: 'missing', status: 'unresolved', reason: expect.any(String) }),
      expect.objectContaining({ kind: 'reference', label: 'pending', status: 'indeterminate', reason: expect.any(String) }),
      expect.objectContaining({ kind: 'import', status: 'external', documentUri: 'https://example.org/types.json', provenance: 'importdefs' }),
      expect.objectContaining({ kind: 'import', status: 'indeterminate', provenance: 'importdefs' })
    ]));
  });
});
