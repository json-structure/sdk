import { mountJsonStructureEditor, type JsonStructureEditorHandle } from '../ui.js';
import { PROTOCOL_VERSION, type ApplyResult, type ApplyTextEditsRequest, type DocumentSnapshot, type EditorHost, type LibraryOperation, type ProgressEvent, type ResourceSnapshot } from '../contracts.js';

declare function acquireVsCodeApi(): VsCodeApi;

const sourceReplaceDelayMs = 300;
const requestTimeoutMs = 10_000;

interface InitMessage {
  readonly type: 'init';
  readonly protocolVersion: typeof protocolVersion;
  readonly uri: string;
  readonly title: string;
  readonly text: string;
  readonly documentVersion: number;
}

interface DocumentChangedMessage {
  readonly type: 'documentChanged';
  readonly protocolVersion: typeof protocolVersion;
  readonly text: string;
  readonly documentVersion: number;
}

interface DocumentRejectedMessage {
  readonly type: 'documentRejected';
  readonly protocolVersion: typeof protocolVersion;
  readonly documentVersion: number;
  readonly diagnostics: DocumentSnapshot['diagnostics'];
}

interface ApplyResultMessage {
  readonly type: 'applyResult';
  readonly protocolVersion: typeof protocolVersion;
  readonly requestId: string;
  readonly result: ApplyResult;
}

interface DocumentSavedMessage {
  readonly type: 'documentSaved';
  readonly protocolVersion: typeof protocolVersion;
  readonly documentVersion: number;
}

interface ShowCommandsMessage {
  readonly type: 'showCommands';
  readonly protocolVersion: typeof protocolVersion;
}
interface ResourceResultMessage {
  readonly type: 'resourceResult';
  readonly protocolVersion: typeof protocolVersion;
  readonly requestId: string;
  readonly result?: ResourceSnapshot;
  readonly error?: string;
}
interface ServiceResultMessage { readonly type: 'serviceResult'; readonly protocolVersion: typeof protocolVersion; readonly requestId: string; readonly result?: unknown; readonly error?: string }
interface ConversionProgressMessage extends ProgressEvent { readonly type: 'conversionProgress' }
export type HostMessage = InitMessage | DocumentChangedMessage | DocumentRejectedMessage | ApplyResultMessage | DocumentSavedMessage | ShowCommandsMessage | ResourceResultMessage | ServiceResultMessage | ConversionProgressMessage;
export type WebviewMessage = { readonly type: 'applyTextEdits'; readonly protocolVersion: typeof protocolVersion; readonly request: ApplyTextEditsRequest } |
  { readonly type: 'readResource'; readonly protocolVersion: typeof protocolVersion; readonly requestId: string; readonly uri: string } |
  { readonly type: 'listConversionCommands' | 'selectConversionSource' | 'convert' | 'cancelConversion' | 'openGeneratedOutput' | 'libraryRequest' | 'listLibraryEntries' | 'readLibraryDocument'; readonly protocolVersion: typeof protocolVersion; readonly requestId: string; readonly request?: unknown };

const protocolVersion = PROTOCOL_VERSION;

export interface VsCodeApi { postMessage(message: WebviewMessage): void; }
export interface WebviewEventTarget {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}
export interface WebviewDocument extends WebviewEventTarget { readonly visibilityState: string; }
export interface VsCodeWebviewClientOptions {
  readonly vscode: VsCodeApi;
  readonly window: WebviewEventTarget;
  readonly document: WebviewDocument;
  readonly mount?: (snapshot: InitMessage, host: EditorHost, onChange: (text: string) => void) => JsonStructureEditorHandle;
  readonly setTimeout?: typeof setTimeout;
  readonly clearTimeout?: typeof clearTimeout;
  readonly sourceReplaceDelayMs?: number;
  readonly requestTimeoutMs?: number;
}

interface PendingRequest { readonly request: ApplyTextEditsRequest; readonly resolve: (result: ApplyResult) => void; readonly reject: (error: Error) => void; readonly timeout: ReturnType<typeof setTimeout>; }
interface QueuedApply { readonly request: ApplyTextEditsRequest; readonly resolve: (result: ApplyResult) => void; readonly reject: (error: Error) => void; }
interface PendingReplacement { readonly text: string; }

export interface VsCodeWebviewClient { readonly host: EditorHost; receive(message: unknown): void; replaceDocument(text: string): void; dispose(): void; }

export function createVsCodeWebviewClient(options: VsCodeWebviewClientOptions): VsCodeWebviewClient {
  const schedule = options.setTimeout ?? setTimeout;
  const cancel = options.clearTimeout ?? clearTimeout;
  const replaceDelay = options.sourceReplaceDelayMs ?? sourceReplaceDelayMs;
  const timeoutDelay = options.requestTimeoutMs ?? requestTimeoutMs;
  const pending = new Map<string, PendingRequest>();
  const pendingResources = new Map<string, { readonly resolve: (result: ResourceSnapshot) => void; readonly reject: (error: Error) => void; readonly timeout: ReturnType<typeof setTimeout> }>();
  const pendingServices = new Map<string, { readonly resolve: (result: unknown) => void; readonly reject: (error: Error) => void; readonly timeout?: ReturnType<typeof setTimeout> }>();
  let editor: JsonStructureEditorHandle | undefined;
  let snapshot: DocumentSnapshot | undefined;
  let synchronizing = false;
  let replacement: PendingReplacement | undefined;
  let replaceTimer: ReturnType<typeof setTimeout> | undefined;
  let replacementFlush: Promise<void> | undefined;
  let replacementInFlight = false;
  let replacementAwaitingVersion: number | undefined;
  let sourceRequest = 0;
  const applyQueue: QueuedApply[] = [];
  let applyInFlight = false;
  let disposed = false;
  const progressListeners = new Set<(event: ProgressEvent) => void>();


  function rejectPending(message: string): void {
    for (const entry of pending.values()) {
      cancel(entry.timeout);
      entry.reject(new Error(message));
    }
    pending.clear();
    for (const entry of applyQueue.splice(0)) entry.reject(new Error(message));
    applyInFlight = false;
  }

  function startNextApply(): void {
    if (disposed || applyInFlight) return;
    const entry = applyQueue.shift();
    if (!entry) return;
    applyInFlight = true;
    const timeout = schedule(() => {
      pending.delete(entry.request.requestId);
      applyInFlight = false;
      entry.reject(new Error(`Timed out waiting for apply result: ${entry.request.requestId}`));
      startNextApply();
    }, timeoutDelay);
    pending.set(entry.request.requestId, { ...entry, timeout });
    options.vscode.postMessage({ type: 'applyTextEdits', protocolVersion, request: entry.request });
  }

  async function drainReplacement(): Promise<void> {
    while (!disposed && snapshot && replacement) {
      if (replacementAwaitingVersion !== undefined && snapshot.documentVersion < replacementAwaitingVersion) return;
      if (replacement.text === snapshot.text) { replacement = undefined; return; }
      const submitted = replacement;
      const baseSnapshot = snapshot;
      replacementInFlight = true;
      try {
        const result = await host.applyTextEdits({ protocolVersion, requestId: `source-${++sourceRequest}`, documentVersion: baseSnapshot.documentVersion, edits: [minimalReplacement(baseSnapshot.text, submitted.text)] });
        if (!result.applied) {
          if (result.documentVersion > snapshot.documentVersion) {
            replacementAwaitingVersion = result.documentVersion;
            return;
          }
          if (replacement === submitted && snapshot.documentVersion === baseSnapshot.documentVersion && snapshot.text === baseSnapshot.text) {
            replacement = undefined;
            editor?.setText(snapshot.text, snapshot.documentVersion);
            return;
          }
        }
      } catch {
        replacement = undefined;
        if (snapshot) editor?.setText(snapshot.text, snapshot.documentVersion);
        return;
      } finally {
        replacementInFlight = false;
      }
    }
  }

  function flushReplacement(): Promise<void> {
    if (replaceTimer !== undefined) { cancel(replaceTimer); replaceTimer = undefined; }
    if (replacementFlush) return replacementFlush;
    const running = drainReplacement().finally(() => {
      if (replacementFlush !== running) return;
      replacementFlush = undefined;
      if (!disposed && snapshot && replacement && replacementAwaitingVersion === undefined && replacement.text !== snapshot.text) void flushReplacement();
    });
    replacementFlush = running;
    return running;
  }

  function replaceDocument(text: string): void {
    if (disposed || synchronizing || !snapshot || text === snapshot.text && !replacementInFlight && !replacement) return;
    replacement = { text };
    if (replaceTimer !== undefined) cancel(replaceTimer);
    if (!replacementFlush) replaceTimer = schedule(() => { void flushReplacement(); }, replaceDelay);
  }

  const host: EditorHost = {
    kind: 'vscode',
    async readDocument() {
      await flushReplacement();
      if (!snapshot) throw new Error('The VS Code document has not been initialized.');
      return snapshot;
    },
    applyTextEdits(request) {
      if (disposed) return Promise.reject(new Error('The VS Code webview has been disposed.'));
      return new Promise<ApplyResult>((resolve, reject) => {
        applyQueue.push({ request, resolve, reject });
        startNextApply();
      });
    },
    readResource(uri) {
      if (disposed) return Promise.reject(new Error('The VS Code webview has been disposed.'));
      const requestId = `resource-${++sourceRequest}`;
      return new Promise<ResourceSnapshot>((resolve, reject) => {
        const timeout = schedule(() => {
          pendingResources.delete(requestId);
          reject(new Error(`Timed out waiting for resource result: ${requestId}`));
        }, timeoutDelay);
        pendingResources.set(requestId, { resolve, reject, timeout });
        options.vscode.postMessage({ type: 'readResource', protocolVersion, requestId, uri });
      });
    },
    listConversionCommands: () => requestService('listConversionCommands'),
    selectConversionSource: (request) => requestService('selectConversionSource', request),
    convert: (request) => requestService('convert', request),
    onConversionProgress(listener) { progressListeners.add(listener); return () => progressListeners.delete(listener); },
    cancelConversion: (requestId) => requestService('cancelConversion', { protocolVersion, requestId }),
    openGeneratedOutput: (request) => requestService('openGeneratedOutput', request),
    libraryRequest: <T>(operation: LibraryOperation, payload?: unknown) => requestService<T>('libraryRequest', { operation, payload }),
    listLibraryEntries: () => requestService('listLibraryEntries'),
    readLibraryDocument: (entryId, version) => requestService('readLibraryDocument', { entryId, version })
  };

  function requestService<T>(type: 'listConversionCommands' | 'selectConversionSource' | 'convert' | 'cancelConversion' | 'openGeneratedOutput' | 'libraryRequest' | 'listLibraryEntries' | 'readLibraryDocument', request?: unknown): Promise<T> {
    if (disposed) return Promise.reject(new Error('The VS Code webview has been disposed.'));
    const requestId = `service-${++sourceRequest}`;
    return new Promise<T>((resolve, reject) => {
      const timeout = type === 'convert' || type === 'selectConversionSource' ? undefined : schedule(() => { pendingServices.delete(requestId); reject(new Error(`Timed out waiting for service result: ${requestId}`)); }, timeoutDelay);
      pendingServices.set(requestId, { resolve: resolve as (result: unknown) => void, reject, ...(timeout === undefined ? {} : { timeout }) });
      options.vscode.postMessage({ type, protocolVersion, requestId, request });
    });
  }

  function receive(value: unknown): void {
    if (disposed || !isHostMessage(value)) return;
    if (value.type === 'showCommands') { editor?.showCommandPalette(); return; }
    if (value.type === 'documentSaved') return;
    if (value.type === 'conversionProgress') { for (const listener of progressListeners) listener(value); return; }
    if (value.type === 'resourceResult') {
      const entry = pendingResources.get(value.requestId);
      if (!entry) return;
      pendingResources.delete(value.requestId);
      cancel(entry.timeout);
      if (value.result) entry.resolve(value.result); else entry.reject(new Error(value.error ?? 'The resource is unavailable.'));
      return;
    }
    if (value.type === 'serviceResult') {
      const entry = pendingServices.get(value.requestId);
      if (!entry) return;
      pendingServices.delete(value.requestId);
      if (entry.timeout !== undefined) cancel(entry.timeout);
      if (value.error) entry.reject(new Error(value.error)); else entry.resolve(value.result);
      return;
    }
    if (value.type === 'applyResult') {
      const entry = pending.get(value.requestId);
      if (!entry) return;
      pending.delete(value.requestId);
      cancel(entry.timeout);
      if (value.result.applied && snapshot && snapshot.documentVersion < value.result.documentVersion) snapshot = { ...snapshot, text: applyEdits(snapshot.text, entry.request.edits), documentVersion: value.result.documentVersion };
      applyInFlight = false;
      entry.resolve(value.result);
      startNextApply();
      return;
    }
    if (value.type === 'documentRejected') {
      if (!snapshot || value.documentVersion < snapshot.documentVersion) return;
      if (replaceTimer !== undefined) { cancel(replaceTimer); replaceTimer = undefined; }
      replacement = undefined;
      replacementAwaitingVersion = undefined;
      snapshot = { ...snapshot, documentVersion: value.documentVersion, recovery: 'invalid', diagnostics: value.diagnostics };
      rejectPending('The VS Code document was rejected by the host.');
      synchronizing = true;
      editor?.setText(snapshot.text, snapshot.documentVersion);
      synchronizing = false;
      return;
    }
    const preserveReplacement = value.type === 'documentChanged' && (replacementInFlight || replacementAwaitingVersion !== undefined);
    if (replaceTimer !== undefined) { cancel(replaceTimer); replaceTimer = undefined; }
    if (!preserveReplacement || replacement?.text === value.text) replacement = undefined;
    const uri = value.type === 'init' ? value.uri : snapshot?.uri ?? '';
    snapshot = { uri, text: value.text, documentVersion: value.documentVersion, recovery: 'valid', diagnostics: [] };
    if (!replacement) replacementAwaitingVersion = undefined;
    else if (replacementAwaitingVersion !== undefined && value.documentVersion >= replacementAwaitingVersion) {
      replacementAwaitingVersion = undefined;
      void flushReplacement();
    }
    if (value.type === 'init') {
      rejectPending('The VS Code webview was reinitialized.');
      editor?.dispose();
      editor = options.mount?.(value, host, replaceDocument);
    } else if (!replacement) {
      synchronizing = true;
      editor?.setText(value.text, value.documentVersion);
      synchronizing = false;
    }
  }

  const onMessage = (event: Event) => receive((event as unknown as { data: unknown }).data);
  const onVisibilityChange = () => { if (options.document.visibilityState === 'hidden') void flushReplacement(); };
  options.window.addEventListener('message', onMessage);
  options.document.addEventListener('visibilitychange', onVisibilityChange);
  return { host, receive, replaceDocument, dispose() {
    if (disposed) return;
    disposed = true;
    if (replaceTimer !== undefined) cancel(replaceTimer);
    replacement = undefined;
    rejectPending('The VS Code webview was disposed.');
    for (const entry of pendingResources.values()) { cancel(entry.timeout); entry.reject(new Error('The VS Code webview was disposed.')); }
    pendingResources.clear();
    for (const entry of pendingServices.values()) { if (entry.timeout !== undefined) cancel(entry.timeout); entry.reject(new Error('The VS Code webview was disposed.')); }
    pendingServices.clear();
    progressListeners.clear();
    editor?.dispose();
    options.window.removeEventListener('message', onMessage);
    options.document.removeEventListener('visibilitychange', onVisibilityChange);
  } };
}

export function startVsCodeWebview(): VsCodeWebviewClient {
  const styleNonce = document.querySelector('meta[name="json-structure-style-nonce"]')?.getAttribute('content') ?? undefined;
  return createVsCodeWebviewClient({
    vscode: acquireVsCodeApi(), window, document,
    mount: (initial, host, onChange) => mountJsonStructureEditor(document.querySelector('#editor') as HTMLElement, {
      text: initial.text, uri: initial.uri, title: initial.title, documentVersion: initial.documentVersion, host, onChange, styleNonce
    })
  });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') startVsCodeWebview();

function isHostMessage(value: unknown): value is HostMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  if (message.protocolVersion !== protocolVersion || typeof message.type !== 'string') return false;
  if (message.type === 'showCommands') return true;
  if (message.type === 'conversionProgress') return typeof message.requestId === 'string' && Number.isInteger(message.documentVersion) && typeof message.phase === 'string' && (message.percent === undefined || typeof message.percent === 'number') && (message.message === undefined || typeof message.message === 'string');
  if (message.type === 'resourceResult') return typeof message.requestId === 'string' && (!!message.result || typeof message.error === 'string');
  if (message.type === 'serviceResult') return typeof message.requestId === 'string' && ('result' in message || typeof message.error === 'string');
  if (message.type === 'applyResult') return typeof message.requestId === 'string' && !!message.result;
  if (message.type === 'documentSaved') return Number.isInteger(message.documentVersion);
  if (message.type === 'documentRejected') return Number.isInteger(message.documentVersion) && Array.isArray(message.diagnostics);
  if (typeof message.text !== 'string' || !Number.isInteger(message.documentVersion)) return false;
  if (message.type === 'init') return typeof message.uri === 'string' && typeof message.title === 'string';
  if (message.type === 'documentChanged') return true;
  return false;
}

function applyEdits(text: string, edits: readonly ApplyTextEditsRequest['edits'][number][]): string {
  return [...edits]
    .sort((left, right) => (right.range.startOffset ?? 0) - (left.range.startOffset ?? 0))
    .reduce((current, edit) => current.slice(0, edit.range.startOffset) + edit.newText + current.slice(edit.range.endOffset), text);
}

function minimalReplacement(before: string, after: string): ApplyTextEditsRequest['edits'][number] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) { beforeEnd -= 1; afterEnd -= 1; }
  return { range: { start: { line: 0, column: start }, end: { line: 0, column: beforeEnd }, startOffset: start, endOffset: beforeEnd }, newText: after.slice(start, afterEnd) };
}