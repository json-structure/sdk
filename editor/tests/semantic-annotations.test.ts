import { describe, expect, it } from 'vitest';
import {
  DocumentSession,
  SetAudioChannelsCommand,
  SetCadenceCommand,
  SetCodedValuesCommand,
  SetColorSpacesCommand,
  SetConceptsCommand,
  SetCoordinateReferenceSystemCommand,
  SetDerivationCommand,
  SetFrameTransformsCommand,
  SetLinearReferenceSystemCommand,
  SetMeasurementConditioningCommand,
  SetObservedPropertyCommand,
  SetPhenomenonTimeRelationCommand,
  SetReferenceRoleCommand,
  SetSemanticRoleCommand,
  SetSpectralBandsCommand,
  SetStatisticCommand,
  SetSupportPeriodCommand,
  SetTemporalReferenceSystemCommand,
  SetTensorReferenceFramesCommand,
  SetVectorReferenceFramesCommand,
  parseDocument,
  type EditorCommand
} from '../src/index.js';

const extended = 'https://json-structure.org/meta/extended/v0/#';
const semantic = 'https://json-structure.org/meta/semantic-annotations/v0/#';

function apply(text: string, command: EditorCommand): { changed: string; restored: string } {
  const session = new DocumentSession('memory://semantic-edit', text);
  const result = command.execute({ session, documentVersion: 1 });
  const edit = result.edits[0];
  const changed = text.slice(0, edit.range.startOffset) + edit.newText + text.slice(edit.range.endOffset);
  const inverse = result.inverseEdits[0];
  return { changed, restored: changed.slice(0, inverse.range.startOffset) + inverse.newText + changed.slice(inverse.range.endOffset) };
}

function execute(text: string, command: EditorCommand, documentVersion = 1) {
  const session = new DocumentSession('memory://semantic-execute', text);
  return command.execute({ session, documentVersion });
}

describe('Semantic Annotations authoring', () => {
  it('uses the normative activation matrix and enforces placement', () => {
    const matrix: ReadonlyArray<readonly [Record<string, unknown>, boolean]> = [
      [{ $schema: semantic }, true],
      [{ $schema: extended, $uses: ['JSONStructureSemanticAnnotations'] }, true],
      [{ $schema: extended, $uses: ['SemanticAnnotations'] }, false],
      [{ $schema: extended }, false],
      [{ $schema: 'https://json-structure.org/meta/core/v0/#', $uses: ['JSONStructureSemanticAnnotations'] }, false]
    ];
    for (const [header, expected] of matrix) {
      const session = new DocumentSession('memory://activation', JSON.stringify({ ...header, type: 'string' }));
      expect(session.capabilities.semanticAnnotationsActive).toBe(expected);
      expect(new SetConceptsCommand('', [{ reference: 'https://example.test/concept', kind: 'skos-concept' }]).canExecute({ session, documentVersion: 1 })).toBe(expected);
    }
    const scalar = new DocumentSession('memory://scalar', JSON.stringify({ $schema: semantic, type: 'string' }));
    expect(new SetCoordinateReferenceSystemCommand('', { reference: 'https://www.opengis.net/def/crs/EPSG/0/4326', kind: 'epsg', coordinates: ['lat', 'lon'] }).canExecute({ session: scalar, documentVersion: 1 })).toBe(false);
    const record = new DocumentSession('memory://record', JSON.stringify({ $schema: semantic, type: 'object', properties: { lat: { type: 'number' }, lon: { type: 'number' } } }));
    expect(new SetCoordinateReferenceSystemCommand('', { reference: 'https://www.opengis.net/def/crs/EPSG/0/4326', kind: 'epsg', coordinates: ['lat', 'lon'] }).canExecute({ session: record, documentVersion: 1 })).toBe(true);
  });

  it('preserves exact bytes for add, replace, and remove', () => {
    const original = `{"$schema":"${semantic}","type":"object","properties":{"value":{"type":"string","unknown":{"keep":"\\u0061"}}}}`;
    const pointer = '/properties/value';
    const added = apply(original, new SetSemanticRoleCommand(pointer, 'featureOfInterest'));
    expect(added.restored).toBe(original);
    const replaced = apply(added.changed, new SetSemanticRoleCommand(pointer, 'observationValue'));
    expect(replaced.restored).toBe(added.changed);
    const removed = apply(replaced.changed, new SetSemanticRoleCommand(pointer, undefined));
    expect(removed.restored).toBe(replaced.changed);
  });

  it('validates the complete candidate annotation set before removal', () => {
    const temporal = JSON.stringify({
      $schema: semantic,
      type: 'object',
      properties: {
        value: {
          type: 'string',
          semanticRole: 'resultTime',
          temporalReferenceSystem: { reference: 'https://example.test/time', kind: 'custom' }
        }
      }
    });
    const temporalSession = new DocumentSession('memory://remove-temporal-system', temporal);
    expect(new SetTemporalReferenceSystemCommand('/properties/value', undefined).canExecute({ session: temporalSession, documentVersion: 1 })).toBe(false);

    const fixedState = JSON.stringify({
      $schema: semantic,
      type: 'object',
      properties: {
        value: {
          type: 'string',
          semanticRole: 'status',
          concepts: [{ reference: 'https://example.test/state', kind: 'custom' }],
          derivation: 'measured'
        }
      }
    });
    const fixedStateSession = new DocumentSession('memory://remove-fixed-state', fixedState);
    expect(new SetConceptsCommand('/properties/value', undefined).canExecute({ session: fixedStateSession, documentVersion: 1 })).toBe(false);

    const removed = apply(fixedState, new SetDerivationCommand('/properties/value', undefined));
    expect(removed.changed).not.toContain('"derivation"');
    expect(removed.restored).toBe(fixedState);
  });

  it('provides typed add, replace, and remove commands for all 20 keywords', () => {
    const original = JSON.stringify({
      $schema: semantic,
      type: 'object',
      properties: Object.fromEntries(['time','x','y','z','matrix','route','distance','distanceEnd','direction','red','green','blue','alpha','left','right','B2','B3','B4','B8','qx','qy','qz','qw'].map((name) => [name, { type: 'number' }]))
    });
    const reference = (suffix: string) => ({ reference: `https://example.test/${suffix}`, kind: 'custom' });
    const cases: ReadonlyArray<readonly [string, (value: never) => EditorCommand, unknown, unknown]> = [
      ['concepts', (value) => new SetConceptsCommand('', value), [reference('concept-a')], [reference('concept-b')]],
      ['observedProperty', (value) => new SetObservedPropertyCommand('', value), reference('temperature'), reference('pressure')],
      ['semanticRole', (value) => new SetSemanticRoleCommand('/properties/x', value), 'observationValue', 'resultQuality'],
      ['derivation', (value) => new SetDerivationCommand('/properties/x', value), 'measured', 'calculated'],
      ['statistic', (value) => new SetStatisticCommand('/properties/x', value), 'mean', 'sum'],
      ['codedValues', (value) => new SetCodedValuesCommand('/properties/x', value), reference('codes-a'), reference('codes-b')],
      ['measurementConditioning', (value) => new SetMeasurementConditioningCommand('/properties/x', value), { weighting: 'A' }, { weighting: 'C' }],
      ['referenceRole', (value) => new SetReferenceRoleCommand('/properties/x', value), 'position', 'measure'],
      ['phenomenonTimeRelation', (value) => new SetPhenomenonTimeRelationCommand('/properties/x', value), 'instant', 'interval'],
      ['supportPeriod', (value) => new SetSupportPeriodCommand('/properties/x', value), { length: 'PT1S', anchor: 'start' }, { length: 'PT2S', anchor: 'end' }],
      ['temporalReferenceSystem', (value) => new SetTemporalReferenceSystemCommand('', value), { ...reference('time-a'), position: 'time' }, { ...reference('time-b'), position: 'time', sortOrder: 'backward' }],
      ['cadence', (value) => new SetCadenceCommand('/properties/x', value), { kind: 'fixed', period: 'PT1S' }, { kind: 'onChange' }],
      ['coordinateReferenceSystem', (value) => new SetCoordinateReferenceSystemCommand('', value), { ...reference('crs-a'), coordinates: ['x', 'y'] }, { ...reference('crs-b'), coordinates: ['x', 'y', 'z'] }],
      ['vectorReferenceFrames', (value) => new SetVectorReferenceFramesCommand('', value), [{ ...reference('frame-a'), components: ['x', 'y'] }], [{ ...reference('frame-b'), components: ['x', 'y', 'z'], variance: 'covariant' }]],
      ['tensorReferenceFrames', (value) => new SetTensorReferenceFramesCommand('', value), [{ frames: [reference('frame-a'), reference('frame-b')], components: 'matrix' }], [{ frames: [reference('frame-c'), reference('frame-d')], components: 'matrix' }]],
      ['frameTransforms', (value) => new SetFrameTransformsCommand('', value), [{ from: reference('frame-a'), to: reference('frame-b'), encoding: 'quaternion', components: ['qx', 'qy', 'qz', 'qw'] }], [{ from: reference('frame-b'), to: reference('frame-a'), encoding: 'quaternion', components: ['qx', 'qy', 'qz', 'qw'] }]],
      ['linearReferenceSystem', (value) => new SetLinearReferenceSystemCommand('', value), { ...reference('lrs-a'), linearElement: 'route', measure: 'distance' }, { ...reference('lrs-b'), linearElement: 'route', measure: 'distance', measureEnd: 'distanceEnd', direction: 'direction' }],
      ['colorSpaces', (value) => new SetColorSpacesCommand('', value), [{ ...reference('srgb'), channels: ['red', 'green', 'blue'] }], [{ ...reference('rgba'), channels: ['red', 'green', 'blue'], alpha: 'alpha' }]],
      ['audioChannels', (value) => new SetAudioChannelsCommand('', value), [{ ...reference('mono'), channels: ['left'] }], [{ ...reference('stereo'), channels: ['left', 'right'] }]],
      ['spectralBands', (value) => new SetSpectralBandsCommand('', value), [{ ...reference('rgb'), bands: ['red', 'green', 'blue'] }], [{ ...reference('sentinel'), bands: ['B2', 'B3', 'B4', 'B8'] }]]
    ];
    for (const [keyword, create, first, second] of cases) {
      let base = original;
      if (keyword === 'codedValues') {
        const value = JSON.parse(base) as Record<string, unknown>;
        ((value.properties as Record<string, Record<string, unknown>>).x).type = 'string';
        base = JSON.stringify(value);
      }
      if (keyword === 'statistic') {
        const value = JSON.parse(base) as Record<string, unknown>;
        ((value.properties as Record<string, Record<string, unknown>>).x).derivation = 'statistic';
        base = JSON.stringify(value);
      }
      if (keyword === 'supportPeriod') base = apply(base, new SetPhenomenonTimeRelationCommand('/properties/x', 'interval')).changed;
      const added = apply(base, create(first as never));
      expect(added.restored, `${keyword} add inverse`).toBe(base);
      const replaced = apply(added.changed, create(second as never));
      expect(replaced.restored, `${keyword} replace inverse`).toBe(added.changed);
      if (keyword === 'statistic') {
        expect(() => execute(replaced.changed, create(undefined as never))).toThrow();
      } else {
        const removed = apply(replaced.changed, create(undefined as never));
        expect(removed.restored, `${keyword} remove inverse`).toBe(replaced.changed);
      }
    }
  });

  it('inspects authored values, effective defaults, exact JSON, and indeterminate references', () => {
    const source = JSON.stringify({
      $schema: semantic,
      type: 'object',
      properties: { time: { type: 'string' }, red: { type: 'number' }, green: { type: 'number' }, blue: { type: 'number' }, left: { type: 'number' }, right: { type: 'number' } },
      temporalReferenceSystem: { reference: 'https://example.test/trs', kind: 'custom', position: 'time' },
      vectorReferenceFrames: [{ reference: 'https://example.test/frame', kind: 'custom', components: ['red', 'green', 'blue'] }],
      colorSpaces: [{ reference: 'https://example.test/color', kind: 'custom', channels: ['red', 'green', 'blue'] }],
      audioChannels: [{ reference: 'https://example.test/audio', kind: 'custom', channels: ['left', 'right'] }]
    });
    const placement = parseDocument('memory://inspection', source).model?.projections.semanticPlacements.find((item) => item.pointer === '');
    const inspection = Object.fromEntries((placement?.inspection ?? []).map((item) => [item.keyword, item]));
    expect(inspection.temporalReferenceSystem.effective).toMatchObject({ sortOrder: 'forward' });
    expect((inspection.vectorReferenceFrames.effective as Record<string, unknown>[])[0]).toMatchObject({ variance: 'contravariant' });
    expect((inspection.colorSpaces.effective as Record<string, unknown>[])[0]).toMatchObject({ transfer: 'asDefined' });
    expect((inspection.audioChannels.effective as Record<string, unknown>[])[0]).toMatchObject({ levelReference: 'fullScale', encoding: 'linear' });
    expect(inspection.temporalReferenceSystem.authored).not.toHaveProperty('sortOrder');
    expect(inspection.temporalReferenceSystem.normativeDefaults).toEqual({ sortOrder: 'forward' });
    expect(inspection.vectorReferenceFrames.normativeDefaults).toEqual([{ variance: 'contravariant' }]);
    expect(JSON.parse(inspection.temporalReferenceSystem.emittedJson)).toEqual(inspection.temporalReferenceSystem.authored);
    expect(inspection.temporalReferenceSystem).toMatchObject({ resolution: 'indeterminate', advisory: true });
  });

  it('emits an exact sparse one-key semantic preview', () => {
    const source = JSON.stringify({ $schema: semantic, type: 'object', properties: { value: { type: 'number', derivation: 'measured' } } });
    const placement = parseDocument('memory://one-key-preview', source).model?.projections.semanticPlacements.find((item) => item.pointer === '/properties/value');
    expect(placement?.annotations).toEqual({ derivation: 'measured' });
    expect(placement?.inspection).toEqual([{
      keyword: 'derivation',
      authored: 'measured',
      effective: 'measured',
      emittedJson: '"measured"',
      resolution: 'local',
      advisory: true
    }]);
    expect(JSON.stringify(placement)).not.toContain('undefined');
  });

  it('enforces Core type compatibility in parser diagnostics and commands', () => {
    const annotation = { reference: 'https://example.test/codes', kind: 'custom' };
    const cases: ReadonlyArray<readonly [string, Record<string, unknown>, EditorCommand, boolean]> = [
      ['temporal position', { type: 'datetime', semanticRole: 'resultTime' }, new SetSemanticRoleCommand('/properties/value', 'resultTime'), true],
      ['non-temporal position', { type: 'string', semanticRole: 'resultTime' }, new SetSemanticRoleCommand('/properties/value', 'resultTime'), false],
      ['period object', { type: 'object', properties: { start: { type: 'datetime' } }, semanticRole: 'effectiveTime' }, new SetSemanticRoleCommand('/properties/value', 'effectiveTime'), true],
      ['scalar period', { type: 'datetime', semanticRole: 'effectiveTime' }, new SetSemanticRoleCommand('/properties/value', 'effectiveTime'), false],
      ['duration lead', { type: 'duration', semanticRole: 'forecastLeadDuration' }, new SetSemanticRoleCommand('/properties/value', 'forecastLeadDuration'), true],
      ['unit lead', { type: 'double', unit: 's', semanticRole: 'forecastLeadDuration' }, new SetSemanticRoleCommand('/properties/value', 'forecastLeadDuration'), true],
      ['unitless lead', { type: 'double', semanticRole: 'forecastLeadDuration' }, new SetSemanticRoleCommand('/properties/value', 'forecastLeadDuration'), false],
      ['string status', { type: 'string', enum: ['ready'], semanticRole: 'status' }, new SetSemanticRoleCommand('/properties/value', 'status'), true],
      ['unconstrained status', { type: 'string', semanticRole: 'status' }, new SetSemanticRoleCommand('/properties/value', 'status'), false],
      ['coded integer', { type: 'int32', codedValues: annotation }, new SetCodedValuesCommand('/properties/value', annotation), true],
      ['coded number', { type: 'number', codedValues: annotation }, new SetCodedValuesCommand('/properties/value', annotation), false],
      ['conditioned numeric', { type: 'decimal', measurementConditioning: { weighting: 'A' } }, new SetMeasurementConditioningCommand('/properties/value', { weighting: 'A' }), true],
      ['conditioned string', { type: 'string', measurementConditioning: { weighting: 'A' } }, new SetMeasurementConditioningCommand('/properties/value', { weighting: 'A' }), false]
    ];
    for (const [label, annotated, command, valid] of cases) {
      const parserSource = JSON.stringify({ $schema: semantic, type: 'object', properties: { value: annotated } });
      const parsed = parseDocument(`memory://parser-${label}`, parserSource);
      expect(parsed.diagnostics.some((item) => item.code === 'json.keyword-invalid' && item.location?.pointer.startsWith('/properties/value/')), label).toBe(!valid);

      const { semanticRole, codedValues, measurementConditioning, ...base } = annotated;
      expect(command.canExecute({
        session: new DocumentSession(`memory://command-${label}`, JSON.stringify({ $schema: semantic, type: 'object', properties: { value: base } })),
        documentVersion: 1
      }), label).toBe(valid);
      expect(semanticRole ?? codedValues ?? measurementConditioning).toBeDefined();
    }
  });

  it('resolves compatible local refs and extends while leaving unions and external refs indeterminate', () => {
    const annotation = { reference: 'https://example.test/codes', kind: 'custom' };
    const source = JSON.stringify({
      $schema: semantic,
      type: 'object',
      definitions: {
        Code: { type: 'string' },
        DerivedCode: { $extends: '#/definitions/Code' }
      },
      properties: {
        directRef: { type: { $ref: '#/definitions/Code' }, codedValues: annotation },
        extended: { type: { $ref: '#/definitions/DerivedCode' }, codedValues: annotation },
        union: { type: ['string', 'number'], codedValues: annotation },
        external: { type: { $ref: 'https://example.test/types#Code' }, codedValues: annotation }
      }
    });
    const parsed = parseDocument('memory://effective-types', source);
    for (const name of ['directRef', 'extended', 'union', 'external']) {
      expect(parsed.diagnostics.some((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === `/properties/${name}/codedValues`), name).toBe(false);
    }
  });

  it('gates authored types on determinate compatible extends for diagnostics and commands', () => {
    const annotation = { reference: 'https://example.test/codes', kind: 'custom' };
    const source = JSON.stringify({
      $schema: semantic,
      type: 'object',
      definitions: {
        LocalNumber: { type: 'number' },
        Mixed: { type: 'number', $extends: ['#/definitions/LocalNumber', 'https://example.test/types#ExternalString'] },
        Missing: { type: 'number', $extends: ['#/definitions/LocalNumber', '#/definitions/Absent'] },
        Local: { type: 'number', $extends: '#/definitions/LocalNumber' }
      },
      properties: {
        mixed: { type: { $ref: '#/definitions/Mixed' }, codedValues: annotation },
        missing: { type: { $ref: '#/definitions/Missing' }, codedValues: annotation },
        local: { type: { $ref: '#/definitions/Local' }, codedValues: annotation }
      }
    });
    const parsed = parseDocument('memory://mixed-effective-types', source);
    expect(parsed.diagnostics.some((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === '/properties/mixed/codedValues')).toBe(false);
    expect(parsed.diagnostics.some((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === '/properties/missing/codedValues')).toBe(false);
    expect(parsed.diagnostics.some((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === '/properties/local/codedValues')).toBe(true);

    const commandSource = JSON.stringify({
      $schema: semantic,
      type: 'object',
      definitions: {
        LocalNumber: { type: 'number' },
        Mixed: { type: 'number', $extends: ['#/definitions/LocalNumber', 'https://example.test/types#ExternalString'] },
        Missing: { type: 'number', $extends: ['#/definitions/LocalNumber', '#/definitions/Absent'] },
        Local: { type: 'number', $extends: '#/definitions/LocalNumber' }
      },
      properties: {
        mixed: { type: { $ref: '#/definitions/Mixed' } },
        missing: { type: { $ref: '#/definitions/Missing' } },
        local: { type: { $ref: '#/definitions/Local' } }
      }
    });
    const session = new DocumentSession('memory://mixed-effective-type-command', commandSource);
    expect(new SetCodedValuesCommand('/properties/mixed', annotation).canExecute({ session, documentVersion: 1 })).toBe(true);
    expect(new SetCodedValuesCommand('/properties/missing', annotation).canExecute({ session, documentVersion: 1 })).toBe(true);
    expect(new SetCodedValuesCommand('/properties/local', annotation).canExecute({ session, documentVersion: 1 })).toBe(false);
  });

  it('rejects stale, duplicate, incomplete, and sibling-invalid edits without touching bytes', () => {
    const source = `{"$schema":"${semantic}","type":"object","properties":{"x":{"type":"number","semanticRole":"status"}}}`;
    const session = new DocumentSession('memory://guards', source);
    expect(() => new SetSemanticRoleCommand('/properties/x', 'observationValue').execute({ session, documentVersion: 2 })).toThrow();
    const duplicate = `{"$schema":"${semantic}","type":"object","properties":{"x":{"type":"number","semanticRole":"status","semantic\u0052ole":"status"}}}`;
    expect(() => execute(duplicate, new SetSemanticRoleCommand('/properties/x', 'observationValue'))).toThrow();
    const incomplete = `{"$schema":"${semantic}","type":"object","properties":{"x":{"type":"number","derivation":"statistic"}}}`;
    expect(execute(incomplete, new SetStatisticCommand('/properties/x', 'mean')).edits).toHaveLength(1);
    expect(() => execute(source, new SetStatisticCommand('/properties/x', 'mean'))).toThrow();
  });

  it('preserves escaped authored bytes and rejects duplicate temporal singleton roles', () => {
    const escaped = `{"$schema":"${semantic}","type":"object","properties":{"x":{"type":"number","semantic\u0052ole":"status","unknown":"\\u0061"}}}`;
    const replaced = apply(escaped, new SetSemanticRoleCommand('/properties/x', 'observationValue'));
    expect(replaced.changed).toContain('"semanticRole":"observationValue"');
    expect(replaced.changed).toContain('"unknown":"\\u0061"');
    expect(replaced.restored).toBe(escaped);
    const duplicateRole = JSON.stringify({ $schema: semantic, type: 'object', properties: { start: { type: 'string', semanticRole: 'phenomenonTime' }, end: { type: 'string' } } });
    expect(() => execute(duplicateRole, new SetSemanticRoleCommand('/properties/end', 'phenomenonTime'))).toThrow();
  });

  it('diagnoses locally decidable activation, placement, binding, role, and accumulation violations', () => {
    const inactive = parseDocument('memory://inactive', JSON.stringify({
      $schema: 'https://json-structure.org/meta/core/v0/#',
      type: 'object',
      concepts: [{ reference: 'https://example.test/concept', kind: 'custom' }],
      default: { semanticRole: 'status' }
    }));
    expect(inactive.diagnostics.some((item) => item.location?.pointer === '/concepts' && item.code === 'json.keyword-invalid')).toBe(true);
    expect(inactive.diagnostics.some((item) => item.location?.pointer === '/default/semanticRole')).toBe(false);

    const invalid = parseDocument('memory://semantic-local-invalid', JSON.stringify({
      $schema: semantic,
      type: 'object',
      properties: {
        first: { type: 'number', semanticRole: 'phenomenonTime' },
        second: { type: 'number', semanticRole: 'phenomenonTime' },
        total: { type: 'number', derivation: 'measured', phenomenonTimeRelation: 'accumulation' }
      },
      semanticRole: 'status',
      coordinateReferenceSystem: { reference: 'https://example.test/crs', kind: 'custom', coordinates: ['missing'] }
    }));
    for (const pointer of [
      '/semanticRole',
      '/coordinateReferenceSystem',
      '/properties/first/semanticRole',
      '/properties/second/semanticRole',
      '/properties/total/phenomenonTimeRelation'
    ]) {
      expect(invalid.diagnostics.some((item) => item.location?.pointer === pointer && item.code === 'json.keyword-invalid'), pointer).toBe(true);
    }
    expect(invalid.model?.projections.semanticPlacements.find((item) => item.pointer === '')?.annotations.coordinateReferenceSystem).toBeUndefined();
  });

  it('enforces local concept consistency and positive Core temporal intervals', () => {
    const source = JSON.stringify({
      $schema: semantic,
      type: 'object',
      properties: { when: { type: 'datetime' }, value: { type: 'number' } }
    });
    const classConcept = { reference: 'https://example.test/Class', kind: 'owl-class' };
    const propertyConcept = { reference: 'https://example.test/property', kind: 'rdf-property' };
    expect(execute(source, new SetConceptsCommand('', [classConcept])).edits).toHaveLength(1);
    expect(() => execute(source, new SetConceptsCommand('', [propertyConcept]))).toThrow();
    expect(execute(source, new SetConceptsCommand('/properties/value', [propertyConcept])).edits).toHaveLength(1);
    expect(() => execute(source, new SetConceptsCommand('', [classConcept, propertyConcept]))).toThrow();
    expect(() => execute(source, new SetConceptsCommand('', [classConcept, { ...classConcept, kind: 'rdfs-class' }]))).toThrow();

    const overlap = JSON.stringify({ ...JSON.parse(source), concepts: [{ reference: 'https://example.test/temperature', kind: 'custom' }] });
    expect(() => execute(overlap, new SetObservedPropertyCommand('', { reference: 'https://example.test/temperature', kind: 'custom' }))).toThrow();

    const temporal = apply(source, new SetPhenomenonTimeRelationCommand('/properties/when', 'interval')).changed;
    expect(execute(temporal, new SetSupportPeriodCommand('/properties/when', { length: 'PT0.5S', anchor: 'end' })).edits).toHaveLength(1);
    expect(() => execute(temporal, new SetSupportPeriodCommand('/properties/when', { length: 'PT0S', anchor: 'end' }))).toThrow();
    expect(execute(source, new SetCadenceCommand('/properties/when', { kind: 'fixed', period: 'PT1M' })).edits).toHaveLength(1);
    expect(() => execute(source, new SetCadenceCommand('/properties/when', { kind: 'fixed', period: 'P0D' }))).toThrow();
  });
});