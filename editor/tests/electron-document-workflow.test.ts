import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readResource } from '../src/electron/file-service.js';
import { classifyGeneratedOutputPaths, commonGeneratedOutputDirectory, createConversionDocumentContext, createFileDocumentContext, createUntitledDocumentContext, DocumentActivationLedger } from '../src/electron/document-workflow.js';

describe('Electron document workflow', () => {
  it('routes only JSON Structure generated output to the custom session', () => {
    expect(classifyGeneratedOutputPaths(['C:\\generated\\target.struct.json'])).toBe('json-structure');
    expect(classifyGeneratedOutputPaths(['C:\\generated\\schema.json'])).toBe('file');
    expect(classifyGeneratedOutputPaths(['C:\\generated\\record.avsc'])).toBe('file');
    expect(classifyGeneratedOutputPaths(['C:\\generated\\tables.sql'])).toBe('file');
    expect(classifyGeneratedOutputPaths(['C:\\generated\\messages.proto'])).toBe('file');
    expect(classifyGeneratedOutputPaths(['C:\\generated\\a.ts', 'C:\\generated\\b.ts'])).toBe('directory');
    expect(commonGeneratedOutputDirectory(['C:\\generated\\a.ts', 'C:\\generated\\nested\\b.ts'])).toBe('C:\\generated');
  });

  it('allocates a deterministic untitled URI without accepting path-like identities', () => {
    expect(createUntitledDocumentContext('test-1')).toEqual({ uri: 'untitled:json-structure-test-1.struct.json', title: 'Untitled JSON Structure' });
    expect(() => createUntitledDocumentContext('../outside')).toThrow('simple token');
  });
  it('carries a canonical file URI and document kind with a selection', () => {
    const context = createFileDocumentContext('C:\\schemas\\generated.struct.json', '{"type":"object"}', 'generated');
    expect(context).toEqual({
      path: 'C:\\schemas\\generated.struct.json',
      uri: 'file:///C:/schemas/generated.struct.json',
      name: 'generated.struct.json',
      text: '{"type":"object"}',
      kind: 'generated',
    });
  });

  it('does not replace the active document until a staged selection is activated', () => {
    const tokens = ['first', 'second'];
    const ledger = new DocumentActivationLedger(() => tokens.shift() ?? 'fallback');
    const first = createFileDocumentContext('C:\\schemas\\first.struct.json', '{"first":true}');
    const second = createFileDocumentContext('C:\\schemas\\second.struct.json', '{"second":true}');
    ledger.setActive(first);

    const selected = ledger.stage(second);
    expect(ledger.active).toBe(first);
    const superseded = ledger.stage(second);
    expect(ledger.activate(selected.activationToken)).toBeUndefined();
    ledger.discard(superseded.activationToken);
    expect(ledger.active).toBe(first);
    expect(ledger.activate(selected.activationToken)).toBeUndefined();
  });

  it('keeps the newest deferred read activatable when an older read completes last', async () => {
    const ledger = new DocumentActivationLedger(() => 'selection');
    let generation = 0;
    let resolveOlder!: () => void;
    let resolveNewer!: () => void;
    const olderRead = new Promise<void>((resolve) => { resolveOlder = resolve; });
    const newerRead = new Promise<void>((resolve) => { resolveNewer = resolve; });
    const older = olderRead.then(() => ledger.stageIfCurrent(createFileDocumentContext('C:\\schemas\\older.struct.json', '{}'), 0, () => generation));
    generation = 1;
    const newer = newerRead.then(() => ledger.stageIfCurrent(createFileDocumentContext('C:\\schemas\\newer.struct.json', '{}'), 1, () => generation));

    resolveNewer();
    const newestSelection = await newer;
    expect(newestSelection?.path).toBe('C:\\schemas\\newer.struct.json');
    resolveOlder();
    expect(await older).toBeUndefined();
    expect(newestSelection && ledger.activate(newestSelection.activationToken)?.path).toBe('C:\\schemas\\newer.struct.json');
  });

  it('uses the captured conversion root when a delayed import outlives a document switch', async () => {
    const parent = join(process.cwd(), 'tests', '.conversion-context-' + randomUUID());
    const firstRoot = join(parent, 'first');
    const secondRoot = join(parent, 'second');
    const firstImport = join(firstRoot, 'types.json');
    try {
      await fs.mkdir(firstRoot, { recursive: true });
      await fs.mkdir(secondRoot, { recursive: true });
      await fs.writeFile(firstImport, '{"first":true}', 'utf8');
      const firstContext = createConversionDocumentContext(join(firstRoot, 'document.struct.json'), firstRoot);
      let activeRoot = firstRoot;
      let release!: () => void;
      const delayedImport = new Promise<void>((resolve) => { release = resolve; }).then(() => readResource(pathToFileURL(firstImport).toString(), firstContext.documentRoot, 1024));
      activeRoot = secondRoot;
      release();
      await expect(delayedImport).resolves.toMatchObject({ content: '{"first":true}' });
      expect(activeRoot).toBe(secondRoot);
      expect(firstContext.documentRoot).toBe(firstRoot);
      expect(firstContext.documentUri).toBe(pathToFileURL(join(firstRoot, 'document.struct.json')).toString());
    } finally {
      await fs.rm(parent, { recursive: true, force: true });
    }
  });

  it('supports legacy path-only activation without allowing an unrelated path', () => {
    const ledger = new DocumentActivationLedger(() => 'selection');
    const selected = ledger.stage(createFileDocumentContext('C:\\schemas\\selected.struct.json', '{}'));
    expect(ledger.activatePath('C:\\schemas\\other.struct.json')).toBeUndefined();
    expect(ledger.activatePath(selected.path)).toMatchObject({ path: selected.path, uri: selected.uri });
    expect(ledger.active?.path).toBe(selected.path);
  });

  it('invalidates older selections when a Save As document becomes active', () => {
    const ledger = new DocumentActivationLedger(() => 'selection');
    const selected = ledger.stage(createFileDocumentContext('C:\\schemas\\selected.struct.json', '{}'));
    ledger.setActive(createFileDocumentContext('C:\\schemas\\saved-as.struct.json', '{}'));
    expect(ledger.activate(selected.activationToken)).toBeUndefined();
    expect(ledger.active?.path).toBe('C:\\schemas\\saved-as.struct.json');
  });
});
