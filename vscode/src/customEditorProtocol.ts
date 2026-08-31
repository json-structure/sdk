export const customEditorProtocolVersion = 1 as const;
const maxEditCount = 1_000;
const maxEditTextLength = 4 * 1024 * 1024;

export interface TextEditMessage {
    readonly type: 'applyTextEdits';
    readonly protocolVersion: typeof customEditorProtocolVersion;
    readonly request: {
        readonly requestId: string;
        readonly documentVersion: number;
        readonly edits: readonly { readonly range: { readonly startOffset: number; readonly endOffset: number }; readonly newText: string }[];
    };
}
export interface ReadResourceMessage {
    readonly type: 'readResource';
    readonly protocolVersion: typeof customEditorProtocolVersion;
    readonly requestId: string;
    readonly uri: string;
}
export interface ServiceRequestMessage {
    readonly type: 'listConversionCommands' | 'convert' | 'cancelConversion' | 'openGeneratedOutput' | 'libraryRequest' | 'listLibraryEntries' | 'readLibraryDocument';
    readonly protocolVersion: typeof customEditorProtocolVersion;
    readonly requestId: string;
    readonly request?: unknown;
}
export type WebviewMessage = TextEditMessage | ReadResourceMessage | ServiceRequestMessage;

export function isWebviewMessage(value: unknown): value is WebviewMessage {
    if (!value || typeof value !== 'object') return false;
    const message = value as Record<string, unknown>;
    if (message.protocolVersion !== customEditorProtocolVersion) return false;
    if (message.type === 'readResource') return typeof message.requestId === 'string' && message.requestId.trim().length > 0 && message.requestId.length <= 256 && typeof message.uri === 'string' && message.uri.trim().length > 0 && message.uri.length <= 16_384;
    if (message.type === 'libraryRequest') return isRequestId(message.requestId) && isLibraryRequest(message.request);
    if (['listConversionCommands', 'convert', 'cancelConversion', 'openGeneratedOutput', 'listLibraryEntries', 'readLibraryDocument'].includes(String(message.type))) return isRequestId(message.requestId);
    if (message.type !== 'applyTextEdits' || !message.request || typeof message.request !== 'object') return false;
    const request = message.request as Record<string, unknown>;
    return typeof request.requestId === 'string' && request.requestId.trim().length > 0 && Number.isInteger(request.documentVersion) && (request.documentVersion as number) >= 0 && Array.isArray(request.edits) && request.edits.length <= maxEditCount && request.edits.every(isTextEdit) && !hasOverlappingEdits(request.edits as Record<string, unknown>[]);
}

function isRequestId(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
}

function isLibraryRequest(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const request = value as Record<string, unknown>;
    return Object.keys(request).every((key) => key === 'operation' || key === 'payload') &&
        typeof request.operation === 'string' && ['listProviders', 'configureProvider', 'removeProvider', 'listCatalog', 'resolve', 'publish'].includes(request.operation) &&
        isSerializable(request.payload, 0);
}

function isSerializable(value: unknown, depth: number): boolean {
    if (value === undefined || value === null || typeof value === 'boolean' || typeof value === 'string' && value.length <= maxEditTextLength) return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (depth >= 16) return false;
    if (Array.isArray(value)) return value.length <= 10_000 && value.every((item) => isSerializable(item, depth + 1));
    if (!value || typeof value !== 'object') return false;
    const entries = Object.entries(value);
    return entries.length <= 10_000 && entries.every(([key, item]) => key.length <= 256 && isSerializable(item, depth + 1));
}

function isTextEdit(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const edit = value as Record<string, unknown>;
    const range = edit.range as Record<string, unknown> | undefined;
    return typeof edit.newText === 'string' && edit.newText.length <= maxEditTextLength && !!range && Number.isInteger(range.startOffset) && Number.isInteger(range.endOffset) && (range.startOffset as number) >= 0 && (range.endOffset as number) >= (range.startOffset as number);
}

function hasOverlappingEdits(edits: Record<string, unknown>[]): boolean {
    const ranges = edits.map((edit) => edit.range as { startOffset: number; endOffset: number }).sort((left, right) => left.startOffset - right.startOffset || left.endOffset - right.endOffset);
    return ranges.some((range, index) => index > 0 && range.startOffset < ranges[index - 1].endOffset);
}
