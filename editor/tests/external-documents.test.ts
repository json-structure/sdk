import { describe, expect, it } from 'vitest';
import { loadExternalDocuments, resolveResourceUri, resourceSnapshot } from '../src/external-documents.js';

describe('external document loading', () => {
  it('resolves relative sources and loads transitive imports once', async () => {
    const resources = new Map([
      ['file:///workspace/library.json', JSON.stringify({ $schema: 'https://json-structure.org/meta/extended/v0/#', $uses: ['JSONStructureImport'], $id: 'file:///workspace/library.json', name: 'Library', definitions: { Nested: { $importdefs: 'file:///workspace/nested.json' }, Value: { type: 'string' } } })],
      ['file:///workspace/nested.json', JSON.stringify({ $schema: 'https://json-structure.org/meta/extended/v0/#', $uses: ['JSONStructureImport'], $id: 'file:///workspace/nested.json', name: 'Nested', definitions: { Library: { $importdefs: 'file:///workspace/library.json' }, Count: { type: 'integer' } } })]
    ]);
    const loaded = await loadExternalDocuments('file:///workspace/main.json', ['./library.json'], async (uri) => {
      const content = resources.get(uri);
      if (!content) throw new Error('missing');
      return resourceSnapshot(uri, uri, content);
    });
    expect(loaded.map((item) => item.uri)).toEqual(['file:///workspace/library.json', 'file:///workspace/nested.json']);
    expect(loaded.every((item) => item.availability === 'available')).toBe(true);
  });

  it('retains unavailable and incomplete resources for tri-state resolution', async () => {
    const loaded = await loadExternalDocuments('https://example.test/main.json', ['./bad.json', './missing.json'], async (uri) => {
      if (uri.endsWith('/bad.json')) return resourceSnapshot(uri, uri, '{');
      throw new Error('missing');
    });
    expect(loaded).toEqual([
      expect.objectContaining({ uri: 'https://example.test/bad.json', availability: 'stale' }),
      { uri: 'https://example.test/missing.json', availability: 'unavailable' }
    ]);
  });

  it('keeps schema-invalid resources out of resolver-ready state', async () => {
    const content = JSON.stringify({
      $schema: 'https://json-structure.org/meta/core/v0/#',
      $id: 'https://example.test/invalid.json',
      name: 'Invalid',
      type: 'not-a-core-type'
    });
    const [loaded] = await loadExternalDocuments('https://example.test/main.json', ['./invalid.json'], async (uri) => resourceSnapshot(uri, uri, content));
    expect(loaded).toMatchObject({ uri: 'https://example.test/invalid.json', availability: 'stale' });
    expect(loaded).not.toHaveProperty('model');
    expect(loaded).not.toHaveProperty('value');
    expect(loaded?.snapshot?.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(true);
  });

  it('normalizes fragments without sending them to resource readers', () => {
    expect(resolveResourceUri('file:///workspace/main.json', './types.json#/definitions/A')).toBe('file:///workspace/types.json');
  });

  it('bounds depth, document count, and aggregate content bytes', async () => {
    const document = (next?: string) => JSON.stringify({ $schema: 'https://json-structure.org/meta/extended/v0/#', $uses: ['JSONStructureImport'], $id: 'file:///workspace/value.json', name: 'Value', definitions: next ? { Next: { $importdefs: next } } : { Value: { type: 'string' } } });
    const resources = new Map([
      ['file:///workspace/one.json', document('file:///workspace/two.json')],
      ['file:///workspace/two.json', document('file:///workspace/three.json')],
      ['file:///workspace/three.json', document()],
    ]);
    const reads: string[] = [];
    const read = async (uri: string) => {
      reads.push(uri);
      return resourceSnapshot(uri, uri, resources.get(uri)!);
    };

    const depthLimited = await loadExternalDocuments('file:///workspace/main.json', ['./one.json'], read, { maxDepth: 1, maxDocuments: 10, maxTotalBytes: 10000, supportedSchemes: ['file'] });
    expect(depthLimited.map((item) => item.availability)).toEqual(['available', 'unavailable']);
    expect(reads).toEqual(['file:///workspace/one.json']);

    reads.length = 0;
    const countLimited = await loadExternalDocuments('file:///workspace/main.json', ['./one.json'], read, { maxDepth: 10, maxDocuments: 2, maxTotalBytes: 10000, supportedSchemes: ['file'] });
    expect(countLimited).toHaveLength(2);
    expect(reads).toHaveLength(2);

    reads.length = 0;
    const sizeLimited = await loadExternalDocuments('file:///workspace/main.json', ['./one.json'], read, { maxDepth: 10, maxDocuments: 10, maxTotalBytes: 1, supportedSchemes: ['file'] });
    expect(sizeLimited).toEqual([{ uri: 'file:///workspace/one.json', availability: 'unavailable' }]);
    expect(reads).toHaveLength(1);
  });

  it('rejects unsupported schemes before invoking the host reader', async () => {
    let reads = 0;
    const loaded = await loadExternalDocuments('file:///workspace/main.json', ['data:text/plain,{}'], async () => {
      reads += 1;
      throw new Error('must not run');
    });
    expect(loaded).toEqual([{ uri: 'data:text/plain,{}', availability: 'unavailable' }]);
    expect(reads).toBe(0);
  });

  it('does not follow import-shaped values outside active import projections', async () => {
    const source = JSON.stringify({
      $schema: 'https://json-structure.org/meta/core/v0/#',
      $id: 'file:///workspace/library.json',
      name: 'Library',
      type: 'string',
      'x-metadata': { $import: 'file:///workspace/should-not-load.json' }
    });
    const reads: string[] = [];
    await loadExternalDocuments('file:///workspace/main.json', ['./library.json'], async (uri) => {
      reads.push(uri);
      return resourceSnapshot(uri, uri, source);
    });
    expect(reads).toEqual(['file:///workspace/library.json']);
  });
});