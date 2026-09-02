import * as assert from 'assert';
import { createPublisherStore, type PublishedLibraryEntry, type PublisherState } from '../../libraryPublisherStore';

suite('Library publisher store', () => {
    test('serializes concurrent writes across providers sharing one persisted state', async () => {
        let state: PublisherState = {};
        let signalFirstWriteStarted!: () => void;
        let releaseFirstWrite!: () => void;
        const firstWriteStarted = new Promise<void>((resolve) => { signalFirstWriteStarted = resolve; });
        const firstWriteRelease = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
        let writes = 0;
        const adapter = {
            read: () => state,
            write: async (next: PublisherState) => {
                if (++writes === 1) {
                    signalFirstWriteStarted();
                    await firstWriteRelease;
                }
                state = next;
            }
        };
        const queues = new Map<string, Promise<void>>();
        const first = createPublisherStore(adapter, 'local-a', queues);
        const second = createPublisherStore(adapter, 'local-b', queues);
        const entry = (id: string): PublishedLibraryEntry => ({ id, epoch: '1', versions: { '1': { entryId: id, version: '1', uri: `memory:${id}`, value: {} } } });

        const firstWrite = first.write(entry('first'), undefined);
        await firstWriteStarted;
        const secondWrite = second.write(entry('second'), undefined);
        assert.strictEqual(queues.size, 1);
        releaseFirstWrite();

        assert.deepStrictEqual(await Promise.all([firstWrite, secondWrite]), [true, true]);
        assert.deepStrictEqual(Object.keys(state).sort(), ['local-a', 'local-b']);
    });
});