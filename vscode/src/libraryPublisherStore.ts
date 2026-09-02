export interface PublishedLibraryEntry {
    readonly id: string;
    readonly epoch: string;
    readonly defaultVersion?: string;
    readonly versions: Readonly<Record<string, { readonly entryId: string; readonly version: string; readonly uri: string; readonly value: unknown; readonly provenance?: { readonly sourceUri: string }; readonly integrity?: string; readonly epoch?: string }>>;
}

export interface LibraryPublisherStore {
    read(entryId: string): Promise<PublishedLibraryEntry | undefined>;
    list(): Promise<readonly PublishedLibraryEntry[]>;
    write(entry: PublishedLibraryEntry, expectedEpoch: string | undefined): Promise<boolean>;
}

export type PublisherState = Record<string, Record<string, PublishedLibraryEntry>>;

export interface PublisherStateAdapter {
    read(): PublisherState;
    write(state: PublisherState): PromiseLike<void>;
}

export function createPublisherStore(adapter: PublisherStateAdapter, providerId: string, queues: Map<string, Promise<void>>): LibraryPublisherStore {
    return {
        async read(entryId: string) { return adapter.read()[providerId]?.[entryId]; },
        async list() { return Object.values(adapter.read()[providerId] ?? {}).sort((left, right) => left.id.localeCompare(right.id)); },
        async write(entry: PublishedLibraryEntry, expectedEpoch: string | undefined) {
            return serializePublisherWrite(queues, async () => {
                const state = adapter.read();
                if (state[providerId]?.[entry.id]?.epoch !== expectedEpoch) return false;
                await adapter.write({ ...state, [providerId]: { ...state[providerId], [entry.id]: entry } });
                return true;
            });
        }
    };
}

const publisherStateQueueKey = 'publisher-state';

function serializePublisherWrite<T>(queues: Map<string, Promise<void>>, operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(publisherStateQueueKey) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const settled = result.then(() => undefined, () => undefined);
    queues.set(publisherStateQueueKey, settled);
    void settled.finally(() => { if (queues.get(publisherStateQueueKey) === settled) queues.delete(publisherStateQueueKey); });
    return result;
}
