import { normalizeLibraryEntry, type LibraryManifestEntry, type LibraryVersionSelector } from './contracts.js';
import {
  attachDiscoveredXRegistryProvider,
  createLibraryServiceFacade,
  type LibraryCacheStore,
  type LibraryServiceFacade,
} from './facade.js';
import {
  LocalDocumentLibraryProvider,
  PublishedOverlayLibraryProvider,
  StaticDocumentLibraryProvider,
  type HttpTransport,
  type XRegistryProviderReference,
} from './providers.js';
import { publishedLibraryDocumentUri, type LibraryPublisherStore, type PublishedLibraryEntry } from './publishing.js';
import { canonicalLibraryOrigin, canonicalLibraryUri, evaluateLibraryTrust, isLibraryUriWithin, isSameLibraryUri, type LibraryTrustPolicy } from './trust.js';
import { isLibraryOperation, type LibraryOperation } from '../contracts.js';
import { DocumentSession } from '../session.js';

export type { LibraryOperation } from '../contracts.js';

const maxHttpResponseBytes = 4 * 1024 * 1024;
const maxHttpRedirects = 3;
const httpRequestTimeoutMs = 10_000;

export type LibraryHostAddressResolver = (hostname: string) => Promise<readonly string[]>;

export function createBoundedHttpsTransport(fetcher: typeof fetch, resolveAddresses?: LibraryHostAddressResolver): HttpTransport {
  return async (request, credential) => {
    const initialUrl = parseSafeHttpsUrl(request.url);
    const redirectRoot = redirectRootUrl(initialUrl);
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
        await requirePublicNetworkTarget(currentUrl, resolveAddresses);
        const response = await fetcher(currentUrl, { method: 'GET', headers, redirect: 'manual', signal: controller.signal });
        if (isRedirectStatus(response.status)) {
          if (redirectCount >= maxHttpRedirects) throw new Error(`Library response exceeds the ${maxHttpRedirects}-redirect limit.`);
          const location = response.headers.get('location');
          if (!location) throw new Error('Library redirect response is missing a Location header.');
          const nextUrl = parseSafeHttpsUrl(new URL(location, currentUrl).toString());
          if (nextUrl.origin !== currentUrl.origin || nextUrl.origin !== initialUrl.origin) throw new Error('Library redirects must remain on the exact HTTPS origin.');
          if (!isLibraryUriWithin(nextUrl.href, redirectRoot)) throw new Error('Library redirects must remain under the authorized HTTPS path.');
          currentUrl = nextUrl;
          continue;
        }
        if (response.url) {
          const finalUrl = parseSafeHttpsUrl(response.url);
          if (finalUrl.origin !== currentUrl.origin || finalUrl.origin !== initialUrl.origin) throw new Error('Library response final origin does not match the requested HTTPS origin.');
          if (!isSameLibraryUri(finalUrl.href, currentUrl.href)) throw new Error('Library response final URL does not match the requested HTTPS URL.');
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
export async function requirePublicLibraryNetworkUri(uri: string, resolveAddresses: LibraryHostAddressResolver): Promise<void> {
  const url = parseSafeHttpsUrl(uri);
  await requirePublicNetworkTarget(url, resolveAddresses);
}

async function requirePublicNetworkTarget(url: URL, resolveAddresses: LibraryHostAddressResolver | undefined): Promise<void> {
  if (!resolveAddresses || isIpAddress(url.hostname)) return;
  let addresses: readonly string[];
  try { addresses = await resolveAddresses(url.hostname); }
  catch { throw new Error('Library network target could not be resolved safely.'); }
  if (addresses.length === 0 || addresses.some((address) => !isIpAddress(address) || isPrivateNetworkHost(address))) {
    throw new Error('Library network requests to private or local network targets are not allowed.');
  }
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
  readonly isTrustedUri?: (providerId: string, uri: string) => Promise<boolean>;
  readonly authorizeOperation?: (request: LibraryHostOperationAuthorization) => Promise<boolean>;
  readonly authorizeCredentialBinding?: (request: LibraryCredentialBindingAuthorization) => Promise<boolean>;
  readonly readJsonResource: (uri: string) => Promise<unknown>;
  readonly httpTransport: HttpTransport;
  readonly resolvePublisherStore: (providerId: string) => Promise<LibraryPublisherStore | undefined>;
}

export interface LibraryHostOperationAuthorization {
  readonly operation: LibraryOperation | 'readResource';
  readonly providerId?: string;
  readonly uri?: string;
}

export interface LibraryCredentialBindingIdentity {
  readonly providerId: string;
  readonly origin: string;
  readonly scheme: string;
}

export interface LibraryCredentialBindingAuthorization {
  readonly credentialId: string;
  readonly source: LibraryCredentialBindingIdentity;
  readonly target: LibraryCredentialBindingIdentity;
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
  readonly documentUri: string;
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

export interface LibraryHostResource {
  readonly uri: string;
  readonly document: unknown;
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
    await this.requireOperation({ operation: 'listProviders' });
    return Promise.all(this.effectiveConfigs().map(async (config) => {
      const location = providerLocation(config);
      const trusted = await this.isProviderRootAuthorized(config);
      const binding = credentialBinding(config);
      const credentialConfigured = trusted && binding
        ? Boolean(await this.options.secretStore.getSecret(binding.secretRef))
        : false;
      const publishSupported = trusted && providerSupportsPublishing(config) && Boolean(await this.options.resolvePublisherStore(config.id));
      return { id: config.id, kind: config.kind, location, trusted, credentialConfigured, publishSupported };
    }));
  }

  async configureProvider(config: SerializableLibraryProviderConfig, credentialSecret?: string): Promise<LibraryProviderSummary> {
    return this.serializeMutation(() => this.configureProviderCore(config, credentialSecret));
  }

  private async configureProviderCore(config: SerializableLibraryProviderConfig, credentialSecret?: string): Promise<LibraryProviderSummary> {
    const validated = validateConfig(config);
    await this.requireOperation({ operation: 'configureProvider', providerId: validated.id });
    if (this.requiredById.has(validated.id)) throw new Error(`Required bundled provider '${validated.id}' cannot be replaced.`);
    await this.requireProviderConfigAuthorization(validated);
    const previous = this.persistedConfigs.find((candidate) => candidate.id === validated.id);
    await this.requireImmutablePublisherLocation(previous, validated);
    const previousBinding = credentialBinding(previous);
    const nextBinding = credentialBinding(validated);
    const reusedBinding = nextBinding && this.persistedConfigs
      .map(credentialBinding)
      .find((binding) => binding?.credentialId === nextBinding.credentialId && binding.secretRef !== nextBinding.secretRef);
    const sourceBinding = previousBinding && nextBinding && previousBinding.credentialId === nextBinding.credentialId && previousBinding.secretRef !== nextBinding.secretRef
      ? previousBinding
      : reusedBinding;
    let previousTargetSecret: string | undefined;
    let copiedAuthorizedSecret = false;
    if (sourceBinding && nextBinding && credentialSecret === undefined) {
      const authorized = await this.options.authorizeCredentialBinding?.({
        credentialId: nextBinding.credentialId,
        source: credentialBindingIdentity(sourceBinding),
        target: credentialBindingIdentity(nextBinding),
      }) ?? false;
      if (!authorized) throw new Error(`Credential handle '${nextBinding.credentialId}' requires a fresh secret or native authorization for this provider, origin, and scheme.`);
      const sourceSecret = await this.options.secretStore.getSecret(sourceBinding.secretRef);
      if (!sourceSecret) throw new Error(`Credential handle '${nextBinding.credentialId}' has no secret available for native reauthorization.`);
      previousTargetSecret = await this.options.secretStore.getSecret(nextBinding.secretRef);
      await this.options.secretStore.setSecret(nextBinding.secretRef, sourceSecret);
      copiedAuthorizedSecret = true;
    }
    if (credentialSecret !== undefined) {
      if (!nextBinding) throw new Error('A credential secret requires an xRegistry credentialId.');
      if (!credentialSecret.trim()) throw new Error('Credential secret must not be empty.');
      previousTargetSecret = await this.options.secretStore.getSecret(nextBinding.secretRef);
      await this.options.secretStore.setSecret(nextBinding.secretRef, credentialSecret);
    }
    const next = [...this.persistedConfigs.filter((candidate) => candidate.id !== validated.id), validated]
      .sort((left, right) => left.id.localeCompare(right.id));
    try {
      const facade = await this.buildFacade(next);
      await this.options.providerConfigStore.write(next);
      this.persistedConfigs = next;
      this.facade = facade;
      if (previousBinding && previousBinding.secretRef !== nextBinding?.secretRef) {
        await this.options.secretStore.deleteSecret(previousBinding.secretRef);
      }
    } catch (error) {
      if ((credentialSecret !== undefined || copiedAuthorizedSecret) && nextBinding) {
        if (previousTargetSecret === undefined) await this.options.secretStore.deleteSecret(nextBinding.secretRef);
        else await this.options.secretStore.setSecret(nextBinding.secretRef, previousTargetSecret);
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
    await this.requireOperation({ operation: 'removeProvider', providerId: id });
    if (this.requiredById.has(id)) throw new Error(`Required bundled provider '${id}' cannot be removed.`);
    const existing = this.persistedConfigs.find((config) => config.id === id);
    if (!existing) throw new Error(`Library provider '${id}' is not configured.`);
    await this.requireProviderAuthorization(existing);
    const next = this.persistedConfigs.filter((config) => config.id !== id);
    const facade = await this.buildFacade(next);
    await this.options.providerConfigStore.write(next);
    this.persistedConfigs = next;
    this.facade = facade;
    const binding = credentialBinding(existing);
    if (binding) await this.options.secretStore.deleteSecret(binding.secretRef);
  }

  async listCatalog(): Promise<readonly LibraryCatalogEntry[]> {
    await this.requireOperation({ operation: 'listCatalog' });
    const activeProviderIds = new Set(this.facade.service.listProviders().map((provider) => provider.providerId));
    for (const config of this.effectiveConfigs()) {
      if (activeProviderIds.has(config.id) && config.kind !== 'xregistry') await this.requireProviderConfigAuthorization(config);
    }
    const listings = await this.facade.service.listCatalog();
    return listings.flatMap((listing) => listing.entries.map((entry) => ({ providerId: listing.provider.providerId, ...entry })));
  }

  async resolve(request: LibraryHostResolveRequest): Promise<LibraryHostResolution> {
    validateId(request.providerId);
    validateText(request.entryId, 'Library entry id');
    await this.requireOperation({ operation: 'resolve', providerId: request.providerId });
    const config = this.effectiveConfigs().find((candidate) => candidate.id === request.providerId);
    if (!config) throw new Error(`Library provider '${request.providerId}' is not configured.`);
    await this.requireProviderAuthorization(config);
    const resolved = await this.facade.service.resolve(request);
    return {
      document: cloneJson(resolved.resolved.document.value),
      documentUri: resolved.resolved.document.uri,
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
    await this.requireOperation({ operation: 'publish', providerId });
    const document = validatePublishDocument(request.document, request.sourceUri);
    const config = this.effectiveConfigs().find((candidate) => candidate.id === providerId);
    if (!config || !providerSupportsPublishing(config)) throw new Error(`Library provider '${providerId}' does not support publishing.`);
    await this.requireProviderConfigAuthorization(config);
    const documentUri = publishedLibraryDocumentUri(providerLocation(config), providerId, request.entryId, request.version);
    await this.authorizeProviderUri(config, documentUri);
    const publisher = await this.options.resolvePublisherStore(providerId);
    if (!publisher) throw new Error(`Library provider '${providerId}' does not support publishing.`);
    const store = immutablePublisherStore(config, publisher);
    const listing = (await this.facade.service.listCatalog()).find((candidate) => candidate.provider.providerId === providerId);
    if (listing?.entries.find((entry) => entry.id === request.entryId)?.versions.some((version) => version.version === request.version)) {
      throw new Error(`Library version '${request.entryId}@${request.version}' already exists.`);
    }
    const plan = this.facade.service.buildPublishPlan({
      ...request,
      document,
      documentUri,
    });
    return this.facade.service.publish({ store, plan });
  }

  async readResource(uri: string): Promise<LibraryHostResource | undefined> {
    const requestedUri = canonicalLibraryUri(validateText(uri, 'Library resource URI'));
    await this.requireOperation({ operation: 'readResource', uri: requestedUri });
    const candidateConfigs = this.effectiveConfigs().filter((config) => providerMayOwnUri(config, requestedUri));
    for (const config of candidateConfigs) await this.authorizeProviderUri(config, requestedUri);
    const cached = candidateConfigs.length > 0 ? await this.facade.cache.findByUri(requestedUri) : undefined;
    if (cached) {
      const config = this.effectiveConfigs().find((candidate) => candidate.id === cached.providerId);
      if (!config || !candidateConfigs.some((candidate) => candidate.id === config.id) || !evaluateLibraryTrust(cached.providerId, cached.document, await this.trustPolicy(config)).trusted) {
        throw new Error(`Library resource '${requestedUri}' is not trusted.`);
      }
      return { uri: requestedUri, document: cloneJson(cached.document.value) };
    }

    for (const config of candidateConfigs) {
      if (config.kind !== 'xregistry') {
        for (const entry of config.entries) {
          const version = entry.versions.find((candidate) => isSameLibraryUri(candidate.documentUri, requestedUri));
          if (version) return this.resolveTrustedResource(config.id, entry.id, version.version, requestedUri);
        }
      }
      if (!providerSupportsPublishing(config)) continue;
      await this.requireProviderAuthorization(config);
      const publisher = await this.options.resolvePublisherStore(config.id);
      if (!publisher) continue;
      const store = immutablePublisherStore(config, publisher);
      for (const entry of await store.list()) {
        const published = Object.values(entry.versions).find((document) => document.uri === requestedUri);
        if (published) return this.resolveTrustedResource(config.id, entry.id, published.version, requestedUri);
      }
    }
    return undefined;
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
        ...(this.options.isTrustedUri ? { isTrustedUri: this.options.isTrustedUri } : {}),
      },
      credentials: allConfigs.flatMap((config) => {
        const binding = credentialBinding(config);
        return binding ? [{ credentialId: binding.secretRef, scheme: binding.scheme, secretRef: binding.secretRef }] : [];
      }),
    });
    for (const config of allConfigs) {
      if (!await this.isProviderAuthorized(config)) {
        if (this.requiredById.has(config.id)) throw new Error(`Required library provider '${config.id}' is not authorized by the host.`);
        continue;
      }
      try { await this.authorizeProviderUri(config, providerLocation(config)); }
      catch (error) { if (this.requiredById.has(config.id)) throw error; else continue; }
      const trustPolicy = await this.trustPolicy(config);
      if (config.kind === 'xregistry') {
        try {
          const binding = credentialBinding(config);
          await attachDiscoveredXRegistryProvider({
            facade,
            id: config.id,
            baseUrl: config.baseUrl,
            transport: this.options.httpTransport,
            ...(binding ? { credentialId: binding.secretRef } : {}),
            ...(config.reference ? { reference: config.reference } : {}),
            trustPolicy,
            metadata: { kind: config.kind, location: config.baseUrl },
            authorizeProvider: () => this.requireProviderAuthorization(config),
            authorizeUri: (uri) => this.authorizeProviderUri(config, uri),
          });
        } catch {
          throw new Error(`xRegistry provider '${config.id}' could not be initialized.`);
        }
      } else {
        const provider = config.kind === 'static'
          ? new StaticDocumentLibraryProvider(config.id, config.entries, async (_entryId, _version, uri) => this.options.readJsonResource(uri))
          : new LocalDocumentLibraryProvider(config.id, config.entries, this.options.readJsonResource);
        const resolvedPublisher = providerSupportsPublishing(config) ? await this.options.resolvePublisherStore(config.id) : undefined;
        const publisher = resolvedPublisher ? immutablePublisherStore(config, resolvedPublisher) : undefined;
        facade.service.addProvider({
          provider: publisher ? new PublishedOverlayLibraryProvider(provider, publisher) : provider,
          trustPolicy,
          metadata: { kind: config.kind, location: config.location },
          authorizeProvider: () => this.requireProviderAuthorization(config),
          authorizeUri: (uri) => this.authorizeProviderUri(config, uri),
        });
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
      trustedUriPrefixes: trustedOrigin ? [providerUriPrefix(location)] : [],
    };
  }

  private async authorizeProviderUri(config: SerializableLibraryProviderConfig, uri: string): Promise<void> {
    const canonicalUri = canonicalLibraryUri(uri);
    await this.requireProviderAuthorization(config);
    if (this.options.isTrustedUri && !await this.options.isTrustedUri(config.id, canonicalUri)) {
      throw new Error(`Library URI '${canonicalUri}' is not authorized by the host.`);
    }
    const policy = await this.trustPolicy(config);
    const decision = evaluateLibraryTrust(config.id, { entryId: '', version: '', uri: canonicalUri, value: null }, policy);
    if (!decision.trusted) throw new Error(decision.reasons.join(' ') || `Library URI '${canonicalUri}' is not trusted.`);
  }

  private async requireProviderAuthorization(config: SerializableLibraryProviderConfig): Promise<void> {
    if (!await this.isProviderAuthorized(config)) {
      throw new Error(`Library provider '${config.id}' is not authorized by the host.`);
    }
  }

  private async requireProviderConfigAuthorization(config: SerializableLibraryProviderConfig): Promise<void> {
    await this.requireProviderAuthorization(config);
    await this.authorizeProviderUri(config, providerLocation(config));
    if (config.kind !== 'xregistry') {
      for (const entry of config.entries) for (const version of entry.versions) await this.authorizeProviderUri(config, version.documentUri);
    }
  }

  private async requireImmutablePublisherLocation(
    previous: SerializableLibraryProviderConfig | undefined,
    next: SerializableLibraryProviderConfig,
  ): Promise<void> {
    if (!previous || !providerSupportsPublishing(previous) || providerSupportsPublishing(next) && sameProviderLocation(previous, next)) return;
    await this.requireProviderConfigAuthorization(previous);
    const publisher = await this.options.resolvePublisherStore(previous.id);
    if (!publisher) return;
    if ((await immutablePublisherStore(previous, publisher).list()).length > 0) {
      throw new Error(`Library provider '${previous.id}' cannot change location after publishing immutable versions.`);
    }
  }

  private async isProviderAuthorized(config: SerializableLibraryProviderConfig): Promise<boolean> {
    const location = providerLocation(config);
    return isConfiguredTrusted(config) && await this.options.isTrustedProvider(config.id) && await this.options.isTrustedOrigin(originOf(location));
  }

  private async isProviderRootAuthorized(config: SerializableLibraryProviderConfig): Promise<boolean> {
    try {
      await this.requireProviderAuthorization(config);
      await this.authorizeProviderUri(config, providerLocation(config));
      return true;
    } catch {
      return false;
    }
  }

  private async requireOperation(request: LibraryHostOperationAuthorization): Promise<void> {
    if (this.options.authorizeOperation && !await this.options.authorizeOperation(request)) {
      throw new Error(`Library operation '${request.operation}' is not authorized by the host.`);
    }
  }

  private async resolveTrustedResource(
    providerId: string,
    entryId: string,
    version: string,
    requestedUri: string,
  ): Promise<LibraryHostResource> {
    const config = this.effectiveConfigs().find((candidate) => candidate.id === providerId);
    const policy = config && await this.trustPolicy(config);
    if (!policy || !evaluateLibraryTrust(providerId, { entryId, version, uri: requestedUri, value: null }, policy).trusted) {
      throw new Error(`Library resource '${requestedUri}' is not trusted.`);
    }
    const resolved = await this.facade.service.resolve({
      providerId,
      entryId,
      selector: { kind: 'pinned', version },
      offline: false,
    });
    const trusted = evaluateLibraryTrust(providerId, resolved.resolved.document, policy).trusted;
    if (!isSameLibraryUri(resolved.resolved.document.uri, requestedUri) || !trusted) {
      throw new Error(`Library resource '${requestedUri}' is not trusted.`);
    }
    return { uri: requestedUri, document: cloneJson(resolved.resolved.document.value) };
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
      group: validateXRegistrySegment(config.reference.group, 'xRegistry group'),
      resource: validateXRegistrySegment(config.reference.resource, 'xRegistry resource'),
    };
    if (config.trusted !== true) throw new Error('xRegistry providers require explicit trusted: true configuration.');
    if (credentialScheme && !['Bearer', 'Basic', 'API-Key'].includes(credentialScheme)) throw new Error('Credential scheme must be Bearer, Basic, or API-Key.');
    return { id, kind: 'xregistry', baseUrl, ...(credentialId ? { credentialId } : {}), ...(credentialScheme ? { credentialScheme } : {}), ...(reference ? { reference } : {}), trusted: true };
  }
  if (!['bundled', 'static', 'local'].includes(config.kind)) throw new Error('Unsupported library provider kind.');
  const location = validateText(config.location, 'Library provider location');
  if (!Array.isArray(config.entries)) throw new Error('Library provider entries must be an array.');
  if (config.kind === 'static' && /^https:/i.test(location) && config.trusted !== true) throw new Error('Remote static providers require explicit trusted: true configuration.');
  const entries = config.entries.map((entry) => {
    const normalized = normalizeLibraryEntry(entry);
    return {
      id: normalized.id,
      ...(entry.name === undefined ? {} : { name: normalized.name }),
      ...(normalized.description === undefined ? {} : { description: normalized.description }),
      versions: normalized.versions.map((version) => ({ ...version })),
    };
  });
  return { id, kind: config.kind, location, entries, ...(config.trusted === true ? { trusted: true } : {}) };
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

function validateXRegistrySegment(value: string, field: string): string {
  const segment = validateText(value, field);
  if (segment === '.' || segment === '..') throw new Error(`${field} must not be a relative path segment.`);
  return segment;
}

function providerLocation(config: SerializableLibraryProviderConfig): string {
  return config.kind === 'xregistry' ? config.baseUrl : config.location;
}

interface BoundCredential extends LibraryCredentialBindingIdentity {
  readonly credentialId: string;
  readonly secretRef: string;
}

function credentialBinding(config: SerializableLibraryProviderConfig | undefined): BoundCredential | undefined {
  if (!config || config.kind !== 'xregistry' || !config.credentialId) return undefined;
  const scheme = config.credentialScheme ?? 'Bearer';
  const origin = canonicalLibraryOrigin(config.baseUrl);
  return {
    credentialId: config.credentialId,
    providerId: config.id,
    origin,
    scheme,
    secretRef: ['library-credential', 'v1', config.credentialId, config.id, origin, scheme].map(encodeURIComponent).join(':'),
  };
}

function credentialBindingIdentity(binding: BoundCredential): LibraryCredentialBindingIdentity {
  return { providerId: binding.providerId, origin: binding.origin, scheme: binding.scheme };
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
  if (isPrivateNetworkHost(url.hostname)) throw new Error('Library network requests to private or local network targets are not allowed.');
  return url;
}

function isPrivateNetworkHost(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return true;
  const ipv4 = hostname.split('.').map(Number);
  if (ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [first, second] = ipv4 as [number, number, number, number];
    return first === 0 || first === 10 || first === 127 || first >= 224 ||
      first === 100 && second >= 64 && second <= 127 ||
      first === 169 && second === 254 ||
      first === 172 && second >= 16 && second <= 31 ||
      first === 192 && second === 168 ||
      first === 198 && (second === 18 || second === 19);
  }
  if (!hostname.includes(':')) return false;
  if (hostname === '::' || hostname === '::1') return true;
  const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/i.exec(hostname);
  if (mapped) {
    const high = Number.parseInt(mapped[1]!, 16);
    const low = Number.parseInt(mapped[2]!, 16);
    return isPrivateNetworkHost(`${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`);
  }
  const firstGroup = Number.parseInt(hostname.split(':')[0] || '0', 16);
  return firstGroup >= 0xfc00 && firstGroup <= 0xfdff || firstGroup >= 0xfe80 && firstGroup <= 0xfeff || firstGroup >= 0xff00 ||
    /^::ffff:(?:0*:)*?(?:10\.|127\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname);
}

function isIpAddress(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const ipv4 = hostname.split('.').map(Number);
  if (ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) return true;
  return hostname.includes(':') && /^[a-f0-9:.]+$/i.test(hostname);
}

function isRedirectStatus(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

function redirectRootUrl(url: URL): string {
  const root = new URL(url.href);
  root.search = '';
  root.hash = '';
  if (!root.pathname.endsWith('/')) root.pathname = root.pathname.slice(0, root.pathname.lastIndexOf('/') + 1);
  return root.href;
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

function providerSupportsPublishing(config: SerializableLibraryProviderConfig): boolean {
  return config.kind === 'local' || config.kind === 'static';
}

function providerUriPrefix(location: string): string {
  return location.endsWith('/') ? location : `${location}/`;
}

function sameProviderLocation(left: SerializableLibraryProviderConfig, right: SerializableLibraryProviderConfig): boolean {
  const leftLocation = providerLocation(left);
  const rightLocation = providerLocation(right);
  return isSameLibraryUri(leftLocation, rightLocation) || leftLocation.replace(/\/+$/, '') === rightLocation.replace(/\/+$/, '');
}

function providerMayOwnUri(config: SerializableLibraryProviderConfig, uri: string): boolean {
  return isLibraryUriWithin(uri, providerUriPrefix(providerLocation(config))) ||
    config.kind !== 'xregistry' && config.entries.some((entry) => entry.versions.some((version) => isSameLibraryUri(version.documentUri, uri)));
}

function immutablePublisherStore(config: SerializableLibraryProviderConfig, store: LibraryPublisherStore): LibraryPublisherStore {
  const validateEntry = (entry: PublishedLibraryEntry): PublishedLibraryEntry => {
    if (!entry || typeof entry.id !== 'string' || typeof entry.epoch !== 'string' || !entry.versions || typeof entry.versions !== 'object') {
      throw new Error(`Published library state for provider '${config.id}' is invalid.`);
    }
    for (const [version, document] of Object.entries(entry.versions)) {
      const expectedUri = publishedLibraryDocumentUri(providerLocation(config), config.id, entry.id, version);
      if (!document || document.entryId !== entry.id || document.version !== version || !isSameLibraryUri(document.uri, expectedUri)) {
        throw new Error(`Published library URI for '${entry.id}@${version}' is not immutable.`);
      }
    }
    return entry;
  };
  return {
    async read(entryId) {
      const entry = await store.read(entryId);
      if (entry && entry.id !== entryId) throw new Error(`Published library identity for '${entryId}' is invalid.`);
      return entry && validateEntry(entry);
    },
    async list() {
      const entries = await store.list();
      const ids = new Set<string>();
      for (const entry of entries) {
        validateEntry(entry);
        if (ids.has(entry.id)) throw new Error(`Published library entry '${entry.id}' is duplicated.`);
        ids.add(entry.id);
      }
      return entries;
    },
    async write(entry, expectedEpoch) {
      return store.write(validateEntry(entry), expectedEpoch);
    },
  };
}

function cloneJson(value: unknown): unknown {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Library resources must be representable as JSON.');
  return JSON.parse(serialized) as unknown;
}

function validatePublishDocument(value: unknown, sourceUri: string): unknown {
  let text: string | undefined;
  try { text = typeof value === 'string' ? value : JSON.stringify(value); }
  catch { throw new Error('Published library document must be representable as JSON.'); }
  if (text === undefined) throw new Error('Published library document must be representable as JSON.');
  const session = new DocumentSession(validateText(sourceUri, 'Library source URI'), text);
  const snapshot = session.snapshot();
  const errorKeys = new Set(snapshot.diagnostics
    .filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => `${diagnostic.code}|${diagnostic.location?.pointer ?? ''}`));
  for (const diagnostic of snapshot.model?.projections.diagnostics ?? []) {
    if (diagnostic.severity === 'error') errorKeys.add(`${diagnostic.code}|${diagnostic.pointer ?? ''}`);
  }
  if (!snapshot.model || snapshot.recovery !== 'valid' || errorKeys.size > 0) {
    throw new Error(`Published library document is not a valid JSON Structure document (${errorKeys.size} error${errorKeys.size === 1 ? '' : 's'}).`);
  }
  return session.value;
}