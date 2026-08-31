import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readResource } from '../src/electron/file-service.js';

describe('Electron imported resource reads', () => {
  it('allows bounded file reads inside the safe root', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'json-structure-'));
    const nested = join(root, 'nested');
    await fs.mkdir(nested);
    const path = join(nested, 'types.json');
    await fs.writeFile(path, '{}');
    await expect(readResource(pathToFileURL(path).toString(), root, 2)).resolves.toMatchObject({ content: '{}' });
  });

  it('rejects remote schemes, root escapes, and oversized files', async () => {
    const parent = await fs.mkdtemp(join(tmpdir(), 'json-structure-'));
    const root = join(parent, 'root');
    await fs.mkdir(root);
    const outside = join(parent, 'outside.json');
    const oversized = join(root, 'oversized.json');
    await fs.writeFile(outside, '{}');
    await fs.writeFile(oversized, '123');
    await expect(readResource('https://example.test/types.json', root, 10)).rejects.toThrow('Only file:');
    await expect(readResource(pathToFileURL(outside).toString(), root, 10)).rejects.toThrow('inside the opened document directory');
    await expect(readResource(pathToFileURL(oversized).toString(), root, 2)).rejects.toThrow('exceeds');
  });
});

import { atomicWrite, readFile } from '../src/electron/file-service';

describe('Electron file service', () => {
  it('writes the complete replacement and leaves no temporary file', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'json-structure-editor-'));
    const path = join(directory, 'example.struct.json');

    await atomicWrite(path, '{"version":2}');

    await expect(fs.readFile(path, 'utf8')).resolves.toBe('{"version":2}');
    await expect(fs.readdir(directory)).resolves.toEqual(['example.struct.json']);
  });

  it('returns the path and text for an existing initial file', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'json-structure-editor-'));
    const path = join(directory, 'initial.struct.json');
    await fs.writeFile(path, '{"version":1}', 'utf8');

    await expect(readFile(path)).resolves.toEqual({ path, text: '{"version":1}' });
  });
});