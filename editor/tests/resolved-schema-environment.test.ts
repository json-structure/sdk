import { describe, expect, it } from 'vitest';
import { resourceSnapshot } from '../src/external-documents.js';
import { loadExternalDocuments } from '../src/external-documents.js';
import {
  AddPropertyCommand,
  AddRelationCommand,
  RemoveIdentityCommand,
  SetAllOfCommand,
  SetCoordinateReferenceSystemCommand,
  SetCoreMemberCommand,
  SetRelationQualifierCommand,
  SetRootCommand,
  SetSemanticRoleCommand,
  SetTypeReferenceCommand,
  SetValidationKeywordCommand
} from '../src/commands.js';
import { resolveEffectiveMembers } from '../src/phase4/effective-members.js';
import { ResolvedSchemaContext } from '../src/phase4/resolved-schema.js';
import { DocumentSession } from '../src/session.js';

describe('resolved schema environment', () => {
  it('ignores import-shaped literal values inside schema declarations', () => {
    const externalUri = 'https://example.test/shared.struct.json';
    const context = new ResolvedSchemaContext({
      $schema: 'https://json-structure.org/meta/extended/v0/#',
      definitions: {
        shared: { $importdefs: externalUri },
        Local: { type: 'string', default: { $import: 'https://example.test/not-an-import.struct.json' } }
      }
    }, {
      documentUri: 'https://example.test/root.struct.json',
      resolvedDocuments: [{
        uri: externalUri,
        document: {
          $schema: 'https://json-structure.org/meta/core/v0/#',
          definitions: { Shared: { type: 'string' } }
        }
      }]
    });
    expect(context.indeterminate).toBe(false);
    expect(context.resolve('#/definitions/shared/Shared')?.documentUri).toBe(externalUri);
  });

  it('retains parsed external schema values for effective and instance evaluators', async () => {
    const externalUri = 'https://example.test/shared.struct.json';
    const external = JSON.stringify({
      $schema: 'https://json-structure.org/meta/core/v0/#',
      $id: externalUri,
      name: 'SharedTypes',
      definitions: { Entity: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
    });
    const documents = await loadExternalDocuments('https://example.test/root.struct.json', [externalUri], async (uri) => resourceSnapshot('read', uri, external));
    const session = new DocumentSession('https://example.test/root.struct.json', JSON.stringify({
      $schema: 'https://json-structure.org/meta/extended/v0/#',
      definitions: {
        shared: { $importdefs: externalUri },
        Local: { type: 'object', $extends: '#/definitions/shared/Entity', properties: { name: { type: 'string' } } },
      },
    }));
    session.setExternalDocuments(documents);

    expect(session.resolvedSchemaDocuments).toEqual([{ uri: externalUri, document: JSON.parse(external) }]);
    expect(session.effectiveDeclarations.map((declaration) => [declaration.effectivePointer, declaration.documentUri, declaration.sourcePointer])).toEqual([
      ['/definitions/Local', 'https://example.test/root.struct.json', '/definitions/Local'],
      ['/definitions/shared/Entity', externalUri, '/definitions/Entity'],
    ]);
    expect(resolveEffectiveMembers(session.value as Record<string, unknown>, '#/definitions/Local', {
      documentUri: session.uri,
      resolvedDocuments: session.resolvedSchemaDocuments,
    }).members.map((member) => member.name)).toEqual(['id', 'name']);
    expect(new SetTypeReferenceCommand('/definitions/Local/properties/name', '#/definitions/shared/Entity').canExecute({ session, documentVersion: 1 })).toBe(true);
  });

  it('uses one unambiguous effective declaration rule across reference authoring commands', async () => {
    const externalUri = 'https://example.test/reference-library.struct.json';
    const external = JSON.stringify({
      $schema: 'https://json-structure.org/meta/relations/v0/#',
      $id: externalUri,
      name: 'ReferenceLibrary',
      $uses: ['JSONStructureRelations'],
      definitions: {
        Entity: { type: 'object', properties: { id: { type: 'string' } }, identity: ['id'] },
        AbstractEntity: { type: 'object', abstract: true, properties: { id: { type: 'string' } } },
        Qualifier: { type: 'string' },
        PositionBase: { type: 'object', abstract: true, properties: { latitude: { type: 'number' } } }
      }
    });
    const documents = await loadExternalDocuments('https://example.test/root.struct.json', [externalUri], async (uri) => resourceSnapshot('read', uri, external));
    const session = new DocumentSession('https://example.test/root.struct.json', JSON.stringify({
      $schema: 'https://json-structure.org/meta/semantic-annotations/v0/#',
      $uses: ['JSONStructureSemanticAnnotations'],
      definitions: {
        shared: { $importdefs: externalUri },
        Local: { type: 'object', properties: { name: { type: 'string' }, alias: { type: { $ref: '#/definitions/shared/Qualifier' } } } },
        Position: { type: 'object', $extends: '#/definitions/shared/PositionBase', properties: { longitude: { type: 'number' } } },
        Choice: { type: 'choice', choices: { reading: { type: 'number', semanticRole: 'observationValue' } } }
      }
    }));
    session.setExternalDocuments(documents);
    const context = { session, documentVersion: 1 };

    expect(new SetTypeReferenceCommand('/definitions/Local/properties/name', '#/definitions/shared/Qualifier').canExecute(context)).toBe(true);
    expect(new SetValidationKeywordCommand('/definitions/Local/properties/alias', 'maxLength', 16).canExecute(context)).toBe(true);
    expect(new SetCoreMemberCommand('/definitions/Local', '$extends', '#/definitions/shared/AbstractEntity').canExecute(context)).toBe(true);
    expect(new AddPropertyCommand('/definitions/Local', 'entity', { type: { $ref: '#/definitions/shared/Entity' } }).canExecute(context)).toBe(true);
    const relationSession = new DocumentSession('https://example.test/relation-root.struct.json', JSON.stringify({
      $schema: 'https://json-structure.org/meta/relations/v0/#',
      $id: 'https://example.test/relation-root.struct.json',
      name: 'RelationRoot',
      $uses: ['JSONStructureRelations'],
      definitions: {
        shared: { $importdefs: externalUri },
        Source: {
          type: 'object',
          properties: { id: { type: 'string' } },
          relations: { entity: { targettype: { $ref: '#/definitions/shared/Entity' }, cardinality: 'single' } }
        }
      }
    }));
    relationSession.setExternalDocuments(documents);
    const relationContext = { session: relationSession, documentVersion: 1 };
    expect(new AddRelationCommand('/definitions/Source', 'other', {
      targetTypeRef: '#/definitions/shared/Entity',
      cardinality: 'single',
      qualifierTypeRef: '#/definitions/shared/Qualifier'
    }).canExecute(relationContext)).toBe(true);
    expect(new SetRelationQualifierCommand('/definitions/Source/relations/entity', '#/definitions/shared/Qualifier').canExecute(relationContext)).toBe(true);
    expect(new SetRootCommand('/definitions/shared/Entity').canExecute(context)).toBe(true);
    expect(new SetAllOfCommand('/definitions/Local/properties/name', [{ $ref: '#/definitions/shared/Qualifier' }]).canExecute(context)).toBe(true);
    expect(new SetCoordinateReferenceSystemCommand('/definitions/Position', {
      reference: 'https://www.opengis.net/def/crs/EPSG/0/4326',
      kind: 'epsg',
      coordinates: ['latitude', 'longitude']
    }).canExecute(context)).toBe(true);
    expect(new SetCoordinateReferenceSystemCommand('/definitions/Position', {
      reference: 'https://www.opengis.net/def/crs/EPSG/0/4326',
      kind: 'epsg',
      coordinates: ['latitude', 'missing']
    }).canExecute(context)).toBe(false);
    expect(session.model?.projections.semanticPlacements.some((placement) => placement.pointer === '/definitions/Choice/choices/reading')).toBe(true);
    expect(new SetSemanticRoleCommand('/definitions/Choice/choices/reading', 'resultQuality').canExecute(context)).toBe(true);

    for (const reference of ['#/definitions/shared/Missing', '#/definitions/shared/AbstractEntity']) {
      expect(new SetTypeReferenceCommand('/definitions/Local/properties/name', reference).canExecute(context), reference).toBe(false);
    }
  });

  it('uses effective inherited identities, namespaces, and subtype collection scopes in relation commands', () => {
    const externalUri = 'https://example.test/effective-relations.struct.json';
    const external = {
      $schema: 'https://json-structure.org/meta/relations/v0/#',
      $id: externalUri,
      name: 'EffectiveRelations',
      $uses: ['JSONStructureRelations'],
      definitions: {
        Entity: { type: 'object', abstract: true, properties: { id: { type: 'string' } }, identity: ['id'] },
        DirectTarget: { type: 'object', properties: { id: { type: 'string' } }, identity: ['id'] },
        CollectionBase: {
          type: 'object',
          abstract: true,
          properties: { agents: { type: { $ref: '#/definitions/AgentCollection' } }, inheritedProperty: { type: 'string' } },
          relations: { inheritedRelation: { targettype: { $ref: '#/definitions/DirectTarget' }, cardinality: 'single' } }
        },
        AgentCollection: { type: 'array', items: { type: { $ref: '#/definitions/Agent' } } },
        Agent: { type: 'object', $extends: '#/definitions/Entity', properties: { name: { type: 'string' } } }
      }
    };
    const session = new DocumentSession('https://example.test/effective-relations-root.struct.json', JSON.stringify({
      $schema: 'https://json-structure.org/meta/relations/v0/#',
      $id: 'https://example.test/effective-relations-root.struct.json',
      name: 'EffectiveRelationsRoot',
      $uses: ['JSONStructureRelations'],
      definitions: {
        shared: { $importdefs: externalUri },
        AgentAlias: { type: { $ref: '#/definitions/shared/Agent' } },
        Department: { type: 'object', $extends: '#/definitions/shared/CollectionBase', properties: { local: { type: 'string' } } },
        Source: { type: 'object', $extends: '#/definitions/shared/CollectionBase', properties: { local: { type: 'string' } } }
      }
    }));
    session.setExternalDocuments([{ uri: externalUri, value: external, availability: 'available' }]);
    const context = { session, documentVersion: 1 };
    const scoped = { targetTypeRef: '#/definitions/AgentAlias', cardinality: 'single' as const, scope: '#/definitions/Department/properties/agents' };

    expect(new AddRelationCommand('/definitions/Source', 'agent', scoped).canExecute(context)).toBe(true);
    expect(new AddRelationCommand('/definitions/Source', 'inheritedProperty', scoped).canExecute(context)).toBe(false);
    expect(new AddRelationCommand('/definitions/Source', 'inheritedRelation', scoped).canExecute(context)).toBe(false);
    expect(new AddPropertyCommand('/definitions/Source', 'inheritedRelation', { type: 'string' }).canExecute(context)).toBe(false);
  });

  it('protects identities targeted through subtype and alias chains', () => {
    const session = new DocumentSession('memory://effective-identity-dependency', JSON.stringify({
      $schema: 'https://json-structure.org/meta/relations/v0/#',
      $id: 'https://example.test/effective-identity-dependency.struct.json',
      name: 'EffectiveIdentityDependency',
      $uses: ['JSONStructureRelations'],
      definitions: {
        Entity: { type: 'object', abstract: true, properties: { id: { type: 'string' } }, identity: ['id'] },
        Agent: { type: 'object', $extends: '#/definitions/Entity', properties: { name: { type: 'string' } } },
        AgentAlias: { type: { $ref: '#/definitions/Agent' } },
        AgentCollection: { type: 'array', items: { type: { $ref: '#/definitions/Agent' } } },
        AgentCollectionAlias: { type: { $ref: '#/definitions/AgentCollection' } },
        Department: { type: 'object', properties: { agents: { type: { $ref: '#/definitions/AgentCollectionAlias' } } } },
        Unused: { type: 'object', properties: { id: { type: 'string' } }, identity: ['id'] },
        Source: {
          type: 'object',
          properties: { local: { type: 'string' } },
          relations: {
            direct: { targettype: { $ref: '#/definitions/Agent' }, cardinality: 'single' },
            alias: {
              targettype: { $ref: '#/definitions/AgentAlias' },
              cardinality: 'single',
              scope: '#/definitions/Department/properties/agents'
            }
          }
        }
      }
    }));
    const context = { session, documentVersion: 1 };
    expect(session.diagnostics.some((diagnostic) => diagnostic.location?.pointer?.includes('/relations/') &&
      (diagnostic.message.includes('identity') || diagnostic.message.includes('scope')))).toBe(false);
    expect(new RemoveIdentityCommand('/definitions/Entity').canExecute(context)).toBe(false);
    expect(new RemoveIdentityCommand('/definitions/Unused').canExecute(context)).toBe(true);
  });

  it('diagnoses inherited relation collisions and incompatible scopes after resolution', () => {
    const externalUri = 'https://example.test/relation-diagnostics.struct.json';
    const external = {
      $schema: 'https://json-structure.org/meta/relations/v0/#',
      $id: externalUri,
      name: 'RelationDiagnostics',
      $uses: ['JSONStructureRelations'],
      definitions: {
        Target: { type: 'object', properties: { id: { type: 'string' } }, identity: ['id'] },
        Other: { type: 'object', properties: { id: { type: 'string' } }, identity: ['id'] },
        OtherCollection: { type: 'array', items: { type: { $ref: '#/definitions/Other' } } },
        Base: {
          type: 'object',
          abstract: true,
          properties: {
            collision: { type: 'string' },
            targets: { type: { $ref: '#/definitions/OtherCollection' } }
          }
        }
      }
    };
    const session = new DocumentSession('https://example.test/relation-diagnostics-root.struct.json', JSON.stringify({
      $schema: 'https://json-structure.org/meta/relations/v0/#',
      $id: 'https://example.test/relation-diagnostics-root.struct.json',
      name: 'RelationDiagnosticsRoot',
      $uses: ['JSONStructureRelations'],
      definitions: {
        shared: { $importdefs: externalUri },
        Derived: {
          type: 'object',
          $extends: '#/definitions/shared/Base',
          properties: { local: { type: 'string' } },
          relations: {
            collision: { targettype: { $ref: '#/definitions/shared/Target' }, cardinality: 'single' },
            scoped: {
              targettype: { $ref: '#/definitions/shared/Target' },
              cardinality: 'single',
              scope: '#/definitions/Derived/properties/targets'
            }
          }
        }
      }
    }));
    expect(session.diagnostics.some((diagnostic) => diagnostic.location?.pointer === '/definitions/Derived/relations/scoped/scope')).toBe(false);
    session.setExternalDocuments([{ uri: externalUri, value: external, availability: 'available' }]);
    expect(session.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'json.keyword-invalid', location: expect.objectContaining({ pointer: '/definitions/Derived/relations/collision' }) }),
      expect.objectContaining({ code: 'json.keyword-invalid', location: expect.objectContaining({ pointer: '/definitions/Derived/relations/scoped/scope' }) })
    ]));
  });

  it('rejects malformed imported declarations as reusable reference targets', async () => {
    const externalUri = 'https://example.test/invalid-reference-library.struct.json';
    const external = JSON.stringify({
      $id: externalUri,
      definitions: {
        EmptyReference: { type: {} },
        EmptyUnion: { type: [] },
        UnknownPrimitive: { type: 'not-a-core-type' },
        MalformedAlias: { type: { $ref: '#/definitions/Bad~2Pointer' } },
        DanglingAlias: { type: { $ref: '#/definitions/Missing' } },
        Target: { type: 'string' },
        EncodedAlias: { type: { $ref: '#%2Fdefinitions%2FTarget' } },
        InvalidBase: { type: {} },
        Derived: { type: 'object', $extends: '#/definitions/InvalidBase', properties: { value: { type: 'string' } } }
      }
    });
    const session = new DocumentSession('https://example.test/root.struct.json', JSON.stringify({
      definitions: {
        shared: { $importdefs: externalUri },
        Local: { type: 'object', properties: { value: { type: 'string' } } }
      }
    }));
    session.setExternalDocuments([{ uri: externalUri, value: JSON.parse(external), availability: 'available' }]);
    const context = { session, documentVersion: 1 };
    const resolved = new ResolvedSchemaContext(session.value as Record<string, unknown>, {
      documentUri: session.uri,
      resolvedDocuments: session.resolvedSchemaDocuments
    });

    for (const name of ['EmptyReference', 'EmptyUnion', 'UnknownPrimitive', 'MalformedAlias', 'DanglingAlias']) {
      const reference = `#/definitions/shared/${name}`;
      expect(session.effectiveDeclarations.some((declaration) => declaration.effectivePointer === reference.slice(1)), reference).toBe(false);
      expect(new SetTypeReferenceCommand('/definitions/Local/properties/value', reference).canExecute(context), reference).toBe(false);
    }
    expect(session.resolvedSchemaDocuments).toEqual([]);
    expect(session.effectiveDeclarations.some((declaration) => declaration.effectivePointer === '/definitions/shared/EncodedAlias')).toBe(false);
    expect(new SetTypeReferenceCommand('/definitions/Local/properties/value', '#/definitions/shared/EncodedAlias').canExecute(context)).toBe(false);
    expect(resolved.resolve('#/definitions/InvalidBase', externalUri)).toBeUndefined();
    expect(resolveEffectiveMembers(session.value as Record<string, unknown>, '#/definitions/shared/Derived', {
      documentUri: session.uri,
      resolvedDocuments: session.resolvedSchemaDocuments
    })).toMatchObject({
      status: 'indeterminate',
      diagnostics: [expect.objectContaining({ code: 'effective-members.target-missing' })]
    });

    const staleSession = new DocumentSession('https://example.test/stale-root.struct.json', JSON.stringify({
      definitions: {
        shared: { $importdefs: externalUri },
        Local: { type: 'object', properties: { value: { type: 'string' } } }
      }
    }));
    staleSession.setExternalDocuments([{
      uri: externalUri,
      value: { $id: externalUri, definitions: { Value: { type: 'string' } } },
      availability: 'stale'
    }]);
    expect(staleSession.effectiveDeclarations.some((declaration) => declaration.effectivePointer === '/definitions/shared/Value')).toBe(false);
  });

  it('revalidates resolved Core scalar constraints and semantic effective bindings', () => {
    const coreUri = 'https://example.test/core-values.struct.json';
    const coreLibrary = {
      $schema: 'https://json-structure.org/meta/core/v0/#',
      $id: coreUri,
      name: 'CoreValues',
      definitions: {
        Text: { type: 'string' },
        Small: { type: 'int8' }
      }
    };
    const coreSession = new DocumentSession('https://example.test/core-root.struct.json', JSON.stringify({
      $schema: 'https://json-structure.org/meta/extended/v0/#',
      $id: 'https://example.test/core-root.struct.json',
      name: 'CoreRoot',
      definitions: {
        shared: { $importdefs: coreUri },
        BadEnum: { type: { $ref: '#/definitions/shared/Small' }, enum: [128] },
        BadConst: { type: { $ref: '#/definitions/shared/Text' }, const: 7 },
        BadLength: { type: { $ref: '#/definitions/shared/Small' }, maxLength: 3 }
      }
    }));
    expect(coreSession.diagnostics.some((diagnostic) =>
      ['/definitions/BadEnum/enum', '/definitions/BadConst/const', '/definitions/BadLength/maxLength'].includes(diagnostic.location?.pointer ?? ''))).toBe(false);
    coreSession.setExternalDocuments([{ uri: coreUri, value: coreLibrary, availability: 'available' }]);
    for (const pointer of ['/definitions/BadEnum/enum', '/definitions/BadConst/const', '/definitions/BadLength/maxLength']) {
      expect(coreSession.diagnostics.some((diagnostic) => diagnostic.code === 'core.declaration-invalid' && diagnostic.location?.pointer === pointer), pointer).toBe(true);
    }

    const semanticUri = 'https://example.test/semantic-base.struct.json';
    const semanticLibrary = {
      $schema: 'https://json-structure.org/meta/semantic-annotations/v0/#',
      $id: semanticUri,
      name: 'SemanticBase',
      $uses: ['JSONStructureSemanticAnnotations'],
      definitions: {
        Base: {
          type: 'object',
          abstract: true,
          properties: { inheritedTime: { type: 'datetime', semanticRole: 'resultTime' }, latitude: { type: 'number' } }
        }
      }
    };
    const semanticSession = new DocumentSession('https://example.test/semantic-root.struct.json', JSON.stringify({
      $schema: 'https://json-structure.org/meta/semantic-annotations/v0/#',
      $id: 'https://example.test/semantic-root.struct.json',
      name: 'SemanticRoot',
      $uses: ['JSONStructureSemanticAnnotations'],
      definitions: {
        shared: { $importdefs: semanticUri },
        Position: {
          type: 'object',
          $extends: '#/definitions/shared/Base',
          properties: { localTime: { type: 'datetime', semanticRole: 'resultTime' }, longitude: { type: 'number' } },
          coordinateReferenceSystem: { reference: 'https://example.test/crs', kind: 'custom', coordinates: ['latitude', 'missing'] }
        }
      }
    }));
    expect(semanticSession.diagnostics.some((diagnostic) => diagnostic.location?.pointer === '/definitions/Position/coordinateReferenceSystem')).toBe(false);
    semanticSession.setExternalDocuments([{ uri: semanticUri, value: semanticLibrary, availability: 'available' }]);
    expect(semanticSession.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'json.keyword-invalid', location: expect.objectContaining({ pointer: '/definitions/Position/coordinateReferenceSystem' }) }),
      expect.objectContaining({ code: 'json.keyword-invalid', location: expect.objectContaining({ pointer: '/definitions/Position/properties/localTime/semanticRole' }) })
    ]));
  });

  it('rejects ambiguous supplied document identities in effective reference commands', () => {
    const externalId = 'https://example.test/ambiguous-library.struct.json';
    const session = new DocumentSession('https://example.test/root.struct.json', JSON.stringify({
      definitions: {
        shared: { $importdefs: externalId },
        Local: { type: 'object', properties: { value: { type: 'string' } } }
      }
    }));
    session.setExternalDocuments([
      { uri: 'https://mirror-one.example.test/library.struct.json', value: { $id: externalId, definitions: { Value: { type: 'string' } } }, availability: 'available' },
      { uri: 'https://mirror-two.example.test/library.struct.json', value: { $id: externalId, definitions: { Value: { type: 'number' } } }, availability: 'available' }
    ]);

    expect(session.effectiveDeclarations.some((declaration) => declaration.effectivePointer === '/definitions/shared/Value')).toBe(false);
    expect(new ResolvedSchemaContext(session.value as Record<string, unknown>, {
      documentUri: session.uri,
      resolvedDocuments: session.resolvedSchemaDocuments
    }).resolve('#/definitions/Value', externalId)).toBeUndefined();
    expect(new SetTypeReferenceCommand('/definitions/Local/properties/value', '#/definitions/shared/Value').canExecute({ session, documentVersion: 1 })).toBe(false);
  });

  it('diagnoses determinable imported inheritance violations', () => {
    const externalUri = 'https://example.test/inheritance-library.struct.json';
    const external = {
      $schema: 'https://json-structure.org/meta/core/v0/#',
      $id: externalUri,
      name: 'InheritanceLibrary',
      definitions: {
        AbstractBase: { type: 'object', abstract: true, properties: { id: { type: 'string' } } },
        AbstractMiddle: { type: 'object', abstract: true, $extends: '#/definitions/AbstractBase', properties: { tenant: { type: 'string' } } },
        ConcreteBase: { type: 'object', properties: { value: { type: 'string' } } },
        TupleBase: { type: 'tuple', abstract: true, properties: { x: { type: 'number' } }, tuple: ['x'] }
      }
    };
    const session = new DocumentSession('https://example.test/root.struct.json', JSON.stringify({
      $schema: 'https://json-structure.org/meta/extended/v0/#',
      $id: 'https://example.test/root.struct.json',
      name: 'Root',
      definitions: {
        shared: { $importdefs: externalUri },
        Valid: { type: 'object', $extends: '#/definitions/shared/AbstractMiddle', properties: { name: { type: 'string' } } },
        Concrete: { type: 'object', $extends: '#/definitions/shared/ConcreteBase', properties: { other: { type: 'string' } } },
        Incompatible: { type: 'object', $extends: '#/definitions/shared/TupleBase', properties: { other: { type: 'string' } } },
        Redefines: { type: 'object', $extends: '#/definitions/shared/AbstractMiddle', properties: { id: { type: 'uuid' } } }
      }
    }));
    session.setExternalDocuments([{ uri: externalUri, value: external, availability: 'available' }]);

    const corePointers = session.diagnostics
      .filter((diagnostic) => diagnostic.code === 'core.declaration-invalid')
      .map((diagnostic) => diagnostic.location?.pointer);
    expect(corePointers).toEqual(expect.arrayContaining([
      '/definitions/Concrete/$extends',
      '/definitions/Incompatible/$extends',
      '/definitions/Redefines/properties/id'
    ]));
    expect(corePointers.some((pointer) => pointer?.startsWith('/definitions/Valid'))).toBe(false);
  });

  it('diagnoses imported abstract declarations in ordinary reference positions', () => {
    const externalUri = 'https://example.test/abstract-library.struct.json';
    const external = {
      $schema: 'https://json-structure.org/meta/relations/v0/#',
      $id: externalUri,
      name: 'AbstractLibrary',
      $uses: ['JSONStructureRelations'],
      definitions: {
        AbstractEntity: {
          type: 'object',
          abstract: true,
          properties: { id: { type: 'string' } },
          identity: ['id']
        }
      }
    };
    const session = new DocumentSession('https://example.test/root.struct.json', JSON.stringify({
      $schema: 'https://json-structure.org/meta/relations/v0/#',
      $id: 'https://example.test/root.struct.json',
      name: 'Root',
      $uses: ['JSONStructureRelations'],
      $root: '#/definitions/shared/AbstractEntity',
      definitions: {
        shared: { $importdefs: externalUri },
        ValidDerived: { type: 'object', $extends: '#/definitions/shared/AbstractEntity', properties: { name: { type: 'string' } } },
        InvalidAlias: { type: { $ref: '#/definitions/shared/AbstractEntity' } },
        Source: {
          type: 'object',
          properties: { local: { type: 'string' } },
          relations: {
            invalid: {
              targettype: { $ref: '#/definitions/shared/AbstractEntity' },
              cardinality: 'single',
              qualifiertype: { $ref: '#/definitions/shared/AbstractEntity' }
            }
          }
        }
      }
    }));
    session.setExternalDocuments([{ uri: externalUri, value: external, availability: 'available' }]);

    const corePointers = session.diagnostics
      .filter((diagnostic) => diagnostic.code === 'core.declaration-invalid')
      .map((diagnostic) => diagnostic.location?.pointer);
    expect(corePointers).toEqual(expect.arrayContaining([
      '/$root',
      '/definitions/InvalidAlias/type/$ref',
      '/definitions/Source/relations/invalid/targettype/$ref',
      '/definitions/Source/relations/invalid/qualifiertype/$ref'
    ]));
    expect(corePointers).not.toContain('/definitions/ValidDerived/$extends');
  });

  it('rejects transitive inherited property redefinition in property authoring', () => {
    const session = new DocumentSession('memory://inherited-property-authoring', JSON.stringify({
      definitions: {
        Base: { type: 'object', abstract: true, properties: { id: { type: 'string' } } },
        Middle: { type: 'object', abstract: true, $extends: '#/definitions/Base', properties: { middle: { type: 'string' } } },
        Derived: { type: 'object', $extends: '#/definitions/Middle', properties: { local: { type: 'string' } } }
      }
    }));
    const context = { session, documentVersion: 1 };
    expect(new AddPropertyCommand('/definitions/Derived', 'id', { type: 'uuid' }).canExecute(context)).toBe(false);
    expect(new AddPropertyCommand('/definitions/Derived', 'middle', { type: 'number' }).canExecute(context)).toBe(false);
    expect(new AddPropertyCommand('/definitions/Derived', 'newMember', { type: 'boolean' }).canExecute(context)).toBe(true);
  });
});