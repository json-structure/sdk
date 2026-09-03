import { describe, expect, it } from 'vitest';
import { DocumentSession, RemoveObjectMemberCommand, SetCoreMemberCommand, SetDescriptionCommand } from '../src/index.js';

describe('DocumentSession reversible design state', () => {
  it('tracks byte dirty state and exact undo/redo transitions', () => {
    const source = '{"type":"string"}';
    const session = new DocumentSession('memory://history', source);
    const command = new SetDescriptionCommand('', 'A description');
    const context = { session, documentVersion: session.snapshot().documentVersion };
    const result = command.execute(context);
    session.applyTextEdits(result.edits);
    expect(session.dirty).toBe(true);
    expect(session.canUndo).toBe(true);
    session.undo();
    expect(session.snapshot().text).toBe(source);
    expect(session.dirty).toBe(false);
    session.redo();
    expect(session.snapshot().text).toContain('A description');
    session.markSaved();
    expect(session.dirty).toBe(false);
    session.undo();
    expect(session.dirty).toBe(true);
  });

  it('blocks primitive-to-collection type mutations without a member schema', () => {
    for (const type of ['array', 'set', 'map'] as const) {
      const session = new DocumentSession(`memory://${type}`, JSON.stringify({ type: 'string' }));
      expect(new SetCoreMemberCommand('', 'type', type).canExecute({ session, documentVersion: 1 })).toBe(false);
    }
  });
  it('blocks removal of mandatory document headers at command level', () => {
    const session = new DocumentSession('memory://headers', JSON.stringify({ $schema: 'https://json-structure.org/meta/core/v0/#', $id: 'urn:test', name: 'Test' }));
    for (const keyword of ['$schema', '$id', 'name']) {
      expect(new RemoveObjectMemberCommand('', keyword).canExecute({ session, documentVersion: 1 })).toBe(false);
    }
  });
  it('keeps Design history and dirty bytes when only the document URI changes', () => {
    const source = '{"type":"string"}';
    const session = new DocumentSession('memory://before', source);
    const command = new SetDescriptionCommand('', 'edited');
    session.applyTextEdits(command.execute({ session, documentVersion: 1 }).edits);
    session.setUri('file:///after.struct.json');
    expect(session.uri).toBe('file:///after.struct.json');
    expect(session.dirty).toBe(true);
    expect(session.canUndo).toBe(true);
    expect(session.undo().text).toBe(source);
    expect(session.dirty).toBe(false);
  });
  it('rejects overlapping or out-of-bounds edits before changing session state', () => {
    const source = 'abcdef';
    const session = new DocumentSession('memory://edit-ranges', source);
    const edit = (startOffset: number, endOffset: number, newText: string) => ({
      range: {
        start: { line: 0, column: startOffset, offset: startOffset },
        end: { line: 0, column: endOffset, offset: endOffset },
        startOffset,
        endOffset
      },
      newText
    });
    const before = session.snapshot();
    expect(() => session.applyTextEdits([edit(0, 4, 'X'), edit(2, 3, 'Y')])).toThrow('Overlapping text edits');
    expect(() => session.applyTextEdits([edit(0, 0, 'prefix'), edit(6, 7, '')])).toThrow('Edit source range is invalid');
    expect(session.snapshot()).toBe(before);
    expect(session.canUndo).toBe(false);
  });

  it('applies adjacent ranges and deterministic insertions against original bytes', () => {
    const source = 'abcdef';
    const edit = (startOffset: number, endOffset: number, newText: string) => ({
      range: {
        start: { line: 0, column: startOffset, offset: startOffset },
        end: { line: 0, column: endOffset, offset: endOffset },
        startOffset,
        endOffset
      },
      newText
    });
    const session = new DocumentSession('memory://edit-order', source);
    const changed = session.applyTextEdits([
      edit(0, 2, 'AB'),
      edit(2, 4, 'CD'),
      edit(4, 4, '>'),
      edit(4, 4, '<')
    ]);
    expect(changed.text).toBe('ABCD><ef');
    expect(session.undo().text).toBe(source);
    expect(session.redo().text).toBe('ABCD><ef');
  });
});
