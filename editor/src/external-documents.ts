import { PROTOCOL_VERSION, type ResourceSnapshot } from './contracts.js';
import { parseDocument } from './parser.js';
import { resolveCapabilities } from './capabilities.js';
import type { ExternalDocumentDescriptor } from './resolver.js';

export type ResourceReader = (uri: string) => Promise<ResourceSnapshot>;

export interface ExternalDocumentLimits {
  readonly maxDepth: number;
  readonly maxDocuments: number;
  readonly maxTotalBytes: number;
  readonly supportedSchemes: readonly string[];
}

export const defaultExternalDocumentLimits: ExternalDocumentLimits = {
  maxDepth: 16,
  maxDocuments: 128,
  maxTotalBytes: 8 * 1024 * 1024,
  supportedSchemes: ['file', 'http', 'https', 'vscode-remote', 'memory', 'bundle'],
};

/** Loads the transitive import closure as resolver-ready descriptors. */
export async function loadExternalDocuments(documentUri: string, sources: readonly string[], readResource: ResourceReader, limits: ExternalDocumentLimits = defaultExternalDocumentLimits): Promise<readonly ExternalDocumentDescriptor[]> {
  const results: ExternalDocumentDescriptor[] = [];
  const visited = new Set<string>();
  const supportedSchemes = new Set(limits.supportedSchemes.map((scheme) => scheme.toLowerCase()));
  const pending = sources.map((source) => ({ uri: resolveResourceUri(documentUri, source), depth: 1 }));
  let totalBytes = 0;
  while (pending.length && visited.size < limits.maxDocuments) {
    const { uri, depth } = pending.shift()!;
    if (visited.has(uri)) continue;
    visited.add(uri);
    if (depth > limits.maxDepth || !hasSupportedScheme(uri, supportedSchemes)) {
      results.push({ uri, availability: 'unavailable' });
      continue;
    }
    try {
      const resource = await readResource(uri);
      const contentBytes = new TextEncoder().encode(resource.content).byteLength;
      if (contentBytes > limits.maxTotalBytes - totalBytes) {
        results.push({ uri, availability: 'unavailable' });
        break;
      }
      totalBytes += contentBytes;
      const parsed = parseDocument(resource.uri, resource.content);
      const importedSources = discoverImportSources(parsed.value);
      if (!parsed.model || parsed.recovery !== 'valid' || parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
        results.push({ uri, snapshot: { uri: resource.uri, text: resource.content, documentVersion: 1, recovery: parsed.recovery, diagnostics: parsed.diagnostics }, availability: 'stale' });
        for (const source of importedSources) pending.push({ uri: resolveResourceUri(resource.uri, source), depth: depth + 1 });
        continue;
      }
      results.push({ uri, model: parsed.model, value: parsed.value as Readonly<Record<string, unknown>>, availability: 'available' });
      for (const source of importedSources) pending.push({ uri: resolveResourceUri(resource.uri, source), depth: depth + 1 });
    } catch {
      results.push({ uri, availability: 'unavailable' });
    }
  }
  return results;
}

/** Returns import sources found at active namespace locations without interpreting schema payloads. */
export function discoverImportSources(value: unknown): readonly string[] {
  if (!isRecord(value) || !resolveCapabilities(value).importActive) return [];
  const sources: string[] = [];
  const visit = (candidate: Readonly<Record<string, unknown>>, pointer: string): void => {
    for (const keyword of ['$import', '$importdefs'] as const) {
      if (typeof candidate[keyword] === 'string') sources.push(candidate[keyword]);
    }
    if (pointer === '') {
      if (isRecord(candidate.definitions)) visit(candidate.definitions, '/definitions');
      return;
    }
    if (pointer !== '/definitions' && !pointer.startsWith('/definitions/')) return;
    for (const [name, child] of Object.entries(candidate)) {
      if (name.startsWith('$') || !isRecord(child) || isSchemaDeclaration(child)) continue;
      visit(child, `${pointer}/${escapePointerPart(name)}`);
    }
  };
  visit(value, '');
  return [...new Set(sources)];
}

function isSchemaDeclaration(value: Readonly<Record<string, unknown>>): boolean {
  return Object.prototype.hasOwnProperty.call(value, 'type') ||
    Object.prototype.hasOwnProperty.call(value, '$ref') ||
    ['allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else'].some((keyword) => Object.prototype.hasOwnProperty.call(value, keyword));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function escapePointerPart(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}
function hasSupportedScheme(uri: string, supportedSchemes: ReadonlySet<string>): boolean {
  try { return supportedSchemes.has(new URL(uri).protocol.slice(0, -1).toLowerCase()); }
  catch { return false; }
}

export function resolveResourceUri(documentUri: string, source: string): string {
  const resource = source.split('#', 1)[0] ?? '';
  if (!resource) return documentUri.split('#', 1)[0] ?? documentUri;
  try { return new URL(resource, documentUri).toString(); }
  catch { return resource; }
}

/** Creates a protocol resource result for host implementations and tests. */
export function resourceSnapshot(requestId: string, uri: string, content: string, contentHash = ''): ResourceSnapshot {
  return { protocolVersion: PROTOCOL_VERSION, requestId, uri, content, contentHash };
}
