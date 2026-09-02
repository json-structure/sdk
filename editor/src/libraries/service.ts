import { resolveCachedLibrary, type PersistentLibraryCache, type ResolvedLibraryDocument } from './cache.js';
import type {
  LibraryDocument,
  LibraryEntry,
  LibraryProvider,
  LibraryVersion,
  LibraryVersionSelector,
} from './contracts.js';
import {
  planLibraryCopy,
  planLibraryImport,
  planLibraryMaterialization,
  planLibraryPublish,
  type CopyPlan,
  type ImportPlan,
  type LibraryProvenance,
  type MaterializePlan,
  type PublishPlan,
} from './planning.js';
import { publishLibraryVersion, type LibraryPublisherStore, type PublishedLibraryEntry } from './publishing.js';
import { evaluateLibraryTrust, type LibraryTrustDecision, type LibraryTrustPolicy } from './trust.js';

export type LibraryPlan = ImportPlan | CopyPlan | MaterializePlan | PublishPlan;

export interface LibraryProviderBinding {
  readonly provider: LibraryProvider;
  readonly trustPolicy?: LibraryTrustPolicy;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly authorizeProvider?: () => Promise<void>;
  readonly authorizeUri?: (uri: string) => Promise<void>;
}

export interface LibraryProviderState {
  readonly providerId: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface LibraryListing {
  readonly provider: LibraryProviderState;
  readonly entries: readonly LibraryEntry[];
}

export interface ResolvedLibraryWithTrust {
  readonly providerId: string;
  readonly entry: LibraryEntry;
  readonly version: LibraryVersion;
  readonly resolved: ResolvedLibraryDocument;
  readonly trust: LibraryTrustDecision;
  readonly provenance: LibraryProvenance;
}

export interface LibraryResolutionRequest {
  readonly providerId: string;
  readonly entryId: string;
  readonly selector: LibraryVersionSelector;
  readonly offline: boolean;
}

export interface LibraryServiceOptions {
  readonly cache: PersistentLibraryCache;
  readonly providers?: readonly LibraryProviderBinding[];
}

export interface BuildImportPlanRequest {
  readonly resolution: ResolvedLibraryWithTrust;
  readonly source: string;
  readonly destinationPointer: string;
  readonly keyword?: '$import' | '$importdefs';
}

export interface BuildCopyPlanRequest {
  readonly resolution: ResolvedLibraryWithTrust;
  readonly targetDocument: unknown;
  readonly sourcePointers: readonly string[];
  readonly destinationBase: string;
}

export interface BuildMaterializePlanRequest {
  readonly resolution: ResolvedLibraryWithTrust;
  readonly targetDocument: unknown;
  readonly sourcePointers: readonly string[];
  readonly destinationBase: string;
  readonly importPointer: string;
}

export interface BuildPublishPlanRequest {
  readonly providerId: string;
  readonly entryId: string;
  readonly version: string;
  readonly document: unknown;
  readonly expectedEpoch?: string;
  readonly promoteDefault?: boolean;
  readonly sourceUri: string;
  readonly documentUri?: string;
}

export interface PublishExecutionRequest {
  readonly store: LibraryPublisherStore;
  readonly plan: PublishPlan;
}

export class LibraryService {
  private readonly providers = new Map<string, LibraryProviderBinding>();

  constructor(private readonly options: LibraryServiceOptions) {
    for (const binding of options.providers ?? []) this.addProvider(binding);
  }

  addProvider(binding: LibraryProviderBinding): void {
    this.providers.set(binding.provider.id, {
      provider: binding.provider,
      ...(binding.trustPolicy ? { trustPolicy: binding.trustPolicy } : {}),
      metadata: binding.metadata ?? {},
      ...(binding.authorizeProvider ? { authorizeProvider: binding.authorizeProvider } : {}),
      ...(binding.authorizeUri ? { authorizeUri: binding.authorizeUri } : {}),
    });
  }

  removeProvider(providerId: string): void {
    this.providers.delete(providerId);
  }

  listProviders(): readonly LibraryProviderState[] {
    return [...this.providers.values()]
      .map((binding) => ({ providerId: binding.provider.id, metadata: binding.metadata ?? {} }))
      .sort((left, right) => left.providerId.localeCompare(right.providerId));
  }

  async listCatalog(): Promise<readonly LibraryListing[]> {
    const listings = await Promise.all([...this.providers.values()].map(async (binding) => {
      await binding.authorizeProvider?.();
      const entries = await binding.provider.listEntries();
      if (binding.authorizeUri) {
        for (const entry of entries) for (const version of entry.versions) await binding.authorizeUri(version.documentUri);
      }
      return {
        provider: {
          providerId: binding.provider.id,
          metadata: binding.metadata ?? {},
        },
        entries,
      };
    }));
    return listings.sort((left, right) => left.provider.providerId.localeCompare(right.provider.providerId));
  }

  async resolve(request: LibraryResolutionRequest): Promise<ResolvedLibraryWithTrust> {
    const binding = this.requireProvider(request.providerId);
    await binding.authorizeProvider?.();
    const entries = await binding.provider.listEntries();
    const entry = entries.find((candidate) => candidate.id === request.entryId);
    if (!entry) throw new Error(`Library entry '${request.entryId}' was not found in provider '${request.providerId}'.`);
    const version = selectVersion(entry, request.selector);
    const versionUris = new Map(entry.versions.map((candidate) => [candidate.version, candidate.documentUri]));
    const trustPolicy = binding.trustPolicy ?? {};
    const resolved = await resolveCachedLibrary({
      provider: binding.provider,
      cache: this.options.cache,
      entryId: request.entryId,
      selector: request.selector,
      offline: request.offline,
      versionUris,
      ...(binding.authorizeUri ? { authorizeDocument: binding.authorizeUri } : {}),
      validateDocument: async (document) => {
        const decision = evaluateLibraryTrust(binding.provider.id, document, trustPolicy);
        if (!decision.trusted) throw new Error(decision.reasons.join(' ') || `Library provider '${binding.provider.id}' returned an untrusted document.`);
      },
    });
    const provenance: LibraryProvenance = {
      providerId: binding.provider.id,
      entryId: entry.id,
      version: version.version,
      sourceUri: resolved.document.provenance?.sourceUri ?? resolved.document.uri,
    };
    const trust = evaluateLibraryTrust(binding.provider.id, resolved.document, trustPolicy);
    return { providerId: binding.provider.id, entry, version, resolved, trust, provenance };
  }

  buildImportPlan(request: BuildImportPlanRequest): ImportPlan {
    return planLibraryImport(request.resolution.resolved.document.uri, request.destinationPointer, request.resolution.provenance, request.keyword ?? '$importdefs');
  }

  buildCopyPlan(request: BuildCopyPlanRequest): CopyPlan {
    return planLibraryCopy(
      request.resolution.resolved.document.value,
      request.targetDocument,
      request.sourcePointers,
      request.destinationBase,
      request.resolution.provenance,
    );
  }

  buildMaterializePlan(request: BuildMaterializePlanRequest): MaterializePlan {
    return planLibraryMaterialization(
      request.resolution.resolved.document.value,
      request.targetDocument,
      request.sourcePointers,
      request.destinationBase,
      request.importPointer,
      request.resolution.provenance,
      request.resolution.resolved.document.uri,
    );
  }

  buildPublishPlan(request: BuildPublishPlanRequest): PublishPlan {
    this.requireProvider(request.providerId);
    return planLibraryPublish(
      request.entryId,
      request.version,
      request.document,
      {
        providerId: request.providerId,
        entryId: request.entryId,
        version: request.version,
        sourceUri: request.sourceUri,
      },
      request.expectedEpoch,
      request.promoteDefault ?? false,
      request.documentUri,
    );
  }

  async publish(request: PublishExecutionRequest): Promise<PublishedLibraryEntry> {
    return publishLibraryVersion(request.store, {
      entryId: request.plan.entryId,
      version: request.plan.version,
      document: toLibraryDocument(request.plan),
      ...(request.plan.expectedEpoch ? { expectedEpoch: request.plan.expectedEpoch } : {}),
      promoteDefault: request.plan.promoteDefault,
    });
  }

  private requireProvider(providerId: string): LibraryProviderBinding {
    const binding = this.providers.get(providerId);
    if (!binding) throw new Error(`Library provider '${providerId}' is not configured.`);
    return binding;
  }
}

function selectVersion(entry: LibraryEntry, selector: LibraryVersionSelector): LibraryVersion {
  const selected = selector.kind === 'pinned'
    ? entry.versions.find((version) => version.version === selector.version)
    : entry.versions.find((version) => version.isDefault) ?? entry.versions.at(-1);
  if (!selected) throw new Error(`Library version was not found for '${entry.id}'.`);
  return selected;
}

function toLibraryDocument(plan: PublishPlan): LibraryDocument {
  return {
    entryId: plan.entryId,
    version: plan.version,
    uri: plan.documentUri,
    value: plan.document,
    provenance: { sourceUri: plan.provenance.sourceUri },
    ...(plan.expectedEpoch ? { epoch: plan.expectedEpoch } : {}),
  };
}
