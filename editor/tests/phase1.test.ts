import { describe, expect, it } from 'vitest';
import { AddPropertyCommand, DeletePropertyCommand, DocumentSession, EditPropertyCommand, InMemoryEditorHost, PROTOCOL_VERSION, RenamePropertyCommand, parseDocument, resolveSelection, sameSelection, selectionForMode } from '../src/index.js';

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
  it('adds one property with a local edit and restores byte-identical text', async () => {
    const host = new InMemoryEditorHost('memory://fixture', text);
    const session = new DocumentSession('memory://fixture', text);
    const command = new AddPropertyCommand('/definitions/Person', 'name', { type: 'string', description: 'display name' });
    expect(command.canExecute({ session, documentVersion: 1 })).toBe(true);
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
    const original = '{"type":"object","properties":{"old/name":{"type": "string"},"taken":{"type":"number"}},"unknown":1}';
    const host = new InMemoryEditorHost('memory://rename', original);
    const session = new DocumentSession('memory://rename', original);
    const collision = new RenamePropertyCommand('/properties/old~1name', 'taken');
    expect(collision.canExecute({ session, documentVersion: 1 })).toBe(false);
    const command = new RenamePropertyCommand('/properties/old~1name', 'new~name');
    expect(command.canExecute({ session, documentVersion: 1 })).toBe(true);
    const result = command.execute({ session, documentVersion: 1 });
    const applied = await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'rename-1', documentVersion: 1, edits: result.edits });
    expect(applied.applied).toBe(true);
    const changed = await host.readDocument();
    expect(JSON.parse(changed.text).properties['new~name']).toEqual({ type: 'string' });
    expect(changed.text).toContain('{"type": "string"}');
    expect(changed.text).toContain('"unknown":1');
    const inverse = result.inverseEdits[0];
    expect(changed.text.slice(0, inverse.range.startOffset) + inverse.newText + changed.text.slice(inverse.range.endOffset)).toBe(original);
    expect((await host.undo()).text).toBe(original);
  });
  it('rejects unsafe property rename and delete operations', () => {
    const referenced = new DocumentSession('memory://referenced', '{"type":"object","properties":{"id":{"type":"string"}},"required":["id"],"identity":["id"]}');
    expect(new RenamePropertyCommand('/properties/id', 'key').canExecute({ session: referenced, documentVersion: 1 })).toBe(false);
    expect(new DeletePropertyCommand('/properties/id').canExecute({ session: referenced, documentVersion: 1 })).toBe(false);

    const alternativeRequired = new DocumentSession('memory://alternative-required', '{"type":"object","properties":{"id":{"type":"string"},"email":{"type":"string"}},"required":[["id"],["email"]]}');
    expect(new RenamePropertyCommand('/properties/id', 'key').canExecute({ session: alternativeRequired, documentVersion: 1 })).toBe(false);
    expect(new DeletePropertyCommand('/properties/id').canExecute({ session: alternativeRequired, documentVersion: 1 })).toBe(false);

    const relationCollision = new DocumentSession('memory://relation-collision', '{"type":"object","properties":{"id":{"type":"string"}},"relations":{"owner":{"targettype":{"type":"object"}}}}');
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
  it('requires an object declaration and rejects relation-name collisions', () => {
    const scalar = new DocumentSession('memory://scalar', '{"type":"string","properties":{}}');
    expect(new AddPropertyCommand('', 'x', { type: 'string' }).canExecute({ session: scalar, documentVersion: 1 })).toBe(false);
    const relation = new DocumentSession('memory://relation', '{"type":"object","relations":{"x":{}}}');
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
