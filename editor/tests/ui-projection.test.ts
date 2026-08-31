import { describe, expect, it } from 'vitest';
import { DocumentSession } from '../src/session.js';
import { diagnosticsForPointer, pointerLabel, projectGraph, projectProperties } from '../src/ui/helpers.js';

const text = `{
  "definitions": {
    "Base": { "type": "object", "properties": { "id": { "type": "uuid" } } },
    "Person": {
      "type": "object",
      "$extends": "#/definitions/Base",
      "properties": { "name": { "type": "string", "description": "Display name" }, "manager": { "$ref": "#/definitions/Person" } },
      "required": ["name"]
    }
  }
}`;

describe('UI projection helpers', () => {
  it('projects focused property rows with JSON pointer escaping and required state', () => {
    const session = new DocumentSession('memory://ui', text);
    const person = session.model!.projections.definitions.find((definition) => definition.name === 'Person');
    expect(projectProperties(person)).toEqual([
      { name: 'name', pointer: '/definitions/Person/properties/name', type: 'string', required: true, description: 'Display name' },
      { name: 'manager', pointer: '/definitions/Person/properties/manager', type: 'unknown', required: false, description: undefined }
    ]);
  });

  it('projects reusable types and inheritance links only when their type targets are known', () => {
    const graph = projectGraph(new DocumentSession('memory://ui', text).snapshot());
    expect(graph.nodes.map((node) => node.label)).toEqual(['Base', 'Person']);
    expect(graph.edges.map((edge) => [edge.kind, edge.label, edge.from, edge.to])).toEqual([
      ['inheritance', 'extends', '/definitions/Person', '/definitions/Base']
    ]);
  });

  it('filters diagnostics by selected source subtree and formats pointer labels', () => {
    const diagnostics = [{ code: 'x', message: 'one', severity: 'error' as const, location: { uri: 'memory://ui', pointer: '/definitions/Person/properties/name' } }, { code: 'y', message: 'two', severity: 'warning' as const, location: { uri: 'memory://ui', pointer: '/definitions/Base' } }];
    expect(diagnosticsForPointer(diagnostics, '/definitions/Person')).toHaveLength(1);
    expect(pointerLabel('/definitions/Person/properties/a~1b')).toBe('a/b');
  });
});