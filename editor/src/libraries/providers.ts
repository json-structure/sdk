import { normalizeLibraryEntry, type LibraryDocument, type LibraryEntry, type LibraryManifestEntry, type LibraryProvider } from './contracts.js';

export type LibraryDocumentReader = (uri: string) => Promise<unknown>;

export class LocalDocumentLibraryProvider implements LibraryProvider {
  readonly id: string;
  private readonly entries: readonly LibraryEntry[];

  constructor(id: string, entries: readonly LibraryManifestEntry[], private readonly read: LibraryDocumentReader) {
    this.id = id;
    this.entries = normalizeEntries(entries);
  }

  async listEntries(): Promise<readonly LibraryEntry[]> {
    return this.entries;
  }

  async readDocument(entryId: string, version: string): Promise<LibraryDocument> {
    const selected = findVersion(this.entries, entryId, version);
    return {
      entryId,
      version,
      uri: selected.documentUri,
      value: await this.read(selected.documentUri),
      ...(selected.integrity ? { integrity: selected.integrity } : {}),
      ...(selected.epoch ? { epoch: selected.epoch } : {}),
    };
  }
}

export type StaticLibraryDocumentReader = (entryId: string, version: string, uri: string) => Promise<unknown>;

export class StaticDocumentLibraryProvider implements LibraryProvider {
  readonly id: string;
  private readonly entries: readonly LibraryEntry[];

  constructor(id: string, entries: readonly LibraryManifestEntry[], private readonly read: StaticLibraryDocumentReader) {
    this.id = id;
    this.entries = normalizeEntries(entries);
  }

  async listEntries(): Promise<readonly LibraryEntry[]> {
    return this.entries;
  }

  async readDocument(entryId: string, version: string): Promise<LibraryDocument> {
    const selected = findVersion(this.entries, entryId, version);
    return {
      entryId,
      version,
      uri: selected.documentUri,
      value: await this.read(entryId, version, selected.documentUri),
      ...(selected.integrity ? { integrity: selected.integrity } : {}),
      ...(selected.epoch ? { epoch: selected.epoch } : {}),
    };
  }
}

export interface HttpRequest {
  readonly method: 'GET';
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface HttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface SecretCredential {
  readonly scheme: string;
  readonly secret: string;
}

export type HttpTransport = (request: HttpRequest, credential?: SecretCredential) => Promise<HttpResponse>;
export type CredentialLookup = (credentialId: string) => Promise<SecretCredential | undefined>;

export interface TrustAdapter {
  isTrusted(providerId: string, url: string): Promise<boolean>;
}

export interface CredentialAdapter {
  get(credentialId: string): Promise<SecretCredential | undefined>;
}

export interface XRegistryDiscovery {
  readonly root: Record<string, unknown>;
  readonly model: Record<string, unknown>;
  readonly links: readonly string[];
  readonly schemaCollections: readonly string[];
}

export interface XRegistryProviderReference {
  readonly group: string;
  readonly resource: string;
}

export interface XRegistryDiscoveredProvider {
  readonly provider: XRegistryApiLibraryProvider;
  readonly discovery: XRegistryDiscovery;
}

export interface XRegistryLibraryProviderOptions {
  readonly id: string;
  readonly baseUrl: string;
  readonly group: string;
  readonly resource: string;
  readonly credentialId?: string;
  readonly transport: HttpTransport;
  readonly lookupCredential?: CredentialLookup;
}

export class XRegistryApiLibraryProvider implements LibraryProvider {
  readonly id: string;
  private readonly baseUrl: string;

  constructor(private readonly options: XRegistryLibraryProviderOptions) {
    this.id = options.id;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
  }

  async listEntries(): Promise<readonly LibraryEntry[]> {
    const body = await this.get(`${this.resourceUrl()}?inline=versions`);
    const resources = record(body, 'xRegistry collection').resources;
    if (!Array.isArray(resources)) throw new Error('xRegistry collection did not contain a resources array.');
    return normalizeEntries(resources.map(parseXRegistryEntry));
  }

  async readDocument(entryId: string, version: string): Promise<LibraryDocument> {
    const uri = `${this.resourceUrl()}/${encodeURIComponent(entryId)}/versions/${encodeURIComponent(version)}`;
    const body = record(await this.get(uri), 'xRegistry version');
    return {
      entryId,
      version,
      uri,
      value: 'document' in body ? body.document : body,
      ...(typeof body.integrity === 'string' ? { integrity: body.integrity } : {}),
      ...(typeof body.epoch === 'string' ? { epoch: body.epoch } : {}),
    };
  }

  private resourceUrl(): string {
    return `${this.baseUrl}/${encodeURIComponent(this.options.group)}/${encodeURIComponent(this.options.resource)}`;
  }

  private async get(url: string): Promise<unknown> {
    const credential = this.options.credentialId && this.options.lookupCredential
      ? await this.options.lookupCredential(this.options.credentialId)
      : undefined;
    try {
      const response = await this.options.transport({ method: 'GET', url, headers: { accept: 'application/json' } }, credential);
      if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
      return response.body;
    } catch {
      throw new Error(`xRegistry request failed for ${url}.`);
    }
  }
}

function parseXRegistryEntry(value: unknown): LibraryManifestEntry {
  const resource = record(value, 'xRegistry resource');
  if (typeof resource.id !== 'string') throw new Error('xRegistry resource id was missing.');
  const versions = Array.isArray(resource.versions) ? resource.versions.map((candidate) => {
    const version = record(candidate, 'xRegistry version');
    if (typeof version.id !== 'string') throw new Error('xRegistry version id was missing.');
    const documentUri = typeof version.documentUri === 'string' ? version.documentUri : `${resource.id}@${version.id}`;
    return {
      version: version.id,
      documentUri,
      ...(typeof version.integrity === 'string' ? { integrity: version.integrity } : {}),
      ...(typeof version.epoch === 'string' ? { epoch: version.epoch } : {}),
      isDefault: resource.defaultVersionId === version.id,
    };
  }) : [];
  return {
    id: resource.id,
    ...(typeof resource.name === 'string' ? { name: resource.name } : {}),
    ...(typeof resource.description === 'string' ? { description: resource.description } : {}),
    versions,
  };
}

function normalizeEntries(entries: readonly LibraryManifestEntry[]): readonly LibraryEntry[] {
  const normalized = entries.map(normalizeLibraryEntry);
  const ids = new Set<string>();
  for (const entry of normalized) {
    if (ids.has(entry.id)) throw new Error(`Duplicate library entry '${entry.id}'.`);
    ids.add(entry.id);
  }
  return [...normalized].sort((left, right) => left.id.localeCompare(right.id));
}

function findVersion(entries: readonly LibraryEntry[], entryId: string, version: string) {
  const entry = entries.find((candidate) => candidate.id === entryId);
  const selected = entry?.versions.find((candidate) => candidate.version === version);
  if (!selected) throw new Error(`Library document '${entryId}@${version}' was not found.`);
  return selected;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} was not an object.`);
  return value as Record<string, unknown>;
}

export interface DiscoverXRegistryOptions {
  readonly id: string;
  readonly baseUrl: string;
  readonly transport: HttpTransport;
  readonly lookupCredential?: CredentialLookup;
  readonly credentialId?: string;
  readonly trust?: TrustAdapter;
  readonly reference?: XRegistryProviderReference;
}

export async function discoverXRegistryProvider(options: DiscoverXRegistryOptions): Promise<XRegistryDiscoveredProvider> {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  if (options.trust && !await options.trust.isTrusted(options.id, baseUrl)) {
    throw new Error(`xRegistry provider '${options.id}' is not trusted for '${baseUrl}'.`);
  }
  const credential = options.credentialId && options.lookupCredential
    ? await options.lookupCredential(options.credentialId)
    : undefined;
  const root = record(await readJson(options.transport, `${baseUrl}/`, credential), 'xRegistry root');
  const model = record(await readJson(options.transport, `${baseUrl}/model`, credential), 'xRegistry model');
  const discovery = buildDiscovery(baseUrl, root, model);
  const selected = options.reference ?? firstSchemaReference(discovery);
  if (!selected) throw new Error('xRegistry model did not expose a schema collection.');
  return {
    discovery,
    provider: new XRegistryApiLibraryProvider({
      id: options.id,
      baseUrl,
      group: selected.group,
      resource: selected.resource,
      ...(options.credentialId ? { credentialId: options.credentialId } : {}),
      transport: options.transport,
      lookupCredential: options.lookupCredential,
    }),
  };
}

function firstSchemaReference(discovery: XRegistryDiscovery): XRegistryProviderReference | undefined {
  const first = discovery.schemaCollections.at(0);
  if (!first) return undefined;
  const path = first.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+/, '');
  const parts = path.split('/').filter((part) => part.length > 0).map(decodeURIComponent);
  if (parts.length < 2) return undefined;
  return { group: parts[0]!, resource: parts[1]! };
}

async function readJson(transport: HttpTransport, url: string, credential?: SecretCredential): Promise<unknown> {
  const response = await transport({ method: 'GET', url, headers: { accept: 'application/json' } }, credential);
  if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
  return response.body;
}

function buildDiscovery(baseUrl: string, root: Record<string, unknown>, model: Record<string, unknown>): XRegistryDiscovery {
  const links = [
    ...readLinks(root),
    ...readLinks(model),
  ];
  const schemaCollections = [
    ...links.filter((link) => /jsonstructure|schema/i.test(link)),
    ...readModelCollections(baseUrl, model).filter((link) => /jsonstructure|schema/i.test(link)),
  ];
  return {
    root,
    model,
    links: [...new Set(links)],
    schemaCollections: [...new Set(schemaCollections)],
  };
}

function readLinks(value: Record<string, unknown>): string[] {
  const links = value.links;
  if (!Array.isArray(links)) return [];
  return links
    .map((item) => item && typeof item === 'object' ? (item as Record<string, unknown>).href : undefined)
    .filter((href): href is string => typeof href === 'string' && href.length > 0);
}

function readModelCollections(baseUrl: string, model: Record<string, unknown>): string[] {
  const collections = model.collections;
  if (!collections || typeof collections !== 'object' || Array.isArray(collections)) return [];
  return Object.entries(collections)
    .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value))
    .map(([name]) => `${baseUrl}/${encodeURIComponent(name)}`);
}