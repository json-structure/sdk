import { describe, expect, it } from 'vitest';
import { resolveEffectiveMembers } from '../src/phase4/effective-members.js';

describe('Phase 4 effective members', () => {
  it('resolves inheritance chains with provenance and required propagation', () => {
    const document = {
      definitions: {
        Entity: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        Node: { type: 'object', $extends: '#/definitions/Entity', properties: { label: { type: 'string' } }, required: ['label'] },
        Place: { type: 'object', $extends: '#/definitions/Node', properties: { country: { type: 'string' } } }
      }
    };

    const result = resolveEffectiveMembers(document, '#/definitions/Place');

    expect(result.status).toBe('resolved');
    expect(result.required).toEqual(['id', 'label']);
    expect(result.members.map((member) => [member.name, member.provenance, member.inheritedVia])).toEqual([
      ['id', 'inherited', ['/definitions/Node', '/definitions/Entity']],
      ['label', 'inherited', ['/definitions/Node']],
      ['country', 'local', []]
    ]);
  });

  it('uses first-base precedence and reports base and local conflicts', () => {
    const document = {
      definitions: {
        Left: { type: 'object', properties: { shared: { type: 'string' }, left: { type: 'boolean' } }, required: ['shared'] },
        Right: { type: 'object', properties: { shared: { type: 'int32' }, right: { type: 'boolean' } }, required: ['right'] },
        Joint: {
          type: 'object',
          $extends: ['#/definitions/Left', '#/definitions/Right'],
          properties: { shared: { type: 'number' }, local: { type: 'string' } }
        }
      }
    };

    const result = resolveEffectiveMembers(document, '#/definitions/Joint');

    expect(result.members.find((member) => member.name === 'shared')?.schema).toEqual({ type: 'number' });
    expect(result.members.map((member) => member.name)).toEqual(['shared', 'left', 'right', 'local']);
    expect(result.required).toEqual(['shared', 'right']);
    expect(result.conflicts).toEqual([
      {
        name: 'shared',
        winner: '/definitions/Left/properties/shared',
        loser: '/definitions/Right/properties/shared',
        reason: 'base-precedence'
      },
      {
        name: 'shared',
        winner: '/definitions/Joint/properties/shared',
        loser: '/definitions/Left/properties/shared',
        reason: 'local-redefinition'
      }
    ]);
  });

  it('does not report a diamond path to the same declaration as a conflict', () => {
    const document = {
      definitions: {
        Base: { type: 'object', properties: { id: { type: 'string' } } },
        Left: { type: 'object', $extends: '#/definitions/Base' },
        Right: { type: 'object', $extends: '#/definitions/Base' },
        Joint: { type: 'object', $extends: ['#/definitions/Left', '#/definitions/Right'] }
      }
    };

    const result = resolveEffectiveMembers(document, '#/definitions/Joint');

    expect(result.conflicts).toEqual([]);
    expect(result.members).toHaveLength(1);
    expect(result.members[0]?.inheritedVia).toEqual(['/definitions/Left', '/definitions/Base']);
  });

  it('marks cycles and missing local targets indeterminate', () => {
    const document = {
      definitions: {
        A: { type: 'object', $extends: '#/definitions/B', properties: { a: { type: 'string' } } },
        B: { type: 'object', $extends: '#/definitions/A', properties: { b: { type: 'string' } } },
        MissingBase: { type: 'object', $extends: '#/definitions/Absent', properties: { own: { type: 'string' } } }
      }
    };

    const cycle = resolveEffectiveMembers(document, '#/definitions/A');
    const missing = resolveEffectiveMembers(document, '#/definitions/MissingBase');

    expect(cycle.status).toBe('indeterminate');
    expect(cycle.diagnostics).toEqual([expect.objectContaining({ code: 'effective-members.cycle' })]);
    expect(cycle.members.map((member) => member.name)).toEqual(['b', 'a']);
    expect(missing.status).toBe('indeterminate');
    expect(missing.diagnostics).toEqual([expect.objectContaining({ code: 'effective-members.target-missing', pointer: '/definitions/Absent' })]);
    expect(missing.members.map((member) => member.name)).toEqual(['own']);
  });

  it('merges tuple members and order across inheritance', () => {
    const document = {
      definitions: {
        Pair: {
          type: 'tuple',
          properties: { x: { type: 'number' }, y: { type: 'number' } },
          tuple: ['x', 'y'],
          required: ['x']
        },
        Point3D: {
          type: 'tuple',
          $extends: '#/definitions/Pair',
          properties: { z: { type: 'number' } },
          tuple: ['z'],
          required: ['z']
        }
      }
    };

    const result = resolveEffectiveMembers(document, '#/definitions/Point3D');

    expect(result.tuple).toEqual(['x', 'y', 'z']);
    expect(result.required).toEqual(['x', 'z']);
    expect(result.members.map((member) => [member.name, member.required])).toEqual([
      ['x', true],
      ['y', false],
      ['z', true]
    ]);
  });

  it('activates offered add-ins and preserves their provenance', () => {
    const document = {
      $offers: { Audited: '#/definitions/Audited' },
      definitions: {
        Document: { type: 'object', properties: { title: { type: 'string' } } },
        Audited: { abstract: true, type: 'object', $extends: '#/definitions/Document', properties: { createdBy: { type: 'string' } }, required: ['createdBy'] }
      }
    };

    const result = resolveEffectiveMembers(document, '#/definitions/Document', { addIns: ['Audited'] });

    expect(result.status).toBe('resolved');
    expect(result.members.map((member) => [member.name, member.provenance, member.addIn, member.required])).toEqual([
      ['title', 'local', undefined, false],
      ['createdBy', 'add-in', 'Audited', true]
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('resolves inherited members through imported namespaces with source provenance', () => {
    const external = {
      $id: 'https://example.test/base.struct.json',
      definitions: {
        Entity: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        Audited: { type: 'object', $extends: '#/definitions/Entity', properties: { updatedAt: { type: 'datetime' } } }
      }
    };
    const document = {
      definitions: {
        shared: { $importdefs: 'https://example.test/base.struct.json' },
        Local: { type: 'object', $extends: '#/definitions/shared/Audited', properties: { name: { type: 'string' } } }
      }
    };

    const result = resolveEffectiveMembers(document, '#/definitions/Local', {
      documentUri: 'https://example.test/root.struct.json',
      resolvedDocuments: [{ uri: 'https://example.test/base.struct.json', document: external }]
    });

    expect(result.status).toBe('resolved');
    expect(result.members.map((member) => member.name)).toEqual(['id', 'updatedAt', 'name']);
    expect(result.members[0]).toMatchObject({
      provenance: 'inherited',
      documentUri: 'https://example.test/base.struct.json',
      sourcePointer: '/definitions/Entity/properties/id',
      inheritedVia: ['/definitions/shared/Audited', '/definitions/shared/Entity']
    });
    expect(result.members[0]?.imports).toEqual([expect.objectContaining({ keyword: '$importdefs', importPointer: '/definitions/shared/$importdefs' })]);
  });

  it('keeps the existing member when an add-in conflicts and reports the loser', () => {
    const document = {
      $offers: { Collision: '#/definitions/Collision' },
      definitions: {
        Target: { type: 'object', properties: { value: { type: 'string' } } },
        Collision: { abstract: true, type: 'object', $extends: '#/definitions/Target', properties: { value: { type: 'number' } } }
      }
    };

    const result = resolveEffectiveMembers(document, '#/definitions/Target', { addIns: ['Collision'] });

    expect(result.members.find((member) => member.name === 'value')?.schema).toEqual({ type: 'string' });
    expect(result.conflicts).toEqual([expect.objectContaining({ name: 'value', reason: 'addin-conflict' })]);
  });
});