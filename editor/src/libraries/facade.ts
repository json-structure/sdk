import { DurableLibraryCache, JsonLibraryCachePersistence, type PersistentLibraryCache } from './cache.js';
import { LibraryService, type LibraryProviderBinding } from './service.js';
import { PolicyTrustAdapter, SecretStorageCredentialAdapter, type CredentialSecretStore, type CredentialStoreEntry, type TrustedProviderStore } from './adapters.js';
import { discoverXRegistryProvider, type DiscoverXRegistryOptions, type HttpTransport, type XRegistryDiscoveredProvider, type XRegistryProviderReference } from './providers.js';

export interface LibraryCacheStore {
  read(): Promise<string | undefined>;
  write(content: string): Promise<void>;
}

export interface LibraryServiceFacadeOptions {
  readonly cacheStore: LibraryCacheStore;
  readonly secretStore: CredentialSecretStore;
  readonly trustStore: TrustedProviderStore;
  readonly credentials: readonly CredentialStoreEntry[];
  readonly providers?: readonly LibraryProviderBinding[];
}

export interface LibraryServiceFacade {
  readonly cache: PersistentLibraryCache;
  readonly service: LibraryService;
  readonly credentials: SecretStorageCredentialAdapter;
  readonly trust: PolicyTrustAdapter;
}

export function createLibraryServiceFacade(options: LibraryServiceFacadeOptions): LibraryServiceFacade {
  const cache = new DurableLibraryCache(new JsonLibraryCachePersistence(
    async () => options.cacheStore.read(),
    async (content) => options.cacheStore.write(content),
  ));
  const credentials = new SecretStorageCredentialAdapter(options.credentials, options.secretStore);
  const trust = new PolicyTrustAdapter(options.trustStore);
  const service = new LibraryService({
    cache,
    providers: options.providers,
  });
  return { cache, service, credentials, trust };
}

export interface AttachDiscoveredXRegistryRequest {
  readonly facade: LibraryServiceFacade;
  readonly id: string;
  readonly baseUrl: string;
  readonly transport: HttpTransport;
  readonly credentialId?: string;
  readonly reference?: XRegistryProviderReference;
  readonly trustPolicy?: LibraryProviderBinding['trustPolicy'];
  readonly metadata?: LibraryProviderBinding['metadata'];
  readonly authorizeProvider?: LibraryProviderBinding['authorizeProvider'];
  readonly authorizeUri?: LibraryProviderBinding['authorizeUri'];
}

export async function attachDiscoveredXRegistryProvider(request: AttachDiscoveredXRegistryRequest): Promise<XRegistryDiscoveredProvider> {
  const discovered = await discoverXRegistryProvider({
    id: request.id,
    baseUrl: request.baseUrl,
    transport: request.transport,
    ...(request.credentialId
      ? {
          credentialId: request.credentialId,
          lookupCredential: async (credentialId) => request.facade.credentials.get(credentialId),
        }
      : {}),
    trust: request.facade.trust,
    reference: request.reference,
  } satisfies DiscoverXRegistryOptions);
  request.facade.service.addProvider({
    provider: discovered.provider,
    ...(request.trustPolicy ? { trustPolicy: request.trustPolicy } : {}),
    ...(request.metadata ? { metadata: request.metadata } : {}),
    ...(request.authorizeProvider ? { authorizeProvider: request.authorizeProvider } : {}),
    ...(request.authorizeUri ? { authorizeUri: request.authorizeUri } : {}),
  });
  return discovered;
}