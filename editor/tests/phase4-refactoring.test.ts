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

  it('accepts imports only at structural namespace positions with one valid import form', () => {
    const document = {
      definitions: {
        Namespace: { Nested: {} },
        Typed: { type: 'object', properties: { nested: {} } },
        Imported: { $import: 'memory:existing' },
      },
    };
    expect(planAddImport(document, { destinationPointer: '', source: 'memory:root', keyword: '$import' }).applicable).toBe(true);
    expect(planAddImport(document, { destinationPointer: '/definitions', source: 'memory:definitions' }).applicable).toBe(true);
    expect(planAddImport(document, { destinationPointer: '/definitions/Namespace/Nested', source: 'memory:nested' }).applicable).toBe(true);
    expect(planAddImport(document, { destinationPointer: '/definitions/Typed', source: 'memory:typed' }).applicable).toBe(false);
    expect(planAddImport(document, { destinationPointer: '/definitions/Typed/properties', source: 'memory:properties' }).applicable).toBe(false);
    expect(planAddImport(document, { destinationPointer: '/definitions/Imported', source: 'memory:duplicate', keyword: '$importdefs' }).applicable).toBe(false);
    expect(planAddImport(document, { destinationPointer: '/definitions/Namespace', source: 'relative/path' }).applicable).toBe(true);
    expect(planAddImport(document, { destinationPointer: '/definitions/Namespace', source: 'C:\\schemas\\types.json' }).applicable).toBe(false);
    expect(planAddImport(document, { destinationPointer: '/definitions/Namespace', source: '   ' }).applicable).toBe(false);
    expect(planAddImport(document, { destinationPointer: '/definitions/Namespace', source: ' memory:source' }).applicable).toBe(false);
    expect(planAddImport(document, {
      destinationPointer: '/definitions/Namespace',
      source: 'memory:source',
      keyword: '$invalid' as '$importdefs',
    }).applicable).toBe(false);
  });

  it('moves escaped pointers and rewrites local references without mutating the source', () => {
    const source = {
      definitions: {
        'A/B~C': { type: 'string', unknown: { keep: true } },
        Target: {}
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

  it('rewrites moved references only in active schema-owned positions', () => {
    const source = {
      $schema: 'https://json-structure.org/meta/core/v0/#',
      $offers: { Single: '#/definitions/A', Bundle: ['#/definitions/A'] },
      definitions: {
        A: { type: 'string' },
        Use: {
          type: 'object',
          properties: { active: { type: { $ref: '#/definitions/A' } } },
          contains: { type: { $ref: '#/definitions/A' } },
          oneOf: [{ type: { $ref: '#/definitions/A' } }],
          relations: { owner: { targettype: { $ref: '#/definitions/A' } } },
        },
      },
    };
    const plan = planMoveDefinition(source, { sourcePointer: '/definitions/A', targetName: 'Moved' });
    expect(plan.resultingDocument).toMatchObject({
      $offers: { Single: '#/definitions/Moved', Bundle: ['#/definitions/Moved'] },
      definitions: {
        Use: {
          properties: { active: { type: { $ref: '#/definitions/Moved' } } },
          contains: { type: { $ref: '#/definitions/A' } },
          oneOf: [{ type: { $ref: '#/definitions/A' } }],
          relations: { owner: { targettype: { $ref: '#/definitions/A' } } },
        },
      },
    });
  });

  it('reports collisions and leaves an independent unchanged result', () => {
    const source = { definitions: { A: { type: 'string' }, B: { type: 'number' } } };
    const plan = planMoveDefinition(source, { sourcePointer: '/definitions/A', targetName: 'B' });
    expect(plan.applicable).toBe(false);
    expect(plan.collisions).toEqual([expect.objectContaining({ pointer: '/definitions/B', kind: 'target-exists' })]);
    expect(plan.resultingDocument).toEqual(source);
    expect(plan.resultingDocument).not.toBe(source);
  });

  it('accepts only reusable move sources and structural namespace targets', () => {
    const source = {
      definitions: {
        'Group/A~B': {
          Item: { type: 'string' },
          Nested: {},
        },
        Typed: { type: 'object', properties: { value: { type: 'string' } } },
      },
    };

    const valid = planMoveDefinition(source, {
      sourcePointer: '/definitions/Group~1A~0B/Item',
      targetNamespacePointer: '/definitions/Group~1A~0B/Nested',
      targetName: 'Moved/Item',
    });
    expect(valid).toMatchObject({ applicable: true, collisions: [] });
    expect(valid.resultingDocument).toMatchObject({
      definitions: { 'Group/A~B': { Nested: { 'Moved/Item': { type: 'string' } } } },
    });

    for (const options of [
      { sourcePointer: '', targetNamespacePointer: '/definitions', targetName: 'Root' },
      { sourcePointer: '/definitions', targetNamespacePointer: '/definitions/Group~1A~0B/Nested', targetName: 'Definitions' },
      { sourcePointer: '/definitions/Group~1A~0B', targetNamespacePointer: '/definitions', targetName: 'Group' },
      { sourcePointer: '/definitions/Typed/properties/value', targetNamespacePointer: '/definitions', targetName: 'Value' },
      { sourcePointer: '/definitions/Typed', targetNamespacePointer: '', targetName: 'AtRoot' },
      { sourcePointer: '/definitions/Typed', targetNamespacePointer: '/definitions/Typed', targetName: 'Child' },
      { sourcePointer: '/definitions/Typed', targetNamespacePointer: '/definitions/Typed/properties', targetName: 'Child' },
    ]) {
      expect(() => planMoveDefinition(source, options)).not.toThrow();
      expect(planMoveDefinition(source, options)).toMatchObject({
        applicable: false,
        collisions: [expect.objectContaining({ kind: expect.stringMatching(/invalid-(pointer|selection)/) })],
      });
    }
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

  it('keeps literal and annotation payloads opaque while rewriting structural references', () => {
    const source = {
      $schema: 'https://json-structure.org/meta/extended/v0/#',
      $uses: ['JSONStructureValidation', 'JSONStructureConditionalComposition'],
      definitions: {
        A: {
          type: 'object',
          properties: { child: { type: { $ref: '#/definitions/B' } } },
          additionalProperties: { type: { $ref: '#/definitions/Additional' } },
          contains: { type: { $ref: '#/definitions/C' } },
          anyOf: [{ type: { $ref: '#/definitions/D' } }],
          default: { $ref: '#/definitions/B' },
          examples: [{ $ref: '#/definitions/OpaqueExample' }],
          annotations: { $ref: '#/definitions/OpaqueAnnotation' },
        },
        B: { type: { $ref: '#/definitions/E' } },
        Additional: { type: 'string' },
        C: { type: 'string' },
        D: { type: 'string' },
        E: { type: 'string' },
        OpaqueExample: { type: 'string' },
        OpaqueAnnotation: { type: 'string' },
      },
    };
    const plan = planCopyDeclarations({
      sourceDocument: source,
      targetDocument: { definitions: { Local: {} } },
      selectedPointers: ['/definitions/A'],
      targetNamespacePointer: '/definitions/Local',
    });

    expect(plan.applicable).toBe(true);
    expect(plan.provenance.map((entry) => entry.sourcePointer)).toEqual([
      '/definitions/A',
      '/definitions/B',
      '/definitions/Additional',
      '/definitions/C',
      '/definitions/D',
      '/definitions/E',
    ]);
    expect((plan.resultingDocument.definitions as Record<string, unknown>).Local).toMatchObject({
      A: {
        properties: { child: { type: { $ref: '#/definitions/Local/B' } } },
        additionalProperties: { type: { $ref: '#/definitions/Local/Additional' } },
        contains: { type: { $ref: '#/definitions/Local/C' } },
        anyOf: [{ type: { $ref: '#/definitions/Local/D' } }],
        default: { $ref: '#/definitions/B' },
        examples: [{ $ref: '#/definitions/OpaqueExample' }],
        annotations: { $ref: '#/definitions/OpaqueAnnotation' },
      },
    });
  });

  it('treats inactive extension members as opaque while retaining Core dependencies', () => {
    const source = {
      $schema: 'https://json-structure.org/meta/core/v0/#',
      definitions: {
        A: {
          type: 'object',
          properties: { active: { type: { $ref: '#/definitions/B' } } },
          contains: { type: { $ref: '#/definitions/ValidationPayload' } },
          oneOf: [{ type: { $ref: '#/definitions/CompositionPayload' } }],
          relations: { owner: { targettype: { $ref: '#/definitions/RelationPayload' } } },
        },
        B: { type: 'string' },
        ValidationPayload: { type: 'string' },
        CompositionPayload: { type: 'string' },
        RelationPayload: { type: 'string' },
      },
    };
    const plan = planCopyDeclarations({
      sourceDocument: source,
      targetDocument: { definitions: { Local: {} } },
      selectedPointers: ['/definitions/A'],
      targetNamespacePointer: '/definitions/Local',
    });
    expect(plan.provenance.map((entry) => entry.sourcePointer)).toEqual(['/definitions/A', '/definitions/B']);
    expect((plan.resultingDocument.definitions as Record<string, unknown>).Local).toMatchObject({
      A: {
        properties: { active: { type: { $ref: '#/definitions/Local/B' } } },
        contains: { type: { $ref: '#/definitions/ValidationPayload' } },
        oneOf: [{ type: { $ref: '#/definitions/CompositionPayload' } }],
        relations: { owner: { targettype: { $ref: '#/definitions/RelationPayload' } } },
      },
    });
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

  it('rejects copying over a declaration in a distinct target document', () => {
    const plan = planCopyDeclarations({
      sourceDocument: { definitions: { A: { type: 'string' } } },
      targetDocument: { definitions: { A: { type: 'number' } } },
      selectedPointers: ['/definitions/A'],
    });
    expect(plan).toMatchObject({
      applicable: false,
      collisions: [expect.objectContaining({ kind: 'target-exists', pointer: '/definitions/A' })],
    });
  });

  it('rejects selected declarations that map to the same destination name', () => {
    const plan = planCopyDeclarations({
      sourceDocument: {
        definitions: {
          One: { Shared: { type: 'string' } },
          Two: { Shared: { type: 'number' } },
        },
      },
      targetDocument: { definitions: {} },
      selectedPointers: ['/definitions/One/Shared', '/definitions/Two/Shared'],
    });
    expect(plan).toMatchObject({
      applicable: false,
      collisions: [expect.objectContaining({ kind: 'target-exists', pointer: '/definitions/Shared' })],
    });
  });

  it('does not emit an add for an identical same-document copy', () => {
    const document = {
      definitions: {
        Group: { A: { type: { $ref: '#/definitions/B' } } },
        B: { type: 'string' },
      },
    };
    const plan = planCopyDeclarations({
      sourceDocument: document,
      targetDocument: document,
      selectedPointers: ['/definitions/Group/A'],
      targetNamespacePointer: '/definitions/Group',
    });

    expect(plan).toMatchObject({
      applicable: true,
      impact: [],
      provenance: [],
      referenceRewrites: {},
    });
    expect(plan.resultingDocument).toEqual(document);
    expect(plan.resultingDocument).not.toBe(document);
  });

  it('copies only reusable declarations into structural namespaces', () => {
    const source = {
      definitions: {
        'Group/A~B': {
          Item: { type: 'string' },
          Nested: {},
        },
        Typed: { type: 'object', properties: { value: { type: 'string' } } },
      },
    };
    const target = {
      definitions: {
        'Target/A~B': { Nested: {} },
        Typed: { type: 'object', properties: {} },
      },
    };

    const valid = planCopyDeclarations({
      sourceDocument: source,
      targetDocument: target,
      selectedPointers: ['/definitions/Group~1A~0B/Item'],
      targetNamespacePointer: '/definitions/Target~1A~0B/Nested',
    });
    expect(valid).toMatchObject({ applicable: true, collisions: [] });
    expect(valid.resultingDocument).toMatchObject({
      definitions: { 'Target/A~B': { Nested: { Item: { type: 'string' } } } },
    });

    for (const selectedPointer of ['', '/definitions', '/definitions/Group~1A~0B', '/definitions/Typed/properties/value']) {
      expect(planCopyDeclarations({
        sourceDocument: source,
        targetDocument: target,
        selectedPointers: [selectedPointer],
      })).toMatchObject({
        applicable: false,
        collisions: [expect.objectContaining({ kind: 'invalid-selection', pointer: selectedPointer })],
      });
    }

    for (const targetNamespacePointer of ['', '/definitions/Typed', '/definitions/Typed/properties']) {
      expect(() => planCopyDeclarations({
        sourceDocument: source,
        targetDocument: target,
        selectedPointers: ['/definitions/Group~1A~0B/Item'],
        targetNamespacePointer,
      })).not.toThrow();
      expect(planCopyDeclarations({
        sourceDocument: source,
        targetDocument: target,
        selectedPointers: ['/definitions/Group~1A~0B/Item'],
        targetNamespacePointer,
      })).toMatchObject({
        applicable: false,
        collisions: [expect.objectContaining({ kind: 'invalid-pointer', pointer: targetNamespacePointer })],
      });
    }
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

  it('rejects empty or partial materialization that would strand imported references', () => {
    const source = { definitions: { A: { type: 'string' }, B: { type: 'string' } } };
    const target = {
      definitions: {
        $importdefs: 'memory:common',
        UsesB: { type: 'object', properties: { value: { type: { $ref: '#/definitions/B' } } } },
      },
    };
    const base = {
      sourceDocument: source,
      targetDocument: target,
      importPointer: '/definitions/$importdefs',
      importSource: 'memory:common',
    };
    const empty = planMaterializeDeclarations({ ...base, selectedPointers: [] });
    expect(empty).toMatchObject({ applicable: false, collisions: [expect.objectContaining({ kind: 'invalid-selection' })] });

    const partial = planMaterializeDeclarations({ ...base, selectedPointers: ['/definitions/A'] });
    expect(partial).toMatchObject({
      applicable: false,
      collisions: [expect.objectContaining({ kind: 'invalid-selection', pointer: '/definitions/B' })],
    });
    expect(partial.collisions[0]?.message).toMatch(/uncopied/i);

    const opaque = planMaterializeDeclarations({
      ...base,
      targetDocument: {
        definitions: {
          $importdefs: 'memory:common',
          Literal: { type: 'jsonpointer', default: { $ref: '#/definitions/B' } },
        },
      },
      selectedPointers: ['/definitions/A'],
    });
    expect(opaque.applicable).toBe(true);

    const nestedTarget = {
      definitions: {
        Shared: {
          $importdefs: 'memory:common',
          UsesB: { type: 'object', properties: { value: { type: { $ref: '#/definitions/Shared/B' } } } },
        },
      },
    };
    const nestedBase = {
      sourceDocument: source,
      targetDocument: nestedTarget,
      targetNamespacePointer: '/definitions/Shared',
      importPointer: '/definitions/Shared/$importdefs',
      importSource: 'memory:common',
    };
    const nestedPartial = planMaterializeDeclarations({ ...nestedBase, selectedPointers: ['/definitions/A'] });
    expect(nestedPartial).toMatchObject({
      applicable: false,
      collisions: [expect.objectContaining({ kind: 'invalid-selection', pointer: '/definitions/Shared/B' })],
    });
    expect(planMaterializeDeclarations({ ...nestedBase, selectedPointers: ['/definitions/B'] }).applicable).toBe(true);

    const transitive = planMaterializeDeclarations({
      ...base,
      sourceDocument: { definitions: { $importdefs: 'memory:base', A: { type: 'string' } } },
      selectedPointers: ['/definitions/A'],
    });
    expect(transitive).toMatchObject({
      applicable: false,
      collisions: [expect.objectContaining({ kind: 'invalid-selection', pointer: '/definitions/B' })],
    });

    const shadowed = planMaterializeDeclarations({
      ...base,
      targetDocument: {
        definitions: {
          $importdefs: 'memory:common',
          B: { type: 'string' },
          UsesB: { type: 'object', properties: { value: { type: { $ref: '#/definitions/B' } } } },
        },
      },
      selectedPointers: ['/definitions/A'],
    });
    expect(shadowed.applicable).toBe(true);

    const extendsOnly = planMaterializeDeclarations({
      ...base,
      targetDocument: {
        definitions: {
          $importdefs: 'memory:common',
          Derived: { $extends: '#/definitions/B' },
        },
      },
      selectedPointers: ['/definitions/A'],
    });
    expect(extendsOnly).toMatchObject({
      applicable: false,
      collisions: [expect.objectContaining({ kind: 'invalid-selection', pointer: '/definitions/B' })],
    });

    const offered = planMaterializeDeclarations({
      ...base,
      targetDocument: {
        $offers: { Single: '#/definitions/B', Bundle: ['#/definitions/B'] },
        definitions: { $importdefs: 'memory:common' },
      },
      selectedPointers: ['/definitions/A'],
    });
    expect(offered).toMatchObject({
      applicable: false,
      collisions: [expect.objectContaining({ kind: 'invalid-selection', pointer: '/definitions/B' })],
    });
  });
});

describe('phase 4 meta-schema palettes', () => {
  it('detects extended capabilities and exposes literal dollar-prefixed members', () => {
    const document = {
      $schema: 'https://json-structure.org/meta/relations/v0/#',
      $uses: ['JSONStructureImport', 'JSONStructureRelations', 'VendorCapability']
    };
    const detection = detectMetaSchemaMode(document);
    expect(detection.mode).toBe('relations');
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