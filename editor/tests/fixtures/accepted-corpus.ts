import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const editorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function resolveAcceptedCorpusRoot(): string {
  const configured = [process.env.JSON_STRUCTURE_AVROTIZE_ROOT, process.env.STRUCTURIZE_CORPUS_ROOT, process.env.AVROTIZE_ROOT].filter((value): value is string => typeof value === 'string' && value.trim() !== '');
  const candidates = [...configured, path.resolve(editorRoot, '..', '..', 'avrotize')].map((value) => path.resolve(value));
  const root = candidates.find((value) => existsSync(path.join(value, 'test')));
  if (!root) throw new Error(`Accepted conversion corpus is unavailable. Set JSON_STRUCTURE_AVROTIZE_ROOT to an Avrotize checkout containing test\\jsons, or provide an accepted corpus at the configured root.`);
  return root;
}

export function acceptedCorpusFixture(relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes('..')) throw new Error(`Accepted corpus fixture path must be a relative path: ${relativePath}`);
  const root = resolveAcceptedCorpusRoot();
  const fixture = path.resolve(root, relativePath);
  if (!fixture.startsWith(`${root}${path.sep}`) || !existsSync(fixture)) throw new Error(`Required accepted corpus fixture is missing: ${fixture}. Set JSON_STRUCTURE_AVROTIZE_ROOT to a complete accepted corpus checkout.`);
  return fixture;
}
