import { describe, expect, it } from 'vitest';
import { detectMetaSchemaMode, paletteDescriptors } from '../src/phase4/meta-schema.js';
import { planAddImport, planCopyDeclarations, planExtractInlineProperty, planMaterializeDeclarations, planMoveDefinition } from '../src/phase4/refactoring.js';

describe('phase 4 refactoring plans', () => {
  it('previews import references without overwriting an existing import', () => {
    const plan = planAddImport({ definitions: { Finance: {} } }, { destinationPointer: '/definitions/Finance', source: 'https://example.test/finance.struct.json' });
    expect(plan).toMatchObject({ applicable: true, impact: [{ kind: 'add', pointer: '/definitions/Finance/$importdefs' }] });
    expect(plan.resultingDocument).toEqual({ definitions: { Finance: { $importdefs: 'https://example.test/finance.struct.json' } } });
    expect(planAddImport(plan.resultingDocument, { destinationPointer: '/definitions/Finance', source: 'other' }).applicable).toBe(false);
  });

  it('moves escaped pointers and rewrites local references without mutating the source', () => {
    const source = {
      definitions: {
        'A/B~C': { type: 'string', unknown: { keep: true } },
        Target: { type: 'object' }
      },
      type: { $ref: '#/definitions/A~1B~0C' },
      unknown: ['preserved']
    };
    const before = structuredClone(source);
    const plan = planMoveDefinition(source, {
      sourcePointer: '/definitions/A~1B~0C',
      targetNamespacePointer: '/definitions/Target',
      targetName: 'Moved/Name'
    });
    expect(plan.applicable).toBe(true);
    expect(plan.resultingDocument).toMatchObject({
      definitions: { Target: { 'Moved/Name': { unknown: { keep: true } } } },
      type: { $ref: '#/definitions/Target/Moved~1Name' },
      unknown: ['preserved']
    });
    expect(source).toEqual(before);
    expect(plan.preview.some((entry) => entry.kind === 'rewrite-reference')).toBe(true);
  });

  it('reports collisions and leaves an independent unchanged result', () => {
    const source = { definitions: { A: { type: 'string' }, B: { type: 'number' } } };
    const plan = planMoveDefinition(source, { sourcePointer: '/definitions/A', targetName: 'B' });
    expect(plan.applicable).toBe(false);
    expect(plan.collisions).toEqual([expect.objectContaining({ pointer: '/definitions/B', kind: 'target-exists' })]);
    expect(plan.resultingDocument).toEqual(source);
    expect(plan.resultingDocument).not.toBe(source);
  });

  it('extracts an inline property while preserving unknown declaration members', () => {
    const source = { definitions: { Box: { type: 'object', properties: { value: { type: 'string', vendor: 7 } } } } };
    const plan = planExtractInlineProperty(source, {
      propertyPointer: '/definitions/Box/properties/value',
      definitionName: 'Value'
    });
    expect(plan.resultingDocument).toMatchObject({
      definitions: {
        Value: { type: 'string', vendor: 7 },
        Box: { properties: { value: { type: { $ref: '#/definitions/Value' } } } }
      }
    });
  });

  it('copies selected declarations with transitive local dependencies and provenance', () => {
    const source = {
      definitions: {
        A: { type: { $ref: '#/definitions/B' } },
        B: { type: { $ref: '#/definitions/C' } },
        C: { type: 'string', extension: { keep: true } }
      }
    };
    const target = { definitions: { Local: { type: 'boolean' } } };
    const plan = planCopyDeclarations({
      sourceDocument: source,
      targetDocument: target,
      selectedPointers: ['/definitions/A']
    });
    expect(Object.keys(plan.resultingDocument.definitions as object)).toEqual(['Local', 'A', 'B', 'C']);
    expect(plan.provenance.map((entry) => [entry.sourcePointer, entry.reason])).toEqual([
      ['/definitions/A', 'selected'],
      ['/definitions/B', 'dependency'],
      ['/definitions/C', 'dependency']
    ]);
    expect(target).toEqual({ definitions: { Local: { type: 'boolean' } } });
  });

  it('includes relation target and qualifier references in the transitive copy closure', () => {
    const source = {
      definitions: {
        Order: { type: 'object', relations: { customer: { targettype: { $ref: '#/definitions/Customer' }, qualifiertype: { $ref: '#/definitions/Role' } } } },
        Customer: { type: 'object', properties: {} },
        Role: { type: 'string' }
      }
    };
    const plan = planCopyDeclarations({ sourceDocument: source, targetDocument: { definitions: {} }, selectedPointers: ['/definitions/Order'] });
    expect(Object.keys(plan.resultingDocument.definitions as object)).toEqual(['Order', 'Customer', 'Role']);
    expect(plan.provenance.map((entry) => [entry.sourcePointer, entry.reason])).toEqual([
      ['/definitions/Order', 'selected'],
      ['/definitions/Customer', 'dependency'],
      ['/definitions/Role', 'dependency']
    ]);
  });

  it('materializes a closure and removes only the selected authored import', () => {
    const source = { definitions: { A: { type: { $ref: '#/definitions/B' } }, B: { type: 'string' } } };
    const target = { definitions: { $importdefs: 'memory:common', keep: { type: 'boolean' } } };
    const plan = planMaterializeDeclarations({
      sourceDocument: source,
      targetDocument: target,
      selectedPointers: ['/definitions/A'],
      importPointer: '/definitions/$importdefs',
      importSource: 'memory:common'
    });
    expect(plan.applicable).toBe(true);
    expect(plan.resultingDocument).toEqual({ definitions: { keep: { type: 'boolean' }, A: { type: { $ref: '#/definitions/B' } }, B: { type: 'string' } } });
    expect(plan.impact).toContainEqual({ kind: 'remove', pointer: '/definitions/$importdefs', from: 'memory:common' });
  });
});

describe('phase 4 meta-schema palettes', () => {
  it('detects extended capabilities and exposes literal dollar-prefixed members', () => {
    const document = {
      $schema: 'https://json-structure.org/meta/extended/v0/#',
      $uses: ['JSONStructureImport', 'JSONStructureRelations', 'VendorCapability']
    };
    const detection = detectMetaSchemaMode(document);
    expect(detection.mode).toBe('extended');
    expect(detection.capabilities.imports).toBe(true);
    expect(detection.capabilities.validation).toBe(false);
    expect(detection.capabilities.unknownUses).toEqual(['VendorCapability']);
    const palettes = paletteDescriptors(document);
    expect(palettes.map((entry) => entry.id)).toEqual(['document', 'core', 'imports', 'relations']);
    expect(palettes.flatMap((entry) => entry.members)).toEqual(expect.arrayContaining(['$schema', '$ref', '$import', '$importdefs']));
  });

  it('detects dedicated modes and activates their implied palettes', () => {
    const detection = detectMetaSchemaMode({ $schema: 'https://json-structure.org/meta/validation/v0/#' });
    expect(detection.mode).toBe('validation');
    expect(detection.capabilities).toMatchObject({ validation: true, conditionalComposition: true, units: true, alternateNames: true });
    expect(paletteDescriptors({ $schema: 'https://json-structure.org/meta/core/v0/#' }).map((entry) => entry.id)).toEqual(['document', 'core']);
  });
});