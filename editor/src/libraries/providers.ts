import { normalizeLibraryEntry, type LibraryDocument, type LibraryEntry, type LibraryManifestEntry, type LibraryProvider } from './contracts.js';
import { cloneLibraryDocument, type LibraryPublisherStore } from './publishing.js';
import { canonicalLibraryUri, isLibraryUriWithin, isSameLibraryUri } from './trust.js';

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
  readonly trust?: TrustAdapter;
}

export class XRegistryApiLibraryProvider implements LibraryProvider {
  readonly id: string;
  private readonly baseUrl: string;

  constructor(private readonly options: XRegistryLibraryProviderOptions) {
    this.id = options.id;
    this.baseUrl = canonicalLibraryUri(options.baseUrl).replace(/\/+$/, '');
  }

  async listEntries(): Promise<readonly LibraryEntry[]> {
    const resourceUrl = this.resourceUrl();
    const body = await this.get(`${resourceUrl}?inline=versions`);
    const resources = record(body, 'xRegistry collection').resources;
    if (!Array.isArray(resources)) throw new Error('xRegistry collection did not contain a resources array.');
    return normalizeEntries(resources.map((resource) => parseXRegistryEntry(resource, resourceUrl)));
  }

  async readDocument(entryId: string, version: string): Promise<LibraryDocument> {
    const uri = xRegistryVersionUrl(this.resourceUrl(), entryId, version);
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
    const group = xRegistrySegment(this.options.group, 'group');
    const resource = xRegistrySegment(this.options.resource, 'resource');
    const uri = canonicalLibraryUri(`${this.baseUrl}/${encodeURIComponent(group)}/${encodeURIComponent(resource)}`);
    if (!isLibraryUriWithin(uri, `${this.baseUrl}/`)) throw new Error('xRegistry resource URL escaped the configured provider path.');
    return uri;
  }

  private async get(url: string): Promise<unknown> {
    const canonicalUrl = canonicalLibraryUri(url);
    if (this.options.trust && !await this.options.trust.isTrusted(this.id, canonicalUrl)) {
      throw new Error(`xRegistry provider '${this.id}' is not trusted for '${canonicalUrl}'.`);
    }
    const credential = this.options.credentialId && this.options.lookupCredential
      ? await this.options.lookupCredential(this.options.credentialId)
      : undefined;
    try {
      const response = await this.options.transport({ method: 'GET', url: canonicalUrl, headers: { accept: 'application/json' } }, credential);
      if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
      return response.body;
    } catch {
      throw new Error(`xRegistry request failed for ${canonicalUrl}.`);
    }
  }
}

function parseXRegistryEntry(value: unknown, resourceUrl: string): LibraryManifestEntry {
  const resource = record(value, 'xRegistry resource');
  if (typeof resource.id !== 'string') throw new Error('xRegistry resource id was missing.');
  const resourceId = resource.id;
  const versions = Array.isArray(resource.versions) ? resource.versions.map((candidate) => {
    const version = record(candidate, 'xRegistry version');
    if (typeof version.id !== 'string') throw new Error('xRegistry version id was missing.');
    const versionId = version.id;
    const documentUri = xRegistryVersionUrl(resourceUrl, resourceId, versionId);
    if (typeof version.documentUri === 'string' && !isSameLibraryUri(version.documentUri, documentUri)) {
      throw new Error(`xRegistry version '${resourceId}@${versionId}' attempted to replace its immutable provider URI.`);
    }
    return {
      version: versionId,
      documentUri,
      ...(typeof version.integrity === 'string' ? { integrity: version.integrity } : {}),
      ...(typeof version.epoch === 'string' ? { epoch: version.epoch } : {}),
      isDefault: resource.defaultVersionId === version.id,
    };
  }) : [];
  return {
    id: resourceId,
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
  const baseUrl = canonicalLibraryUri(options.baseUrl).replace(/\/+$/, '');
  if (options.trust && !await options.trust.isTrusted(options.id, baseUrl)) {
    throw new Error(`xRegistry provider '${options.id}' is not trusted for '${baseUrl}'.`);
  }
  const rootUrl = canonicalLibraryUri(`${baseUrl}/`);
  const modelUrl = canonicalLibraryUri(`${baseUrl}/model`);
  if (options.trust && (!await options.trust.isTrusted(options.id, rootUrl) || !await options.trust.isTrusted(options.id, modelUrl))) {
    throw new Error(`xRegistry provider '${options.id}' discovery URI is not trusted.`);
  }
  const credential = options.credentialId && options.lookupCredential
    ? await options.lookupCredential(options.credentialId)
    : undefined;
  const root = record(await readJson(options.transport, rootUrl, credential), 'xRegistry root');
  const model = record(await readJson(options.transport, modelUrl, credential), 'xRegistry model');
  const discovery = buildDiscovery(baseUrl, root, model);
  const selected = options.reference ?? await firstSchemaReference(options.id, baseUrl, discovery, options.trust);
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
      trust: options.trust,
    }),
  };
}

async function firstSchemaReference(providerId: string, baseUrl: string, discovery: XRegistryDiscovery, trust?: TrustAdapter): Promise<XRegistryProviderReference | undefined> {
  const first = discovery.schemaCollections.at(0);
  if (!first) return undefined;
  const collectionUrl = new URL(canonicalLibraryUri(first));
  const base = new URL(canonicalLibraryUri(`${baseUrl}/`));
  if (collectionUrl.origin !== base.origin || !isLibraryUriWithin(collectionUrl.href, base.href)) {
    throw new Error('xRegistry model exposed a schema collection outside the configured provider origin or path.');
  }
  if (trust && !await trust.isTrusted(providerId, collectionUrl.href)) throw new Error('xRegistry model exposed an untrusted schema collection.');
  const path = collectionUrl.pathname.slice(base.pathname.length).replace(/^\/+/, '');
  const parts = path.split('/').filter((part) => part.length > 0).map(decodeURIComponent);
  if (parts.length < 2) return undefined;
  return { group: xRegistrySegment(parts[0]!, 'group'), resource: xRegistrySegment(parts[1]!, 'resource') };
}

function xRegistryVersionUrl(resourceUrl: string, entryId: string, version: string): string {
  const entrySegment = xRegistrySegment(entryId, 'resource id');
  const versionSegment = xRegistrySegment(version, 'version id');
  const uri = canonicalLibraryUri(`${resourceUrl}/${encodeURIComponent(entrySegment)}/versions/${encodeURIComponent(versionSegment)}`);
  if (!isLibraryUriWithin(uri, `${resourceUrl}/`)) throw new Error('xRegistry version URL escaped the configured resource path.');
  return uri;
}

function xRegistrySegment(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`xRegistry ${label} must not be empty.`);
  if (value === '.' || value === '..') throw new Error(`xRegistry ${label} must not be a relative path segment.`);
  return value;
}

async function readJson(transport: HttpTransport, url: string, credential?: SecretCredential): Promise<unknown> {
  const response = await transport({ method: 'GET', url, headers: { accept: 'application/json' } }, credential);
  if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
  return response.body;
}

function buildDiscovery(baseUrl: string, root: Record<string, unknown>, model: Record<string, unknown>): XRegistryDiscovery {
  const links = [
    ...readLinks(baseUrl, root),
    ...readLinks(baseUrl, model),
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

function readLinks(baseUrl: string, value: Record<string, unknown>): string[] {
  const links = value.links;
  if (!Array.isArray(links)) return [];
  return links
    .map((item) => item && typeof item === 'object' ? (item as Record<string, unknown>).href : undefined)
    .filter((href): href is string => typeof href === 'string' && href.length > 0)
    .map((href) => canonicalLibraryUri(new URL(href, `${baseUrl}/`).href));
}

function readModelCollections(baseUrl: string, model: Record<string, unknown>): string[] {
  const collections = model.collections;
  if (!collections || typeof collections !== 'object' || Array.isArray(collections)) return [];
  return Object.entries(collections)
    .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value))
    .map(([name]) => canonicalLibraryUri(`${baseUrl}/${encodeURIComponent(name)}`));
}

/** Merges immutable published versions into a provider's normal catalog and read path. */
export class PublishedOverlayLibraryProvider implements LibraryProvider {
  readonly id: string;

  constructor(private readonly base: LibraryProvider, private readonly published: LibraryPublisherStore) {
    this.id = base.id;
  }

  async listEntries(): Promise<readonly LibraryEntry[]> {
    const baseEntries = await this.base.listEntries();
    const entries = new Map(baseEntries.map((entry) => [entry.id, entry]));
    for (const published of await this.published.list()) {
      const base = entries.get(published.id);
      const versions = new Map((base?.versions ?? []).map((version) => [version.version, version]));
      for (const [version, document] of Object.entries(published.versions)) {
        versions.set(version, {
          version,
          documentUri: document.uri,
          ...(document.integrity ? { integrity: document.integrity } : {}),
          epoch: document.epoch ?? published.epoch,
          isDefault: false,
        });
      }
      const defaultVersion = published.defaultVersion ?? base?.versions.find((version) => version.isDefault)?.version;
      entries.set(published.id, {
        id: published.id,
        name: base?.name ?? published.id,
        ...(base?.description ? { description: base.description } : {}),
        versions: [...versions.values()].sort((left, right) => left.version.localeCompare(right.version)).map((version) => ({ ...version, isDefault: version.version === defaultVersion })),
      });
    }
    return [...entries.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  async readDocument(entryId: string, version: string): Promise<LibraryDocument> {
    const document = (await this.published.read(entryId))?.versions[version];
    return document ? cloneLibraryDocument(document) : this.base.readDocument(entryId, version);
  }
}