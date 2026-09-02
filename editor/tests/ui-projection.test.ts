import { describe, expect, it } from 'vitest';
import { DocumentSession } from '../src/session.js';
import { diagnosticsForPointer, filterTypes, isInlineRootSchema, pointerLabel, projectGraph, projectInspectorSections, projectProperties, projectSchemaInspectorSections } from '../src/ui/helpers.js';

const text = `{
  "definitions": {
    "Base": { "type": "object", "properties": { "id": { "type": "uuid" } } },
    "Person": {
      "type": "object",
      "$extends": "#/definitions/Base",
      "properties": { "name": { "type": "string", "description": "Display name" }, "manager": { "type": { "$ref": "#/definitions/Person" } } },
      "required": ["name"]
    }
  }
}`;

describe('UI projection helpers', () => {
  it('projects focused property rows with JSON pointer escaping and required state', () => {
    const session = new DocumentSession('memory://ui', text);
    const person = session.model!.projections.definitions.find((definition) => definition.name === 'Person');
    expect(projectProperties(person)).toEqual([
      { name: 'name', pointer: '/definitions/Person/properties/name', type: 'string', required: true, description: 'Display name', schema: { type: 'string', description: 'Display name' } },
      { name: 'manager', pointer: '/definitions/Person/properties/manager', type: 'Person', required: false, description: undefined, schema: { type: { $ref: '#/definitions/Person' } } }
    ]);
  });

  it('projects nullable union property types without collapsing them to any', () => {
    const session = new DocumentSession('memory://nullable-union', JSON.stringify({
      definitions: {
        Place: {
          type: 'object',
          properties: {
            name: { type: ['string', 'null'] },
            latitude: { type: ['double', 'null'] }
          }
        }
      }
    }));
    const place = session.model!.projections.definitions.find((definition) => definition.name === 'Place');
    expect(projectProperties(place).map((property) => property.type)).toEqual(['string or null', 'double or null']);
  });

  it('projects reusable types, inheritance, and regular references', () => {
    const graph = projectGraph(new DocumentSession('memory://ui', text).snapshot());
    expect(graph.nodes.map((node) => node.label)).toEqual(['Base', 'Person']);
    expect(graph.edges.map((edge) => [edge.kind, edge.label, edge.from, edge.to])).toEqual(expect.arrayContaining([
      ['inheritance', 'extends', '/definitions/Person', '/definitions/Base'],
      ['reference', 'manager', '/definitions/Person', '/definitions/Person']
    ]));
  });

  it('filters diagnostics by selected source subtree and formats pointer labels', () => {
    const diagnostics = [{ code: 'x', message: 'one', severity: 'error' as const, location: { uri: 'memory://ui', pointer: '/definitions/Person/properties/name' } }, { code: 'y', message: 'two', severity: 'warning' as const, location: { uri: 'memory://ui', pointer: '/definitions/Base' } }];
    expect(diagnosticsForPointer(diagnostics, '/definitions/Person')).toHaveLength(1);
    expect(pointerLabel('/definitions/Person/properties/a~1b')).toBe('a/b');
  });

  it('projects populated Core and extension fields with effective defaults distinguished', () => {
    const session = new DocumentSession('memory://inspector', `{
      "$schema":"https://json-structure.org/meta/extended/v0/#",
      "$uses":["JSONStructureValidation","JSONStructureUnits"],
      "definitions":{"Reading":{"type":"number","unit":"m","ucumUnit":"m"},"Samples":{"type":"array","items":{"type":"number"},"contains":{"type":"number"}}}
    }`);
    const reading = session.model!.projections.definitions.find((definition) => definition.name === 'Reading');
    const sections = projectInspectorSections(reading);
    expect(sections.find((section) => section.label === 'Core')?.fields).toEqual(expect.arrayContaining([
      { keyword: 'type', value: 'number', origin: 'authored' }
    ]));
    expect(sections.find((section) => section.label === 'Units')?.fields).toEqual(expect.arrayContaining([
      { keyword: 'unit', value: 'm', origin: 'authored' },
      { keyword: 'preferredComputationalUnit', value: 'm', origin: 'authored' }
    ]));
    const samples = session.model!.projections.definitions.find((definition) => definition.name === 'Samples');
    expect(projectInspectorSections(samples).find((section) => section.label === 'Validation')?.fields).toContainEqual({ keyword: 'minContains', value: '1', origin: 'effective' });
  });

  it('recognizes every Core inline root form and filters visible types', () => {
    for (const type of ['object', 'array', 'map', 'tuple', 'choice', 'string', 'boolean', 'number', 'integer', 'decimal', 'null', 'uuid', 'uri', 'datetime', 'date', 'time', 'duration', 'binary', 'jsonpointer']) {
      expect(isInlineRootSchema({ type }), type).toBe(true);
    }
    expect(isInlineRootSchema({ type: { $ref: '#/definitions/Person' } })).toBe(true);
    expect(isInlineRootSchema({ type: 'set' })).toBe(true);
    expect(isInlineRootSchema({ type: 'union' })).toBe(true);
    expect(isInlineRootSchema({ type: 'int64' })).toBe(true);
    expect(filterTypes([{ name: 'Person', namespace: 'Domain' }, { name: 'Address', namespace: 'Common' }], 'domain per')).toEqual([{ name: 'Person', namespace: 'Domain' }]);
  });

  it('projects the selected property schema rather than its parent declaration', () => {
    expect(projectSchemaInspectorSections({ type: 'string', description: 'Display name', minLength: 2 })).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Core', fields: expect.arrayContaining([{ keyword: 'type', value: 'string', origin: 'authored' }]) }),
      expect.objectContaining({ label: 'Validation', fields: expect.arrayContaining([{ keyword: 'minLength', value: '2', origin: 'authored' }]) })
    ]));
  });

  it('includes inline roots and the references they own in the graph', () => {
    const graph = projectGraph(new DocumentSession('memory://inline-graph', '{"type":"object","properties":{"manager":{"type":{"$ref":"#/definitions/Person"}}},"definitions":{"Person":{"type":"object","$extends":"#/definitions/Base"},"Base":{"type":"object"}}}').snapshot());
    expect(graph.nodes).toContainEqual(expect.objectContaining({ id: 'graph:document', pointer: '', kind: 'document' }));
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'graph:document', kind: 'reference', label: 'manager', to: '/definitions/Person' }),
      expect.objectContaining({ from: '/definitions/Person', kind: 'inheritance', to: '/definitions/Base' })
    ]));
  });
});