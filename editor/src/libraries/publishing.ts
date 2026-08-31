import type { LibraryDocument } from './contracts.js';

export interface PublishedLibraryEntry {
  readonly id: string;
  readonly epoch: string;
  readonly defaultVersion?: string;
  readonly versions: Readonly<Record<string, LibraryDocument>>;
}

export interface LibraryPublisherStore {
  read(entryId: string): Promise<PublishedLibraryEntry | undefined>;
  write(entry: PublishedLibraryEntry, expectedEpoch: string | undefined): Promise<boolean>;
}

export interface PublishLibraryVersionRequest {
  readonly entryId: string;
  readonly version: string;
  readonly document: LibraryDocument;
  readonly expectedEpoch?: string;
  readonly promoteDefault?: boolean;
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
    versions: { ...current?.versions, [request.version]: request.document },
  };
  if (!await store.write(updated, request.expectedEpoch)) throw new EpochConflictError(request.entryId);
  return updated;
}

export class MemoryLibraryPublisherStore implements LibraryPublisherStore {
  private readonly entries = new Map<string, PublishedLibraryEntry>();

  async read(entryId: string): Promise<PublishedLibraryEntry | undefined> {
    return this.entries.get(entryId);
  }

  async write(entry: PublishedLibraryEntry, expectedEpoch: string | undefined): Promise<boolean> {
    if (this.entries.get(entry.id)?.epoch !== expectedEpoch) return false;
    this.entries.set(entry.id, entry);
    return true;
  }
}

function incrementEpoch(epoch: string | undefined): string {
  if (epoch === undefined) return '1';
  const numeric = Number(epoch);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? String(numeric + 1) : `${epoch}.1`;
}