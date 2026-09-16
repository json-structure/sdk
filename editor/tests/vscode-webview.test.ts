import { describe, expect, it, vi } from 'vitest';
import { createVsCodeWebviewClient, type WebviewMessage } from '../src/ui/vscode-webview.js';
import type { ApplyTextEditsRequest } from '../src/contracts.js';

const request: ApplyTextEditsRequest = { protocolVersion: 1, requestId: 'edit-1', documentVersion: 1, edits: [{ range: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 }, startOffset: 1, endOffset: 2 }, newText: 'X' }] };

function fixture() {
  const messages: WebviewMessage[] = [];
  const windowTarget = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const documentTarget = { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const client = createVsCodeWebviewClient({ vscode: { postMessage: (message) => messages.push(message) }, window: windowTarget, document: documentTarget, requestTimeoutMs: 50, sourceReplaceDelayMs: 300 });
  client.receive({ type: 'init', protocolVersion: 1, uri: 'file:///test.struct.json', title: 'Test', text: 'abc', documentVersion: 1 });
  return { client, messages, windowTarget, documentTarget };
}

describe('VS Code webview client', () => {
  it('opens the mounted editor command palette on a host request', () => {
    const showCommandPalette = vi.fn();
    const client = createVsCodeWebviewClient({
      vscode: { postMessage: vi.fn() },
      window: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
      document: { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() },
      mount: () => ({ setText: vi.fn(), setTitle: vi.fn(), setUri: vi.fn(), getText: () => 'abc', showCommandPalette, dispose: vi.fn() })
    });
    client.receive({ type: 'init', protocolVersion: 1, uri: 'file:///test.struct.json', title: 'Test', text: 'abc', documentVersion: 1 });
    client.receive({ type: 'showCommands', protocolVersion: 1 });
    expect(showCommandPalette).toHaveBeenCalledOnce();
  });

  it('updates its snapshot from successful edits before resolving applyTextEdits', async () => {
    const { client } = fixture();
    const applied = client.host.applyTextEdits(request);
    client.receive({ type: 'applyResult', protocolVersion: 1, requestId: request.requestId, result: { protocolVersion: 1, requestId: request.requestId, documentVersion: 2, applied: true, diagnostics: [] } });
    await expect(applied).resolves.toMatchObject({ applied: true });
    await expect(client.host.readDocument()).resolves.toMatchObject({ text: 'aXc', documentVersion: 2 });
  });

  it('serializes apply requests and advances the second request to the acknowledged version', async () => {
    const { client, messages } = fixture();
    const first = client.host.applyTextEdits(request);
    const secondRequest: ApplyTextEditsRequest = { ...request, requestId: 'edit-2', documentVersion: 2, edits: [{ ...request.edits[0]!, range: { ...request.edits[0]!.range, startOffset: 2, endOffset: 3 }, newText: 'Y' }] };
    const second = client.host.applyTextEdits(secondRequest);

    await Promise.resolve();
    expect(messages.filter((message) => message.type === 'applyTextEdits')).toHaveLength(1);
    client.receive({ type: 'applyResult', protocolVersion: 1, requestId: request.requestId, result: { protocolVersion: 1, requestId: request.requestId, documentVersion: 2, applied: true, diagnostics: [] } });
    await first;
    await Promise.resolve();
    expect(messages.filter((message) => message.type === 'applyTextEdits')).toHaveLength(2);
    client.receive({ type: 'applyResult', protocolVersion: 1, requestId: secondRequest.requestId, result: { protocolVersion: 1, requestId: secondRequest.requestId, documentVersion: 3, applied: true, diagnostics: [] } });
    await second;
    await expect(client.host.readDocument()).resolves.toMatchObject({ text: 'aXY', documentVersion: 3 });
  });

  it('round-trips resource reads through the VS Code host protocol', async () => {
    const { client, messages } = fixture();
    const reading = client.host.readResource!('file:///workspace/types.json');
    const resourceRequest = messages.at(-1);
    expect(resourceRequest).toMatchObject({ type: 'readResource', uri: 'file:///workspace/types.json' });
    const requestId = resourceRequest && 'requestId' in resourceRequest ? resourceRequest.requestId : '';
    client.receive({ type: 'resourceResult', protocolVersion: 1, requestId, result: { protocolVersion: 1, requestId, uri: 'file:///workspace/types.json', content: '{}', contentHash: '' } });
    await expect(reading).resolves.toMatchObject({ content: '{}' });
  });

  it('round-trips generic library requests through one VS Code service type', async () => {
    const { client, messages } = fixture();
    const reading = client.host.libraryRequest!<readonly { id: string }[]>('listProviders');
    const libraryRequest = messages.at(-1);
    expect(libraryRequest).toMatchObject({ type: 'libraryRequest', request: { operation: 'listProviders' } });
    const requestId = libraryRequest && 'requestId' in libraryRequest ? libraryRequest.requestId : '';
    client.receive({ type: 'serviceResult', protocolVersion: 1, requestId, result: [{ id: 'financial-types' }] });
    await expect(reading).resolves.toEqual([{ id: 'financial-types' }]);
  });

  it('does not time out an interactive conversion while the host dialog is open', async () => {
    vi.useFakeTimers();
    const { client, messages } = fixture();
    const options = { rootName: 'Invoice', preserveUnknownKeywords: true };
    const converting = client.host.convert!({ protocolVersion: 1, requestId: 'convert-1', kind: 'conversion', documentVersion: 1, commandId: 'export.test', sourceName: 'test.struct.json', sourceText: '{}', options });
    const service = messages.at(-1);
    expect(service).toMatchObject({ type: 'convert', request: { options } });
    const requestId = service && 'requestId' in service ? service.requestId : '';
    await vi.advanceTimersByTimeAsync(500);
    client.receive({ type: 'serviceResult', protocolVersion: 1, requestId, result: { protocolVersion: 1, requestId: 'convert-1', documentVersion: 1, succeeded: false, outputs: [], diagnostics: [] } });
    await expect(converting).resolves.toMatchObject({ requestId: 'convert-1' });
    vi.useRealTimers();
  });

  it('round-trips interactive conversion source selection without a generic timeout', async () => {
    vi.useFakeTimers();
    const { client, messages } = fixture();
    const selecting = client.host.selectConversionSource!({ protocolVersion: 1, requestId: 'source-dialog', kind: 'select-conversion-source', formats: ['avro'] });
    const service = messages.at(-1);
    const requestId = service && 'requestId' in service ? service.requestId : '';
    await vi.advanceTimersByTimeAsync(500);
    client.receive({ type: 'serviceResult', protocolVersion: 1, requestId, result: { uri: 'file:///order.avsc', name: 'order.avsc', text: '{}' } });
    await expect(selecting).resolves.toEqual({ uri: 'file:///order.avsc', name: 'order.avsc', text: '{}' });
    vi.useRealTimers();
  });

  it('times out resource reads that receive no host response', async () => {
    vi.useFakeTimers();
    const { client } = fixture();
    const reading = client.host.readResource!('file:///workspace/missing.json');
    const expectation = expect(reading).rejects.toThrow('Timed out waiting for resource result');
    await vi.advanceTimersByTimeAsync(50);
    await expectation;
    vi.useRealTimers();
  });

  it('does not reset Design history when a local edit echo precedes applyResult', async () => {
    const setText = vi.fn();
    const acknowledgeText = vi.fn();
    const client = createVsCodeWebviewClient({
      vscode: { postMessage: vi.fn() },
      window: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
      document: { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() },
      mount: () => ({ setText, acknowledgeText, setTitle: vi.fn(), setUri: vi.fn(), getText: () => 'aXc', showCommandPalette: vi.fn(), dispose: vi.fn() })
    });
    client.receive({ type: 'init', protocolVersion: 1, uri: 'file:///test.struct.json', title: 'Test', text: 'abc', documentVersion: 1 });
    const applied = client.host.applyTextEdits(request);
    client.receive({ type: 'documentChanged', protocolVersion: 1, text: 'aXc', documentVersion: 2 });
    expect(setText).not.toHaveBeenCalled();
    expect(acknowledgeText).toHaveBeenCalledWith('aXc', 2);
    client.receive({ type: 'applyResult', protocolVersion: 1, requestId: request.requestId, result: { protocolVersion: 1, requestId: request.requestId, documentVersion: 2, applied: true, diagnostics: [] } });
    await expect(applied).resolves.toMatchObject({ applied: true });
  });
  it('does not replay an edit after the host document change already includes it', async () => {
    const { client } = fixture();
    const applied = client.host.applyTextEdits(request);
    client.receive({ type: 'documentChanged', protocolVersion: 1, text: 'aXc', documentVersion: 2 });
    client.receive({ type: 'applyResult', protocolVersion: 1, requestId: request.requestId, result: { protocolVersion: 1, requestId: request.requestId, documentVersion: 2, applied: true, diagnostics: [] } });
    await applied;
    await expect(client.host.readDocument()).resolves.toMatchObject({ text: 'aXc', documentVersion: 2 });
  });

  it('rejects pending apply requests on timeout and disposal', async () => {
    vi.useFakeTimers();
    const { client } = fixture();
    const timedOut = client.host.applyTextEdits(request);
    const timedOutExpectation = expect(timedOut).rejects.toThrow('Timed out waiting for apply result');
    await vi.advanceTimersByTimeAsync(50);
    await timedOutExpectation;
    const disposed = client.host.applyTextEdits({ ...request, requestId: 'edit-2' });
    const disposedExpectation = expect(disposed).rejects.toThrow('disposed');
    client.dispose();
    await disposedExpectation;
    vi.useRealTimers();
  });

  it('coalesces source changes into an acknowledged minimal edit', async () => {
    vi.useFakeTimers();
    const { client, messages } = fixture();
    client.replaceDocument('first');
    client.replaceDocument('latest');
    await vi.advanceTimersByTimeAsync(300);
    expect(messages).toEqual([{ type: 'applyTextEdits', protocolVersion: 1, request: { protocolVersion: 1, requestId: 'source-1', documentVersion: 1, edits: [{ range: { start: { line: 0, column: 0 }, end: { line: 0, column: 3 }, startOffset: 0, endOffset: 3 }, newText: 'latest' }] } }]);
    vi.useRealTimers();
  });

  it('rebases text entered while a source edit awaits its acknowledgement', async () => {
    vi.useFakeTimers();
    const { client, messages } = fixture();
    client.replaceDocument('first');
    await vi.advanceTimersByTimeAsync(300);
    client.replaceDocument('latest');

    client.receive({ type: 'applyResult', protocolVersion: 1, requestId: 'source-1', result: { protocolVersion: 1, requestId: 'source-1', documentVersion: 2, applied: true, diagnostics: [] } });
    await Promise.resolve();
    expect(messages[1]).toEqual({ type: 'applyTextEdits', protocolVersion: 1, request: { protocolVersion: 1, requestId: 'source-2', documentVersion: 2, edits: [{ range: { start: { line: 0, column: 0 }, end: { line: 0, column: 3 }, startOffset: 0, endOffset: 3 }, newText: 'late' }] } });
    client.receive({ type: 'applyResult', protocolVersion: 1, requestId: 'source-2', result: { protocolVersion: 1, requestId: 'source-2', documentVersion: 3, applied: true, diagnostics: [] } });
    await expect(client.host.readDocument()).resolves.toMatchObject({ text: 'latest', documentVersion: 3 });
    vi.useRealTimers();
  });

  it('preserves and rebases late text when the document update precedes the acknowledgement', async () => {
    vi.useFakeTimers();
    const { client, messages } = fixture();
    client.replaceDocument('first');
    await vi.advanceTimersByTimeAsync(300);
    client.replaceDocument('latest');

    client.receive({ type: 'documentChanged', protocolVersion: 1, text: 'first', documentVersion: 2 });
    client.receive({ type: 'applyResult', protocolVersion: 1, requestId: 'source-1', result: { protocolVersion: 1, requestId: 'source-1', documentVersion: 2, applied: true, diagnostics: [] } });
    await Promise.resolve();
    expect(messages[1]).toEqual({ type: 'applyTextEdits', protocolVersion: 1, request: { protocolVersion: 1, requestId: 'source-2', documentVersion: 2, edits: [{ range: { start: { line: 0, column: 0 }, end: { line: 0, column: 3 }, startOffset: 0, endOffset: 3 }, newText: 'late' }] } });
    client.receive({ type: 'documentChanged', protocolVersion: 1, text: 'latest', documentVersion: 3 });
    client.receive({ type: 'applyResult', protocolVersion: 1, requestId: 'source-2', result: { protocolVersion: 1, requestId: 'source-2', documentVersion: 3, applied: true, diagnostics: [] } });
    await expect(client.host.readDocument()).resolves.toMatchObject({ text: 'latest', documentVersion: 3 });
    vi.useRealTimers();
  });

  it('waits for a newer document after a stale rejection before rebasing late text', async () => {
    vi.useFakeTimers();
    const { client, messages } = fixture();
    client.replaceDocument('first');
    await vi.advanceTimersByTimeAsync(300);
    client.replaceDocument('latest');

    client.receive({ type: 'applyResult', protocolVersion: 1, requestId: 'source-1', result: { protocolVersion: 1, requestId: 'source-1', documentVersion: 2, applied: false, diagnostics: [] } });
    await Promise.resolve();
    await client.host.readDocument();
    expect(messages).toHaveLength(1);
    client.receive({ type: 'documentChanged', protocolVersion: 1, text: 'external', documentVersion: 2 });
    await Promise.resolve();
    expect(messages[1]).toEqual({ type: 'applyTextEdits', protocolVersion: 1, request: { protocolVersion: 1, requestId: 'source-2', documentVersion: 2, edits: [{ range: { start: { line: 0, column: 0 }, end: { line: 0, column: 8 }, startOffset: 0, endOffset: 8 }, newText: 'latest' }] } });
    client.receive({ type: 'applyResult', protocolVersion: 1, requestId: 'source-2', result: { protocolVersion: 1, requestId: 'source-2', documentVersion: 3, applied: true, diagnostics: [] } });
    await expect(client.host.readDocument()).resolves.toMatchObject({ text: 'latest', documentVersion: 3 });
    vi.useRealTimers();
  });

  it('restores authoritative text and version when a source replacement is rejected', async () => {
    vi.useFakeTimers();
    const setText = vi.fn();
    const messages: WebviewMessage[] = [];
    const client = createVsCodeWebviewClient({
      vscode: { postMessage: (message) => messages.push(message) },
      window: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
      document: { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() },
      mount: () => ({ setText, setTitle: vi.fn(), setUri: vi.fn(), getText: () => 'abc', showCommandPalette: vi.fn(), dispose: vi.fn() }),
      requestTimeoutMs: 50,
      sourceReplaceDelayMs: 300
    });
    client.receive({ type: 'init', protocolVersion: 1, uri: 'file:///test.struct.json', title: 'Test', text: 'abc', documentVersion: 7 });
    client.replaceDocument('invalid');
    await vi.advanceTimersByTimeAsync(300);
    const requestId = messages[0]?.type === 'applyTextEdits' ? messages[0].request.requestId : '';
    client.receive({ type: 'applyResult', protocolVersion: 1, requestId, result: { protocolVersion: 1, requestId, documentVersion: 7, applied: false, diagnostics: [] } });
    await vi.runAllTimersAsync();
    expect(setText).toHaveBeenCalledWith('abc', 7);
    vi.useRealTimers();
  });

  it('flushes a queued source replacement before returning the host snapshot', async () => {
    vi.useFakeTimers();
    const { client, messages } = fixture();
    client.replaceDocument('latest');
    const reading = client.host.readDocument();
    await vi.advanceTimersByTimeAsync(0);
    const requestId = messages[0]?.type === 'applyTextEdits' ? messages[0].request.requestId : '';
    client.receive({ type: 'applyResult', protocolVersion: 1, requestId, result: { protocolVersion: 1, requestId, documentVersion: 2, applied: true, diagnostics: [] } });
    await expect(reading).resolves.toMatchObject({ text: 'latest', documentVersion: 2 });
    vi.useRealTimers();
  });

  it('drops queued source text when authoritative host text arrives', async () => {
    vi.useFakeTimers();
    const { client, messages } = fixture();
    client.replaceDocument('stale');
    client.receive({ type: 'documentChanged', protocolVersion: 1, text: 'external', documentVersion: 2 });
    await vi.advanceTimersByTimeAsync(300);
    expect(messages).toEqual([]);
    vi.useRealTimers();
  });

  it('accepts rejected-document diagnostics and advances the authoritative version', async () => {
    const setText = vi.fn();
    const client = createVsCodeWebviewClient({
      vscode: { postMessage: vi.fn() },
      window: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
      document: { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() },
      mount: () => ({ setText, setTitle: vi.fn(), setUri: vi.fn(), getText: () => 'abc', showCommandPalette: vi.fn(), dispose: vi.fn() })
    });
    client.receive({ type: 'init', protocolVersion: 1, uri: 'file:///test.struct.json', title: 'Test', text: 'abc', documentVersion: 1 });
    client.receive({ type: 'documentRejected', protocolVersion: 1, documentVersion: 2, diagnostics: [{ code: 'vscode.document-limit', message: 'too large', severity: 'error' }] });
    await expect(client.host.readDocument()).resolves.toMatchObject({
      text: 'abc',
      documentVersion: 2,
      recovery: 'invalid',
      diagnostics: [{ code: 'vscode.document-limit', message: 'too large', severity: 'error' }]
    });
    expect(setText).toHaveBeenLastCalledWith('abc', 2);
  });

  it('flushes the latest source replacement when the webview becomes hidden', () => {
    const { client, messages, documentTarget } = fixture();
    client.replaceDocument('latest');
    documentTarget.visibilityState = 'hidden';
    const visibilityListener = documentTarget.addEventListener.mock.calls.find(([type]) => type === 'visibilitychange')?.[1] as (() => void);
    visibilityListener();
    expect(messages).toEqual([{ type: 'applyTextEdits', protocolVersion: 1, request: { protocolVersion: 1, requestId: 'source-1', documentVersion: 1, edits: [{ range: { start: { line: 0, column: 0 }, end: { line: 0, column: 3 }, startOffset: 0, endOffset: 3 }, newText: 'latest' }] } }]);
  });

  it('removes browser listeners when disposed', () => {
    const { client, windowTarget, documentTarget } = fixture();
    client.dispose();
    expect(windowTarget.removeEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    expect(documentTarget.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
  it('acknowledges owned Source/Design-undo echoes without clearing local navigation and redo history',async()=>{
    vi.useFakeTimers();
    const messages:WebviewMessage[]=[],setText=vi.fn(),acknowledgeText=vi.fn();let localText='abc';
    const client=createVsCodeWebviewClient({vscode:{postMessage:message=>messages.push(message)},window:{addEventListener:vi.fn(),removeEventListener:vi.fn()},document:{visibilityState:'visible',addEventListener:vi.fn(),removeEventListener:vi.fn()},sourceReplaceDelayMs:10,mount:()=>({getText:()=>localText,setText,setTitle:vi.fn(),setUri:vi.fn(),showCommandPalette:vi.fn(),dispose:vi.fn(),acknowledgeText})});
    client.receive({type:'init',protocolVersion:1,uri:'file:///owned.struct.json',title:'Owned',text:'abc',documentVersion:1});
    localText='latest';client.replaceDocument(localText);await vi.advanceTimersByTimeAsync(11);
    client.receive({type:'documentChanged',protocolVersion:1,text:'latest',documentVersion:2});
    expect(setText).not.toHaveBeenCalled();expect(acknowledgeText).toHaveBeenCalledWith('latest',2);
    client.receive({type:'applyResult',protocolVersion:1,requestId:'source-1',result:{protocolVersion:1,requestId:'source-1',documentVersion:2,applied:true,diagnostics:[]}});
    await Promise.resolve();client.dispose();vi.useRealTimers();
  });

  it('retains queued local edits across same-text save/file-watcher version echoes',async()=>{
    vi.useFakeTimers();const {client,messages}=fixture();client.replaceDocument('local undo');
    client.receive({type:'documentChanged',protocolVersion:1,text:'abc',documentVersion:2});
    await vi.advanceTimersByTimeAsync(300);
    expect(messages.at(-1)).toMatchObject({type:'applyTextEdits',request:{documentVersion:2,edits:[{newText:'local undo'}]}});
    client.receive({type:'applyResult',protocolVersion:1,requestId:'source-1',result:{protocolVersion:1,requestId:'source-1',documentVersion:3,applied:true,diagnostics:[]}});
    await Promise.resolve();client.dispose();vi.useRealTimers();
  });

});