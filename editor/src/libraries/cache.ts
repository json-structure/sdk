import { createHash } from 'node:crypto';
import { resolveLibraryVersion, type LibraryDocument, type LibraryProvider, type LibraryVersionSelector } from './contracts.js';

export interface LibraryCacheProof {
  readonly algorithm: 'sha256';
  readonly digest: string;
}

export interface LibraryCacheRecord {
  readonly providerId: string;
  readonly entryId: string;
  readonly version: string;
  readonly document: LibraryDocument;
  readonly storedAt: string;
  readonly proof?: LibraryCacheProof;
  readonly lastFloatingResolvedAt?: string;
}

export interface LibraryCachePersistence {
  readAll(): Promise<readonly LibraryCacheRecord[]>;
  writeAll(records: readonly LibraryCacheRecord[]): Promise<void>;
}

export interface PersistentLibraryCache {
  get(providerId: string, entryId: string, version: string): Promise<LibraryCacheRecord | undefined>;
  put(record: LibraryCacheRecord): Promise<void>;
  list(providerId: string, entryId: string): Promise<readonly LibraryCacheRecord[]>;
}

export interface LibraryCacheLimits {
  readonly maxEntries: number;
  readonly maxSerializedBytes: number;
}

const defaultCacheLimits: LibraryCacheLimits = { maxEntries: 256, maxSerializedBytes: 10 * 1024 * 1024 };

export class MemoryLibraryCache implements PersistentLibraryCache {
  private readonly records = new Map<string, LibraryCacheRecord>();

  constructor(private readonly limits: LibraryCacheLimits = defaultCacheLimits) {}

  async get(providerId: string, entryId: string, version: string): Promise<LibraryCacheRecord | undefined> {
    return this.records.get(cacheKey(providerId, entryId, version));
  }

  async put(record: LibraryCacheRecord): Promise<void> {
    this.records.set(cacheKey(record.providerId, record.entryId, record.version), record);
    enforceLimits(this.records, this.limits);
  }

  async list(providerId: string, entryId: string): Promise<readonly LibraryCacheRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.providerId === providerId && record.entryId === entryId)
      .sort((left, right) => left.version.localeCompare(right.version));
  }
}

export class DurableLibraryCache implements PersistentLibraryCache {
  private readonly records = new Map<string, LibraryCacheRecord>();
  private loaded = false;

  constructor(
    private readonly persistence: LibraryCachePersistence,
    private readonly limits: LibraryCacheLimits = defaultCacheLimits,
  ) {}

  async get(providerId: string, entryId: string, version: string): Promise<LibraryCacheRecord | undefined> {
    await this.ensureLoaded();
    return this.records.get(cacheKey(providerId, entryId, version));
  }

  async put(record: LibraryCacheRecord): Promise<void> {
    await this.ensureLoaded();
    this.records.set(cacheKey(record.providerId, record.entryId, record.version), record);
    enforceLimits(this.records, this.limits);
    await this.persistence.writeAll([...this.records.values()].sort(compareRecords));
  }

  async list(providerId: string, entryId: string): Promise<readonly LibraryCacheRecord[]> {
    await this.ensureLoaded();
    return [...this.records.values()]
      .filter((record) => record.providerId === providerId && record.entryId === entryId)
      .sort(compareRecords);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    for (const record of await this.persistence.readAll()) {
      this.records.set(cacheKey(record.providerId, record.entryId, record.version), record);
    }
    enforceLimits(this.records, this.limits);
    this.loaded = true;
  }
}

export class JsonLibraryCachePersistence implements LibraryCachePersistence {
  constructor(
    private readonly readText: () => Promise<string | undefined>,
    private readonly writeText: (content: string) => Promise<void>,
  ) {}

  async readAll(): Promise<readonly LibraryCacheRecord[]> {
    const text = await this.readText();
    if (!text || !text.trim()) return [];
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) throw new Error('Library cache persistence must be a JSON array.');
    return parsed.map(assertCacheRecord).sort(compareRecords);
  }

  async writeAll(records: readonly LibraryCacheRecord[]): Promise<void> {
    await this.writeText(JSON.stringify([...records].sort(compareRecords), null, 2));
  }
}

export type LibraryResolutionLabel = 'online-verified' | 'pinned-reproducible' | 'floating-offline-unverified';

export interface LibraryResolutionState {
  readonly selector: 'pinned' | 'floating';
  readonly connectivity: 'online' | 'offline';
  readonly verification: 'verified' | 'reproducible' | 'unverified';
}

export interface ResolvedLibraryDocument {
  readonly document: LibraryDocument;
  readonly source: 'provider' | 'cache';
  readonly label: LibraryResolutionLabel;
  readonly state: LibraryResolutionState;
}

export interface ResolveCachedLibraryOptions {
  readonly provider: LibraryProvider;
  readonly cache: PersistentLibraryCache;
  readonly entryId: string;
  readonly selector: LibraryVersionSelector;
  readonly offline: boolean;
  readonly now?: () => string;
}

export async function resolveCachedLibrary(options: ResolveCachedLibraryOptions): Promise<ResolvedLibraryDocument> {
  if (options.offline) return resolveOffline(options);
  const entries = await options.provider.listEntries();
  const entry = entries.find((candidate) => candidate.id === options.entryId);
  if (!entry) throw new Error(`Library entry '${options.entryId}' was not found.`);
  const version = resolveLibraryVersion(entry, options.selector);
  const document = await options.provider.readDocument(entry.id, version.version);
  const proof = createDocumentProof(document.value);
  validateDeclaredIntegrity(version.integrity, proof.digest, `${entry.id}@${version.version}`);
  validateDeclaredIntegrity(document.integrity, proof.digest, `${entry.id}@${version.version}`);
  const storedAt = options.now?.() ?? new Date().toISOString();
  const existing = await options.cache.get(options.provider.id, entry.id, version.version);
  const lastFloatingResolvedAt = options.selector.kind === 'floating' ? storedAt : existing?.lastFloatingResolvedAt;
  await options.cache.put({
    providerId: options.provider.id,
    entryId: entry.id,
    version: version.version,
    document,
    storedAt,
    proof,
    ...(lastFloatingResolvedAt ? { lastFloatingResolvedAt } : {}),
  });
  return {
    document,
    source: 'provider',
    label: 'online-verified',
    state: {
      selector: options.selector.kind,
      connectivity: 'online',
      verification: 'verified',
    },
  };
}

async function resolveOffline(options: ResolveCachedLibraryOptions): Promise<ResolvedLibraryDocument> {
  if (options.selector.kind === 'pinned') {
    const cached = await options.cache.get(options.provider.id, options.entryId, options.selector.version);
    if (!cached) throw new Error(`Pinned library version '${options.entryId}@${options.selector.version}' is not cached.`);
    assertReproducibleCacheRecord(cached);
    return {
      document: cached.document,
      source: 'cache',
      label: 'pinned-reproducible',
      state: {
        selector: 'pinned',
        connectivity: 'offline',
        verification: 'reproducible',
      },
    };
  }
  const records = await options.cache.list(options.provider.id, options.entryId);
  const cached = selectFloatingRecord(records);
  if (!cached) throw new Error(`No cached library version is available for '${options.entryId}'.`);
  assertUntamperedCacheRecord(cached);
  return {
    document: cached.document,
    source: 'cache',
    label: 'floating-offline-unverified',
    state: {
      selector: 'floating',
      connectivity: 'offline',
      verification: 'unverified',
    },
  };
}

function cacheKey(providerId: string, entryId: string, version: string): string {
  return `${providerId}\u0000${entryId}\u0000${version}`;
}

function compareRecords(left: LibraryCacheRecord, right: LibraryCacheRecord): number {
  return left.providerId.localeCompare(right.providerId)
    || left.entryId.localeCompare(right.entryId)
    || left.version.localeCompare(right.version);
}

function createDocumentProof(value: unknown): LibraryCacheProof {
  const canonical = JSON.stringify(canonicalJsonValue(value));
  if (canonical === undefined) throw new Error('Library document must be representable as JSON.');
  return {
    algorithm: 'sha256',
    digest: createHash('sha256').update(new TextEncoder().encode(canonical)).digest('hex'),
  };
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, canonicalJsonValue(child)]));
  }
  return value;
}

function validateDeclaredIntegrity(integrity: string | undefined, digest: string, identity: string): void {
  if (!integrity) return;
  const normalized = integrity.trim();
  const hex = /^(?:sha256:)?([a-f0-9]{64})$/i.exec(normalized)?.[1]?.toLowerCase();
  const base64 = /^sha256-([A-Za-z0-9+/]+={0,2})$/.exec(normalized)?.[1];
  const matches = hex ? hex === digest : base64 ? Buffer.from(digest, 'hex').toString('base64') === base64 : false;
  if (!matches) throw new Error(`Library integrity check failed for '${identity}'.`);
}

function assertReproducibleCacheRecord(record: LibraryCacheRecord): void {
  if (!record.proof) throw new Error(`Cached library version '${record.entryId}@${record.version}' has no verification proof.`);
  assertUntamperedCacheRecord(record);
}

function assertUntamperedCacheRecord(record: LibraryCacheRecord): void {
  if (record.proof && createDocumentProof(record.document.value).digest !== record.proof.digest) {
    throw new Error(`Cached library integrity check failed for '${record.entryId}@${record.version}'.`);
  }
}

function selectFloatingRecord(records: readonly LibraryCacheRecord[]): LibraryCacheRecord | undefined {
  const floating = records.filter((record) => record.lastFloatingResolvedAt !== undefined);
  return [...(floating.length > 0 ? floating : records)].sort((left, right) => {
    const leftTime = left.lastFloatingResolvedAt ?? left.storedAt;
    const rightTime = right.lastFloatingResolvedAt ?? right.storedAt;
    return leftTime.localeCompare(rightTime) || compareRecords(left, right);
  }).at(-1);
}

function enforceLimits(records: Map<string, LibraryCacheRecord>, limits: LibraryCacheLimits): void {
  while (records.size > limits.maxEntries || serializedBytes(records.values()) > limits.maxSerializedBytes) {
    const oldest = [...records.entries()].sort(([, left], [, right]) =>
      left.storedAt.localeCompare(right.storedAt) || compareRecords(left, right))[0];
    if (!oldest) return;
    records.delete(oldest[0]);
  }
}

function serializedBytes(records: Iterable<LibraryCacheRecord>): number {
  return new TextEncoder().encode(JSON.stringify([...records].sort(compareRecords))).byteLength;
}

function assertCacheRecord(value: unknown): LibraryCacheRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid library cache record shape.');
  const record = value as Record<string, unknown>;
  if (typeof record.providerId !== 'string' || typeof record.entryId !== 'string' || typeof record.version !== 'string') {
    throw new Error('Invalid library cache identity fields.');
  }
  if (typeof record.storedAt !== 'string' || typeof record.document !== 'object' || record.document === null || Array.isArray(record.document)) {
    throw new Error('Invalid library cache payload fields.');
  }
  const document = record.document as Record<string, unknown>;
  if (typeof document.entryId !== 'string' || typeof document.version !== 'string' || typeof document.uri !== 'string' || !('value' in document)) {
    throw new Error('Invalid cached library document shape.');
  }
  const normalized: LibraryDocument = {
    entryId: document.entryId,
    version: document.version,
    uri: document.uri,
    value: document.value,
    ...(typeof document.integrity === 'string' ? { integrity: document.integrity } : {}),
    ...(typeof document.epoch === 'string' ? { epoch: document.epoch } : {}),
  };
  return {
    providerId: record.providerId,
    entryId: record.entryId,
    version: record.version,
    document: normalized,
    storedAt: record.storedAt,
    ...(isCacheProof(record.proof) ? { proof: record.proof } : {}),
    ...(typeof record.lastFloatingResolvedAt === 'string' ? { lastFloatingResolvedAt: record.lastFloatingResolvedAt } : {}),
  };
}

function isCacheProof(value: unknown): value is LibraryCacheProof {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proof = value as Record<string, unknown>;
  return proof.algorithm === 'sha256' && typeof proof.digest === 'string' && /^[a-f0-9]{64}$/.test(proof.digest);
}