import type { LibraryManifestEntry, LibraryVersionSelector } from './contracts.js';
import {
  attachDiscoveredXRegistryProvider,
  createLibraryServiceFacade,
  type LibraryCacheStore,
  type LibraryServiceFacade,
} from './facade.js';
import {
  LocalDocumentLibraryProvider,
  StaticDocumentLibraryProvider,
  type HttpTransport,
  type XRegistryProviderReference,
} from './providers.js';
import type { LibraryPublisherStore, PublishedLibraryEntry } from './publishing.js';
import type { LibraryTrustPolicy } from './trust.js';
import { isLibraryOperation, type LibraryOperation } from '../contracts.js';

export type { LibraryOperation } from '../contracts.js';

const maxHttpResponseBytes = 4 * 1024 * 1024;
const maxHttpRedirects = 3;
const httpRequestTimeoutMs = 10_000;

export function createBoundedHttpsTransport(fetcher: typeof fetch): HttpTransport {
  return async (request, credential) => {
    const initialUrl = parseSafeHttpsUrl(request.url);
    const headers: Record<string, string> = { ...request.headers };
    if (credential) {
      if (!['Bearer', 'Basic', 'API-Key'].includes(credential.scheme)) throw new Error('Unsupported credential scheme.');
      if (credential.scheme === 'API-Key') headers['x-api-key'] = credential.secret;
      else headers.authorization = `${credential.scheme} ${credential.secret}`;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), httpRequestTimeoutMs);
    let currentUrl = initialUrl;
    try {
      for (let redirectCount = 0; ; redirectCount += 1) {
        const response = await fetcher(currentUrl, { method: 'GET', headers, redirect: 'manual', signal: controller.signal });
        if (isRedirectStatus(response.status)) {
          if (redirectCount >= maxHttpRedirects) throw new Error(`Library response exceeds the ${maxHttpRedirects}-redirect limit.`);
          const location = response.headers.get('location');
          if (!location) throw new Error('Library redirect response is missing a Location header.');
          const nextUrl = parseSafeHttpsUrl(new URL(location, currentUrl).toString());
          if (nextUrl.origin !== currentUrl.origin || nextUrl.origin !== initialUrl.origin) throw new Error('Library redirects must remain on the exact HTTPS origin.');
          currentUrl = nextUrl;
          continue;
        }
        if (response.url) {
          const finalUrl = parseSafeHttpsUrl(response.url);
          if (finalUrl.origin !== currentUrl.origin || finalUrl.origin !== initialUrl.origin) throw new Error('Library response final origin does not match the requested HTTPS origin.');
        }
        const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
        if (!contentType.includes('application/json') && !contentType.includes('+json')) throw new Error('Library response must be JSON.');
        rejectOversizedContentLength(response.headers.get('content-length'));
        const bytes = await readBoundedResponse(response, controller);
        return { status: response.status, body: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
      }
    } finally {
      clearTimeout(timeout);
    }
  };
}

export type SerializableLibraryProviderConfig =
  | SerializableManifestProviderConfig
  | SerializableXRegistryProviderConfig;

export interface SerializableManifestProviderConfig {
  readonly id: string;
  readonly kind: 'bundled' | 'static' | 'local';
  readonly location: string;
  readonly entries: readonly LibraryManifestEntry[];
  readonly trusted?: boolean;
}

export interface SerializableXRegistryProviderConfig {
  readonly id: string;
  readonly kind: 'xregistry';
  readonly baseUrl: string;
  readonly credentialId?: string;
  readonly credentialScheme?: string;
  readonly reference?: XRegistryProviderReference;
  readonly trusted?: boolean;
}

export interface LibraryProviderConfigStore {
  read(): Promise<readonly SerializableLibraryProviderConfig[] | undefined>;
  write(configs: readonly SerializableLibraryProviderConfig[]): Promise<void>;
}

export interface LibraryHostSecretStore {
  getSecret(key: string): Promise<string | undefined>;
  setSecret(key: string, secret: string): Promise<void>;
  deleteSecret(key: string): Promise<void>;
}

export interface LibraryHostRuntimeAdapters {
  readonly cacheStore: LibraryCacheStore;
  readonly providerConfigStore: LibraryProviderConfigStore;
  readonly secretStore: LibraryHostSecretStore;
  readonly isTrustedProvider: (providerId: string) => Promise<boolean>;
  readonly isTrustedOrigin: (origin: string) => Promise<boolean>;
  readonly readJsonResource: (uri: string) => Promise<unknown>;
  readonly httpTransport: HttpTransport;
  readonly resolvePublisherStore: (providerId: string) => Promise<LibraryPublisherStore | undefined>;
}

export interface LibraryHostRuntimeOptions extends LibraryHostRuntimeAdapters {
  readonly requiredBundledProviders: readonly SerializableManifestProviderConfig[];
}

export interface LibraryProviderSummary {
  readonly id: string;
  readonly kind: SerializableLibraryProviderConfig['kind'];
  readonly location: string;
  readonly trusted: boolean;
  readonly credentialConfigured: boolean;
  readonly publishSupported: boolean;
}

export interface LibraryCatalogEntry {
  readonly providerId: string;
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly versions: readonly {
    readonly version: string;
    readonly documentUri: string;
    readonly integrity?: string;
    readonly epoch?: string;
    readonly isDefault: boolean;
  }[];
}

export interface LibraryHostResolveRequest {
  readonly providerId: string;
  readonly entryId: string;
  readonly selector: LibraryVersionSelector;
  readonly offline: boolean;
}

export interface LibraryHostResolution {
  readonly document: unknown;
  readonly resolution: {
    readonly source: 'provider' | 'cache';
    readonly label: 'online-verified' | 'pinned-reproducible' | 'floating-offline-unverified';
    readonly state: {
      readonly selector: 'pinned' | 'floating';
      readonly connectivity: 'online' | 'offline';
      readonly verification: 'verified' | 'reproducible' | 'unverified';
    };
  };
  readonly trust: {
    readonly trusted: boolean;
    readonly reasons: readonly string[];
  };
  readonly provenance: {
    readonly providerId: string;
    readonly entryId: string;
    readonly version: string;
    readonly sourceUri: string;
  };
}

export interface LibraryHostPublishRequest {
  readonly providerId: string;
  readonly entryId: string;
  readonly version: string;
  readonly document: unknown;
  readonly sourceUri: string;
  readonly expectedEpoch?: string;
  readonly promoteDefault?: boolean;
}

export async function dispatchLibraryOperation(runtime: LibraryHostRuntime, operation: LibraryOperation, payload?: unknown): Promise<unknown> {
  if (!isLibraryOperation(operation)) throw new Error('Unsupported library operation.');
  if (operation === 'listProviders') { requireNoPayload(payload, operation); return runtime.listProviders(); }
  if (operation === 'listCatalog') { requireNoPayload(payload, operation); return runtime.listCatalog(); }
  if (operation === 'configureProvider') {
    const request = requireRecord(payload, operation);
    rejectUnknownKeys(request, ['config', 'credentialSecret'], operation);
    if (typeof request.credentialSecret !== 'undefined' && typeof request.credentialSecret !== 'string') throw new Error('credentialSecret must be a string.');
    return runtime.configureProvider(request.config as SerializableLibraryProviderConfig, request.credentialSecret as string | undefined);
  }
  if (operation === 'removeProvider') {
    const request = requireRecord(payload, operation);
    rejectUnknownKeys(request, ['providerId'], operation);
    if (typeof request.providerId !== 'string') throw new Error('providerId must be a string.');
    return runtime.removeProvider(request.providerId);
  }
  if (operation === 'resolve') {
    const request = requireRecord(payload, operation);
    rejectUnknownKeys(request, ['providerId', 'entryId', 'selector', 'offline'], operation);
    if (typeof request.providerId !== 'string' || typeof request.entryId !== 'string' || typeof request.offline !== 'boolean' || !isVersionSelector(request.selector)) throw new Error('Invalid library resolve request.');
    return runtime.resolve(request as unknown as LibraryHostResolveRequest);
  }
  const request = requireRecord(payload, operation);
  rejectUnknownKeys(request, ['providerId', 'entryId', 'version', 'document', 'sourceUri', 'expectedEpoch', 'promoteDefault'], operation);
  if (typeof request.providerId !== 'string' || typeof request.entryId !== 'string' || typeof request.version !== 'string' || typeof request.sourceUri !== 'string' || !('document' in request) ||
    typeof request.expectedEpoch !== 'undefined' && typeof request.expectedEpoch !== 'string' || typeof request.promoteDefault !== 'undefined' && typeof request.promoteDefault !== 'boolean') throw new Error('Invalid library publish request.');
  return runtime.publish(request as unknown as LibraryHostPublishRequest);
}

export class LibraryHostRuntime {
  private facade!: LibraryServiceFacade;
  private persistedConfigs: readonly SerializableLibraryProviderConfig[] = [];
  private readonly requiredById: ReadonlyMap<string, SerializableManifestProviderConfig>;
  private mutationQueue: Promise<void> = Promise.resolve();

  private constructor(private readonly options: LibraryHostRuntimeOptions) {
    const required = options.requiredBundledProviders.map(validateRequiredBundledConfig);
    this.requiredById = new Map(required.map((config) => [config.id, config]));
    if (this.requiredById.size !== required.length) throw new Error('Required bundled provider ids must be unique.');
  }

  static async create(options: LibraryHostRuntimeOptions): Promise<LibraryHostRuntime> {
    const runtime = new LibraryHostRuntime(options);
    const persisted = await options.providerConfigStore.read();
    runtime.persistedConfigs = validatePersistedConfigs(persisted ?? [], runtime.requiredById);
    runtime.facade = await runtime.buildFacade(runtime.persistedConfigs);
    return runtime;
  }

  async listProviders(): Promise<readonly LibraryProviderSummary[]> {
    return Promise.all(this.effectiveConfigs().map(async (config) => {
      const location = providerLocation(config);
      const trusted = isConfiguredTrusted(config) && await this.options.isTrustedProvider(config.id) && await this.options.isTrustedOrigin(originOf(location));
      const credentialConfigured = config.kind === 'xregistry' && config.credentialId !== undefined
        ? Boolean(await this.options.secretStore.getSecret(config.credentialId))
        : false;
      const publishSupported = Boolean(await this.options.resolvePublisherStore(config.id));
      return { id: config.id, kind: config.kind, location, trusted, credentialConfigured, publishSupported };
    }));
  }

  async configureProvider(config: SerializableLibraryProviderConfig, credentialSecret?: string): Promise<LibraryProviderSummary> {
    return this.serializeMutation(() => this.configureProviderCore(config, credentialSecret));
  }

  private async configureProviderCore(config: SerializableLibraryProviderConfig, credentialSecret?: string): Promise<LibraryProviderSummary> {
    const validated = validateConfig(config);
    if (this.requiredById.has(validated.id)) throw new Error(`Required bundled provider '${validated.id}' cannot be replaced.`);
    const previous = this.persistedConfigs.find((candidate) => candidate.id === validated.id);
    const previousCredentialId = previous?.kind === 'xregistry' ? previous.credentialId : undefined;
    const credentialId = validated.kind === 'xregistry' ? validated.credentialId : undefined;
    const previousSecret = credentialId ? await this.options.secretStore.getSecret(credentialId) : undefined;
    if (credentialSecret !== undefined) {
      if (!credentialId) throw new Error('A credential secret requires an xRegistry credentialId.');
      if (!credentialSecret.trim()) throw new Error('Credential secret must not be empty.');
      await this.options.secretStore.setSecret(credentialId, credentialSecret);
    }
    const next = [...this.persistedConfigs.filter((candidate) => candidate.id !== validated.id), validated]
      .sort((left, right) => left.id.localeCompare(right.id));
    try {
      const facade = await this.buildFacade(next);
      await this.options.providerConfigStore.write(next);
      this.persistedConfigs = next;
      this.facade = facade;
      if (previousCredentialId && previousCredentialId !== credentialId && !referencesCredential(next, previousCredentialId)) {
        await this.options.secretStore.deleteSecret(previousCredentialId);
      }
    } catch (error) {
      if (credentialSecret !== undefined && credentialId) {
        if (previousSecret === undefined) await this.options.secretStore.deleteSecret(credentialId);
        else await this.options.secretStore.setSecret(credentialId, previousSecret);
      }
      if (validated.kind === 'xregistry') throw new Error(`xRegistry provider '${validated.id}' could not be configured.`);
      throw error;
    }
    const summary = (await this.listProviders()).find((candidate) => candidate.id === validated.id);
    if (!summary) throw new Error(`Library provider '${validated.id}' was not configured.`);
    return summary;
  }

  async removeProvider(providerId: string): Promise<void> {
    return this.serializeMutation(() => this.removeProviderCore(providerId));
  }

  private async removeProviderCore(providerId: string): Promise<void> {
    const id = validateId(providerId);
    if (this.requiredById.has(id)) throw new Error(`Required bundled provider '${id}' cannot be removed.`);
    const existing = this.persistedConfigs.find((config) => config.id === id);
    if (!existing) throw new Error(`Library provider '${id}' is not configured.`);
    const next = this.persistedConfigs.filter((config) => config.id !== id);
    const facade = await this.buildFacade(next);
    await this.options.providerConfigStore.write(next);
    this.persistedConfigs = next;
    this.facade = facade;
    if (existing.kind === 'xregistry' && existing.credentialId && !referencesCredential(next, existing.credentialId)) {
      await this.options.secretStore.deleteSecret(existing.credentialId);
    }
  }

  async listCatalog(): Promise<readonly LibraryCatalogEntry[]> {
    const listings = await this.facade.service.listCatalog();
    return listings.flatMap((listing) => listing.entries.map((entry) => ({ providerId: listing.provider.providerId, ...entry })));
  }

  async resolve(request: LibraryHostResolveRequest): Promise<LibraryHostResolution> {
    validateId(request.providerId);
    validateText(request.entryId, 'Library entry id');
    const resolved = await this.facade.service.resolve(request);
    return {
      document: resolved.resolved.document.value,
      resolution: {
        source: resolved.resolved.source,
        label: resolved.resolved.label,
        state: resolved.resolved.state,
      },
      trust: resolved.trust,
      provenance: resolved.provenance,
    };
  }

  async publish(request: LibraryHostPublishRequest): Promise<PublishedLibraryEntry> {
    const providerId = validateId(request.providerId);
    const store = await this.options.resolvePublisherStore(providerId);
    if (!store) throw new Error(`Library provider '${providerId}' does not support publishing.`);
    const plan = this.facade.service.buildPublishPlan(request);
    return this.facade.service.publish({ store, plan });
  }

  private effectiveConfigs(): readonly SerializableLibraryProviderConfig[] {
    return [...this.requiredById.values(), ...this.persistedConfigs]
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  private async buildFacade(configs: readonly SerializableLibraryProviderConfig[]): Promise<LibraryServiceFacade> {
    const allConfigs = [...this.requiredById.values(), ...configs];
    const facade = createLibraryServiceFacade({
      cacheStore: this.options.cacheStore,
      secretStore: this.options.secretStore,
      trustStore: {
        isTrustedProvider: this.options.isTrustedProvider,
        isTrustedOrigin: this.options.isTrustedOrigin,
      },
      credentials: allConfigs.flatMap((config) => config.kind === 'xregistry' && config.credentialId
        ? [{ credentialId: config.credentialId, scheme: config.credentialScheme ?? 'Bearer', secretRef: config.credentialId }]
        : []),
    });
    for (const config of allConfigs) {
      const trustPolicy = await this.trustPolicy(config);
      if (config.kind === 'xregistry') {
        try {
          await attachDiscoveredXRegistryProvider({
            facade,
            id: config.id,
            baseUrl: config.baseUrl,
            transport: this.options.httpTransport,
            ...(config.credentialId ? { credentialId: config.credentialId } : {}),
            ...(config.reference ? { reference: config.reference } : {}),
            trustPolicy,
            metadata: { kind: config.kind, location: config.baseUrl },
          });
        } catch {
          throw new Error(`xRegistry provider '${config.id}' could not be initialized.`);
        }
      } else {
        const provider = config.kind === 'static'
          ? new StaticDocumentLibraryProvider(config.id, config.entries, async (_entryId, _version, uri) => this.options.readJsonResource(uri))
          : new LocalDocumentLibraryProvider(config.id, config.entries, this.options.readJsonResource);
        facade.service.addProvider({ provider, trustPolicy, metadata: { kind: config.kind, location: config.location } });
      }
    }
    return facade;
  }

  private async trustPolicy(config: SerializableLibraryProviderConfig): Promise<LibraryTrustPolicy> {
    const location = providerLocation(config);
    const trustedProvider = isConfiguredTrusted(config) && await this.options.isTrustedProvider(config.id);
    const trustedOrigin = isConfiguredTrusted(config) && await this.options.isTrustedOrigin(originOf(location));
    return {
      trustedProviderIds: trustedProvider ? [config.id] : [],
      trustedUriPrefixes: trustedOrigin ? [location] : [],
    };
  }

  private serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

export async function createLibraryHostRuntime(options: LibraryHostRuntimeOptions): Promise<LibraryHostRuntime> {
  return LibraryHostRuntime.create(options);
}

function validatePersistedConfigs(
  configs: readonly SerializableLibraryProviderConfig[],
  requiredById: ReadonlyMap<string, SerializableManifestProviderConfig>,
): readonly SerializableLibraryProviderConfig[] {
  if (!Array.isArray(configs)) throw new Error('Persisted library provider configuration must be an array.');
  const validated = configs.map(validateConfig);
  const ids = new Set<string>();
  for (const config of validated) {
    if (requiredById.has(config.id)) throw new Error(`Required bundled provider '${config.id}' cannot be replaced.`);
    if (ids.has(config.id)) throw new Error(`Duplicate library provider id '${config.id}'.`);
    ids.add(config.id);
  }
  return validated.sort((left, right) => left.id.localeCompare(right.id));
}

function validateRequiredBundledConfig(config: SerializableManifestProviderConfig): SerializableManifestProviderConfig {
  const validated = validateConfig(config);
  if (validated.kind !== 'bundled') throw new Error('Required providers must have kind bundled.');
  return validated;
}

function validateConfig(config: SerializableLibraryProviderConfig): SerializableLibraryProviderConfig {
  if (!config || typeof config !== 'object') throw new Error('Library provider configuration must be an object.');
  const id = validateId(config.id);
  if (config.kind === 'xregistry') {
    const baseUrl = validateHttpsUrl(config.baseUrl);
    const credentialId = config.credentialId === undefined ? undefined : validateId(config.credentialId);
    const credentialScheme = config.credentialScheme === undefined ? undefined : validateText(config.credentialScheme, 'Credential scheme');
    if (credentialScheme && !credentialId) throw new Error('credentialScheme requires credentialId.');
    const reference = config.reference === undefined ? undefined : {
      group: validateText(config.reference.group, 'xRegistry group'),
      resource: validateText(config.reference.resource, 'xRegistry resource'),
    };
    if (config.trusted !== true) throw new Error('xRegistry providers require explicit trusted: true configuration.');
    if (credentialScheme && !['Bearer', 'Basic', 'API-Key'].includes(credentialScheme)) throw new Error('Credential scheme must be Bearer, Basic, or API-Key.');
    return { id, kind: 'xregistry', baseUrl, ...(credentialId ? { credentialId } : {}), ...(credentialScheme ? { credentialScheme } : {}), ...(reference ? { reference } : {}), trusted: true };
  }
  if (!['bundled', 'static', 'local'].includes(config.kind)) throw new Error('Unsupported library provider kind.');
  const location = validateText(config.location, 'Library provider location');
  if (!Array.isArray(config.entries)) throw new Error('Library provider entries must be an array.');
  if (config.kind === 'static' && /^https:/i.test(location) && config.trusted !== true) throw new Error('Remote static providers require explicit trusted: true configuration.');
  return { id, kind: config.kind, location, entries: config.entries, ...(config.trusted === true ? { trusted: true } : {}) };
}

function validateId(value: string): string {
  const id = validateText(value, 'Library provider id');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) throw new Error(`Invalid library provider id '${id}'.`);
  return id;
}

function validateText(value: string, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must not be empty.`);
  return value.trim();
}

function validateHttpsUrl(value: string): string {
  const url = validateText(value, 'xRegistry baseUrl');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('xRegistry baseUrl must be a valid HTTPS URL.');
  }
  if (parsed.protocol !== 'https:') throw new Error('xRegistry baseUrl must use HTTPS.');
  if (parsed.username || parsed.password) throw new Error('xRegistry baseUrl must not contain credentials.');
  return url.replace(/\/+$/, '');
}

function providerLocation(config: SerializableLibraryProviderConfig): string {
  return config.kind === 'xregistry' ? config.baseUrl : config.location;
}

function referencesCredential(configs: readonly SerializableLibraryProviderConfig[], credentialId: string): boolean {
  return configs.some((config) => config.kind === 'xregistry' && config.credentialId === credentialId);
}

function originOf(location: string): string {
  try {
    return new URL(location).origin;
  } catch {
    return location;
  }
}

function isConfiguredTrusted(config: SerializableLibraryProviderConfig): boolean {
  return config.kind === 'bundled' || config.kind === 'local' || config.trusted === true;
}

function parseSafeHttpsUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error('Library network requests require HTTPS.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Library network requests require HTTPS without URL credentials.');
  return url;
}

function isRedirectStatus(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

function rejectOversizedContentLength(value: string | null): void {
  if (value === null) return;
  const length = Number(value);
  if (Number.isFinite(length) && length > maxHttpResponseBytes) throw new Error(`Library response exceeds the ${maxHttpResponseBytes}-byte limit.`);
}

async function readBoundedResponse(response: Response, controller: AbortController): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxHttpResponseBytes) {
        controller.abort();
        await reader.cancel();
        throw new Error(`Library response exceeds the ${maxHttpResponseBytes}-byte limit.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function requireNoPayload(payload: unknown, operation: string): void {
  if (payload !== undefined) throw new Error(`${operation} does not accept a payload.`);
}

function requireRecord(payload: unknown, operation: string): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error(`${operation} requires an object payload.`);
  return payload as Record<string, unknown>;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], operation: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error(`${operation} payload contains unsupported fields.`);
}

function isVersionSelector(value: unknown): value is LibraryVersionSelector {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const selector = value as Record<string, unknown>;
  if (selector.kind === 'pinned') return Object.keys(selector).every((key) => ['kind', 'version'].includes(key)) && typeof selector.version === 'string' && selector.version.length > 0 && selector.version.length <= 256;
  return selector.kind === 'floating' && Object.keys(selector).every((key) => ['kind', 'tag'].includes(key)) && (selector.tag === undefined || typeof selector.tag === 'string' && selector.tag.length <= 256);
}