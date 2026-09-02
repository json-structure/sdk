import type { LibraryDocument } from './contracts.js';

export interface PublishedLibraryEntry {
  readonly id: string;
  readonly epoch: string;
  readonly defaultVersion?: string;
  readonly versions: Readonly<Record<string, LibraryDocument>>;
}

export interface LibraryPublisherStore {
  read(entryId: string): Promise<PublishedLibraryEntry | undefined>;
  list(): Promise<readonly PublishedLibraryEntry[]>;
  write(entry: PublishedLibraryEntry, expectedEpoch: string | undefined): Promise<boolean>;
}

export interface PublishLibraryVersionRequest {
  readonly entryId: string;
  readonly version: string;
  readonly document: LibraryDocument;
  readonly expectedEpoch?: string;
  readonly promoteDefault?: boolean;
}

export function publishedLibraryDocumentUri(providerLocation: string, providerId: string, entryId: string, version: string): string {
  const location = providerLocation.trim();
  if (!location) throw new Error('Library provider location must not be empty.');
  const prefix = location.endsWith('/') ? location : `${location}/`;
  return `${prefix}.published/provider-${encodeURIComponent(providerId)}/entry-${encodeURIComponent(entryId)}/version-${encodeURIComponent(version)}.json`;
}

export class EpochConflictError extends Error {
  constructor(entryId: string) {
    super(`Library entry '${entryId}' changed since it was read.`);
    this.name = 'EpochConflictError';
  }
}

export async function publishLibraryVersion(store: LibraryPublisherStore, request: PublishLibraryVersionRequest): Promise<PublishedLibraryEntry> {
  const current = await store.read(request.entryId);
  if (current?.epoch !== request.expectedEpoch || (!current && request.expectedEpoch !== undefined)) throw new EpochConflictError(request.entryId);
  if (current?.versions[request.version]) throw new Error(`Library version '${request.entryId}@${request.version}' already exists.`);
  const nextEpoch = incrementEpoch(current?.epoch);
  const updated: PublishedLibraryEntry = {
    id: request.entryId,
    epoch: nextEpoch,
    ...(request.promoteDefault ? { defaultVersion: request.version } : current?.defaultVersion ? { defaultVersion: current.defaultVersion } : {}),
    versions: { ...current?.versions, [request.version]: cloneLibraryDocument({ ...request.document, epoch: nextEpoch }) },
  };
  if (!await store.write(updated, request.expectedEpoch)) throw new EpochConflictError(request.entryId);
  return clonePublishedEntry(updated);
}

export class MemoryLibraryPublisherStore implements LibraryPublisherStore {
  private readonly entries = new Map<string, PublishedLibraryEntry>();

  async read(entryId: string): Promise<PublishedLibraryEntry | undefined> {
    const entry = this.entries.get(entryId);
    return entry && clonePublishedEntry(entry);
  }

  async list(): Promise<readonly PublishedLibraryEntry[]> {
    return [...this.entries.values()].sort((left, right) => left.id.localeCompare(right.id)).map(clonePublishedEntry);
  }

  async write(entry: PublishedLibraryEntry, expectedEpoch: string | undefined): Promise<boolean> {
    if (this.entries.get(entry.id)?.epoch !== expectedEpoch) return false;
    this.entries.set(entry.id, clonePublishedEntry(entry));
    return true;
  }
}

export function cloneLibraryDocument(document: LibraryDocument): LibraryDocument {
  return {
    ...document,
    value: cloneJson(document.value),
  };
}

export function clonePublishedEntry(entry: PublishedLibraryEntry): PublishedLibraryEntry {
  return {
    ...entry,
    versions: Object.fromEntries(Object.entries(entry.versions).map(([version, document]) => [version, cloneLibraryDocument(document)])),
  };
}

function incrementEpoch(epoch: string | undefined): string {
  if (epoch === undefined) return '1';
  const numeric = Number(epoch);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? String(numeric + 1) : `${epoch}.1`;
}

function cloneJson(value: unknown): unknown {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Published library documents must be representable as JSON.');
  return JSON.parse(serialized) as unknown;
}