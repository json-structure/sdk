import * as assert from 'assert';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalContainedFile } from '../../libraryRuntimePaths';

suite('library runtime canonical paths', () => {
    test('accepts real files under a canonical root', async () => {
        const root = await mkdtemp(join(tmpdir(), 'json-structure-vscode-library-'));
        const file = join(root, 'inside.json');
        await writeFile(file, '{}');
        assert.strictEqual(await canonicalContainedFile(file, [root]), file);
    });

    test('rejects junction or symlink escapes after realpath resolution', async function () {
        const parent = await mkdtemp(join(tmpdir(), 'json-structure-vscode-library-'));
        const root = join(parent, 'root');
        const outside = join(parent, 'outside');
        await Promise.all([mkdir(root), mkdir(outside)]);
        const target = join(outside, 'escaped.json');
        await writeFile(target, '{}');
        const link = join(root, 'linked');
        try { await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir'); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EPERM') { this.skip(); return; }
            throw error;
        }
        await assert.rejects(canonicalContainedFile(join(link, 'escaped.json'), [root]), /must remain under/);
    });
});