export interface PublishedLibraryEntry {
    readonly id: string;
    readonly epoch: string;
    readonly defaultVersion?: string;
    readonly versions: Readonly<Record<string, { readonly entryId: string; readonly version: string; readonly uri: string; readonly value: unknown; readonly integrity?: string; readonly epoch?: string }>>;
}

export interface LibraryPublisherStore {
    read(entryId: string): Promise<PublishedLibraryEntry | undefined>;
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
        async write(entry: PublishedLibraryEntry, expectedEpoch: string | undefined) {
            return serializeProviderWrite(queues, providerId, async () => {
                const state = adapter.read();
                if (state[providerId]?.[entry.id]?.epoch !== expectedEpoch) return false;
                await adapter.write({ ...state, [providerId]: { ...state[providerId], [entry.id]: entry } });
                return true;
            });
        }
    };
}

function serializeProviderWrite<T>(queues: Map<string, Promise<void>>, providerId: string, operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(providerId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const settled = result.then(() => undefined, () => undefined);
    queues.set(providerId, settled);
    void settled.finally(() => { if (queues.get(providerId) === settled) queues.delete(providerId); });
    return result;
}
