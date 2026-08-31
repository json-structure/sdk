import { PROTOCOL_VERSION, type ResourceSnapshot } from './contracts.js';
import { parseDocument } from './parser.js';
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
  supportedSchemes: ['file', 'http', 'https', 'vscode-remote'],
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
      if (!parsed.model || parsed.recovery !== 'valid') {
        results.push({ uri, snapshot: { uri: resource.uri, text: resource.content, documentVersion: 1, recovery: parsed.recovery, diagnostics: parsed.diagnostics }, availability: 'stale' });
        continue;
      }
      results.push({ uri, model: parsed.model, value: parsed.value as Readonly<Record<string, unknown>>, availability: 'available' });
      for (const imported of importSources(parsed.value)) pending.push({ uri: resolveResourceUri(resource.uri, imported), depth: depth + 1 });
    } catch {
      results.push({ uri, availability: 'unavailable' });
    }
  }
  return results;
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

function importSources(value: unknown): readonly string[] {
  const sources: string[] = [];
  const visit = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return;
    const object = candidate as Record<string, unknown>;
    for (const keyword of ['$import', '$importdefs']) if (typeof object[keyword] === 'string') sources.push(object[keyword]);
    for (const nested of Object.values(object)) visit(nested);
  };
  visit(value);
  return sources;
}