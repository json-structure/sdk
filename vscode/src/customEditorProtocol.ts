import { Buffer } from 'node:buffer';

export const customEditorProtocolVersion = 1 as const;
const maxEditCount = 1_000;
const maxPayloadSerializedBytes = 4 * 1024 * 1024;
const maxMessageSerializedBytes = maxPayloadSerializedBytes + 64 * 1024;
const maxSerializedEntries = 10_000;
const maxMessageDepth = 20;
const maxLibraryPayloadDepth = 16;

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
    readonly type: 'listConversionCommands' | 'selectConversionSource' | 'convert' | 'cancelConversion' | 'openGeneratedOutput' | 'libraryRequest' | 'listLibraryEntries' | 'readLibraryDocument';
    readonly protocolVersion: typeof customEditorProtocolVersion;
    readonly requestId: string;
    readonly request?: unknown;
}
export type WebviewMessage = TextEditMessage | ReadResourceMessage | ServiceRequestMessage;

export function isWebviewMessage(value: unknown): value is WebviewMessage {
    if (!value || typeof value !== 'object') return false;
    if (!isSerializedMessageWithinBudget(value)) return false;
    const message = value as Record<string, unknown>;
    if (message.protocolVersion !== customEditorProtocolVersion) return false;
    if (message.type === 'readResource') return typeof message.requestId === 'string' && message.requestId.trim().length > 0 && message.requestId.length <= 256 && typeof message.uri === 'string' && message.uri.trim().length > 0 && message.uri.length <= 16_384;
    if (message.type === 'libraryRequest') return isRequestId(message.requestId) && isLibraryRequest(message.request);
    if (['listConversionCommands', 'selectConversionSource', 'convert', 'cancelConversion', 'openGeneratedOutput', 'listLibraryEntries', 'readLibraryDocument'].includes(String(message.type))) return isRequestId(message.requestId);
    if (message.type !== 'applyTextEdits' || !message.request || typeof message.request !== 'object') return false;
    const request = message.request as Record<string, unknown>;
    return typeof request.requestId === 'string' && request.requestId.trim().length > 0 && Number.isInteger(request.documentVersion) && (request.documentVersion as number) >= 0 && Array.isArray(request.edits) && request.edits.length <= maxEditCount && areBoundedTextEdits(request.edits) && !hasOverlappingEdits(request.edits as Record<string, unknown>[]);
}

function isRequestId(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
}

function isLibraryRequest(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const request = value as Record<string, unknown>;
    return Object.keys(request).every((key) => key === 'operation' || key === 'payload') &&
        typeof request.operation === 'string' && ['listProviders', 'configureProvider', 'removeProvider', 'listCatalog', 'resolve', 'publish'].includes(request.operation) &&
        isSerializableWithinBudget(request.payload, maxLibraryPayloadDepth, maxPayloadSerializedBytes);
}

interface SerializationBudget {
    bytes: number;
    entries: number;
    readonly maxBytes: number;
}

export function isSerializedMessageWithinBudget(value: unknown): boolean {
    return isSerializableWithinBudget(value, maxMessageDepth, maxMessageSerializedBytes);
}

function isSerializableWithinBudget(value: unknown, maxDepth: number, maxBytes: number): boolean {
    return consumeSerializable(value, 0, maxDepth, { bytes: 0, entries: 0, maxBytes }, new WeakSet<object>());
}

function consumeSerializable(value: unknown, depth: number, maxDepth: number, budget: SerializationBudget, ancestors: WeakSet<object>): boolean {
    if (value === undefined || value === null) return consumeBytes(budget, 4);
    if (typeof value === 'boolean') return consumeBytes(budget, value ? 4 : 5);
    if (typeof value === 'string') return consumeBytes(budget, serializedStringBytes(value));
    if (typeof value === 'number') return Number.isFinite(value) && consumeBytes(budget, Buffer.byteLength(String(value), 'utf8'));
    if (!value || typeof value !== 'object' || depth >= maxDepth || ancestors.has(value)) return false;

    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            if (!consumeEntries(budget, value.length) || !consumeBytes(budget, value.length > 0 ? value.length + 1 : 2)) return false;
            for (let index = 0; index < value.length; index += 1) {
                if (!consumeSerializable(index in value ? value[index] : null, depth + 1, maxDepth, budget, ancestors)) return false;
            }
            return true;
        }
        const entries = Object.entries(value);
        if (!consumeEntries(budget, entries.length) || !consumeBytes(budget, entries.length > 0 ? entries.length + 1 : 2)) return false;
        return entries.every(([key, item]) => key.length <= 256 && consumeBytes(budget, serializedStringBytes(key) + 1) && consumeSerializable(item, depth + 1, maxDepth, budget, ancestors));
    } finally {
        ancestors.delete(value);
    }
}

function consumeBytes(budget: SerializationBudget, bytes: number): boolean {
    budget.bytes += bytes;
    return budget.bytes <= budget.maxBytes;
}

function consumeEntries(budget: SerializationBudget, entries: number): boolean {
    budget.entries += entries;
    return budget.entries <= maxSerializedEntries;
}

function serializedStringBytes(value: string): number {
    let bytes = 2;
    for (let index = 0; index < value.length; index += 1) {
        const codeUnit = value.charCodeAt(index);
        if (codeUnit === 0x22 || codeUnit === 0x5c || codeUnit === 0x08 || codeUnit === 0x09 || codeUnit === 0x0a || codeUnit === 0x0c || codeUnit === 0x0d) bytes += 2;
        else if (codeUnit < 0x20) bytes += 6;
        else if (codeUnit < 0x80) bytes += 1;
        else if (codeUnit < 0x800) bytes += 2;
        else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
            bytes += 4;
            index += 1;
        } else if (codeUnit >= 0xd800 && codeUnit <= 0xdfff) bytes += 6;
        else bytes += 3;
    }
    return bytes;
}

function areBoundedTextEdits(values: readonly unknown[]): boolean {
    let totalTextBytes = 0;
    for (const value of values) {
        if (!isTextEdit(value)) return false;
        totalTextBytes += Buffer.byteLength((value as Record<string, unknown>).newText as string, 'utf8');
        if (totalTextBytes > maxPayloadSerializedBytes) return false;
    }
    return true;
}

function isTextEdit(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const edit = value as Record<string, unknown>;
    const range = edit.range as Record<string, unknown> | undefined;
    return typeof edit.newText === 'string' && !!range && Number.isInteger(range.startOffset) && Number.isInteger(range.endOffset) && (range.startOffset as number) >= 0 && (range.endOffset as number) >= (range.startOffset as number);
}

function hasOverlappingEdits(edits: Record<string, unknown>[]): boolean {
    const ranges = edits.map((edit) => edit.range as { startOffset: number; endOffset: number }).sort((left, right) => left.startOffset - right.startOffset || left.endOffset - right.endOffset);
    return ranges.some((range, index) => index > 0 && range.startOffset < ranges[index - 1].endOffset);
}
