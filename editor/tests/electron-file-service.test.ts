import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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