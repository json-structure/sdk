import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export async function canonicalContainedFile(candidate: string, roots: readonly string[]): Promise<string> {
    const [canonicalCandidate, ...canonicalRoots] = await Promise.all([
        realpath(candidate),
        ...roots.map((root) => realpath(root))
    ]);
    if (!canonicalRoots.some((root) => isWithinPath(canonicalCandidate, root))) {
        throw new Error('Library resources must remain under the extension media or a workspace root.');
    }
    return canonicalCandidate;
}

function isWithinPath(candidate: string, root: string): boolean {
    const child = relative(resolve(root), resolve(candidate));
    return child === '' || !child.startsWith('..') && !isAbsolute(child);
}
