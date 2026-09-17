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

  it('reads a contained symlink through its canonical target', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'json-structure-symlink-'));
    const targetDirectory = join(root, 'target');
    const linkDirectory = join(root, 'linked');
    await fs.mkdir(targetDirectory);
    const target = join(targetDirectory, 'types.json');
    await fs.writeFile(target, '{"canonical":true}');
    await fs.symlink(targetDirectory, linkDirectory, process.platform === 'win32' ? 'junction' : 'dir');

    await expect(readResource(pathToFileURL(join(linkDirectory, 'types.json')).toString(), root, 100)).resolves.toEqual({
      uri: pathToFileURL(await fs.realpath(target)).toString(),
      content: '{"canonical":true}',
    });
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

import { atomicWrite, readBoundedFile, readFile } from '../src/electron/file-service';

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

    await expect(readFile(path)).resolves.toEqual({ path: await fs.realpath(path), text: '{"version":1}' });
  });

  it('rejects oversized and structurally excessive primary documents before IPC', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'json-structure-primary-limit-'));
    const oversized = join(directory, 'oversized.struct.json');
    const tooDeep = join(directory, 'deep.struct.json');
    const tooManyNodes = join(directory, 'nodes.struct.json');
    await fs.writeFile(oversized, 'x'.repeat(4 * 1024 * 1024 + 1), 'utf8');
    await fs.writeFile(tooDeep, `${'['.repeat(129)}${']'.repeat(129)}`, 'utf8');
    await fs.writeFile(tooManyNodes, `[${'0,'.repeat(100_001)}0]`, 'utf8');

    await expect(readFile(oversized)).rejects.toThrow(/Primary document.*byte limit/);
    await expect(readFile(tooDeep)).rejects.toThrow('128-level nesting limit');
    await expect(readFile(tooManyNodes)).rejects.toThrow('100000-node structural limit');
  });

  it('reads only bounded conversion source files', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'json-structure-conversion-source-'));
    const path = join(directory, 'source.avsc');
    await fs.writeFile(path, '{}', 'utf8');
    await expect(readBoundedFile(path, 2)).resolves.toEqual({ path, text: '{}' });
    await expect(readBoundedFile(path, 1)).rejects.toThrow('exceeds');
  });
});