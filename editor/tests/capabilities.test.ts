import { describe, expect, it } from 'vitest';
import { resolveCapabilities, resolveMetaSchemaCapabilityProfile } from '../src/capabilities.js';
import {
  AddPropertyCommand,
  AddRelationCommand,
  DeleteDefinitionCommand,
  DeleteImportCommand,
  DeletePropertyCommand,
  RenameDefinitionCommand,
  RenamePropertyCommand,
  SetIdentityCommand,
  SetImportCommand
} from '../src/commands.js';
import { parseDocument } from '../src/parser.js';
import { detectMetaSchemaMode } from '../src/phase4/meta-schema.js';
import { DocumentSession } from '../src/session.js';

const core = 'https://json-structure.org/meta/core/v0/#';
const extended = 'https://json-structure.org/meta/extended/v0/#';
const validation = 'https://json-structure.org/meta/validation/v0/#';
const semanticAnnotations = 'https://json-structure.org/meta/semantic-annotations/v0/#';
const relations = 'https://json-structure.org/meta/relations/v0/#';

describe('canonical capability profiles', () => {
  it('computes the exact transitive uses closure from canonical meta-schema headers', () => {
    const profiles: ReadonlyArray<readonly [string, readonly string[]]> = [
      [core, []],
      [extended, ['JSONStructureImport']],
      [validation, ['JSONStructureAlternateNames', 'JSONStructureConditionalComposition', 'JSONStructureImport', 'JSONStructureUnits', 'JSONStructureValidation']],
      [semanticAnnotations, ['JSONStructureConditionalComposition', 'JSONStructureImport', 'JSONStructureUnits', 'JSONStructureValidation']],
      [relations, ['JSONStructureImport']]
    ];
    for (const [schema, expected] of profiles) {
      expect([...resolveMetaSchemaCapabilityProfile({ $schema: schema }).activeUses].sort(), schema).toEqual(expected);
    }
  });

  it('layers explicit uses on supported extension meta-schemas without treating offered features as active', () => {
    expect(resolveCapabilities({ $schema: semanticAnnotations })).toMatchObject({
      validationActive: true,
      conditionalCompositionActive: true,
      unitsActive: true,
      importActive: true,
      semanticAnnotationsActive: false,
      alternateNamesActive: false
    });
    expect(resolveCapabilities({ $schema: semanticAnnotations, $uses: ['JSONStructureSemanticAnnotations', 'JSONStructureAlternateNames'] })).toMatchObject({
      semanticAnnotationsActive: true,
      alternateNamesActive: true
    });
    expect(resolveCapabilities({ $schema: relations })).toMatchObject({ importActive: true, relationsActive: false });
    expect(resolveCapabilities({ $schema: relations, $uses: ['JSONStructureRelations'] })).toMatchObject({ importActive: true, relationsActive: true });
    expect(resolveCapabilities({ $schema: core, $uses: ['JSONStructureUnits'] }).unitsActive).toBe(false);
    expect(resolveCapabilities({ $schema: relations, $uses: ['JSONStructureSemanticAnnotations'] }).semanticAnnotationsActive).toBe(false);
    expect(resolveCapabilities({ $schema: semanticAnnotations, $uses: ['JSONStructureRelations'] }).relationsActive).toBe(false);
  });

  it('inherits offered capabilities and reads authored offer-map keys', () => {
    const profile = resolveMetaSchemaCapabilityProfile({ $schema: semanticAnnotations });
    expect([...profile.offeredUses].sort()).toEqual([
      'JSONStructureAlternateNames',
      'JSONStructureConditionalComposition',
      'JSONStructureImport',
      'JSONStructureSemanticAnnotations',
      'JSONStructureUnits',
      'JSONStructureValidation'
    ]);
    expect(resolveCapabilities({
      $schema: extended,
      $offers: {
        JSONStructureRelations: '#/definitions/Relations',
        VendorCapability: '#/definitions/Vendor'
      }
    })).toMatchObject({
      offeredExtensions: ['JSONStructureRelations', 'VendorCapability'],
      unknown: []
    });
  });

  it('diagnoses malformed, duplicate, and unresolved offer targets', () => {
    const parsed = parseDocument('memory://offers', JSON.stringify({
      $schema: core,
      $id: 'https://example.test/offers',
      name: 'Offers',
      $offers: {
        Good: '#/definitions/AddIn',
        Duplicate: ['#/definitions/AddIn', '#/definitions/AddIn'],
        Missing: '#/definitions/Missing',
        Invalid: { $ref: '#/definitions/AddIn' },
        GoodUnion: '#/definitions/Union',
        Namespace: '#/definitions/Group',
        NestedMember: '#/definitions/Container/properties/value'
      },
      definitions: {
        AddIn: { type: 'string' },
        Union: { type: ['string', 'null'] },
        Group: { Nested: { type: 'string' } },
        Container: { type: 'object', properties: { value: { type: 'string' } } }
      }
    }));
    expect(parsed.diagnostics.some((item) => item.location?.pointer === '/$offers/Good')).toBe(false);
    expect(parsed.diagnostics.some((item) => item.location?.pointer === '/$offers/GoodUnion')).toBe(false);
    for (const pointer of ['/$offers/Duplicate', '/$offers/Missing', '/$offers/Invalid', '/$offers/Namespace', '/$offers/NestedMember']) {
      expect(parsed.diagnostics.some((item) => item.location?.pointer === pointer), pointer).toBe(true);
    }
  });

  it('keeps capability and Phase 4 meta-schema views in parity', () => {
    const document = {
      $schema: semanticAnnotations,
      $uses: ['JSONStructureSemanticAnnotations', 'JSONStructureAlternateNames', 'VendorCapability']
    };
    const capabilities = resolveCapabilities(document);
    const meta = detectMetaSchemaMode(document);
    expect(meta.mode).toBe('semantic-annotations');
    expect(meta.capabilities).toMatchObject({
      validation: capabilities.validationActive,
      conditionalComposition: capabilities.conditionalCompositionActive,
      units: capabilities.unitsActive,
      semanticAnnotations: capabilities.semanticAnnotationsActive,
      alternateNames: capabilities.alternateNamesActive,
      imports: capabilities.importActive,
      relations: capabilities.relationsActive,
      unknownUses: ['VendorCapability']
    });
  });

  it('keeps inactive relation and import payloads out of projections, references, and commands', () => {
    const source = JSON.stringify({
      $schema: core,
      $id: 'https://example.test/inactive.struct.json',
      name: 'Inactive',
      $importdefs: 'https://example.test/library.struct.json',
      definitions: {
        Target: { type: 'object', properties: { id: { type: 'string' } }, identity: ['id'] },
        Source: {
          type: 'object',
          properties: { id: { type: 'string' } },
          relations: { target: { targettype: { $ref: '#/definitions/Target' }, cardinality: 'single' } }
        }
      }
    });
    const parsed = parseDocument('memory://inactive-capabilities', source);
    expect(parsed.model?.projections.imports).toEqual([]);
    expect(parsed.model?.projections.references.some((reference) => reference.pointer.includes('/relations/'))).toBe(false);
    expect(parsed.model?.projections.definitions.find((definition) => definition.pointer === '/definitions/Target')?.identity).toBeUndefined();
    expect(parsed.model?.projections.definitions.find((definition) => definition.pointer === '/definitions/Source')?.relations).toEqual([]);
    expect(parsed.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'json.keyword-invalid', location: expect.objectContaining({ pointer: '/$importdefs' }) }),
      expect.objectContaining({ code: 'json.keyword-invalid', location: expect.objectContaining({ pointer: '/definitions/Target/identity' }) }),
      expect.objectContaining({ code: 'json.keyword-invalid', location: expect.objectContaining({ pointer: '/definitions/Source/relations' }) })
    ]));

    const session = new DocumentSession('memory://inactive-capabilities', source);
    const context = { session, documentVersion: 1 };
    expect(new SetIdentityCommand('/definitions/Target', ['id']).canExecute(context)).toBe(false);
    expect(new AddRelationCommand('/definitions/Source', 'other', { targetTypeRef: '#/definitions/Target', cardinality: 'single' }).canExecute(context)).toBe(false);
    expect(new SetImportCommand('', '$import', 'https://example.test/other.struct.json').canExecute(context)).toBe(false);
    expect(new DeleteImportCommand('', '$importdefs').canExecute(context)).toBe(false);
    expect(new AddPropertyCommand('/definitions/Source', 'target', { type: 'string' }).canExecute(context)).toBe(true);
    expect(new RenamePropertyCommand('/definitions/Target/properties/id', 'renamed').canExecute(context)).toBe(true);
    expect(new DeletePropertyCommand('/definitions/Target/properties/id').canExecute(context)).toBe(true);
    expect(new RenameDefinitionCommand('/definitions/Target', 'RenamedTarget').canExecute(context)).toBe(true);
    expect(new DeleteDefinitionCommand('/definitions/Target').canExecute(context)).toBe(true);
  });
});