import { describe, expect, it } from 'vitest';
import {
  AddDefinitionCommand,
  AddRelationCommand,
  AddPropertyCommand,
  DeleteImportCommand,
  DeleteDefinitionCommand,
  DeleteRelationCommand,
  DeletePropertyCommand,
  DocumentSession,
  EditRelationCommand,
  EditPropertyCommand,
  InMemoryEditorHost,
  PROTOCOL_VERSION,
  RemoveIdentityCommand,
  RenameRelationCommand,
  RenameDefinitionCommand,
  RenamePropertyCommand,
  SetIdentityCommand,
  SetImportCommand,
  SetBinaryAnnotationsCommand,
  SetCollectionMemberCommand,
  SetDescriptionCommand,
  SetRelationCardinalityCommand,
  SetRelationQualifierCommand,
  SetRelationScopeCommand,
  SetRootCommand,
  SetRequiredCommand,
  SetTupleMembersCommand,
  SetTypeReferenceCommand,
  parseDocument,
  resolveReferences,
  resolveSelection,
  sameSelection,
  selectionForMode
} from '../src/index.js';

const text = `{
  "$schema": "https://json-structure.org/schema/",
  "unknown": {"keep": true},
  "definitions": {
    "Person": {
      "type": "object",
      "properties": {"id": {"type": "string"}}
    }
  }
}`;
const semanticSchema = 'https://json-structure.org/meta/semantic-annotations/v0/#';
const extendedSchema = 'https://json-structure.org/meta/extended/v0/#';
const relationsSchema = 'https://json-structure.org/meta/relations/v0/#';

function withProfile(source: string, schema: string, uses: readonly string[] = []): string {
  const header = JSON.stringify({ $schema: schema, ...(uses.length > 0 ? { $uses: uses } : {}) });
  return source === '{}' ? header : `${header.slice(0, -1)},${source.slice(1)}`;
}

const withRelations = (source: string): string => withProfile(source, relationsSchema, ['JSONStructureRelations']);
const withImports = (source: string): string => withProfile(source, extendedSchema);

describe('Phase 1 vertical slice', () => {
  it('normalizes pointers and exact source ranges', () => {
    const result = parseDocument('memory://fixture', text);
    expect(result.recovery).toBe('valid');
    const person = result.model?.nodes.find((node) => node.pointer === '/definitions/Person');
    const property = result.model?.nodes.find((node) => node.pointer === '/definitions/Person/properties/id');
    expect(person?.range?.startOffset).toBe(text.indexOf('"Person"') + '"Person"'.length + 2);
    expect(text.slice(property!.range!.startOffset!, property!.range!.endOffset!)).toBe('{"type": "string"}');
    expect(property?.location?.pointer).toBe('/definitions/Person/properties/id');
  });
  it('projects typed definitions, imports, relation semantics, units, validation, composition, and semantic annotations', () => {
    const fixture = `{
  "$schema": "https://json-structure.org/meta/semantic-annotations/v0/#",
  "$uses": ["JSONStructureValidation", "JSONStructureConditionalComposition", "JSONStructureUnits", "JSONStructureSemanticAnnotations"],
  "$import": "https://example.org/root.struct.json",
  "$importdefs": "https://example.org/common.struct.json",
  "definitions": {
    "Meta": {"type":"string"},
    "ObjectBase": {"type":"object","properties":{"base":{"type":"string"}}},
    "Thing": {
      "type": "object",
      "$extends": ["#/definitions/ObjectBase"],
      "properties": {"id":{"type":"string","semanticRole":"observationValue","derivation":"statistic","statistic":{"function":"percentile","percentile":95},"codedValues":{"reference":"urn:codes","kind":"custom-code-list"},"measurementConditioning":{"weighting":"custom-weighting"},"referenceRole":"position","phenomenonTimeRelation":"interval","supportPeriod":{"length":"PT10S","anchor":"end"},"temporalReferenceSystem":{"reference":"urn:trs:iso8601","kind":"custom-trs"},"cadence":{"kind":"fixed","period":"PT1S"}},"time":{"type":"string"},"x":{"type":"number"},"y":{"type":"number"},"vx":{"type":"number"},"vy":{"type":"number"},"xx":{"type":"number"},"roll":{"type":"number"},"pitch":{"type":"number"},"yaw":{"type":"number"},"tx":{"type":"number"},"ty":{"type":"number"},"tz":{"type":"number"},"road":{"type":"string"},"distance":{"type":"number"},"red":{"type":"number"},"green":{"type":"number"},"blue":{"type":"number"},"left":{"type":"number"},"right":{"type":"number"}},
      "identity": ["id"],
      "relations": {
        "owner": {

          "targettype": {"$ref": "#/definitions/Meta"},
          "cardinality": "single",
          "scope": ["#/items"],
          "qualifiertype": {"$ref": "#/definitions/Meta"}
        }
      },
      "symbol": "kg",
      "symbols": {"display": "kg", "lang:en": "kilogram"},
      "unit": "kilogram",
      "ucumUnit": "kg",
      "currency": "EUR",
      "minimum": 0,
      "maximum": 100,
      "exclusiveMinimum": 0,
      "exclusiveMaximum": 100,
      "multipleOf": 0.5,
      "minLength": 1,
      "maxLength": 32,
      "pattern": "^[a-z]+$",
      "format": "text",
      "minItems": 0,
      "maxItems": 5,
      "uniqueItems": true,
      "minContains": 1,
      "maxContains": 2,
      "minProperties": 1,
      "maxProperties": 5,
      "minEntries": 0,
      "maxEntries": 5,
      "default": "abc",
      "contains": {"type":"string"},
      "propertyNames": {"pattern":"^[a-z]+$"},
      "keyNames": {"pattern":"^[a-z]+$"},
      "has": {"id": true},
      "dependentRequired": {"id": ["name"]},
      "patternProperties": {"^x": {"type":"string"}},
      "patternKeys": {"^x": {"type":"string"}},
      "allOf": [{"type":"object"}],
      "anyOf": [{"type":"object"}],
      "oneOf": [{"type":"object"}],
      "not": {"type":"null"},
      "if": {"type":"object"},
      "then": {"type":"object"},
      "else": {"type":"object"},
      "concepts": [{"reference":"urn:concept:thing","kind":"custom-concept"}],
      "observedProperty": {"reference":"urn:obs:mass","kind":"custom-observable"},
      "temporalReferenceSystem": {"reference":"urn:trs:iso8601","kind":"custom-trs","position":"time","sortOrder":"forward"},
      "coordinateReferenceSystem": {"reference":"urn:ogc:def:crs:EPSG::4326","kind":"custom-crs","coordinates":["x","y"]},
      "vectorReferenceFrames": [{"reference":"urn:frame:enu","kind":"custom-frame","components":["vx","vy"],"variance":"contravariant"}],
      "tensorReferenceFrames": [{"frames":[{"reference":"urn:frame:a","kind":"custom-frame"},{"reference":"urn:frame:a","kind":"custom-frame"}],"components":[{"index":[0,0],"property":"xx"}],"symmetry":"none"}],
      "frameTransforms": [{"from":{"reference":"urn:frame:a","kind":"custom-frame"},"to":{"reference":"urn:frame:b","kind":"custom-frame"},"encoding":"eulerAngles","components":["roll","pitch","yaw"],"rotationSequence":"XYZ","translation":["tx","ty","tz"]}],
      "linearReferenceSystem": {"reference":"urn:lrs:1","kind":"custom-lrs","linearElement":"road","measure":"distance"},
      "colorSpaces": [{"reference":"urn:color:srgb","kind":"custom-color","channels":["red","green","blue"],"transfer":"asDefined"}],
      "audioChannels": [{"reference":"urn:audio:stereo","kind":"custom-audio","channels":["left","right"],"encoding":"urn:encoding:custom"}],
      "spectralBands": [{"reference":"urn:spectral:vis","kind":"custom-spectral","bands":["red","green","blue"],"calibration":"custom-calibration"}]
    },
    "Nested": {
      "$import": "https://example.org/nested.struct.json",
      "$importdefs": "https://example.org/nested-defs.struct.json",
      "definitions": {
        "Inner": {"type":{"$ref":"#/definitions/Meta"}}
      }
    }
  }
}`;
    const result = parseDocument('memory://typed', fixture);
    const relationResult = parseDocument('memory://typed-relations', withRelations(JSON.stringify({
      definitions: {
        Meta: { type: 'object', properties: { id: { type: 'string' } }, identity: ['id'] },
        Thing: {
          type: 'object',
          properties: { id: { type: 'string' } },
          identity: ['id'],
          relations: {
            owner: {
              targettype: { $ref: '#/definitions/Meta' },
              cardinality: 'single',
              scope: ['#/definitions/Things'],
              qualifiertype: { $ref: '#/definitions/Meta' }
            }
          }
        },
        Things: { type: 'array', items: { type: { $ref: '#/definitions/Meta' } } }
      }
    })));
    expect(result.recovery).toBe('valid');
    const projections = result.model?.projections;
    const semanticPlacements = projections?.semanticPlacements ?? [];
    expect(projections?.definitions.length).toBeGreaterThanOrEqual(3);
    const thing = projections?.definitions.find((item) => item.pointer === '/definitions/Thing');
    const relationThing = relationResult.model?.projections.definitions.find((item) => item.pointer === '/definitions/Thing');
    expect(thing?.coreForm).toBe('typed');
    expect(thing?.extends).toEqual(['#/definitions/ObjectBase']);
    expect(relationThing?.relations[0]?.name).toBe('owner');

    expect(relationThing?.relations[0]?.targetTypeRef).toBe('#/definitions/Meta');
    expect(relationThing?.relations[0]?.cardinality).toBe('single');
    expect(relationThing?.relations[0]?.scope).toEqual(['#/definitions/Things']);
    expect(relationThing?.relations[0]?.qualifierTypeRef).toBe('#/definitions/Meta');
    expect(thing?.units).toEqual({ symbol: 'kg', symbols: { display: 'kg', 'lang:en': 'kilogram' }, currency: 'EUR' });
    expect(result.diagnostics.some((item) => item.location?.pointer === '/definitions/Thing/unit')).toBe(true);
    expect(result.diagnostics.some((item) => item.location?.pointer === '/definitions/Thing/ucumUnit')).toBe(true);
    expect(thing?.validation?.minimum).toBeUndefined();
    expect(thing?.validation?.maximum).toBeUndefined();
    expect(thing?.validation?.exclusiveMinimum).toBeUndefined();
    expect(thing?.validation?.exclusiveMaximum).toBeUndefined();
    expect(thing?.validation?.multipleOf).toBeUndefined();
    expect(thing?.validation?.minLength).toBeUndefined();
    expect(thing?.validation).not.toHaveProperty('maxLength');
    expect(thing?.validation?.pattern).toBeUndefined();
    expect(thing?.validation?.format).toBeUndefined();
    expect(thing?.validation?.minItems).toBeUndefined();
    expect(thing?.validation?.maxItems).toBeUndefined();
    expect(thing?.validation?.uniqueItems).toBeUndefined();
    expect(thing?.validation?.minContains).toBeUndefined();
    expect(thing?.validation?.maxContains).toBeUndefined();
    expect(thing?.validation?.minProperties).toBe(1);
    expect(thing?.validation?.maxProperties).toBe(5);
    expect(thing?.validation?.minEntries).toBeUndefined();
    expect(thing?.validation?.maxEntries).toBeUndefined();
    expect(thing?.validation?.default).toBe('abc');
    expect(thing?.validation?.contains).toBeUndefined();
    expect(thing?.validation?.propertyNames).toBeUndefined();
    expect(thing?.validation?.keyNames).toBeUndefined();
    expect(thing?.validation?.has).toBeUndefined();
    expect(thing?.validation?.dependentRequired).toEqual({ id: ['name'] });
    expect(thing?.validation?.patternProperties).toEqual({ '^x': { type: 'string' } });
    expect(thing?.validation?.patternKeys).toBeUndefined();
    expect(thing?.composition?.allOf).toEqual([{ type: 'object' }]);
    expect(thing?.composition?.anyOf).toEqual([{ type: 'object' }]);
    expect(thing?.composition?.oneOf).toEqual([{ type: 'object' }]);
    expect(thing?.composition?.not).toEqual({ type: 'null' });
    expect(thing?.composition?.if).toEqual({ type: 'object' });
    expect(thing?.composition?.then).toEqual({ type: 'object' });
    expect(thing?.composition?.else).toEqual({ type: 'object' });
    expect(thing?.semantic?.concepts).toEqual([{ reference: 'urn:concept:thing', kind: 'custom-concept' }]);
    expect(thing?.semantic?.observedProperty).toEqual({ reference: 'urn:obs:mass', kind: 'custom-observable' });
    expect(thing?.semantic?.temporalReferenceSystem).toEqual({ reference: 'urn:trs:iso8601', kind: 'custom-trs', position: 'time', sortOrder: 'forward' });
    const idSemantic = semanticPlacements.find((entry) => entry.pointer === '/definitions/Thing/properties/id')?.annotations;
    expect(idSemantic?.semanticRole).toBe('observationValue');
    expect(idSemantic?.statistic).toEqual({ function: 'percentile', percentile: 95 });
    expect(thing?.semantic?.coordinateReferenceSystem).toEqual({ reference: 'urn:ogc:def:crs:EPSG::4326', kind: 'custom-crs', coordinates: ['x', 'y'] });
    expect(thing?.semantic?.vectorReferenceFrames?.[0]?.variance).toBe('contravariant');
    expect(thing?.semantic?.tensorReferenceFrames?.[0]?.symmetry).toBe('none');
    expect(thing?.semantic?.frameTransforms?.[0]?.encoding).toBe('eulerAngles');
    expect(thing?.semantic?.linearReferenceSystem?.measure).toBe('distance');
    expect(thing?.semantic?.colorSpaces?.[0]?.channels).toEqual(['red', 'green', 'blue']);
    expect(thing?.semantic?.audioChannels?.[0]?.channels).toEqual(['left', 'right']);
    expect(thing?.semantic?.spectralBands?.[0]?.bands).toEqual(['red', 'green', 'blue']);
    const importEntries = projections?.imports ?? [];
    expect(importEntries.some((entry) => entry.pointer === '/$import' && entry.provenance === 'import')).toBe(true);
    expect(importEntries.some((entry) => entry.pointer === '/$importdefs' && entry.provenance === 'importdefs')).toBe(true);
    expect(importEntries.some((entry) => entry.pointer === '/definitions/Nested/$import')).toBe(true);
    expect(importEntries.some((entry) => entry.pointer === '/definitions/Nested/$importdefs')).toBe(true);
    expect(importEntries.every((entry) => typeof entry.source === 'string')).toBe(true);
    expect(importEntries.every((entry) => !('targetPointer' in (entry as unknown as Record<string, unknown>)))).toBe(true);
    const refs = projections?.references ?? [];
    expect(refs.some((entry) => entry.pointer === '/definitions/Nested/definitions/Inner/type/$ref' && entry.target === '#/definitions/Meta')).toBe(true);
    expect(relationResult.model?.projections.references.some((entry) => entry.pointer === '/definitions/Thing/relations/owner/targettype/$ref' && entry.target === '#/definitions/Meta')).toBe(true);
    expect(semanticPlacements.some((entry) => entry.pointer === '/definitions/Thing')).toBe(true);
  });
  it('emits per-keyword diagnostics for malformed companion values and excludes invalid projections', () => {
    const cases: ReadonlyArray<{
      readonly label: string;
      readonly body: string;
      readonly pointer: string;
      readonly code?: string;
      readonly scope?: 'root' | 'definition';
      readonly assertDefinition?: (definition: NonNullable<ReturnType<typeof parseDocument>['model']>['projections']['definitions'][number]) => void;
      readonly assertImports?: (imports: NonNullable<ReturnType<typeof parseDocument>['model']>['projections']['imports']) => void;
    }> = [
      { label: 'validation.minimum', body: '"minimum":"zero"', pointer: '/definitions/Thing/minimum', assertDefinition: (d) => expect(d.validation?.minimum).toBeUndefined() },
      { label: 'core.maxLength', body: '"maxLength":-1', pointer: '/definitions/Thing/maxLength', code: 'core.declaration-invalid', assertDefinition: (d) => expect(d.validation && 'maxLength' in d.validation).toBeFalsy() },
      { label: 'validation.dependentRequired', body: '"dependentRequired":{"id":[1]}', pointer: '/definitions/Thing/dependentRequired', assertDefinition: (d) => expect(d.validation?.dependentRequired).toBeUndefined() },
      { label: 'validation.patternProperties', body: '"patternProperties":{"^x":1}', pointer: '/definitions/Thing/patternProperties', assertDefinition: (d) => expect(d.validation?.patternProperties).toBeUndefined() },
      { label: 'composition.allOf', body: '"allOf":[1]', pointer: '/definitions/Thing/allOf', assertDefinition: (d) => expect(d.composition?.allOf).toBeUndefined() },
      { label: 'composition.not', body: '"not":[1]', pointer: '/definitions/Thing/not', assertDefinition: (d) => expect(d.composition?.not).toBeUndefined() },
      { label: 'units.symbol', body: '"symbol":1', pointer: '/definitions/Thing/symbol', assertDefinition: (d) => expect(d.units?.symbol).toBeUndefined() },
      { label: 'units.symbols', body: '"symbols":{"display":1}', pointer: '/definitions/Thing/symbols', assertDefinition: (d) => expect(d.units?.symbols).toBeUndefined() },
      { label: 'relations.members', body: '"relations":{"owner":{"identity":["id"],"targettype":{"$ref":"#/definitions/Thing"},"cardinality":"single"}}', pointer: '/definitions/Thing/relations/owner/identity', assertDefinition: (d) => expect(d.relations).toHaveLength(0) },
      { label: 'relations.target', body: '"relations":{"owner":{"targettype":{"$ref":1},"cardinality":"single"}}', pointer: '/definitions/Thing/relations/owner/targettype', assertDefinition: (d) => expect(d.relations).toHaveLength(0) },
      { label: 'relations.qualifier', body: '"relations":{"owner":{"targettype":{"$ref":"#/definitions/Thing"},"cardinality":"single","qualifiertype":{"$ref":1}}}', pointer: '/definitions/Thing/relations/owner/qualifiertype', assertDefinition: (d) => expect(d.relations[0]?.qualifierTypeRef).toBeUndefined() },
      { label: 'relations.cardinality', body: '"relations":{"owner":{"targettype":{"$ref":"#/definitions/Thing"},"cardinality":"one"}}', pointer: '/definitions/Thing/relations/owner/cardinality', assertDefinition: (d) => expect(d.relations).toHaveLength(0) },
      { label: 'relations.scope', body: '"relations":{"owner":{"targettype":{"$ref":"#/definitions/Thing"},"cardinality":"single","scope":["/not-a-fragment"]}}', pointer: '/definitions/Thing/relations/owner/scope', assertDefinition: (d) => expect(d.relations[0]?.scope).toBeUndefined() },
      { label: 'imports.import', body: '"$import":["x"]', pointer: '/$import', scope: 'root', assertImports: (imports) => expect(imports.find((item) => item.pointer === '/$import')).toBeUndefined() },
      { label: 'imports.importdefs', body: '"$importdefs":["https://example.org/a"]', pointer: '/$importdefs', scope: 'root', assertImports: (imports) => expect(imports.find((item) => item.pointer === '/$importdefs')).toBeUndefined() },
      { label: 'semantic.concepts', body: '"concepts":[1]', pointer: '/definitions/Thing/concepts', assertDefinition: (d) => expect(d.semantic?.concepts).toBeUndefined() },
      { label: 'semantic.observedProperty', body: '"observedProperty":1', pointer: '/definitions/Thing/observedProperty', assertDefinition: (d) => expect(d.semantic?.observedProperty).toBeUndefined() },
      { label: 'semantic.semanticRole', body: '"semanticRole":"measurement"', pointer: '/definitions/Thing/semanticRole', assertDefinition: (d) => expect(d.semantic?.semanticRole).toBeUndefined() },
      { label: 'semantic.derivation', body: '"derivation":"observed"', pointer: '/definitions/Thing/derivation', assertDefinition: (d) => expect(d.semantic?.derivation).toBeUndefined() },
      { label: 'semantic.statistic', body: '"statistic":{"function":"percentile","percentile":100}', pointer: '/definitions/Thing/statistic', assertDefinition: (d) => expect(d.semantic?.statistic).toBeUndefined() },
      { label: 'semantic.codedValues', body: '"codedValues":{"A":1}', pointer: '/definitions/Thing/codedValues', assertDefinition: (d) => expect(d.semantic?.codedValues).toBeUndefined() },
      { label: 'semantic.measurementConditioning', body: '"measurementConditioning":1', pointer: '/definitions/Thing/measurementConditioning', assertDefinition: (d) => expect(d.semantic?.measurementConditioning).toBeUndefined() },
      { label: 'semantic.referenceRole', body: '"referenceRole":"baseline"', pointer: '/definitions/Thing/referenceRole', assertDefinition: (d) => expect(d.semantic?.referenceRole).toBeUndefined() },
      { label: 'semantic.phenomenonTimeRelation', body: '"phenomenonTimeRelation":"period"', pointer: '/definitions/Thing/phenomenonTimeRelation', assertDefinition: (d) => expect(d.semantic?.phenomenonTimeRelation).toBeUndefined() },
      { label: 'semantic.supportPeriod', body: '"supportPeriod":{"length":"PT1S","anchor":"middle"}', pointer: '/definitions/Thing/supportPeriod', assertDefinition: (d) => expect(d.semantic?.supportPeriod).toBeUndefined() },
      { label: 'semantic.temporalReferenceSystem', body: '"temporalReferenceSystem":1', pointer: '/definitions/Thing/temporalReferenceSystem', assertDefinition: (d) => expect(d.semantic?.temporalReferenceSystem).toBeUndefined() },
      { label: 'semantic.cadence', body: '"cadence":{"kind":"fixed"}', pointer: '/definitions/Thing/cadence', assertDefinition: (d) => expect(d.semantic?.cadence).toBeUndefined() },
      { label: 'semantic.coordinateReferenceSystem', body: '"coordinateReferenceSystem":1', pointer: '/definitions/Thing/coordinateReferenceSystem', assertDefinition: (d) => expect(d.semantic?.coordinateReferenceSystem).toBeUndefined() },
      { label: 'semantic.vectorReferenceFrames', body: '"vectorReferenceFrames":[1]', pointer: '/definitions/Thing/vectorReferenceFrames', assertDefinition: (d) => expect(d.semantic?.vectorReferenceFrames).toBeUndefined() },
      { label: 'semantic.tensorReferenceFrames', body: '"tensorReferenceFrames":[1]', pointer: '/definitions/Thing/tensorReferenceFrames', assertDefinition: (d) => expect(d.semantic?.tensorReferenceFrames).toBeUndefined() },
      { label: 'semantic.frameTransforms', body: '"frameTransforms":[{"from":{"reference":"urn:a","kind":"frame"},"to":{"reference":"urn:b","kind":"frame"},"encoding":"eulerAngles","components":["x","y","z"],"rotationSequence":"ABC"}]', pointer: '/definitions/Thing/frameTransforms', assertDefinition: (d) => expect(d.semantic?.frameTransforms).toBeUndefined() },
      { label: 'semantic.linearReferenceSystem', body: '"linearReferenceSystem":1', pointer: '/definitions/Thing/linearReferenceSystem', assertDefinition: (d) => expect(d.semantic?.linearReferenceSystem).toBeUndefined() },
      { label: 'semantic.colorSpaces', body: '"colorSpaces":[1]', pointer: '/definitions/Thing/colorSpaces', assertDefinition: (d) => expect(d.semantic?.colorSpaces).toBeUndefined() },
      { label: 'semantic.audioChannels', body: '"audioChannels":[1]', pointer: '/definitions/Thing/audioChannels', assertDefinition: (d) => expect(d.semantic?.audioChannels).toBeUndefined() },
      { label: 'semantic.spectralBands', body: '"spectralBands":[1]', pointer: '/definitions/Thing/spectralBands', assertDefinition: (d) => expect(d.semantic?.spectralBands).toBeUndefined() }
    ];
    for (const testCase of cases) {
      const schema = testCase.label.startsWith('semantic.')
        ? semanticSchema
        : testCase.label.startsWith('relations.')
        ? relationsSchema
        : testCase.label.startsWith('imports.')
        ? extendedSchema
        : testCase.label.startsWith('validation.')
        ? 'https://json-structure.org/meta/validation/v0/#'
        : 'https://json-structure.org/schema/';
      const uses = testCase.label.startsWith('semantic.') ? '"$uses":["JSONStructureSemanticAnnotations"],'
        : testCase.label.startsWith('relations.') ? '"$uses":["JSONStructureRelations"],'
        : testCase.label.startsWith('units.') ? '"$uses":["JSONStructureUnits"],'
        : '';
      const effectiveSchema = testCase.label.startsWith('units.') ? 'https://json-structure.org/meta/extended/v0/#' : schema;
      const fixture = testCase.scope === 'root'
        ? `{"$schema":"${effectiveSchema}",${uses}${testCase.body},"definitions":{"Thing":{"type":"object"}}}`
        : `{"$schema":"${effectiveSchema}",${uses}"definitions":{"Thing":{"type":"object",${testCase.body}}}}`;
      const result = parseDocument(`memory://malformed-${testCase.label}`, fixture);
      expect(result.recovery).toBe('valid');
      const diagnosticCode = testCase.code ?? 'json.keyword-invalid';
      const diagnostic = result.diagnostics.find((item) => item.code === diagnosticCode && item.location?.pointer === testCase.pointer);
      expect(diagnostic, `missing ${diagnosticCode} for ${testCase.label} at ${testCase.pointer}`).toBeDefined();
      const offendingNode = result.model?.nodes.find((node) => node.pointer === testCase.pointer);
      expect(diagnostic?.location?.range).toEqual(offendingNode?.range);
      const diagnosticRange = diagnostic?.location?.range;
      expect(diagnosticRange).toBeDefined();
      expect(diagnosticRange!.startOffset).not.toBe(0);
      expect(fixture.slice(diagnosticRange!.startOffset, diagnosticRange!.endOffset)).toBe(
        fixture.slice(offendingNode!.range!.startOffset, offendingNode!.range!.endOffset)
      );
      const definition = result.model?.projections.definitions.find((item) => item.pointer === '/definitions/Thing');
      if (testCase.assertDefinition) {
        expect(definition).toBeDefined();
        testCase.assertDefinition(definition!);
      }
      if (testCase.assertImports) testCase.assertImports(result.model?.projections.imports ?? []);
    }
  });
  it('accepts normative relation scope fragments only', () => {
    const valid = parseDocument('memory://scope-valid', withRelations('{"definitions":{"Thing":{"type":"object","relations":{"owner":{"targettype":{"$ref":"#/definitions/Thing"},"cardinality":"single","scope":["#","#/definitions/Thing"]}}}}}'));
    const relation = valid.model?.projections.definitions[0]?.relations[0];
    expect(relation?.scope).toEqual(['#', '#/definitions/Thing']);

    const invalid = parseDocument('memory://scope-invalid', withRelations('{"definitions":{"Thing":{"type":"object","relations":{"owner":{"targettype":{"$ref":"#/definitions/Thing"},"cardinality":"single","scope":"/definitions/Thing"}}}}}'));
    const diagnostic = invalid.diagnostics.find((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === '/definitions/Thing/relations/owner/scope');
    expect(diagnostic).toBeDefined();
  });
  it('accepts singular absolute and relative URI-reference strings for $import and $importdefs only', () => {
    const valid = parseDocument('memory://imports-valid', withImports('{"$import":"../root.json","$importdefs":"https://example.org/defs.json","definitions":{"Thing":{"type":"object"}}}'));
    expect(valid.model?.projections.imports).toHaveLength(2);
    expect(valid.model?.projections.imports[0]?.source).toBe('../root.json');

    const invalid = parseDocument('memory://imports-invalid', withImports('{"$import":"C:\\\\schemas\\\\root.json","$importdefs":["https://example.org/defs.json"],"definitions":{"Thing":{"type":"object"}}}'));
    expect(invalid.diagnostics.some((item) => item.location?.pointer === '/$import' && item.code === 'json.keyword-invalid')).toBe(true);
    expect(invalid.diagnostics.some((item) => item.location?.pointer === '/$importdefs' && item.code === 'json.keyword-invalid')).toBe(true);
  });
  it('diagnoses forbidden import placement without projecting it as an effective import', () => {
    const result = parseDocument('memory://import-placement', withImports('{"definitions":{"Thing":{"type":"object","$import":"https://example.org/invalid.json"}}}'));
    expect(result.diagnostics.some((item) => item.location?.pointer === '/definitions/Thing/$import' && item.code === 'json.keyword-invalid')).toBe(true);
    expect(result.model?.projections.imports).toHaveLength(0);
  });
  it('projects direct definitions and imports nested under namespace objects', () => {
    const result = parseDocument('memory://nested-namespace', withImports('{"definitions":{"$import":"https://example.org/root-definitions.json","Domain":{"$import":"https://example.org/domain.json","Entity":{"type":"object"},"Nested":{"$importdefs":"https://example.org/nested.json","Value":{"type":"string"}}}}}'));
    const definitions = result.model?.projections.definitions ?? [];
    expect(definitions.some((item) => item.pointer === '/definitions/Domain/Entity' && item.namespacePointer === '/definitions/Domain')).toBe(true);
    expect(definitions.some((item) => item.pointer === '/definitions/Domain/Nested/Value' && item.namespacePointer === '/definitions/Domain/Nested')).toBe(true);
    const imports = result.model?.projections.imports ?? [];
    expect(imports.some((item) => item.pointer === '/definitions/Domain/$import')).toBe(true);
    expect(imports.some((item) => item.pointer === '/definitions/Domain/Nested/$importdefs')).toBe(true);
    expect(imports.some((item) => item.pointer === '/definitions/$import')).toBe(true);
  });
  it('diagnoses relation/identity local invariants with exact source pointers', () => {
    const source = JSON.stringify({
      $schema: relationsSchema,
      $uses: ['JSONStructureRelations'],
      definitions: {
        Thing: {
          type: 'string',
          identity: ['id', 'id'],
          relations: {
            id: { targettype: { $ref: '#/definitions/Missing' }, cardinality: 'single', scope: '#/definitions/Missing' }
          },
          properties: { id: { type: 'string' } }
        },
        Target: { type: 'object' },
        Nest: {
          type: 'object',
          properties: {
            wrong: {
              type: 'object'
            }
          }
        }
      },
      $import: 'https://example.org/a.json',
      $importdefs: 'https://example.org/b.json'
    });
    const result = parseDocument('memory://relation-identity-diag', source);
    const pointers = new Set(result.diagnostics.filter((d) => d.code === 'json.keyword-invalid').map((d) => d.location?.pointer));
    expect(pointers.has('/definitions/Thing/identity')).toBe(true);
    expect(pointers.has('/definitions/Thing/relations')).toBe(true);
    expect(pointers.has('/definitions/Thing/relations/id')).toBe(true);
    expect(resolveReferences(result.model!).diagnostics.some((diagnostic) => diagnostic.location?.pointer === '/definitions/Thing/relations/id/targettype/$ref')).toBe(true);
    expect(pointers.has('/definitions/Thing/relations/id/scope')).toBe(true);
    expect(pointers.has('')).toBe(true);
  });
  it('projects ordered object, composite, tuple, root, and nested identities', () => {
    const source = JSON.stringify({
      $schema: relationsSchema,
      $uses: ['JSONStructureRelations'],
      type: 'object',
      properties: {
        tenant: { type: 'string' },
        id: { type: 'string' },
        nested: {
          type: 'object',
          properties: { localId: { type: 'uuid' } },
          identity: ['localId']
        }
      },
      identity: ['tenant', 'id'],
      definitions: {
        Coordinate: {
          type: 'tuple',
          properties: { x: { type: 'double' }, y: { type: 'double' } },
          tuple: ['x', 'y'],
          identity: ['y', 'x']
        }
      }
    });
    const result = parseDocument('memory://identity-inspection', source);
    expect(result.diagnostics.filter((item) => item.code === 'json.keyword-invalid')).toEqual([]);
    const definitions = result.model?.projections.definitions ?? [];
    expect(definitions.find((item) => item.pointer === '')?.identity).toEqual(['tenant', 'id']);
    expect(definitions.find((item) => item.pointer === '/properties/nested')?.identity).toEqual(['localId']);
    expect(definitions.find((item) => item.pointer === '/definitions/Coordinate')?.identity).toEqual(['y', 'x']);
  });
  it('diagnoses invalid identity placement, values, properties, duplicates, and ambiguous source keys', () => {
    const cases = [
      ['placement', '{"type":"string","identity":["id"]}', '/identity'],
      ['empty-array', '{"type":"object","properties":{"id":{"type":"string"}},"identity":[]}', '/identity'],
      ['non-string', '{"type":"object","properties":{"id":{"type":"string"}},"identity":[1]}', '/identity'],
      ['empty-name', '{"type":"object","properties":{"id":{"type":"string"}},"identity":[""]}', '/identity'],
      ['missing-properties', '{"type":"object","identity":["id"]}', '/identity'],
      ['missing-property', '{"type":"object","properties":{"id":{"type":"string"}},"identity":["missing"]}', '/identity/0'],
      ['duplicate-name', '{"type":"object","properties":{"id":{"type":"string"}},"identity":["id","id"]}', '/identity'],
      ['duplicate-source-property', '{"type":"object","properties":{"id":{"type":"string"},"id":{"type":"uuid"}},"identity":["id"]}', '/identity/0'],
      ['duplicate-source-identity', '{"type":"object","properties":{"id":{"type":"string"}},"identity":["id"],"identity":["id"]}', '/identity']
    ] as const;
    for (const [label, source, pointer] of cases) {
      const result = parseDocument(`memory://identity-${label}`, withRelations(source));
      expect(result.diagnostics.some((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === pointer), label).toBe(true);
      expect(result.model?.projections.definitions.find((item) => item.pointer === '')?.identity, label).toBeUndefined();
    }

    const incomplete = parseDocument('memory://identity-incomplete', '{"type":"object","identity":["id"');
    expect(incomplete.recovery).toBe('incomplete');
    expect(incomplete.model).toBeUndefined();
  });
  it('validates identity only in schema-owned locations, not literal instance payloads', () => {
    const source = JSON.stringify({
      $schema: relationsSchema,
      $uses: ['JSONStructureRelations'],
      type: 'object',
      properties: {
        valid: { type: 'object', properties: { id: { type: 'string' } }, identity: ['id'] },
        unresolved: { type: 'object', properties: { id: { type: 'string' } }, identity: ['missing'] },
        invalid: { type: 'string', identity: ['id'] }
      },
      default: { type: 'object', identity: ['missing'] }
    });
    const result = parseDocument('memory://identity-schema-traversal', source);
    const identityDiagnostics = result.diagnostics.filter((item) =>
      item.code === 'json.keyword-invalid' && item.message.includes('identity'));
    expect(identityDiagnostics.map((item) => item.location?.pointer).sort()).toEqual([
      '/properties/invalid/identity',
      '/properties/unresolved/identity/0'
    ]);
    expect(result.model?.projections.definitions.find((item) => item.pointer === '/properties/valid')?.identity).toEqual(['id']);
  });
  it('supports identity set/edit/remove with byte-identical undo and rejects invalid identity paths', async () => {
    const original = withRelations('{"definitions":{"Person":{"type":"object","properties":{"id":{"type":"string"},"name":{"type":"string"}}}},"unknown":1}');
    const host = new InMemoryEditorHost('memory://identity', original);
    const session = new DocumentSession('memory://identity', original);
    const set = new SetIdentityCommand('/definitions/Person', ['id']);
    expect(set.canExecute({ session, documentVersion: 1 })).toBe(true);
    const setResult = set.execute({ session, documentVersion: 1 });
    await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'identity-set', documentVersion: 1, edits: setResult.edits });
    const changed = await host.readDocument();
    expect(JSON.parse(changed.text).definitions.Person.identity).toEqual(['id']);
    const setInverse = setResult.inverseEdits[0];
    expect(changed.text.slice(0, setInverse.range.startOffset) + setInverse.newText + changed.text.slice(setInverse.range.endOffset)).toBe(original);

    const session2 = new DocumentSession('memory://identity2', changed.text);
    const edit = new SetIdentityCommand('/definitions/Person', ['id', 'name']);
    expect(edit.canExecute({ session: session2, documentVersion: 1 })).toBe(true);
    const editResult = edit.execute({ session: session2, documentVersion: 1 });
    await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'identity-edit', documentVersion: 2, edits: editResult.edits });
    expect(JSON.parse((await host.readDocument()).text).definitions.Person.identity).toEqual(['id', 'name']);

    const session3 = new DocumentSession('memory://identity3', (await host.readDocument()).text);
    const remove = new RemoveIdentityCommand('/definitions/Person');
    expect(remove.canExecute({ session: session3, documentVersion: 1 })).toBe(true);
    const removeResult = remove.execute({ session: session3, documentVersion: 1 });
    await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'identity-remove', documentVersion: 3, edits: removeResult.edits });
    expect(JSON.parse((await host.readDocument()).text).definitions.Person.identity).toBeUndefined();
    expect((await host.undo()).text).toContain('"identity"');

    const invalid = new DocumentSession('memory://identity-invalid', withRelations('{"definitions":{"Person":{"type":"object","properties":{"id":{"type":"string"}}}}}'));
    expect(new SetIdentityCommand('/definitions/Person', ['missing']).canExecute({ session: invalid, documentVersion: 1 })).toBe(false);
    expect(new SetIdentityCommand('/definitions/Person', ['id', 'id']).canExecute({ session: invalid, documentVersion: 1 })).toBe(false);
    const inherited = new DocumentSession('memory://identity-inherited', withRelations('{"definitions":{"Base":{"type":"object","properties":{"id":{"type":"string"}}},"Person":{"type":"object","$extends":"#/definitions/Base","properties":{"name":{"type":"string"}}}}}'));
    expect(new SetIdentityCommand('/definitions/Person', ['id']).canExecute({ session: inherited, documentVersion: 1 })).toBe(false);
    expect(new RemoveIdentityCommand('/definitions/Person').canExecute({ session: invalid, documentVersion: 1 })).toBe(false);
  });
  it('enforces identity command state and returns direct byte-identical set/remove inverses', () => {
    const withoutIdentity = withRelations('{\n  "definitions": {\n    "Person": {"type":"object","properties":{"id":{"type":"string"},"tenant":{"type":"string"}},"x-unknown":{"keep":true}}\n  },\n  "unknown": 7\n}');
    const setSession = new DocumentSession('memory://identity-direct-set', withoutIdentity);
    const set = new SetIdentityCommand('/definitions/Person', ['tenant', 'id']);
    const setContext = { session: setSession, documentVersion: 1 };
    expect(set.canExecute(setContext)).toBe(true);
    expect(set.canExecute({ session: setSession, documentVersion: 2 })).toBe(false);
    const setResult = set.execute(setContext);
    const withIdentity = withoutIdentity.slice(0, setResult.edits[0].range.startOffset) + setResult.edits[0].newText + withoutIdentity.slice(setResult.edits[0].range.endOffset);
    const setInverse = setResult.inverseEdits[0];
    expect(withIdentity.slice(0, setInverse.range.startOffset) + setInverse.newText + withIdentity.slice(setInverse.range.endOffset)).toBe(withoutIdentity);
    expect(JSON.parse(withIdentity).definitions.Person['x-unknown']).toEqual({ keep: true });

    const removeSession = new DocumentSession('memory://identity-direct-remove', withIdentity);
    const remove = new RemoveIdentityCommand('/definitions/Person');
    const removeResult = remove.execute({ session: removeSession, documentVersion: 1 });
    const removed = withIdentity.slice(0, removeResult.edits[0].range.startOffset) + removeResult.edits[0].newText + withIdentity.slice(removeResult.edits[0].range.endOffset);
    const removeInverse = removeResult.inverseEdits[0];
    expect(removed.slice(0, removeInverse.range.startOffset) + removeInverse.newText + removed.slice(removeInverse.range.endOffset)).toBe(withIdentity);
    expect(JSON.parse(removed).definitions.Person['x-unknown']).toEqual({ keep: true });

    const tuple = new DocumentSession('memory://identity-tuple-command', withRelations('{"type":"tuple","properties":{"x":{"type":"double"}},"tuple":["x"]}'));
    expect(new SetIdentityCommand('', ['x']).canExecute({ session: tuple, documentVersion: 1 })).toBe(true);
    const primitive = new DocumentSession('memory://identity-primitive-command', '{"type":"string","properties":{"id":{"type":"string"}}}');
    expect(new SetIdentityCommand('', ['id']).canExecute({ session: primitive, documentVersion: 1 })).toBe(false);
    const invalid = new DocumentSession('memory://identity-invalid-command', '{"type":');
    expect(new SetIdentityCommand('', ['id']).canExecute({ session: invalid, documentVersion: 1 })).toBe(false);
    expect(new RemoveIdentityCommand('').canExecute({ session: invalid, documentVersion: 1 })).toBe(false);
    const duplicate = new DocumentSession('memory://identity-duplicate-command', withRelations('{"type":"object","properties":{"id":{"type":"string"},"id":{"type":"uuid"}}}'));
    expect(new SetIdentityCommand('', ['id']).canExecute({ session: duplicate, documentVersion: 1 })).toBe(false);
  });
  it('does not treat default or example targettype payloads as inbound relations', () => {
    const literalPayload = new DocumentSession('memory://identity-literal-targettype', withRelations('{"definitions":{"Person":{"type":"object","properties":{"id":{"type":"string"}},"identity":["id"]}},"default":{"targettype":{"$ref":"#/definitions/Person"}},"examples":[{"targettype":{"$ref":"#/definitions/Person"}}]}'));
    expect(new RemoveIdentityCommand('/definitions/Person').canExecute({ session: literalPayload, documentVersion: 1 })).toBe(true);
  });
  it('treats a schema-owned relation target as an inbound identity dependency', () => {
    const inbound = new DocumentSession('memory://identity-inbound-targettype', withRelations('{"definitions":{"Person":{"type":"object","properties":{"id":{"type":"string"}},"identity":["id"]},"Book":{"type":"object","relations":{"owner":{"targettype":{"$ref":"#/definitions/Person"},"cardinality":"single"}}}}}'));
    expect(new RemoveIdentityCommand('/definitions/Person').canExecute({ session: inbound, documentVersion: 1 })).toBe(false);
  });
  it('conservatively blocks ambiguous targettype source within a schema-owned relation', () => {
    const duplicate = new DocumentSession('memory://identity-duplicate-targettype', withRelations('{"definitions":{"Person":{"type":"object","properties":{"id":{"type":"string"}},"identity":["id"]},"Book":{"type":"object","relations":{"owner":{"targettype":{"$ref":"#/definitions/Book"},"targettype":{"$ref":"#/definitions/Person"},"cardinality":"single"}}}}}'));
    expect(new RemoveIdentityCommand('/definitions/Person').canExecute({ session: duplicate, documentVersion: 1 })).toBe(false);

    const duplicateReference = new DocumentSession('memory://identity-duplicate-targettype-ref', withRelations('{"definitions":{"Person":{"type":"object","properties":{"id":{"type":"string"}},"identity":["id"]},"Book":{"type":"object","relations":{"owner":{"targettype":{"$ref":"#/definitions/Book","$ref":"#/definitions/Person"},"cardinality":"single"}}}}}'));
    expect(new RemoveIdentityCommand('/definitions/Person').canExecute({ session: duplicateReference, documentVersion: 1 })).toBe(false);
  });
  it('supports relation add/edit/rename/delete plus typed cardinality/scope/qualifier mutation APIs', async () => {
    const withLibrary = withRelations('{"definitions":{"Person":{"type":"object","properties":{"id":{"type":"string"}},"identity":["id"]},"Book":{"type":"object","properties":{"isbn":{"type":"string"}},"identity":["isbn"]},"Library":{"type":"array","items":{"type":{"$ref":"#/definitions/Person"}}}}}');
    const host2 = new InMemoryEditorHost('memory://relations2', withLibrary);
    const sessionOk = new DocumentSession('memory://relations2', withLibrary);
    const addOk = new AddRelationCommand('/definitions/Book', 'author', {
      targetTypeRef: '#/definitions/Person',
      cardinality: 'single',
      scope: '#/definitions/Library',
      qualifierTypeRef: '#/definitions/Person'
    });
    expect(addOk.canExecute({ session: sessionOk, documentVersion: 1 })).toBe(true);
    const addResult = addOk.execute({ session: sessionOk, documentVersion: 1 });
    await host2.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'relation-add', documentVersion: 1, edits: addResult.edits });
    const added = await host2.readDocument();
    expect(JSON.parse(added.text).definitions.Book.relations.author.cardinality).toBe('single');
    const addInverse = addResult.inverseEdits[0];
    expect(added.text.slice(0, addInverse.range.startOffset) + addInverse.newText + added.text.slice(addInverse.range.endOffset)).toBe(withLibrary);

    const editSession = new DocumentSession('memory://relations2-edit', added.text);
    const edit = new EditRelationCommand('/definitions/Book/relations/author', {
      targetTypeRef: '#/definitions/Person',
      cardinality: 'multiple',
      scope: ['#/definitions/Library'],
      qualifierTypeRef: '#/definitions/Person'
    });
    expect(edit.canExecute({ session: editSession, documentVersion: 1 })).toBe(true);
    await host2.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'relation-edit', documentVersion: 2, edits: edit.execute({ session: editSession, documentVersion: 1 }).edits });

    const renameSession = new DocumentSession('memory://relations2-rename', (await host2.readDocument()).text);
    const rename = new RenameRelationCommand('/definitions/Book/relations/author', 'contributors');
    expect(rename.canExecute({ session: renameSession, documentVersion: 1 })).toBe(true);
    await host2.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'relation-rename', documentVersion: 3, edits: rename.execute({ session: renameSession, documentVersion: 1 }).edits });
    expect(JSON.parse((await host2.readDocument()).text).definitions.Book.relations.contributors).toBeDefined();

    const typedSession = new DocumentSession('memory://relations2-typed', (await host2.readDocument()).text);
    const setCardinality = new SetRelationCardinalityCommand('/definitions/Book/relations/contributors', 'single');
    expect(setCardinality.canExecute({ session: typedSession, documentVersion: 1 })).toBe(true);
    await host2.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'relation-cardinality', documentVersion: 4, edits: setCardinality.execute({ session: typedSession, documentVersion: 1 }).edits });

    const typedSession2 = new DocumentSession('memory://relations2-typed2', (await host2.readDocument()).text);
    const setScope = new SetRelationScopeCommand('/definitions/Book/relations/contributors', undefined);
    expect(setScope.canExecute({ session: typedSession2, documentVersion: 1 })).toBe(true);
    await host2.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'relation-scope', documentVersion: 5, edits: setScope.execute({ session: typedSession2, documentVersion: 1 }).edits });

    const typedSession3 = new DocumentSession('memory://relations2-typed3', (await host2.readDocument()).text);
    const setQualifier = new SetRelationQualifierCommand('/definitions/Book/relations/contributors', undefined);
    expect(setQualifier.canExecute({ session: typedSession3, documentVersion: 1 })).toBe(true);
    await host2.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'relation-qualifier', documentVersion: 6, edits: setQualifier.execute({ session: typedSession3, documentVersion: 1 }).edits });

    const deleteSession = new DocumentSession('memory://relations2-delete', (await host2.readDocument()).text);
    const remove = new DeleteRelationCommand('/definitions/Book/relations/contributors');
    expect(remove.canExecute({ session: deleteSession, documentVersion: 1 })).toBe(true);
    const removeResult = remove.execute({ session: deleteSession, documentVersion: 1 });
    await host2.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'relation-delete', documentVersion: 7, edits: removeResult.edits });
    expect(JSON.parse((await host2.readDocument()).text).definitions.Book.relations?.contributors).toBeUndefined();

    const collision = new DocumentSession('memory://relation-collision', withRelations('{"type":"object","properties":{"owner":{"type":"string"}},"relations":{"existing":{"targettype":{"$ref":"#/definitions/T"},"cardinality":"single"}}}'));
    expect(new AddRelationCommand('', 'owner', { targetTypeRef: '#/definitions/T', cardinality: 'single' }).canExecute({ session: collision, documentVersion: 1 })).toBe(false);
    expect(new RenameRelationCommand('/relations/existing', 'owner').canExecute({ session: collision, documentVersion: 1 })).toBe(false);
  });
  it('supports import add/edit/delete at normative placements and rejects invalid placements/forms', async () => {
    const original = withImports('{"definitions":{"People":{}},"unknown":1}');
    const host = new InMemoryEditorHost('memory://imports', original);
    const session = new DocumentSession('memory://imports', original);

    const setRootImport = new SetImportCommand('', '$import', 'https://example.org/root.struct.json');
    expect(setRootImport.canExecute({ session, documentVersion: 1 })).toBe(true);
    const rootResult = setRootImport.execute({ session, documentVersion: 1 });
    await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'import-root', documentVersion: 1, edits: rootResult.edits });

    const s2 = new DocumentSession('memory://imports-2', (await host.readDocument()).text);
    const setDefsImport = new SetImportCommand('/definitions/People', '$importdefs', 'https://example.org/people.struct.json');
    expect(setDefsImport.canExecute({ session: s2, documentVersion: 1 })).toBe(true);
    await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'import-defs', documentVersion: 2, edits: setDefsImport.execute({ session: s2, documentVersion: 1 }).edits });
    const parsed = JSON.parse((await host.readDocument()).text);
    expect(parsed.$import).toBe('https://example.org/root.struct.json');
    expect(parsed.definitions.People.$importdefs).toBe('https://example.org/people.struct.json');

    const s3 = new DocumentSession('memory://imports-3', (await host.readDocument()).text);
    const delDefs = new DeleteImportCommand('/definitions/People', '$importdefs');
    expect(delDefs.canExecute({ session: s3, documentVersion: 1 })).toBe(true);
    await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'import-delete', documentVersion: 3, edits: delDefs.execute({ session: s3, documentVersion: 1 }).edits });
    expect(JSON.parse((await host.readDocument()).text).definitions.People.$importdefs).toBeUndefined();

    const invalidPlacement = new DocumentSession('memory://import-invalid-placement', withImports('{"type":"object","properties":{"x":{"type":"string"}}}'));
    expect(new SetImportCommand('/properties/x', '$import', 'https://example.org/x').canExecute({ session: invalidPlacement, documentVersion: 1 })).toBe(false);
    expect(new SetImportCommand('', '$import', '/relative').canExecute({ session: invalidPlacement, documentVersion: 1 })).toBe(true);
    expect(new SetImportCommand('', '$import', 'C:\\schemas\\root.json').canExecute({ session: invalidPlacement, documentVersion: 1 })).toBe(false);
    const relativeImport = new DocumentSession('memory://import-relative', withImports('{"definitions":{"People":{}}}'));
    expect(new SetImportCommand('/definitions/People', '$importdefs', '../people/schema.struct.json').canExecute({ session: relativeImport, documentVersion: 1 })).toBe(true);
    expect(new SetImportCommand('/definitions/People', '$importdefs', '../people/%zz.struct.json').canExecute({ session: relativeImport, documentVersion: 1 })).toBe(false);

    const bothKeywords = new DocumentSession('memory://import-both', withImports('{"definitions":{"Ns":{"$import":"https://example.org/a","$importdefs":"https://example.org/b"}}}'));
    expect(new SetImportCommand('/definitions/Ns', '$import', 'https://example.org/c').canExecute({ session: bothKeywords, documentVersion: 1 })).toBe(false);

    const danglingScope = new DocumentSession('memory://relation-dangling-scope', withRelations('{"definitions":{"Person":{"type":"object","properties":{"id":{"type":"string"}},"identity":["id"]},"Book":{"type":"object","properties":{"isbn":{"type":"string"}},"identity":["isbn"]}}}'));
    expect(
      new AddRelationCommand('/definitions/Book', 'author', { targetTypeRef: '#/definitions/Person', cardinality: 'single', scope: '#/definitions/Missing' })
        .canExecute({ session: danglingScope, documentVersion: 1 })
    ).toBe(false);
  });
  it('requires relation scopes to be compatible collections and validates root collection scope', async () => {
    const original = withRelations('{"$root":"#/definitions/RootItems","definitions":{"Target":{"type":"object","properties":{"id":{"type":"string"}},"identity":["id"]},"Other":{"type":"object","properties":{"id":{"type":"string"}},"identity":["id"]},"RootItems":{"type":"array","items":{"type":{"$ref":"#/definitions/Target"}}},"TargetSet":{"type":"set","items":{"type":{"$ref":"#/definitions/Target"}}},"TargetMap":{"type":"map","values":{"type":{"$ref":"#/definitions/Target"}}},"Wrong":{"type":"array","items":{"type":{"$ref":"#/definitions/Other"}}},"Source":{"type":"object","properties":{"id":{"type":"string"}},"identity":["id"]}}}');
    const session = new DocumentSession('memory://compatible-scopes', original);
    const context = { session, documentVersion: 1 };
    for (const scope of ['#', '#/definitions/RootItems', '#/definitions/TargetSet', '#/definitions/TargetMap']) {
      expect(new AddRelationCommand('/definitions/Source', `rel_${scope.length}`, { targetTypeRef: '#/definitions/Target', cardinality: 'single', scope }).canExecute(context)).toBe(true);
    }
    expect(new AddRelationCommand('/definitions/Source', 'wrong', { targetTypeRef: '#/definitions/Target', cardinality: 'single', scope: '#/definitions/Wrong' }).canExecute(context)).toBe(false);
    expect(new AddRelationCommand('/definitions/Source', 'not_collection', { targetTypeRef: '#/definitions/Target', cardinality: 'single', scope: '#/definitions/Target' }).canExecute(context)).toBe(false);

    const add = new AddRelationCommand('/definitions/Source', 'target', { targetTypeRef: '#/definitions/Target', cardinality: 'single', scope: '#' });
    const result = add.execute(context);
    const changed = original.slice(0, result.edits[0].range.startOffset) + result.edits[0].newText + original.slice(result.edits[0].range.endOffset);
    const inverse = result.inverseEdits[0];
    expect(changed.slice(0, inverse.range.startOffset) + inverse.newText + changed.slice(inverse.range.endOffset)).toBe(original);

    const inlineRoot = new DocumentSession('memory://inline-root-scope', withRelations('{"type":"array","items":{"type":{"$ref":"#/definitions/Target"}},"definitions":{"Target":{"type":"object","properties":{"id":{"type":"string"}},"identity":["id"]},"Source":{"type":"object"}}}'));
    expect(new AddRelationCommand('/definitions/Source', 'target', { targetTypeRef: '#/definitions/Target', cardinality: 'single', scope: '#' }).canExecute({ session: inlineRoot, documentVersion: 1 })).toBe(false);

    const encodedRoot = new DocumentSession('memory://encoded-root-scope', original.replace('#/definitions/RootItems', '#%2Fdefinitions%2FRootItems'));
    expect(new AddRelationCommand('/definitions/Source', 'encoded_root', { targetTypeRef: '#/definitions/Target', cardinality: 'single', scope: '#' }).canExecute({ session: encodedRoot, documentVersion: 1 })).toBe(true);

    const parsed = parseDocument('memory://scope-diagnostics', original.replace('#/definitions/Target\"}}},\"TargetSet', '#/definitions/Other\"}}},\"TargetSet'));
    expect(parsed.diagnostics.some((item) => item.location?.pointer === '/definitions/RootItems/items')).toBe(false);
    const badScope = parseDocument('memory://scope-diagnostics-bad', withRelations('{"$root":"#/definitions/Wrong","definitions":{"Target":{"type":"object","properties":{"id":{"type":"string"}},"identity":["id"]},"Other":{"type":"object","properties":{"id":{"type":"string"}},"identity":["id"]},"Wrong":{"type":"array","items":{"type":{"$ref":"#/definitions/Other"}}},"Source":{"type":"object","relations":{"target":{"targettype":{"$ref":"#/definitions/Target"},"cardinality":"single","scope":"#"}}}}}'));
    expect(badScope.diagnostics.some((item) => item.location?.pointer === '/definitions/Source/relations/target/scope')).toBe(true);
  });
  it('requires unique object relations, reusable valid targets, and reusable qualifiers', () => {
    const malformed = new DocumentSession('memory://malformed-relation-command', withRelations('{"definitions":{"Target":{"type":"object","properties":{"id":{"type":"string"}},"identity":["id"]},"Source":{"type":"object","relations":{"bad":1}}}}'));
    expect(new DeleteRelationCommand('/definitions/Source/relations/bad').canExecute({ session: malformed, documentVersion: 1 })).toBe(false);
    const duplicate = new DocumentSession('memory://duplicate-relation-command', withRelations('{"definitions":{"Target":{"type":"object","properties":{"id":{"type":"string"}},"identity":["id"]},"Source":{"type":"object","relations":{"bad":{"targettype":{"$ref":"#/definitions/Target"},"cardinality":"single"},"bad":{"targettype":{"$ref":"#/definitions/Target"},"cardinality":"multiple"}}}}}'));
    expect(new DeleteRelationCommand('/definitions/Source/relations/bad').canExecute({ session: duplicate, documentVersion: 1 })).toBe(false);

    const targets = new DocumentSession('memory://relation-targets', withRelations('{"definitions":{"Good":{"type":"object","properties":{"id":{"type":"string"}},"identity":["id"]},"BadIdentity":{"type":"object","properties":{"id":{"type":"string"}},"identity":["missing"]},"Primitive":{"type":"string","identity":["id"]},"Qualifier":{"type":"string"},"Holder":{"type":"object","properties":{"inline":{"type":"object","properties":{"id":{"type":"string"}},"identity":["id"]}}},"Source":{"type":"object"}}}'));
    const targetContext = { session: targets, documentVersion: 1 };
    expect(new AddRelationCommand('/definitions/Source', 'good', { targetTypeRef: '#/definitions/Good', cardinality: 'single', qualifierTypeRef: '#/definitions/Qualifier' }).canExecute(targetContext)).toBe(true);
    expect(new AddRelationCommand('/definitions/Source', 'bad_identity', { targetTypeRef: '#/definitions/BadIdentity', cardinality: 'single' }).canExecute(targetContext)).toBe(false);
    expect(new AddRelationCommand('/definitions/Source', 'primitive', { targetTypeRef: '#/definitions/Primitive', cardinality: 'single' }).canExecute(targetContext)).toBe(false);
    expect(new AddRelationCommand('/definitions/Source', 'inline', { targetTypeRef: '#/definitions/Holder/properties/inline', cardinality: 'single' }).canExecute(targetContext)).toBe(false);
    expect(new AddRelationCommand('/definitions/Source', 'inline_qualifier', { targetTypeRef: '#/definitions/Good', cardinality: 'single', qualifierTypeRef: '#/definitions/Holder/properties/inline' }).canExecute(targetContext)).toBe(false);

    const diagnostics = parseDocument('memory://relation-shapes', withRelations('{"definitions":{"Good":{"type":"object","properties":{"id":{"type":"string"}},"identity":["id"]},"BadIdentity":{"type":"object","properties":{"id":{"type":"string"}},"identity":["missing"]},"Qualifier":{"type":"string"},"Holder":{"type":"object","properties":{"inline":{"type":"object","properties":{"id":{"type":"string"}},"identity":["id"]}}},"Source":{"type":"object","relations":{"bad-name":{"targettype":{"$ref":"#/definitions/BadIdentity"},"cardinality":"single","qualifiertype":{"$ref":"#/definitions/Holder/properties/inline"}}}},"Broken":{"type":"object","relations":[]}}}'));
    for (const pointer of ['/definitions/Source/relations/bad-name', '/definitions/Source/relations/bad-name/targettype/$ref', '/definitions/Source/relations/bad-name/qualifiertype/$ref', '/definitions/Broken/relations']) {
      expect(diagnostics.diagnostics.some((item) => item.location?.pointer === pointer), pointer).toBe(true);
    }
  });
  it('protects identities used by inbound relation targets', () => {
    const used = new DocumentSession('memory://identity-inbound', withRelations('{"definitions":{"Target":{"type":"object","properties":{"id":{"type":"string"}},"identity":["id"]},"Source":{"type":"object","relations":{"target":{"targettype":{"$ref":"#/definitions/Target"},"cardinality":"single"}}}}}'));
    expect(new RemoveIdentityCommand('/definitions/Target').canExecute({ session: used, documentVersion: 1 })).toBe(false);
    const unused = new DocumentSession('memory://identity-unused', withRelations('{"definitions":{"Target":{"type":"object","properties":{"id":{"type":"string"}},"identity":["id"]}}}'));
    expect(new RemoveIdentityCommand('/definitions/Target').canExecute({ session: unused, documentVersion: 1 })).toBe(true);
  });
  it('uses structural namespace placement for imports and reusable hierarchy for SetRoot', () => {
    const original = withImports('{"definitions":{"Ns":{"Nested":{},"Type":{"type":"object","properties":{"child":{"type":"object"}}}}}}');
    const session = new DocumentSession('memory://structural-placement', original);
    expect(new SetImportCommand('', '$import', 'https://example.org/root').canExecute({ session, documentVersion: 1 })).toBe(true);
    expect(new SetImportCommand('/definitions', '$importdefs', 'https://example.org/defs').canExecute({ session, documentVersion: 1 })).toBe(true);
    expect(new SetImportCommand('/definitions/Ns/Nested', '$import', 'https://example.org/nested').canExecute({ session, documentVersion: 1 })).toBe(true);
    expect(new SetImportCommand('/definitions/Ns/Type', '$import', 'https://example.org/type').canExecute({ session, documentVersion: 1 })).toBe(false);
    expect(new SetImportCommand('/definitions/Ns/Type/properties/child', '$import', 'https://example.org/property').canExecute({ session, documentVersion: 1 })).toBe(false);
    expect(new SetRootCommand('/definitions/Ns/Type/properties/child').canExecute({ session, documentVersion: 1 })).toBe(false);

    const root = new SetRootCommand('/definitions/Ns/Type');
    const result = root.execute({ session, documentVersion: 1 });
    const changed = original.slice(0, result.edits[0].range.startOffset) + result.edits[0].newText + original.slice(result.edits[0].range.endOffset);
    const inverse = result.inverseEdits[0];
    expect(changed.slice(0, inverse.range.startOffset) + inverse.newText + changed.slice(inverse.range.endOffset)).toBe(original);

    const inline = new DocumentSession('memory://inline-set-root', '{"type":"object","definitions":{"Type":{"type":"object"}}}');
    expect(new SetRootCommand('/definitions/Type').canExecute({ session: inline, documentVersion: 1 })).toBe(false);

    const parsed = parseDocument('memory://import-structural-diagnostics', withImports('{"definitions":{"Ns":{"$import":"https://example.org/ns","Type":{"type":"object","$import":"https://example.org/type","properties":{"child":{"type":"object","$importdefs":"https://example.org/child"}}}}}}'));
    expect(parsed.diagnostics.some((item) => item.location?.pointer === '/definitions/Ns/$import')).toBe(false);
    expect(parsed.diagnostics.some((item) => item.location?.pointer === '/definitions/Ns/Type/$import')).toBe(true);
    expect(parsed.diagnostics.some((item) => item.location?.pointer === '/definitions/Ns/Type/properties/child/$importdefs')).toBe(true);
  });
  it('rejects duplicate ambiguity on identity, relation members, root, and imports', () => {
    const duplicateIdentity = new DocumentSession('memory://duplicate-identity-edit', withRelations('{"definitions":{"T":{"type":"object","properties":{"id":{"type":"string"}},"identity":["id"],"identity":["id"]}}}'));
    expect(new SetIdentityCommand('/definitions/T', ['id']).canExecute({ session: duplicateIdentity, documentVersion: 1 })).toBe(false);
    expect(new RemoveIdentityCommand('/definitions/T').canExecute({ session: duplicateIdentity, documentVersion: 1 })).toBe(false);
    const duplicateIdentityProperty = new DocumentSession('memory://duplicate-identity-property', withRelations('{"definitions":{"T":{"type":"object","properties":{"id":{"type":"string"},"id":{"type":"uuid"}}}}}'));
    expect(new SetIdentityCommand('/definitions/T', ['id']).canExecute({ session: duplicateIdentityProperty, documentVersion: 1 })).toBe(false);

    const duplicateMembers = new DocumentSession('memory://duplicate-relation-members', withRelations('{"definitions":{"T":{"type":"object","properties":{"id":{"type":"string"}},"identity":["id"]},"S":{"type":"object","relations":{"r":{"targettype":{"$ref":"#/definitions/T"},"cardinality":"single","cardinality":"multiple","scope":"#/definitions/C","scope":"#/definitions/C","qualifiertype":{"$ref":"#/definitions/T"},"qualifiertype":{"$ref":"#/definitions/T"}}}},"C":{"type":"array","items":{"$ref":"#/definitions/T"}}}}'));
    const memberContext = { session: duplicateMembers, documentVersion: 1 };
    expect(new SetRelationCardinalityCommand('/definitions/S/relations/r', 'single').canExecute(memberContext)).toBe(false);
    expect(new SetRelationScopeCommand('/definitions/S/relations/r', '#/definitions/C').canExecute(memberContext)).toBe(false);
    expect(new SetRelationQualifierCommand('/definitions/S/relations/r', '#/definitions/T').canExecute(memberContext)).toBe(false);

    const duplicateRoot = new DocumentSession('memory://duplicate-root', '{"$root":"#/definitions/A","$root":"#/definitions/B","definitions":{"A":{"type":"object"},"B":{"type":"object"}}}');
    expect(new SetRootCommand('/definitions/A').canExecute({ session: duplicateRoot, documentVersion: 1 })).toBe(false);
    const duplicateImport = new DocumentSession('memory://duplicate-import', withImports('{"$import":"https://example.org/a","$import":"https://example.org/b"}'));
    expect(new SetImportCommand('', '$import', 'https://example.org/c').canExecute({ session: duplicateImport, documentVersion: 1 })).toBe(false);
    expect(new DeleteImportCommand('', '$import').canExecute({ session: duplicateImport, documentVersion: 1 })).toBe(false);
  });
  it('enforces relation identifier grammar in commands and diagnostics', () => {
    const source = withRelations('{"definitions":{"T":{"type":"object","properties":{"id":{"type":"string"}},"identity":["id"]},"S":{"type":"object","relations":{"valid_name":{"targettype":{"$ref":"#/definitions/T"},"cardinality":"single"}}}}}');
    const session = new DocumentSession('memory://relation-names', source);
    expect(new AddRelationCommand('/definitions/S', '_alsoValid2', { targetTypeRef: '#/definitions/T', cardinality: 'single' }).canExecute({ session, documentVersion: 1 })).toBe(true);
    expect(new AddRelationCommand('/definitions/S', 'bad-name', { targetTypeRef: '#/definitions/T', cardinality: 'single' }).canExecute({ session, documentVersion: 1 })).toBe(false);
    expect(new RenameRelationCommand('/definitions/S/relations/valid_name', '2bad').canExecute({ session, documentVersion: 1 })).toBe(false);
    const parsed = parseDocument('memory://relation-name-diagnostic', source.replace('valid_name', 'bad-name'));
    expect(parsed.diagnostics.some((item) => item.location?.pointer === '/definitions/S/relations/bad-name')).toBe(true);
  });
  it('supports numeric validation strings only for extended numeric declaration types with positive multipleOf', () => {
    const validExtended = parseDocument('memory://numeric-extended', '{"$schema":"https://json-structure.org/meta/validation/v0/#","definitions":{"D":{"type":"decimal","minimum":"0.0","maximum":"10.5","exclusiveMinimum":"0.0","exclusiveMaximum":"11.0","multipleOf":"0.5"}}}');
    const d = validExtended.model?.projections.definitions[0];
    expect(d?.validation?.minimum).toBe('0.0');
    expect(d?.validation?.multipleOf).toBe('0.5');

    const invalidNonExtended = parseDocument('memory://numeric-non-extended', '{"$schema":"https://json-structure.org/meta/validation/v0/#","definitions":{"N":{"type":"number","minimum":"0"}}}');
    expect(invalidNonExtended.diagnostics.some((item) => item.location?.pointer === '/definitions/N/minimum' && item.code === 'json.keyword-invalid')).toBe(true);

    const invalidMultiple = parseDocument('memory://numeric-multipleof', '{"$schema":"https://json-structure.org/meta/validation/v0/#","definitions":{"D":{"type":"decimal","multipleOf":"0.0"}}}');
    expect(invalidMultiple.diagnostics.some((item) => item.location?.pointer === '/definitions/D/multipleOf' && item.code === 'json.keyword-invalid')).toBe(true);
  });
  it('enforces numeric keyword applicability and normative scalar representation by declaration type', () => {
    const extendedValid = parseDocument(
      'memory://numeric-extended-valid',
      '{"$schema":"https://json-structure.org/meta/validation/v0/#","definitions":{"D":{"type":"decimal","minimum":"0.0","maximum":"10.5","exclusiveMinimum":"0.001","exclusiveMaximum":"1000.0","multipleOf":"0.25"}}}'
    );
    const extended = extendedValid.model?.projections.definitions[0]?.validation;
    expect(extended?.minimum).toBe('0.0');
    expect(extended?.maximum).toBe('10.5');
    expect(extended?.exclusiveMinimum).toBe('0.001');
    expect(extended?.exclusiveMaximum).toBe('1000.0');
    expect(extended?.multipleOf).toBe('0.25');

    const extendedInvalidNumber = parseDocument(
      'memory://numeric-extended-invalid-number',
      '{"$schema":"https://json-structure.org/meta/validation/v0/#","definitions":{"D":{"type":"decimal","minimum":0,"maximum":10,"exclusiveMinimum":1,"exclusiveMaximum":2,"multipleOf":0.5}}}'
    );
    for (const pointer of [
      '/definitions/D/minimum',
      '/definitions/D/maximum',
      '/definitions/D/exclusiveMinimum',
      '/definitions/D/exclusiveMaximum',
      '/definitions/D/multipleOf'
    ]) {
      expect(extendedInvalidNumber.diagnostics.some((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === pointer)).toBe(true);
    }

    const nonExtendedValid = parseDocument(
      'memory://numeric-nonextended-valid',
      '{"$schema":"https://json-structure.org/meta/validation/v0/#","definitions":{"N":{"type":"number","minimum":0,"maximum":10.5,"exclusiveMinimum":0.1,"exclusiveMaximum":11,"multipleOf":0.5}}}'
    );
    const nonExtended = nonExtendedValid.model?.projections.definitions[0]?.validation;
    expect(nonExtended?.minimum).toBe(0);
    expect(nonExtended?.maximum).toBe(10.5);
    expect(nonExtended?.exclusiveMinimum).toBe(0.1);
    expect(nonExtended?.exclusiveMaximum).toBe(11);
    expect(nonExtended?.multipleOf).toBe(0.5);

    const nonExtendedInvalidString = parseDocument(
      'memory://numeric-nonextended-invalid-string',
      '{"$schema":"https://json-structure.org/meta/validation/v0/#","definitions":{"N":{"type":"number","minimum":"0","maximum":"10","exclusiveMinimum":"0.1","exclusiveMaximum":"11","multipleOf":"0.5"}}}'
    );
    for (const pointer of [
      '/definitions/N/minimum',
      '/definitions/N/maximum',
      '/definitions/N/exclusiveMinimum',
      '/definitions/N/exclusiveMaximum',
      '/definitions/N/multipleOf'
    ]) {
      expect(nonExtendedInvalidString.diagnostics.some((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === pointer)).toBe(true);
    }

    const nonNumericInvalid = parseDocument(
      'memory://numeric-nonnumeric-applicability',
      '{"$schema":"https://json-structure.org/meta/validation/v0/#","definitions":{"S":{"type":"string","minimum":0,"maximum":10,"exclusiveMinimum":1,"exclusiveMaximum":11,"multipleOf":1}}}'
    );
    for (const pointer of [
      '/definitions/S/minimum',
      '/definitions/S/maximum',
      '/definitions/S/exclusiveMinimum',
      '/definitions/S/exclusiveMaximum',
      '/definitions/S/multipleOf'
    ]) {
      expect(nonNumericInvalid.diagnostics.some((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === pointer)).toBe(true);
    }
    const projected = nonNumericInvalid.model?.projections.definitions[0]?.validation;
    expect(projected?.minimum).toBeUndefined();
    expect(projected?.maximum).toBeUndefined();
    expect(projected?.exclusiveMinimum).toBeUndefined();
    expect(projected?.exclusiveMaximum).toBeUndefined();
    expect(projected?.multipleOf).toBeUndefined();

    const invalidNonPositive = parseDocument(
      'memory://numeric-multiple-nonpositive',
      '{"$schema":"https://json-structure.org/meta/validation/v0/#","definitions":{"D":{"type":"decimal","multipleOf":"0.0"},"N":{"type":"number","multipleOf":0}}}'
    );
    expect(invalidNonPositive.diagnostics.some((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === '/definitions/D/multipleOf')).toBe(true);
    expect(invalidNonPositive.diagnostics.some((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === '/definitions/N/multipleOf')).toBe(true);
  });
  it('rejects empty allOf, anyOf, and oneOf arrays', () => {
    const result = parseDocument('memory://composition-empty', '{"definitions":{"Thing":{"type":"object","allOf":[],"anyOf":[],"oneOf":[]}}}');
    expect(result.diagnostics.some((item) => item.location?.pointer === '/definitions/Thing/allOf' && item.code === 'json.keyword-invalid')).toBe(true);
    expect(result.diagnostics.some((item) => item.location?.pointer === '/definitions/Thing/anyOf' && item.code === 'json.keyword-invalid')).toBe(true);
    expect(result.diagnostics.some((item) => item.location?.pointer === '/definitions/Thing/oneOf' && item.code === 'json.keyword-invalid')).toBe(true);
  });
  it('enforces tensor/frame local constraints for rank and symmetry', () => {
    const valid = parseDocument('memory://tensor-valid', `{"$schema":"${semanticSchema}","$uses":["JSONStructureSemanticAnnotations"],"definitions":{"Thing":{"type":"object","tensorReferenceFrames":[{"frames":[{"reference":"urn:frame:a","kind":"custom"},{"reference":"urn:frame:a","kind":"custom"}],"components":[{"index":[0,1],"property":"ab"}],"symmetry":"symmetric"}]}}}`);
    expect(valid.diagnostics.some((item) => item.location?.pointer === '/definitions/Thing/tensorReferenceFrames' && item.code === 'json.keyword-invalid')).toBe(false);

    const invalidRank = parseDocument('memory://tensor-rank', `{"$schema":"${semanticSchema}","$uses":["JSONStructureSemanticAnnotations"],"definitions":{"Thing":{"type":"object","tensorReferenceFrames":[{"frames":[{"reference":"urn:frame:a","kind":"custom"},{"reference":"urn:frame:b","kind":"custom"},{"reference":"urn:frame:c","kind":"custom"}],"components":[{"index":[0,1],"property":"ab"}],"symmetry":"none"}]}}}`);
    expect(invalidRank.diagnostics.some((item) => item.location?.pointer === '/definitions/Thing/tensorReferenceFrames' && item.code === 'json.keyword-invalid')).toBe(true);

    const invalidSymmetry = parseDocument('memory://tensor-symmetry', `{"$schema":"${semanticSchema}","$uses":["JSONStructureSemanticAnnotations"],"definitions":{"Thing":{"type":"object","tensorReferenceFrames":[{"frames":[{"reference":"urn:frame:a","kind":"custom"},{"reference":"urn:frame:b","kind":"custom"}],"components":[{"index":[0,1],"property":"ab"}],"symmetry":"symmetric"}]}}}`);
    expect(invalidSymmetry.diagnostics.some((item) => item.location?.pointer === '/definitions/Thing/tensorReferenceFrames' && item.code === 'json.keyword-invalid')).toBe(true);
  });
  it('requires rank-two same-frame tensor symmetry even when symmetry is none', () => {
    const validNone = parseDocument(
      'memory://tensor-symmetry-none-valid',
      `{"$schema":"${semanticSchema}","$uses":["JSONStructureSemanticAnnotations"],"definitions":{"Thing":{"type":"object","tensorReferenceFrames":[{"frames":[{"reference":"urn:frame:a","kind":"custom"},{"reference":"urn:frame:a","kind":"custom"}],"components":[{"index":[0,0],"property":"aa"}],"symmetry":"none"}]}}}`
    );
    expect(validNone.diagnostics.some((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === '/definitions/Thing/tensorReferenceFrames')).toBe(false);

    const invalidNoneDifferentFrames = parseDocument(
      'memory://tensor-symmetry-none-different-frames',
      `{"$schema":"${semanticSchema}","$uses":["JSONStructureSemanticAnnotations"],"definitions":{"Thing":{"type":"object","tensorReferenceFrames":[{"frames":[{"reference":"urn:frame:a","kind":"custom"},{"reference":"urn:frame:b","kind":"custom"}],"components":[{"index":[0,0],"property":"aa"}],"symmetry":"none"}]}}}`
    );
    expect(invalidNoneDifferentFrames.diagnostics.some((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === '/definitions/Thing/tensorReferenceFrames')).toBe(true);

    const invalidNoneWrongRank = parseDocument(
      'memory://tensor-symmetry-none-wrong-rank',
      `{"$schema":"${semanticSchema}","$uses":["JSONStructureSemanticAnnotations"],"definitions":{"Thing":{"type":"object","tensorReferenceFrames":[{"frames":[{"reference":"urn:frame:a","kind":"custom"},{"reference":"urn:frame:a","kind":"custom"},{"reference":"urn:frame:a","kind":"custom"}],"components":[{"index":[0,0,0],"property":"aaa"}],"symmetry":"none"}]}}}`
    );
    expect(invalidNoneWrongRank.diagnostics.some((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === '/definitions/Thing/tensorReferenceFrames')).toBe(true);
  });
  it('accepts symmetry when kind:type frame refs are structurally equal but parsed as separate objects', () => {
    const valid = parseDocument(
      'memory://tensor-symmetry-type-ref-structural-equal',
      `{"$schema":"${semanticSchema}","$uses":["JSONStructureSemanticAnnotations"],"definitions":{"Frame":{"type":"object"},"Thing":{"type":"object","tensorReferenceFrames":[{"frames":[{"reference":{"$ref":"#/definitions/Frame"},"kind":"type"},{"reference":{"$ref":"#/definitions/Frame"},"kind":"type"}],"components":[{"index":[0,0],"property":"aa"}],"symmetry":"none"}]}}}`
    );
    expect(valid.diagnostics.some((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === '/definitions/Thing/tensorReferenceFrames')).toBe(false);

    const invalidDifferentRef = parseDocument(
      'memory://tensor-symmetry-type-ref-structural-unequal',
      `{"$schema":"${semanticSchema}","$uses":["JSONStructureSemanticAnnotations"],"definitions":{"FrameA":{"type":"object"},"FrameB":{"type":"object"},"Thing":{"type":"object","tensorReferenceFrames":[{"frames":[{"reference":{"$ref":"#/definitions/FrameA"},"kind":"type"},{"reference":{"$ref":"#/definitions/FrameB"},"kind":"type"}],"components":[{"index":[0,0],"property":"aa"}],"symmetry":"none"}]}}}`
    );
    expect(invalidDifferentRef.diagnostics.some((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === '/definitions/Thing/tensorReferenceFrames')).toBe(true);
  });
  it('requires equal variance (or both omitted) for symmetric tensor frames including explicit symmetry none', () => {
    const validSameVariance = parseDocument(
      'memory://tensor-symmetry-variance-same',
      `{"$schema":"${semanticSchema}","$uses":["JSONStructureSemanticAnnotations"],"definitions":{"Thing":{"type":"object","tensorReferenceFrames":[{"frames":[{"reference":"urn:frame:a","kind":"custom","variance":"covariant"},{"reference":"urn:frame:a","kind":"custom","variance":"covariant"}],"components":[{"index":[0,0],"property":"aa"}],"symmetry":"none"}]}}}`
    );
    expect(validSameVariance.diagnostics.some((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === '/definitions/Thing/tensorReferenceFrames')).toBe(false);

    const validBothOmitted = parseDocument(
      'memory://tensor-symmetry-variance-both-omitted',
      `{"$schema":"${semanticSchema}","$uses":["JSONStructureSemanticAnnotations"],"definitions":{"Thing":{"type":"object","tensorReferenceFrames":[{"frames":[{"reference":"urn:frame:a","kind":"custom"},{"reference":"urn:frame:a","kind":"custom"}],"components":[{"index":[0,0],"property":"aa"}],"symmetry":"none"}]}}}`
    );
    expect(validBothOmitted.diagnostics.some((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === '/definitions/Thing/tensorReferenceFrames')).toBe(false);

    const invalidDifferentVariance = parseDocument(
      'memory://tensor-symmetry-variance-different',
      `{"$schema":"${semanticSchema}","$uses":["JSONStructureSemanticAnnotations"],"definitions":{"Thing":{"type":"object","tensorReferenceFrames":[{"frames":[{"reference":"urn:frame:a","kind":"custom","variance":"covariant"},{"reference":"urn:frame:a","kind":"custom","variance":"contravariant"}],"components":[{"index":[0,0],"property":"aa"}],"symmetry":"none"}]}}}`
    );
    expect(invalidDifferentVariance.diagnostics.some((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === '/definitions/Thing/tensorReferenceFrames')).toBe(true);

    const invalidOneOmitted = parseDocument(
      'memory://tensor-symmetry-variance-one-omitted',
      `{"$schema":"${semanticSchema}","$uses":["JSONStructureSemanticAnnotations"],"definitions":{"Thing":{"type":"object","tensorReferenceFrames":[{"frames":[{"reference":"urn:frame:a","kind":"custom","variance":"covariant"},{"reference":"urn:frame:a","kind":"custom"}],"components":[{"index":[0,0],"property":"aa"}],"symmetry":"none"}]}}}`
    );
    expect(invalidOneOmitted.diagnostics.some((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === '/definitions/Thing/tensorReferenceFrames')).toBe(true);
  });
  it('requires exactly two indices for indexed matrix components in frame transforms', () => {
    const validRotationIndexed = parseDocument(
      'memory://frame-transform-rotation-indexed-valid',
      `{"$schema":"${semanticSchema}","$uses":["JSONStructureSemanticAnnotations"],"definitions":{"Thing":{"type":"object","frameTransforms":[{"from":{"reference":"urn:frame:a","kind":"custom"},"to":{"reference":"urn:frame:b","kind":"custom"},"encoding":"rotationMatrix","components":[{"index":[0,0],"property":"m00"},{"index":[0,1],"property":"m01"},{"index":[0,2],"property":"m02"},{"index":[1,0],"property":"m10"},{"index":[1,1],"property":"m11"},{"index":[1,2],"property":"m12"},{"index":[2,0],"property":"m20"},{"index":[2,1],"property":"m21"},{"index":[2,2],"property":"m22"}]}]}}}`
    );
    expect(validRotationIndexed.diagnostics.some((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === '/definitions/Thing/frameTransforms')).toBe(false);

    const validHomogeneousIndexed = parseDocument(
      'memory://frame-transform-homogeneous-indexed-valid',
      `{"$schema":"${semanticSchema}","$uses":["JSONStructureSemanticAnnotations"],"definitions":{"Thing":{"type":"object","frameTransforms":[{"from":{"reference":"urn:frame:a","kind":"custom"},"to":{"reference":"urn:frame:b","kind":"custom"},"encoding":"homogeneousMatrix","components":[{"index":[0,0],"property":"h00"},{"index":[0,1],"property":"h01"},{"index":[0,2],"property":"h02"},{"index":[0,3],"property":"h03"},{"index":[1,0],"property":"h10"},{"index":[1,1],"property":"h11"},{"index":[1,2],"property":"h12"},{"index":[1,3],"property":"h13"},{"index":[2,0],"property":"h20"},{"index":[2,1],"property":"h21"},{"index":[2,2],"property":"h22"},{"index":[2,3],"property":"h23"},{"index":[3,0],"property":"h30"},{"index":[3,1],"property":"h31"},{"index":[3,2],"property":"h32"},{"index":[3,3],"property":"h33"}]}]}}}`
    );
    expect(validHomogeneousIndexed.diagnostics.some((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === '/definitions/Thing/frameTransforms')).toBe(false);

    const invalidOneIndex = parseDocument(
      'memory://frame-transform-indexed-one-index',
      `{"$schema":"${semanticSchema}","$uses":["JSONStructureSemanticAnnotations"],"definitions":{"Thing":{"type":"object","frameTransforms":[{"from":{"reference":"urn:frame:a","kind":"custom"},"to":{"reference":"urn:frame:b","kind":"custom"},"encoding":"rotationMatrix","components":[{"index":[0],"property":"m00"}]}]}}}`
    );
    expect(invalidOneIndex.diagnostics.some((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === '/definitions/Thing/frameTransforms')).toBe(true);

    const invalidThreeIndices = parseDocument(
      'memory://frame-transform-indexed-three-indices',
      `{"$schema":"${semanticSchema}","$uses":["JSONStructureSemanticAnnotations"],"definitions":{"Thing":{"type":"object","frameTransforms":[{"from":{"reference":"urn:frame:a","kind":"custom"},"to":{"reference":"urn:frame:b","kind":"custom"},"encoding":"homogeneousMatrix","components":[{"index":[0,0,0],"property":"h000"}]}]}}}`
    );
    expect(invalidThreeIndices.diagnostics.some((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === '/definitions/Thing/frameTransforms')).toBe(true);
  });
  it('collects semantic placements only at normative schema attachment positions', () => {
    const result = parseDocument(
      'memory://semantic-placement-scope',
      JSON.stringify({
        $schema: semanticSchema,
        $uses: ['JSONStructureSemanticAnnotations'],
        definitions: {
          Thing: {
            type: 'object',
            concepts: [{ reference: 'urn:concept:thing', kind: 'custom-concept' }],
            unknownPayload: {
              concepts: [{ reference: 'urn:concept:ignore', kind: 'custom-concept' }],
              semanticRole: 'observationValue'
            },
            properties: {
              id: {
                type: 'string',
                concepts: [{ reference: 'urn:concept:id', kind: 'custom-concept' }],
                semanticRole: 'status'
              }
            },
            values: {
              type: 'number',
              semanticRole: 'resultQuality'
            },
            items: {
              type: 'number',
              concepts: [{ reference: 'urn:concept:item', kind: 'custom-concept' }]
            },
            choices: {
              scalar: {
                type: 'number',
                semanticRole: 'resultQuality'
              }
            },
            anyOf: [
              { type: 'number', concepts: [{ reference: 'urn:concept:number', kind: 'custom-concept' }] },
              { type: 'string', concepts: [{ reference: 'urn:concept:string', kind: 'custom-concept' }] }
            ]
          }
        }
      })
    );
    expect(result.recovery).toBe('valid');
    const placements = result.model?.projections.semanticPlacements ?? [];
    expect(placements.some((entry) => entry.pointer === '/definitions/Thing')).toBe(true);
    expect(placements.some((entry) => entry.pointer === '/definitions/Thing/properties/id')).toBe(true);
    expect(placements.some((entry) => entry.pointer === '/definitions/Thing/items')).toBe(true);
    expect(placements.some((entry) => entry.pointer === '/definitions/Thing/values')).toBe(false);
    expect(placements.some((entry) => entry.pointer === '/definitions/Thing/choices/scalar')).toBe(false);
    expect(placements.some((entry) => entry.pointer === '/definitions/Thing/anyOf/0')).toBe(true);
    expect(placements.some((entry) => entry.pointer === '/definitions/Thing/anyOf/1')).toBe(true);
    expect(result.diagnostics.some((entry) => entry.location?.pointer === '/definitions/Thing/anyOf' && entry.message.includes('requires'))).toBe(false);
    expect(result.diagnostics.some((entry) => entry.location?.pointer?.startsWith('/definitions/Thing/anyOf/0'))).toBe(false);
    expect(result.diagnostics.some((entry) => entry.location?.pointer === '/definitions/Thing/values/semanticRole')).toBe(true);
    expect(placements.some((entry) => entry.pointer === '/definitions/Thing/unknownPayload')).toBe(false);
  });
  it('validates relation declarations and semantic unions against closed and open vocabularies', () => {
    const valid = parseDocument('memory://normative-forms', JSON.stringify({ $schema: semanticSchema, $uses: ['JSONStructureSemanticAnnotations'], definitions: { Thing: {
      type: 'object',
      properties: { value: { type: 'string', enum: ['active'], semanticRole: 'status', derivation: 'statistic', statistic: 'sum', phenomenonTimeRelation: 'accumulation', supportPeriod: { length: 'PT1M', anchor: 'start' }, cadence: { kind: 'onChange' }, codedValues: { reference: 'urn:codes:custom', kind: 'vendor-private' }, temporalReferenceSystem: { reference: 'urn:trs:custom', kind: 'vendor-private' } } },
    } } }));
    const relationForms = parseDocument('memory://normative-relation-forms', withRelations(JSON.stringify({ definitions: { Thing: {
      type: 'object',
      properties: { id: { type: 'string' } },
      identity: ['id'],
      relations: {
        owner: { targettype: { $ref: '#/definitions/Thing' }, cardinality: 'single' },
        peers: { targettype: { $ref: '#/definitions/Thing' }, cardinality: 'multiple' }
      }
    } } })));
    const thing = relationForms.model?.projections.definitions[0];
    const valueSemantic = valid.model?.projections.semanticPlacements.find((entry) => entry.pointer === '/definitions/Thing/properties/value')?.annotations;
    expect(thing?.relations.map((relation) => relation.cardinality)).toEqual(['single', 'multiple']);
    expect(valueSemantic?.statistic).toBe('sum');
    expect(valueSemantic?.cadence).toEqual({ kind: 'onChange' });
    expect(valueSemantic?.codedValues?.kind).toBe('vendor-private');

    const invalidCases = [
      ['missing targettype', '"relations":{"owner":{"cardinality":"single"}}', '/definitions/Thing/relations/owner'],
      ['missing cardinality', '"relations":{"owner":{"targettype":{"$ref":"#/definitions/Thing"}}}', '/definitions/Thing/relations/owner'],
      ['closed semantic role', '"semanticRole":"measurement"', '/definitions/Thing/semanticRole'],
      ['statistic sibling', '"derivation":"measured","statistic":"mean"', '/definitions/Thing/statistic'],
      ['support period sibling', '"phenomenonTimeRelation":"instant","supportPeriod":{"length":"PT1S","anchor":"end"}', '/definitions/Thing/supportPeriod'],
      ['type reference form', '"codedValues":{"reference":"urn:codes","kind":"type"}', '/definitions/Thing/codedValues']
    ] as const;
    for (const [label, body, pointer] of invalidCases) {
      const source = label.startsWith('missing ')
        ? withRelations(`{"definitions":{"Thing":{"type":"object",${body}}}}`)
        : `{"$schema":"${semanticSchema}","$uses":["JSONStructureSemanticAnnotations"],"definitions":{"Thing":{"type":"object",${body}}}}`;
      const result = parseDocument(`memory://${label}`, source);
      const diagnostic = result.diagnostics.find((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === pointer);
      expect(diagnostic, label).toBeDefined();
      expect(diagnostic?.location?.range).toBeDefined();
      expect(diagnostic!.location!.range!.startOffset).toBeGreaterThan(0);
    }
  });
  it('adds one property with a local edit and restores byte-identical text', async () => {
    const host = new InMemoryEditorHost('memory://fixture', text);
    const session = new DocumentSession('memory://fixture', text);
    const command = new AddPropertyCommand('/definitions/Person', 'name', { type: 'string', description: 'display name' });
    expect(command.canExecute({ session, documentVersion: 1 })).toBe(true);
    expect(new AddPropertyCommand('/definitions/Person', 'bad-name', { type: 'string' }).canExecute({ session, documentVersion: 1 })).toBe(false);
    const result = command.execute({ session, documentVersion: 1 });
    const applied = await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'add-1', documentVersion: 1, edits: result.edits });
    expect(applied.applied).toBe(true);
    const changed = await host.readDocument();
    expect(changed.text).toContain('"name":{"type":"string","description":"display name"}');
    expect(changed.text).toContain('"unknown": {"keep": true}');
    const inverse = result.inverseEdits[0];
    expect(changed.text.slice(0, inverse.range.startOffset) + inverse.newText + changed.text.slice(inverse.range.endOffset)).toBe(text);
    expect((await host.undo()).text).toBe(text);
  });
  it('edits one property with a local edit and restores byte-identical text', async () => {
    const host = new InMemoryEditorHost('memory://fixture', text);
    const session = new DocumentSession('memory://fixture', text);
    const command = new EditPropertyCommand('/definitions/Person/properties/id', { type: 'integer', minimum: 1 });
    expect(command.canExecute({ session, documentVersion: 1 })).toBe(true);
    expect(command.canExecute({ session, documentVersion: 2 })).toBe(false);
    const result = command.execute({ session, documentVersion: 1 });
    const applied = await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'edit-1', documentVersion: 1, edits: result.edits });
    expect(applied.applied).toBe(true);
    const changed = await host.readDocument();
    expect(JSON.parse(changed.text).definitions.Person.properties.id).toEqual({ type: 'integer', minimum: 1 });
    expect(changed.text).toContain('"unknown": {"keep": true}');
    expect((await host.undo()).text).toBe(text);
  });
  it('deletes first, middle, last, and sole properties with byte-identical undo', async () => {
    const cases = [
      ['{"type":"object","properties":{"a":{"type":"string"},"b":{"type":"number"},"c":{"type":"boolean"}},"unknown":1}', 'a'],
      ['{"type":"object","properties":{"a":{"type":"string"},"b":{"type":"number"},"c":{"type":"boolean"}},"unknown":1}', 'b'],
      ['{"type":"object","properties":{"a":{"type":"string"},"b":{"type":"number"},"c":{"type":"boolean"}},"unknown":1}', 'c'],
      ['{\n  "type": "object",\n  "properties": {\n    "only": {"type":"string"}\n  },\n  "unknown": 1\n}', 'only']
    ] as const;
    for (const [original, propertyName] of cases) {
      const host = new InMemoryEditorHost('memory://delete', original);
      const session = new DocumentSession('memory://delete', original);
      const command = new DeletePropertyCommand(`/properties/${propertyName}`);
      expect(command.canExecute({ session, documentVersion: 1 })).toBe(true);
      expect(command.canExecute({ session, documentVersion: 2 })).toBe(false);
      const result = command.execute({ session, documentVersion: 1 });
      const applied = await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: `delete-${propertyName}`, documentVersion: 1, edits: result.edits });
      expect(applied.applied).toBe(true);
      const changed = await host.readDocument();
      const parsed = JSON.parse(changed.text);
      expect(parsed.properties[propertyName]).toBeUndefined();
      expect(parsed.unknown).toBe(1);
      expect((await host.undo()).text).toBe(original);
    }
  });
  it('renames only the property key and rejects collisions', async () => {
    const original = '{"type":"object","properties":{"old_name":{"type": "string"},"taken":{"type":"number"}},"unknown":1}';
    const host = new InMemoryEditorHost('memory://rename', original);
    const session = new DocumentSession('memory://rename', original);
    const collision = new RenamePropertyCommand('/properties/old_name', 'taken');
    expect(collision.canExecute({ session, documentVersion: 1 })).toBe(false);
    expect(new RenamePropertyCommand('/properties/old_name', 'bad-name').canExecute({ session, documentVersion: 1 })).toBe(false);
    const command = new RenamePropertyCommand('/properties/old_name', 'new_name');
    expect(command.canExecute({ session, documentVersion: 1 })).toBe(true);
    const result = command.execute({ session, documentVersion: 1 });
    const applied = await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'rename-1', documentVersion: 1, edits: result.edits });
    expect(applied.applied).toBe(true);
    const changed = await host.readDocument();
    expect(JSON.parse(changed.text).properties.new_name).toEqual({ type: 'string' });
    expect(changed.text).toContain('{"type": "string"}');
    expect(changed.text).toContain('"unknown":1');
    const inverse = result.inverseEdits[0];
    expect(changed.text.slice(0, inverse.range.startOffset) + inverse.newText + changed.text.slice(inverse.range.endOffset)).toBe(original);
    expect((await host.undo()).text).toBe(original);
  });
  it('updates required and identity members atomically while still rejecting ambiguous property operations', () => {
    const referenced = new DocumentSession('memory://referenced', '{"type":"object","properties":{"id":{"type":"string"}},"required":["id"],"identity":["id"]}');
    expect(new RenamePropertyCommand('/properties/id', 'key').canExecute({ session: referenced, documentVersion: 1 })).toBe(true);
    expect(new DeletePropertyCommand('/properties/id').canExecute({ session: referenced, documentVersion: 1 })).toBe(true);

    const alternativeRequired = new DocumentSession('memory://alternative-required', '{"type":"object","properties":{"id":{"type":"string"},"email":{"type":"string"}},"required":[["id"],["email"]]}');
    expect(new RenamePropertyCommand('/properties/id', 'key').canExecute({ session: alternativeRequired, documentVersion: 1 })).toBe(true);
    expect(new DeletePropertyCommand('/properties/id').canExecute({ session: alternativeRequired, documentVersion: 1 })).toBe(true);

    const relationCollision = new DocumentSession('memory://relation-collision', withRelations('{"type":"object","properties":{"id":{"type":"string"}},"relations":{"owner":{"targettype":{"type":"object"}}}}'));
    expect(new RenamePropertyCommand('/properties/id', 'owner').canExecute({ session: relationCollision, documentVersion: 1 })).toBe(false);

    const descendant = new DocumentSession('memory://descendant', '{"type":"object","properties":{"id":{"type":"object","properties":{"nested":{"type":"string"}}}}}');
    expect(new EditPropertyCommand('/properties/id/properties/nested', { type: 'number' }).canExecute({ session: descendant, documentVersion: 1 })).toBe(true);
    expect(new EditPropertyCommand('/properties/id/type', { type: 'number' }).canExecute({ session: descendant, documentVersion: 1 })).toBe(false);

    const duplicate = new DocumentSession('memory://duplicate', '{"type":"object","properties":{"id":{"type":"string"},"id":{"type":"number"}}}');
    expect(new RenamePropertyCommand('/properties/id', 'key').canExecute({ session: duplicate, documentVersion: 1 })).toBe(false);
    expect(new DeletePropertyCommand('/properties/id').canExecute({ session: duplicate, documentVersion: 1 })).toBe(false);

    const duplicateContainer = new DocumentSession('memory://duplicate-container', '{"type":"object","properties":{"first":{"type":"string"}},"properties":{"second":{"type":"number"}}}');
    expect(new AddPropertyCommand('', 'third', { type: 'boolean' }).canExecute({ session: duplicateContainer, documentVersion: 1 })).toBe(false);
    expect(new EditPropertyCommand('/properties/second', { type: 'integer' }).canExecute({ session: duplicateContainer, documentVersion: 1 })).toBe(false);
    expect(new RenamePropertyCommand('/properties/second', 'renamed').canExecute({ session: duplicateContainer, documentVersion: 1 })).toBe(false);
    expect(new DeletePropertyCommand('/properties/second').canExecute({ session: duplicateContainer, documentVersion: 1 })).toBe(false);

    const duplicateOwner = new DocumentSession('memory://duplicate-owner', '{"definitions":{"Thing":{"type":"object"},"Thing":{"type":"object"}}}');
    expect(new AddPropertyCommand('/definitions/Thing', 'id', { type: 'string' }).canExecute({ session: duplicateOwner, documentVersion: 1 })).toBe(false);

    const inherited = new DocumentSession('memory://rename-inherited', '{"definitions":{"Base":{"type":"object","abstract":true,"properties":{"id":{"type":"string"}}},"Derived":{"type":"object","$extends":"#/definitions/Base","properties":{"name":{"type":"string"}}}}}');
    expect(new RenamePropertyCommand('/definitions/Derived/properties/name', 'id').canExecute({ session: inherited, documentVersion: 1 })).toBe(false);
  });
  it('renames a property using its exact escaped source key range', async () => {
    const original = '{"type":"object","properties":{"\\u0061\\/b":{"type":"string"}}}';
    const host = new InMemoryEditorHost('memory://escaped', original);
    const session = new DocumentSession('memory://escaped', original);
    const command = new RenamePropertyCommand('/properties/a~1b', 'renamed');
    const result = command.execute({ session, documentVersion: 1 });
    const applied = await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'escaped', documentVersion: 1, edits: result.edits });
    expect(applied.applied).toBe(true);
    const changed = await host.readDocument();
    expect(JSON.parse(changed.text).properties.renamed).toEqual({ type: 'string' });
    const inverse = result.inverseEdits[0];
    expect(changed.text.slice(0, inverse.range.startOffset) + inverse.newText + changed.text.slice(inverse.range.endOffset)).toBe(original);
  });
  it('rejects duplicates, invalid documents, and stale requests', async () => {
    const session = new DocumentSession('memory://fixture', text);
    expect(new AddPropertyCommand('/definitions/Person', 'id', { type: 'string' }).canExecute({ session, documentVersion: 1 })).toBe(false);
    expect(new AddPropertyCommand('/definitions/Person', 'name', { type: 'string' }).canExecute({ session, documentVersion: 2 })).toBe(false);
    const invalid = new DocumentSession('memory://fixture', text);
    invalid.update(text.slice(0, -2), 2);
    expect(invalid.snapshot().recovery).toBe('incomplete');
    expect(invalid.snapshot().model?.nodes.length).toBe(session.model?.nodes.length);
    const host = new InMemoryEditorHost('memory://fixture', text);
    const response = await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'stale', documentVersion: 99, edits: [] });
    expect(response.applied).toBe(false);
    expect(response.requestId).toBe('stale');
  });
  it('edits required names and alternative sets with exact inverse edits', async () => {
    const original = '{"type":"object","properties":{"a/b":{"type":"string"},"other":{"type":"string"}},"unknown": {"keep":true}}';
    const host = new InMemoryEditorHost('memory://required', original);
    const session = new DocumentSession('memory://required', original);
    const set = new SetRequiredCommand('', [['a/b'], ['other']]);
    expect(set.canExecute({ session, documentVersion: 1 })).toBe(true);
    const result = set.execute({ session, documentVersion: 1 });
    await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'required-set', documentVersion: 1, edits: result.edits });
    const changed = await host.readDocument();
    expect(JSON.parse(changed.text).required).toEqual([['a/b'], ['other']]);
    expect(changed.text).toContain('"unknown": {"keep":true}');
    await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'required-inverse', documentVersion: 2, edits: result.inverseEdits });
    expect((await host.readDocument()).text).toBe(original);

    expect(new SetRequiredCommand('', ['missing']).canExecute({ session, documentVersion: 1 })).toBe(false);
    expect(new SetRequiredCommand('', [[]]).canExecute({ session, documentVersion: 1 })).toBe(false);
    expect(new SetRequiredCommand('', [['other'], ['other', 'other']]).canExecute({ session, documentVersion: 1 })).toBe(false);
    expect(new SetRequiredCommand('', ['other']).canExecute({ session, documentVersion: 2 })).toBe(false);
    const duplicate = new DocumentSession('memory://required-duplicate', '{"type":"object","properties":{"x":{"type":"string"}},"required":["x"],"required":["x"]}');
    expect(new SetRequiredCommand('', ['x']).canExecute({ session: duplicate, documentVersion: 1 })).toBe(false);
    const incomplete = new DocumentSession('memory://required-incomplete', '{"type":"object","properties":{');
    expect(new SetRequiredCommand('', ['x']).canExecute({ session: incomplete, documentVersion: 1 })).toBe(false);
  });
  it('edits array, set, map, and tuple members while preserving unrelated source', async () => {
    const original = '{"definitions":{"Target":{"type":"string"},"A":{"type":"array","items":{"type":"string"},"x":1},"S":{"type":"set","items":{"type":"string"}},"M":{"type":"map","values":{"type":"string"}},"T":{"type":"tuple","properties":{"old":{"type":"string"}},"tuple":["old"],"unknown":true}}}';
    let current = original;
    const operations = [
      new SetCollectionMemberCommand('/definitions/A', { type: { $ref: '#/definitions/Target' } }),
      new SetCollectionMemberCommand('/definitions/S', { type: 'int32' }),
      new SetCollectionMemberCommand('/definitions/M', { type: 'boolean' })
    ];
    for (const [index, command] of operations.entries()) {
      const session = new DocumentSession(`memory://collection-${index}`, current);
      const result = command.execute({ session, documentVersion: 1 });
      const host = new InMemoryEditorHost(`memory://collection-${index}`, current);
      await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: `collection-${index}`, documentVersion: 1, edits: result.edits });
      const changed = (await host.readDocument()).text;
      await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: `collection-inverse-${index}`, documentVersion: 2, edits: result.inverseEdits });
      expect((await host.readDocument()).text).toBe(current);
      current = changed;
    }
    const tupleSession = new DocumentSession('memory://tuple', current);
    const tuple = new SetTupleMembersCommand('/definitions/T', { first: { type: 'string' }, second: { type: { $ref: '#/definitions/Target' } } }, ['first', 'second']);
    const tupleResult = tuple.execute({ session: tupleSession, documentVersion: 1 });
    const tupleHost = new InMemoryEditorHost('memory://tuple', current);
    await tupleHost.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'tuple', documentVersion: 1, edits: tupleResult.edits });
    const tupleChanged = await tupleHost.readDocument();
    expect(JSON.parse(tupleChanged.text).definitions.T.tuple).toEqual(['first', 'second']);
    expect(tupleChanged.text).toContain('"unknown":true');
    await tupleHost.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'tuple-inverse', documentVersion: 2, edits: tupleResult.inverseEdits });
    expect((await tupleHost.readDocument()).text).toBe(current);

    expect(new SetCollectionMemberCommand('/definitions/A', { $ref: '#/definitions/Target' }).canExecute({ session: tupleSession, documentVersion: 1 })).toBe(false);
    expect(new SetCollectionMemberCommand('/definitions/A', { type: { $ref: '#/definitions/Missing' } }).canExecute({ session: tupleSession, documentVersion: 1 })).toBe(false);
    expect(new SetTupleMembersCommand('/definitions/T', { first: { type: 'string' } }, ['missing']).canExecute({ session: tupleSession, documentVersion: 1 })).toBe(false);
    const inheritedTuple = new DocumentSession('memory://tuple-inherited', '{"definitions":{"Base":{"type":"tuple","abstract":true,"properties":{"x":{"type":"number"}},"tuple":["x"]},"Derived":{"type":"tuple","$extends":"#/definitions/Base","properties":{"y":{"type":"number"}},"tuple":["y"]}}}');
    expect(new SetTupleMembersCommand('/definitions/Derived', { x: { type: 'string' } }, ['x']).canExecute({ session: inheritedTuple, documentVersion: 1 })).toBe(false);
    const duplicate = new DocumentSession('memory://collection-duplicate', '{"type":"array","items":{"type":"string"},"items":{"type":"number"}}');
    expect(new SetCollectionMemberCommand('', { type: 'boolean' }).canExecute({ session: duplicate, documentVersion: 1 })).toBe(false);
  });
  it('edits description and binary annotations with direct byte-identical inverses', async () => {
    const original = '{"definitions":{"Data":{"type":"binary","description":"old","contentEncoding":"base64","unknown":1}}}';
    const commands = [
      new SetDescriptionCommand('/definitions/Data', 'new description'),
      new SetBinaryAnnotationsCommand('/definitions/Data', 'contentCompression', 'gzip'),
      new SetBinaryAnnotationsCommand('/definitions/Data', 'contentMediaType', 'application/octet-stream')
    ];
    let current = original;
    for (const [index, command] of commands.entries()) {
      const session = new DocumentSession(`memory://annotation-${index}`, current);
      expect(command.canExecute({ session, documentVersion: 1 })).toBe(true);
      const result = command.execute({ session, documentVersion: 1 });
      const host = new InMemoryEditorHost(`memory://annotation-${index}`, current);
      await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: `annotation-${index}`, documentVersion: 1, edits: result.edits });
      const changed = (await host.readDocument()).text;
      expect(changed).toContain('"unknown":1');
      await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: `annotation-inverse-${index}`, documentVersion: 2, edits: result.inverseEdits });
      expect((await host.readDocument()).text).toBe(current);
      current = changed;
    }
    const session = new DocumentSession('memory://annotation-invalid', current);
    expect(new SetBinaryAnnotationsCommand('/definitions/Data', 'contentEncoding', 'hex').canExecute({ session, documentVersion: 1 })).toBe(false);
    expect(new SetBinaryAnnotationsCommand('/definitions/Data', 'contentMediaType', 'not a media type').canExecute({ session, documentVersion: 1 })).toBe(false);
    expect(new SetDescriptionCommand('/definitions/Data', 'stale').canExecute({ session, documentVersion: 2 })).toBe(false);
    const duplicate = new DocumentSession('memory://annotation-duplicate', '{"type":"binary","description":"a","description":"b"}');
    expect(new SetDescriptionCommand('', 'c').canExecute({ session: duplicate, documentVersion: 1 })).toBe(false);
  });
  it('edits and diagnoses local type references with normalized resolution facts', async () => {
    const original = '{"definitions":{"A/B":{"type":"string"},"Use":{"type":"string","description":"keep"}}}';
    const session = new DocumentSession('memory://refs', original);
    const command = new SetTypeReferenceCommand('/definitions/Use', '#/definitions/A~1B');
    expect(command.canExecute({ session, documentVersion: 1 })).toBe(true);
    const result = command.execute({ session, documentVersion: 1 });
    const host = new InMemoryEditorHost('memory://refs', original);
    await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'ref-set', documentVersion: 1, edits: result.edits });
    const changed = await host.readDocument();
    expect(JSON.parse(changed.text).definitions.Use.type).toEqual({ $ref: '#/definitions/A~1B' });
    expect(changed.text).toContain('"description":"keep"');
    await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'ref-inverse', documentVersion: 2, edits: result.inverseEdits });
    expect((await host.readDocument()).text).toBe(original);
    expect(new SetTypeReferenceCommand('/definitions/Use', '#/definitions/Missing').canExecute({ session, documentVersion: 1 })).toBe(false);
    expect(new SetTypeReferenceCommand('', '#/definitions/A~1B').canExecute({ session, documentVersion: 1 })).toBe(false);

    const parsed = parseDocument('memory://core-inspection', '{"definitions":{"Target":{"type":"string"},"Obj":{"type":"object","properties":{"x":{"type":"string"}},"required":["x"],"description":"object"},"Arr":{"type":"array","items":{"type":{"$ref":"#/definitions/Target"}}},"Set":{"type":"set"},"Map":{"type":"map","values":{"type":"string"}},"Tuple":{"type":"tuple","properties":{"x":{"type":"string"}},"tuple":["x"]},"Bin":{"type":"binary","contentEncoding":"base64url","contentCompression":"brotli","contentMediaType":"image/png"},"Bad":{"type":{"$ref":"#/definitions/Missing"}}}}');
    const obj = parsed.model?.projections.definitions.find((entry) => entry.name === 'Obj');
    expect(obj?.required).toEqual(['x']);
    expect(obj?.description).toBe('object');
    expect(parsed.model?.projections.definitions.find((entry) => entry.name === 'Bin')?.binary).toEqual({ contentEncoding: { explicit: 'base64url', effective: 'base64url' }, contentCompression: 'brotli', contentMediaType: 'image/png' });
    const defaultBinarySource = '{"definitions":{"Bin":{"type":"binary"}}}';
    const defaultBinary = parseDocument('memory://core-default-binary', defaultBinarySource);
    expect(defaultBinary.model?.projections.definitions[0]?.binary).toEqual({ contentEncoding: { effective: 'base64' } });
    expect(Object.prototype.hasOwnProperty.call(JSON.parse(defaultBinarySource).definitions.Bin, 'contentEncoding')).toBe(false);
    expect(parsed.model?.projections.references.some((entry) => entry.target === '#/definitions/Target')).toBe(true);
    expect(parsed.diagnostics.some((entry) => entry.location?.pointer === '/definitions/Set')).toBe(true);
    expect(resolveReferences(parsed.model!).diagnostics.some((entry) => entry.location?.pointer === '/definitions/Bad/type/$ref')).toBe(true);

    const malformed = parseDocument('memory://core-invalid', '{"definitions":{"O":{"type":"string","required":["x"],"description":1},"A":{"type":"array","values":{"type":"string"}},"T":{"type":"tuple","properties":{"x":{"type":"string"}},"tuple":["x","x"]},"B":{"type":"string","contentEncoding":"base64"},"R":{"$ref":"#/definitions/O"}}}');
    for (const pointer of ['/definitions/O/required', '/definitions/O/description', '/definitions/A/values', '/definitions/T/tuple', '/definitions/B/contentEncoding']) {
      expect(malformed.diagnostics.some((entry) => entry.code === 'json.keyword-invalid' && entry.location?.pointer === pointer), pointer).toBe(true);
    }
    expect(malformed.diagnostics.some((entry) => entry.code === 'core.declaration-invalid' && entry.location?.pointer === '/definitions/R')).toBe(true);
    expect(parseDocument('memory://core-incomplete', '{"definitions":').recovery).toBe('incomplete');
  });
  it('diagnoses local references only in schema-owned type positions', () => {
    const source = JSON.stringify({
      $schema: 'https://json-structure.org/meta/validation/v0/#',
      type: 'object',
      properties: {
        rootProperty: { type: { $ref: '#/definitions/MissingRootProperty' } },
        literalData: {
          type: 'string',
          default: { $ref: '#/definitions/MissingDefault' },
          examples: [{ $ref: '#/definitions/MissingExample' }]
        }
      },
      definitions: {
        Target: { type: 'object', properties: { id: { type: 'string' } }, identity: ['id'] },
        Qualifier: { type: 'string' },
        Related: {
          type: 'object',
          properties: { id: { type: 'string' } },
          identity: ['id'],
          relations: {
            target: {
              targettype: { $ref: '#/definitions/Target' },
              cardinality: 'single',
              qualifiertype: { $ref: '#/definitions/Qualifier' }
            }
          }
        },
        ArrayUse: { type: 'array', items: { type: { $ref: '#/definitions/MissingItem' } } },
        MapUse: { type: 'map', values: { type: { $ref: '#/definitions/MissingValue' } } },
        UnionUse: { type: ['string', { $ref: '#/definitions/MissingUnion' }] },
        CompositionUse: { type: 'string', allOf: [{ type: { $ref: '#/definitions/MissingComposition' } }] }
      }
    });
    const parsed = parseDocument('memory://schema-owned-refs', source);
    const referenceDiagnostics = resolveReferences(parsed.model!).diagnostics.filter((entry) =>
      entry.code === 'resolution.reference-unresolved');
    expect(referenceDiagnostics.map((entry) => entry.location?.pointer).sort()).toEqual([
      '/definitions/ArrayUse/items/type/$ref',
      '/definitions/CompositionUse/allOf/0/type/$ref',
      '/definitions/MapUse/values/type/$ref',
      '/definitions/UnionUse/type/1/$ref',
      '/properties/rootProperty/type/$ref'
    ]);
    for (const pointer of [
      '/definitions/Related/relations/target/targettype/$ref',
      '/definitions/Related/relations/target/qualifiertype/$ref',
      '/properties/literalData/default/$ref',
      '/properties/literalData/examples/0/$ref'
    ]) {
      expect(parsed.diagnostics.some((entry) => entry.location?.pointer === pointer), pointer).toBe(false);
    }
  });
  it('traverses object-valued additionalProperties as one schema while ignoring boolean forms', () => {
    const parsed = parseDocument('memory://additional-properties-refs', JSON.stringify({
      type: 'object',
      properties: {
        dictionary: {
          type: 'object',
          additionalProperties: { type: { $ref: '#/definitions/MissingAdditionalProperty' } }
        },
        closed: { type: 'object', additionalProperties: false }
      }
    }));
    const pointer = '/properties/dictionary/additionalProperties/type/$ref';
    expect(resolveReferences(parsed.model!).diagnostics.filter((entry) =>
      entry.code === 'resolution.reference-unresolved' && entry.location?.pointer === pointer
    )).toHaveLength(1);
    expect(parsed.model?.projections.references.filter((entry) => entry.pointer === pointer)).toHaveLength(1);
    expect(parsed.model?.projections.definitions.some((entry) => entry.pointer === '/properties/closed/additionalProperties')).toBe(false);
  });
  it('validates Core scalar constraints in every nested schema position', () => {
    const parsed = parseDocument('memory://nested-core-constraints', JSON.stringify({
      $schema: 'https://json-structure.org/meta/validation/v0/#',
      $id: 'https://example.test/nested-core-constraints',
      name: 'NestedCoreConstraints',
      definitions: {
        List: { type: 'array', items: { type: 'int8', enum: [999] }, contains: { type: 'string', const: 1 } },
        Dictionary: { type: 'map', values: { type: 'string', maxLength: -1 } },
        Open: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: { type: 'string', const: 1 } },
        Union: { type: ['null', { type: 'array', items: { type: 'int8', enum: [999] } }] }
      }
    }));
    for (const pointer of [
      '/definitions/List/items/enum',
      '/definitions/List/contains/const',
      '/definitions/Dictionary/values/maxLength',
      '/definitions/Open/additionalProperties/const',
      '/definitions/Union/type/1/items/enum'
    ]) {
      expect(parsed.diagnostics.some((item) => item.location?.pointer === pointer), pointer).toBe(true);
    }
  });
  it('accepts union references and inline collections while rejecting prohibited inline compound members', () => {
    const valid = parseDocument('memory://union-ref', '{"definitions":{"Target":{"type":"string"},"Small":{"type":"int8"},"Half":{"type":"float8"},"Use":{"type":["null",{"$ref":"#/definitions/Target","description":"when present"},{"type":"array","items":{"type":"string"}},{"type":"set","items":{"type":"int32"}},{"type":"map","values":{"type":{"$ref":"#/definitions/Target"}}}]}}}');
    expect(valid.diagnostics.some((entry) => entry.location?.pointer === '/definitions/Use/type/1/$ref')).toBe(false);
    expect(valid.diagnostics.some((entry) => entry.location?.pointer === '/definitions/Use/type')).toBe(false);
    expect(valid.diagnostics.some((entry) => entry.location?.pointer === '/definitions/Small/type')).toBe(false);
    expect(valid.diagnostics.some((entry) => entry.location?.pointer === '/definitions/Half/type')).toBe(false);
    expect(valid.model?.projections.references.some((entry) => entry.pointer === '/definitions/Use/type/1/$ref' && entry.target === '#/definitions/Target')).toBe(true);

    for (const [label, member] of [
      ['object', { type: 'object', properties: { value: { type: 'string' } } }],
      ['tuple', { type: 'tuple', properties: { value: { type: 'string' } }, tuple: ['value'] }],
      ['choice', { type: 'choice', choices: { value: { type: 'string' } } }],
      ['array-without-items', { type: 'array' }],
      ['map-with-invalid-values', { type: 'map', values: { type: 'not-a-core-type' } }]
    ] as const) {
      const source = JSON.stringify({ definitions: { Use: { type: ['string', member] } } });
      const parsed = parseDocument(`memory://union-${label}`, source);
      expect(parsed.diagnostics.some((entry) => entry.location?.pointer === '/definitions/Use/type'), label).toBe(true);
      const session = new DocumentSession(`memory://union-command-${label}`, '{"type":"object","properties":{}}');
      expect(new AddPropertyCommand('', 'value', { type: ['string', member] }).canExecute({ session, documentVersion: 1 }), label).toBe(false);
    }

    const commandSession = new DocumentSession('memory://union-command-valid', '{"type":"object","properties":{},"definitions":{"Target":{"type":"string"}}}');
    for (const member of [
      { type: 'array', items: { type: 'string' } },
      { type: 'set', items: { type: 'int32' } },
      { type: 'map', values: { type: { $ref: '#/definitions/Target' } } }
    ]) {
      expect(new AddPropertyCommand('', 'value', { type: ['null', member] }).canExecute({ session: commandSession, documentVersion: 1 })).toBe(true);
    }

    const invalid = parseDocument('memory://unknown-types', '{"type":"not-a-core-type","properties":{"child":{"type":["string","also-unknown"]}}}');
    expect(invalid.diagnostics.some((entry) => entry.location?.pointer === '/type')).toBe(true);
    expect(invalid.diagnostics.some((entry) => entry.location?.pointer === '/properties/child/type')).toBe(true);
  });
  it('projects and diagnoses root and nested schemas once without traversing annotation payloads', () => {
    const parsed = parseDocument('memory://all-schema-declarations', JSON.stringify({
      type: 'object',
      properties: {
        child: { type: 'object', properties: { leaf: { type: 'unknown-leaf' } } }
      },
      codedValues: { type: 'unknown-annotation', payload: { type: 'unknown-payload' } }
    }));
    const pointers = parsed.model?.projections.definitions.map((entry) => entry.pointer) ?? [];
    expect(pointers.filter((pointer) => pointer === '')).toHaveLength(1);
    expect(pointers.filter((pointer) => pointer === '/properties/child')).toHaveLength(1);
    expect(pointers.filter((pointer) => pointer === '/properties/child/properties/leaf')).toHaveLength(1);
    expect(parsed.diagnostics.filter((entry) => entry.location?.pointer === '/properties/child/properties/leaf/type')).toHaveLength(1);
    expect(pointers.some((pointer) => pointer.startsWith('/codedValues'))).toBe(false);
    expect(parsed.diagnostics.some((entry) => entry.location?.pointer?.startsWith('/codedValues/type'))).toBe(false);
  });
  it('accepts empty simple required and empty tuples while preserving strict alternative sets', () => {
    const parsed = parseDocument('memory://empty-core-members', '{"definitions":{"O":{"type":"object","properties":{},"required":[]},"T":{"type":"tuple","properties":{},"tuple":[]}}}');
    expect(parsed.diagnostics.some((entry) => entry.location?.pointer === '/definitions/O/required')).toBe(false);
    expect(parsed.diagnostics.some((entry) => entry.location?.pointer === '/definitions/T/tuple')).toBe(false);
    expect(parsed.model?.projections.definitions.find((entry) => entry.name === 'O')?.required).toEqual([]);
    expect(parsed.model?.projections.definitions.find((entry) => entry.name === 'T')?.tuple).toEqual([]);

    const objectSession = new DocumentSession('memory://empty-required', '{"type":"object","properties":{"x":{"type":"string"}}}');
    expect(new SetRequiredCommand('', []).canExecute({ session: objectSession, documentVersion: 1 })).toBe(true);
    expect(new SetRequiredCommand('', [[]]).canExecute({ session: objectSession, documentVersion: 1 })).toBe(false);
    const tupleSession = new DocumentSession('memory://empty-tuple', '{"type":"tuple","properties":{"x":{"type":"string"}},"tuple":["x"],"unknown":true}');
    const emptyTuple = new SetTupleMembersCommand('', {}, []);
    expect(emptyTuple.canExecute({ session: tupleSession, documentVersion: 1 })).toBe(true);
    const result = emptyTuple.execute({ session: tupleSession, documentVersion: 1 });
    const changed = result.edits.reduce((source, edit) => source.slice(0, edit.range.startOffset) + edit.newText + source.slice(edit.range.endOffset), tupleSession.snapshot().text);
    expect(JSON.parse(changed)).toEqual({ type: 'tuple', properties: {}, tuple: [], unknown: true });
  });
  it('accepts legal union member schemas in collection and tuple commands and rejects unknown types', () => {
    const source = '{"definitions":{"Target":{"type":"string"},"A":{"type":"array","items":{"type":"string"}},"T":{"type":"tuple","properties":{},"tuple":[]}}}';
    const session = new DocumentSession('memory://union-command-members', source);
    const union = { type: ['null', { $ref: '#/definitions/Target', description: 'present' }] };
    expect(new SetCollectionMemberCommand('/definitions/A', union).canExecute({ session, documentVersion: 1 })).toBe(true);
    expect(new SetTupleMembersCommand('/definitions/T', { value: union }, ['value']).canExecute({ session, documentVersion: 1 })).toBe(true);
    expect(new SetCollectionMemberCommand('/definitions/A', { type: 'not-a-core-type' }).canExecute({ session, documentVersion: 1 })).toBe(false);
    expect(new SetTupleMembersCommand('/definitions/T', { value: { type: ['string', 'unknown'] } }, ['value']).canExecute({ session, documentVersion: 1 })).toBe(false);
  });
  it('requires an object declaration and rejects relation-name collisions', () => {
    const scalar = new DocumentSession('memory://scalar', '{"type":"string","properties":{}}');
    expect(new AddPropertyCommand('', 'x', { type: 'string' }).canExecute({ session: scalar, documentVersion: 1 })).toBe(false);
    const relation = new DocumentSession('memory://relation', withRelations('{"type":"object","relations":{"x":{}}}'));
    expect(new AddPropertyCommand('', 'x', { type: 'string' }).canExecute({ session: relation, documentVersion: 1 })).toBe(false);
    const nullProperties = new DocumentSession('memory://null-properties', '{"type":"object","properties":null}');
    expect(new AddPropertyCommand('', 'x', { type: 'string' }).canExecute({ session: nullProperties, documentVersion: 1 })).toBe(false);
    const protoProperty = new DocumentSession('memory://proto-property', '{"type":"object","properties":{"__proto__":{"type":"string"}}}');
    expect(new AddPropertyCommand('', '__proto__', { type: 'number' }).canExecute({ session: protoProperty, documentVersion: 1 })).toBe(false);
    expect(new RenamePropertyCommand('/properties/__proto__', 'prototypeValue').canExecute({ session: protoProperty, documentVersion: 1 })).toBe(true);
  });
  it('formats minimal edits for inline, multiline, empty, and absent properties', async () => {
    const cases = [
      '{"type":"object","properties":{"a":{"type":"string"}},"unknown": 1}',
      '{"type":"object","properties":{},"unknown": 1}',
      '{\n  "type": "object",\n  "properties": {\n    "a": {"type":"string"}\n  },\n  "unknown": 1\n}',
      '{"type":"object","unknown": 1}'
    ];
    for (const original of cases) {
      const host = new InMemoryEditorHost('memory://edit', original);
      const session = new DocumentSession('memory://edit', original);
      const result = new AddPropertyCommand('', 'b', { type: 'number' }).execute({ session, documentVersion: 1 });
      const applied = await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'minimal', documentVersion: 1, edits: result.edits });
      expect(applied.applied).toBe(true);
      const changed = await host.readDocument();
      expect(() => JSON.parse(changed.text)).not.toThrow();
      expect((await host.undo()).text).toBe(original);
    }
  });
  it('adds, renames, and deletes definitions with inverse edits and minimal source changes', async () => {
    const original = '{"definitions":{"User":{"type":"object"}},"unknown":1}';
    const addHost = new InMemoryEditorHost('memory://defs', original);
    const addSession = new DocumentSession('memory://defs', original);
    const add = new AddDefinitionCommand('', 'Team', { type: 'object', properties: { id: { type: 'string' } } });
    expect(add.canExecute({ session: addSession, documentVersion: 1 })).toBe(true);
    expect(new AddDefinitionCommand('', 'Invalid', { type: 'not-a-core-type' }).canExecute({ session: addSession, documentVersion: 1 })).toBe(false);
    expect(new AddDefinitionCommand('', 'bad-name', { type: 'string' }).canExecute({ session: addSession, documentVersion: 1 })).toBe(false);
    const addResult = add.execute({ session: addSession, documentVersion: 1 });
    const addApplied = await addHost.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'add-def', documentVersion: 1, edits: addResult.edits });
    expect(addApplied.applied).toBe(true);
    const added = await addHost.readDocument();
    expect(JSON.parse(added.text).definitions.Team).toEqual({ type: 'object', properties: { id: { type: 'string' } } });
    const addInverse = addResult.inverseEdits[0];
    expect(added.text.slice(0, addInverse.range.startOffset) + addInverse.newText + added.text.slice(addInverse.range.endOffset)).toBe(original);
    expect((await addHost.undo()).text).toBe(original);

    const renameHost = new InMemoryEditorHost('memory://defs', original);
    const renameSession = new DocumentSession('memory://defs', original);
    const rename = new RenameDefinitionCommand('/definitions/User', 'Profile');
    expect(rename.canExecute({ session: renameSession, documentVersion: 1 })).toBe(true);
    expect(new RenameDefinitionCommand('/definitions/User', '1Profile').canExecute({ session: renameSession, documentVersion: 1 })).toBe(false);
    const renameResult = rename.execute({ session: renameSession, documentVersion: 1 });
    const renameApplied = await renameHost.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'rename-def', documentVersion: 1, edits: renameResult.edits });
    expect(renameApplied.applied).toBe(true);
    const renamed = await renameHost.readDocument();
    expect(JSON.parse(renamed.text).definitions.Profile).toEqual({ type: 'object' });
    const renameInverse = renameResult.inverseEdits[0];
    expect(renamed.text.slice(0, renameInverse.range.startOffset) + renameInverse.newText + renamed.text.slice(renameInverse.range.endOffset)).toBe(original);
    expect((await renameHost.undo()).text).toBe(original);

    const deleteOriginal = '{"definitions":{"User":{"type":"object"},"Team":{"type":"object"}},"unknown":1}';
    const deleteHost = new InMemoryEditorHost('memory://defs', deleteOriginal);
    const deleteSession = new DocumentSession('memory://defs', deleteOriginal);
    const remove = new DeleteDefinitionCommand('/definitions/Team');
    expect(remove.canExecute({ session: deleteSession, documentVersion: 1 })).toBe(true);
    const removeResult = remove.execute({ session: deleteSession, documentVersion: 1 });
    const removeApplied = await deleteHost.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'delete-def', documentVersion: 1, edits: removeResult.edits });
    expect(removeApplied.applied).toBe(true);
    const removed = await deleteHost.readDocument();
    expect(JSON.parse(removed.text).definitions.Team).toBeUndefined();
    const inverseApplied = await deleteHost.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'delete-def-inverse', documentVersion: 2, edits: removeResult.inverseEdits });
    expect(inverseApplied.applied).toBe(true);
    const restored = await deleteHost.readDocument();
    expect(restored.text).toBe(deleteOriginal);
    expect((await deleteHost.undo()).text).toBe(removed.text);
    expect((await deleteHost.undo()).text).toBe(deleteOriginal);
  });
  it('sets root with namespace-aware invariants and byte-identical inverse edits', async () => {
    const original = '{"definitions":{"User":{"type":"object"}},"unknown":1}';
    const host = new InMemoryEditorHost('memory://root', original);
    const session = new DocumentSession('memory://root', original);
    const command = new SetRootCommand('/definitions/User');
    expect(command.canExecute({ session, documentVersion: 1 })).toBe(true);
    const result = command.execute({ session, documentVersion: 1 });
    const applied = await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'set-root', documentVersion: 1, edits: result.edits });
    expect(applied.applied).toBe(true);
    const changed = await host.readDocument();
    expect(JSON.parse(changed.text).$root).toBe('#/definitions/User');
    const inverse = result.inverseEdits[0];
    expect(changed.text.slice(0, inverse.range.startOffset) + inverse.newText + changed.text.slice(inverse.range.endOffset)).toBe(original);
    expect((await host.undo()).text).toBe(original);

    const existing = '{"$root":"#/definitions/User","definitions":{"User":{"type":"object"},"Order":{"type":"object"}}}';
    const host2 = new InMemoryEditorHost('memory://root-existing', existing);
    const session2 = new DocumentSession('memory://root-existing', existing);
    const command2 = new SetRootCommand('/definitions/Order');
    const result2 = command2.execute({ session: session2, documentVersion: 1 });
    const applied2 = await host2.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'set-root-existing', documentVersion: 1, edits: result2.edits });
    expect(applied2.applied).toBe(true);
    expect(JSON.parse((await host2.readDocument()).text).$root).toBe('#/definitions/Order');
    expect((await host2.undo()).text).toBe(existing);

    const namespaceRoot = new DocumentSession('memory://namespace-root', '{"definitions":{"Ns":{"definitions":{"Type":{"type":"object"}}}}}');
    expect(new SetRootCommand('/definitions/Ns').canExecute({ session: namespaceRoot, documentVersion: 1 })).toBe(false);

    const typeRefRoot = new DocumentSession('memory://typeref-root', '{"definitions":{"Alias":{"type":{"$ref":"#/definitions/Target"}},"Target":{"type":"object"}}}');
    expect(new SetRootCommand('/definitions/Alias').canExecute({ session: typeRefRoot, documentVersion: 1 })).toBe(true);
  });
  it('rejects stale, invalid, ambiguous, and reference-breaking definition and root writes', () => {
    const stale = new DocumentSession('memory://stale', '{"definitions":{"User":{"type":"object"}}}');
    expect(new AddDefinitionCommand('', 'Team', { type: 'object' }).canExecute({ session: stale, documentVersion: 2 })).toBe(false);

    const invalid = new DocumentSession('memory://invalid', '{"definitions":{"User":{"type":"object"}}');
    expect(new AddDefinitionCommand('', 'Team', { type: 'object' }).canExecute({ session: invalid, documentVersion: 1 })).toBe(false);

    const duplicate = new DocumentSession('memory://dup-def', '{"definitions":{"User":{"type":"object"},"User":{"type":"string"}}}');
    expect(new RenameDefinitionCommand('/definitions/User', 'Profile').canExecute({ session: duplicate, documentVersion: 1 })).toBe(false);
    expect(new DeleteDefinitionCommand('/definitions/User').canExecute({ session: duplicate, documentVersion: 1 })).toBe(false);

    const collision = new DocumentSession('memory://collision', '{"definitions":{"User":{"type":"object"},"Profile":{"type":"object"}}}');
    expect(new RenameDefinitionCommand('/definitions/User', 'Profile').canExecute({ session: collision, documentVersion: 1 })).toBe(false);

    const referenced = new DocumentSession('memory://referenced-def', '{"definitions":{"User":{"type":"object"},"Team":{"type":{"$ref":"#/definitions/User"}}}}');
    expect(new RenameDefinitionCommand('/definitions/User', 'Profile').canExecute({ session: referenced, documentVersion: 1 })).toBe(true);
    expect(new DeleteDefinitionCommand('/definitions/User').canExecute({ session: referenced, documentVersion: 1 })).toBe(false);

    const extendsRef = new DocumentSession('memory://extends-def', '{"definitions":{"User":{"type":"object"},"Team":{"$extends":["#/definitions/User"]}}}');
    expect(new RenameDefinitionCommand('/definitions/User', 'Profile').canExecute({ session: extendsRef, documentVersion: 1 })).toBe(true);
    expect(new DeleteDefinitionCommand('/definitions/User').canExecute({ session: extendsRef, documentVersion: 1 })).toBe(false);

    const targetTypeRef = new DocumentSession('memory://targettype-def', withRelations('{"definitions":{"User":{"type":"object"},"Team":{"type":"object","relations":{"owner":{"targettype":{"$ref":"#/definitions/User"}}}}}}'));
    expect(new RenameDefinitionCommand('/definitions/User', 'Profile').canExecute({ session: targetTypeRef, documentVersion: 1 })).toBe(true);
    expect(new DeleteDefinitionCommand('/definitions/User').canExecute({ session: targetTypeRef, documentVersion: 1 })).toBe(false);

    const qualifierTypeRef = new DocumentSession('memory://qualifiertype-def', withRelations('{"definitions":{"User":{"type":"object"},"Team":{"type":"object","relations":{"owner":{"qualifiertype":{"$ref":"#/definitions/User"}}}}}}'));
    expect(new RenameDefinitionCommand('/definitions/User', 'Profile').canExecute({ session: qualifierTypeRef, documentVersion: 1 })).toBe(true);
    expect(new DeleteDefinitionCommand('/definitions/User').canExecute({ session: qualifierTypeRef, documentVersion: 1 })).toBe(false);

    const rootRef = new DocumentSession('memory://root-ref', '{"$root":"#/definitions/User","definitions":{"User":{"type":"object"}}}');
    const renameRoot = new RenameDefinitionCommand('/definitions/User', 'Profile');
    expect(renameRoot.canExecute({ session: rootRef, documentVersion: 1 })).toBe(true);
    const renamedRootText = [...renameRoot.execute({ session: rootRef, documentVersion: 1 }).edits]
      .sort((left, right) => right.range.startOffset! - left.range.startOffset!)
      .reduce((source, edit) => source.slice(0, edit.range.startOffset) + edit.newText + source.slice(edit.range.endOffset), rootRef.snapshot().text);
    expect(JSON.parse(renamedRootText)).toEqual({ $root: '#/definitions/Profile', definitions: { Profile: { type: 'object' } } });
    expect(new DeleteDefinitionCommand('/definitions/User').canExecute({ session: rootRef, documentVersion: 1 })).toBe(false);

    const encodedRootRef = new DocumentSession('memory://encoded-root-ref', '{"$root":"#%2Fdefinitions%2FUser","definitions":{"User":{"type":"object"},"Team":{"type":"object"}}}');
    expect(new RenameDefinitionCommand('/definitions/User', 'Profile').canExecute({ session: encodedRootRef, documentVersion: 1 })).toBe(true);
    expect(new DeleteDefinitionCommand('/definitions/User').canExecute({ session: encodedRootRef, documentVersion: 1 })).toBe(false);
    expect(new RenameDefinitionCommand('/definitions/Team', 'Group').canExecute({ session: encodedRootRef, documentVersion: 1 })).toBe(true);
    expect(new DeleteDefinitionCommand('/definitions/Team').canExecute({ session: encodedRootRef, documentVersion: 1 })).toBe(true);

    const malformedRootRef = new DocumentSession('memory://malformed-root-ref', '{"$root":"#%ZZ","definitions":{"User":{"type":"object"}}}');
    expect(() => new RenameDefinitionCommand('/definitions/User', 'Profile').canExecute({ session: malformedRootRef, documentVersion: 1 })).not.toThrow();
    expect(() => new DeleteDefinitionCommand('/definitions/User').canExecute({ session: malformedRootRef, documentVersion: 1 })).not.toThrow();

    const nestedNamespaceRef = new DocumentSession('memory://nested-ref', '{"definitions":{"Container":{"type":"object","definitions":{"Inner":{"type":"object"},"Use":{"type":{"$ref":"#/definitions/Container/definitions/Inner"}}}}}}');
    expect(new RenameDefinitionCommand('/definitions/Container/definitions/Inner', 'Renamed').canExecute({ session: nestedNamespaceRef, documentVersion: 1 })).toBe(true);
    expect(new DeleteDefinitionCommand('/definitions/Container/definitions/Inner').canExecute({ session: nestedNamespaceRef, documentVersion: 1 })).toBe(false);

    const nestedNamespace = new DocumentSession('memory://nested-ns', '{"definitions":{"Container":{"type":"object","definitions":{"Inner":{"type":"object"}}}}}');
    expect(new AddDefinitionCommand('/definitions/Container', 'Leaf', { type: 'object' }).canExecute({ session: nestedNamespace, documentVersion: 1 })).toBe(true);
    expect(new RenameDefinitionCommand('/definitions/Container/definitions/Inner', 'Leaf').canExecute({ session: nestedNamespace, documentVersion: 1 })).toBe(true);
    expect(new DeleteDefinitionCommand('/definitions/Container/definitions/Inner').canExecute({ session: nestedNamespace, documentVersion: 1 })).toBe(true);

    const escaped = new DocumentSession('memory://escaped-def', '{"definitions":{"\u0055\/ser":{"type":"object"}}}');
    expect(new RenameDefinitionCommand('/definitions/U~1ser', 'User').canExecute({ session: escaped, documentVersion: 1 })).toBe(true);
    expect(new DeleteDefinitionCommand('/definitions/U~1ser').canExecute({ session: escaped, documentVersion: 1 })).toBe(true);

    const invalidRoot = new DocumentSession('memory://invalid-root', '{"definitions":{"User":{"type":"object"}}}');
    expect(new SetRootCommand('/definitions/Missing').canExecute({ session: invalidRoot, documentVersion: 1 })).toBe(false);
    expect(new SetRootCommand('/properties/id').canExecute({ session: invalidRoot, documentVersion: 1 })).toBe(false);
  });
  it('preserves RFC 6901 escaping when constructing and matching definition references', async () => {
    const definitionPointer = '/definitions/A~1B~0C';
    const reference = '#/definitions/A~1B~0C';
    const source = JSON.stringify({ definitions: { 'A/B~C': { type: 'object' } } });
    const rootHost = new InMemoryEditorHost('memory://escaped-root', source);
    const rootSession = new DocumentSession('memory://escaped-root', source);
    const rootResult = new SetRootCommand(definitionPointer).execute({ session: rootSession, documentVersion: 1 });
    await rootHost.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'escaped-root', documentVersion: 1, edits: rootResult.edits });
    expect(JSON.parse((await rootHost.readDocument()).text).$root).toBe(reference);

    const sites = [
      { $root: reference },
      { definitions: { Use: { $extends: reference } } },
      { definitions: { Use: { type: { $ref: reference } } } },
      { definitions: { Use: { type: 'object', relations: { target: { targettype: { $ref: reference } } } } } },
      { definitions: { Use: { type: 'object', relations: { target: { qualifiertype: { $ref: reference } } } } } }
    ];
    for (const site of sites) {
      const value = { ...site, definitions: { 'A/B~C': { type: 'object' }, ...(site.definitions ?? {}) } };
      const document = Object.prototype.hasOwnProperty.call(site.definitions?.Use ?? {}, 'relations')
        ? withRelations(JSON.stringify(value))
        : JSON.stringify(value);
      const session = new DocumentSession('memory://escaped-reference', document);
      const rename = new RenameDefinitionCommand(definitionPointer, 'Renamed');
      expect(rename.canExecute({ session, documentVersion: 1 })).toBe(true);
      const renamed = [...rename.execute({ session, documentVersion: 1 }).edits]
        .sort((left, right) => right.range.startOffset! - left.range.startOffset!)
        .reduce((text, edit) => text.slice(0, edit.range.startOffset) + edit.newText + text.slice(edit.range.endOffset), document);
      expect(renamed).not.toContain(reference);
      expect(renamed).toContain('#/definitions/Renamed');
      expect(new DeleteDefinitionCommand(definitionPointer).canExecute({ session, documentVersion: 1 })).toBe(false);
    }
  });
  it('rejects malformed, overlapping, out-of-range, and invalid-state writes with echoed IDs', async () => {
    const host = new InMemoryEditorHost('memory://protocol', '{"type":"object"}');
    const malformed = await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: ' ', documentVersion: 1, edits: [] });
    expect(malformed.diagnostics[0]?.code).toBe('host.malformed-request');
    const overlap = await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'overlap', documentVersion: 1, edits: [
      { range: { start: { line: 0, column: 0 }, end: { line: 0, column: 1 }, startOffset: 0, endOffset: 2 }, newText: 'x' },
      { range: { start: { line: 0, column: 1 }, end: { line: 0, column: 2 }, startOffset: 1, endOffset: 3 }, newText: 'y' }
    ] });
    expect(overlap.diagnostics[0]?.code).toBe('host.overlap');
    const outOfRange = await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'range', documentVersion: 1, edits: [
      { range: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 }, startOffset: 0, endOffset: 999 }, newText: '' }
    ] });
    expect(outOfRange.diagnostics[0]?.code).toBe('host.invalid-edit');
    const invalid = new InMemoryEditorHost('memory://invalid', '{"type":"object"}');
    await invalid.readDocument();
    (invalid as unknown as { session: DocumentSession }).session.update('{', 1);
    const rejected = await invalid.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'recover', documentVersion: 1, edits: [] });
    expect(rejected.diagnostics[0]?.code).toBe('host.invalid-state');
    expect(rejected.requestId).toBe('recover');
  });
  it('keeps one selection identity across projections', () => {
    const model = parseDocument('memory://selection', text).model;
    const selection = resolveSelection(model, '/definitions/Person/properties/id');
    expect(selection?.nodeId).toBe('node:memory://selection:/definitions/Person/properties/id');
    for (const mode of ['design', 'graph', 'source', 'outline', 'inspector'] as const) {
      expect(selectionForMode(selection!, mode).selection.nodeId).toBe(selection?.nodeId);
    }
    expect(sameSelection(selection, selectionForMode(selection!, 'graph').selection)).toBe(true);
  });
});
