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
      mount: () => ({ setText: vi.fn(), setTitle: vi.fn(), getText: () => 'abc', showCommandPalette, dispose: vi.fn() })
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

  it('times out resource reads that receive no host response', async () => {
    vi.useFakeTimers();
    const { client } = fixture();
    const reading = client.host.readResource!('file:///workspace/missing.json');
    const expectation = expect(reading).rejects.toThrow('Timed out waiting for resource result');
    await vi.advanceTimersByTimeAsync(50);
    await expectation;
    vi.useRealTimers();
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

  it('restores authoritative text and version when a source replacement is rejected', async () => {
    vi.useFakeTimers();
    const setText = vi.fn();
    const messages: WebviewMessage[] = [];
    const client = createVsCodeWebviewClient({
      vscode: { postMessage: (message) => messages.push(message) },
      window: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
      document: { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() },
      mount: () => ({ setText, setTitle: vi.fn(), getText: () => 'abc', showCommandPalette: vi.fn(), dispose: vi.fn() }),
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
});