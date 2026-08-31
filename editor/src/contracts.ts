/**
 * Constant for protocol version.
 */
export const PROTOCOL_VERSION = 1 as const;
/**
 * Type alias for host kind.
 */
export type HostKind = 'electron' | 'vscode' | 'memory';
/**
 * Type alias for json pointer.
 */
export type JsonPointer = string;
/**
 * Type alias for node id.
 */
export type NodeId = string & { readonly __nodeId: unique symbol };
/**
 * Type alias for document version.
 */
export type DocumentVersion = number;
/**
 * Defines the text position shape.
 */
export interface TextPosition { readonly line: number; readonly column: number; readonly offset?: number; }
/**
 * Defines the text range shape.
 */
export interface TextRange { readonly start: TextPosition; readonly end: TextPosition; readonly startOffset?: number; readonly endOffset?: number; }
/**
 * Defines the text edit shape.
 */
export interface TextEdit { readonly range: TextRange; readonly newText: string; }
/**
 * Defines the source location shape.
 */
export interface SourceLocation { readonly uri: string; readonly pointer: JsonPointer; readonly range?: TextRange; }
/**
 * Type alias for diagnostic severity.
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'indeterminate';
/**
 * Defines the diagnostic shape.
 */
export interface Diagnostic { readonly code: string; readonly message: string; readonly severity: DiagnosticSeverity; readonly location?: SourceLocation; readonly related?: readonly SourceLocation[]; }
/**
 * Type alias for recovery state.
 */
export type RecoveryState = 'valid' | 'invalid' | 'incomplete' | 'indeterminate';
/**
 * Defines the document snapshot shape.
 */
export interface DocumentSnapshot { readonly uri: string; readonly text: string; readonly documentVersion: DocumentVersion; readonly recovery: RecoveryState; readonly diagnostics: readonly Diagnostic[]; readonly model?: import('./model.js').NormalizedDocument; }
/**
 * Defines the protocol envelope shape.
 */
export interface ProtocolEnvelope { readonly protocolVersion: typeof PROTOCOL_VERSION; readonly requestId: string; }
/**
 * Defines the apply text edits request shape.
 */
export interface ApplyTextEditsRequest extends ProtocolEnvelope { readonly documentVersion: DocumentVersion; readonly edits: readonly TextEdit[]; }
/**
 * Defines the apply result shape.
 */
export interface ApplyResult extends ProtocolEnvelope { readonly documentVersion: DocumentVersion; readonly applied: boolean; readonly diagnostics: readonly Diagnostic[]; }
/**
 * Defines the open dialog request shape.
 */
export interface OpenDialogRequest extends ProtocolEnvelope { readonly kind: 'open-dialog'; readonly filters?: readonly string[]; readonly allowMultiple?: boolean; }
/**
 * Defines the host file shape.
 */
export interface HostFile { readonly uri: string; readonly name: string; }
/**
 * Defines the save dialog request shape.
 */
export interface SaveDialogRequest extends ProtocolEnvelope { readonly kind: 'save-dialog'; readonly suggestedName?: string; }
/**
 * Defines the resource snapshot shape.
 */
export interface ResourceSnapshot extends ProtocolEnvelope { readonly uri: string; readonly content: string; readonly contentHash: string; }
/**
 * Defines the resource change shape.
 */
export interface ResourceChange extends ProtocolEnvelope { readonly uri: string; readonly contentHash: string; readonly documentVersion?: DocumentVersion; }
/**
 * Defines the write resource request shape.
 */
export interface WriteResourceRequest extends ProtocolEnvelope { readonly kind: 'write-resource'; readonly uri: string; readonly content: string; }
/**
 * Defines the conversion request shape.
 */
export interface ConversionRequest extends ProtocolEnvelope { readonly kind: 'conversion'; readonly documentVersion: DocumentVersion; readonly commandId: string; readonly sourceName: string; readonly sourceText: string; readonly options: Readonly<Record<string, string | number | boolean>>; }
/** Type alias for conversion lossiness classifications. */
export type ConversionLossiness = 'none' | 'formatting' | 'metadata' | 'precision' | 'unsupported-feature' | 'data-loss';
/** Defines one structured conversion warning retained for review. */
export interface ConversionReviewWarning {
  readonly code: string;
  readonly message: string;
  readonly lossiness: Exclude<ConversionLossiness, 'none'>;
  readonly sourceLocation?: string;
  readonly targetPath?: string;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}
/** Defines one output file integrity record. */
export interface ConversionIntegrityEntry { readonly path: string; readonly sha256: string; readonly bytes: number; }
/** Defines the deterministic output integrity manifest. */
export interface ConversionOutputManifest { readonly algorithm: 'sha256'; readonly files: readonly ConversionIntegrityEntry[]; }
/** Defines review evidence retained across editor hosts. */
export interface ConversionReview {
  readonly commandId: string;
  readonly converter: { readonly id: string; readonly displayName: string; readonly version: string };
  readonly sourceFormat: string;
  readonly targetFormat: string;
  readonly lifecycle: readonly ('idle' | 'preparing' | 'running' | 'publishing' | 'launching' | 'completed' | 'cancelled' | 'failed')[];
  readonly published: boolean;
  readonly lossiness: ConversionLossiness;
  readonly warnings: readonly ConversionReviewWarning[];
  readonly manifest?: ConversionOutputManifest;
}
/**
 * Defines the conversion result shape.
 */
export interface ConversionResult extends ProtocolEnvelope { readonly documentVersion: DocumentVersion; readonly succeeded: boolean; readonly outputs: readonly HostFile[]; readonly diagnostics: readonly Diagnostic[]; readonly review?: ConversionReview; }
/**
 * Defines the open generated output request shape.
 */
export interface OpenGeneratedOutputRequest extends ProtocolEnvelope { readonly kind: 'open-generated-output'; readonly outputs: readonly HostFile[]; readonly application?: string; }
/**
 * Defines the open generated output result shape.
 */
export interface OpenGeneratedOutputResult extends ProtocolEnvelope { readonly opened: boolean; readonly message?: string; }
/**
 * Defines the progress event shape.
 */
export interface ProgressEvent extends ProtocolEnvelope { readonly documentVersion: DocumentVersion; readonly phase: string; readonly percent?: number; readonly message?: string; }
/** Defines the library operations exposed by an editor host. */
export type LibraryOperation = 'listProviders' | 'configureProvider' | 'removeProvider' | 'listCatalog' | 'resolve' | 'publish';
/** Defines a serializable generic library request. */
export interface LibraryOperationRequest extends ProtocolEnvelope { readonly kind: 'library-request'; readonly operation: LibraryOperation; readonly payload?: unknown; }
/**
 * Defines the editor host shape.
 */
export interface EditorHost {
  readonly kind: HostKind;
  readDocument(): Promise<DocumentSnapshot>;
  applyTextEdits(request: ApplyTextEditsRequest): Promise<ApplyResult>;
  readResource?(uri: string): Promise<ResourceSnapshot>;
  listConversionCommands?(): Promise<import('./conversion/types.js').ConversionCommandsManifest>;
  convert?(request: ConversionRequest): Promise<ConversionResult>;
  onConversionProgress?(listener: (event: ProgressEvent) => void): () => void;
  cancelConversion?(requestId: string): Promise<void>;
  openGeneratedOutput?(request: OpenGeneratedOutputRequest): Promise<OpenGeneratedOutputResult>;
  libraryRequest?<T>(operation: LibraryOperation, payload?: unknown): Promise<T>;
  listLibraryEntries?(): Promise<readonly import('./libraries/contracts.js').LibraryEntry[]>;
  readLibraryDocument?(entryId: string, version: string): Promise<import('./libraries/contracts.js').LibraryDocument>;
}
/**
 * Defines the serializable request shape.
 */
export interface SerializableRequest<T extends string = string> extends ProtocolEnvelope { readonly kind: T; }
/**
 * Returns whether a value satisfies protocol envelope constraints.
 */
export function isProtocolEnvelope(value: unknown): value is ProtocolEnvelope {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.protocolVersion === PROTOCOL_VERSION && typeof v.requestId === 'string' && v.requestId.trim().length > 0 && v.requestId.length <= 256;
}
/** Returns whether a value is a supported library operation. */
export function isLibraryOperation(value: unknown): value is LibraryOperation {
  return typeof value === 'string' && ['listProviders', 'configureProvider', 'removeProvider', 'listCatalog', 'resolve', 'publish'].includes(value);
}
/** Returns whether a value is a well-formed generic library request. */
export function isLibraryOperationRequest(value: unknown): value is LibraryOperationRequest {
  if (!isProtocolEnvelope(value)) return false;
  const request = value as unknown as Record<string, unknown>;
  return request.kind === 'library-request' && isLibraryOperation(request.operation) && isSerializableValue(request.payload, 0);
}
/**
 * Returns whether a value satisfies apply text edits request constraints.
 */
export function isApplyTextEditsRequest(value: unknown): value is ApplyTextEditsRequest {
  if (!isProtocolEnvelope(value)) return false;
  const request = value as unknown as Record<string, unknown>;
  return Number.isInteger(request.documentVersion) && (request.documentVersion as number) >= 0 &&
    Array.isArray(request.edits) && request.edits.every((edit) => {
      if (!edit || typeof edit !== 'object') return false;
      const range = (edit as Record<string, unknown>).range;
      return typeof (edit as Record<string, unknown>).newText === 'string' && !!range && typeof range === 'object' &&
        Number.isInteger((range as Record<string, unknown>).startOffset) &&
        Number.isInteger((range as Record<string, unknown>).endOffset);
    });
}

/** Returns whether a value is a well-formed conversion request. */
export function isConversionRequest(value: unknown): value is ConversionRequest {
  if (!isProtocolEnvelope(value)) return false;
  const request = value as unknown as Record<string, unknown>;
  return request.kind === 'conversion' && Number.isInteger(request.documentVersion) && (request.documentVersion as number) >= 0 &&
    typeof request.commandId === 'string' && request.commandId.trim().length > 0 &&
    typeof request.sourceName === 'string' && request.sourceName.length > 0 && request.sourceName.length <= 255 && !/[\\/]/.test(request.sourceName) &&
    typeof request.sourceText === 'string' && request.sourceText.length <= 4 * 1024 * 1024 && isScalarRecord(request.options);
}

/** Returns whether a value is a well-formed conversion result. */
export function isConversionResult(value: unknown): value is ConversionResult {
  if (!isProtocolEnvelope(value)) return false;
  const result = value as unknown as Record<string, unknown>;
  return Number.isInteger(result.documentVersion) && (result.documentVersion as number) >= 0 && typeof result.succeeded === 'boolean' &&
    Array.isArray(result.outputs) && result.outputs.every(isHostFile) && Array.isArray(result.diagnostics) && result.diagnostics.every(isDiagnostic) &&
    (result.review === undefined || isConversionReview(result.review));
}

function isConversionReview(value: unknown): value is ConversionReview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const review = value as Record<string, unknown>;
  const converter = review.converter;
  const manifest = review.manifest;
  const lifecycle = new Set(['idle', 'preparing', 'running', 'publishing', 'launching', 'completed', 'cancelled', 'failed']);
  const lossiness = new Set<ConversionLossiness>(['none', 'formatting', 'metadata', 'precision', 'unsupported-feature', 'data-loss']);
  return typeof review.commandId === 'string' && review.commandId.length > 0 && !!converter && typeof converter === 'object' && !Array.isArray(converter) &&
    typeof (converter as Record<string, unknown>).id === 'string' && typeof (converter as Record<string, unknown>).displayName === 'string' && typeof (converter as Record<string, unknown>).version === 'string' &&
    typeof review.sourceFormat === 'string' && typeof review.targetFormat === 'string' && Array.isArray(review.lifecycle) && review.lifecycle.every((state) => lifecycle.has(String(state))) &&
    typeof review.published === 'boolean' && lossiness.has(review.lossiness as ConversionLossiness) && Array.isArray(review.warnings) && review.warnings.every(isConversionReviewWarning) &&
    (manifest === undefined || isConversionOutputManifest(manifest));
}

function isConversionReviewWarning(value: unknown): value is ConversionReviewWarning {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const warning = value as Record<string, unknown>;
  return typeof warning.code === 'string' && typeof warning.message === 'string' && ['formatting', 'metadata', 'precision', 'unsupported-feature', 'data-loss'].includes(String(warning.lossiness)) &&
    (warning.sourceLocation === undefined || typeof warning.sourceLocation === 'string') && (warning.targetPath === undefined || typeof warning.targetPath === 'string') &&
    (warning.details === undefined || isScalarRecord(warning.details));
}

function isConversionOutputManifest(value: unknown): value is ConversionOutputManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const manifest = value as Record<string, unknown>;
  return manifest.algorithm === 'sha256' && Array.isArray(manifest.files) && manifest.files.every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const file = entry as Record<string, unknown>;
    return typeof file.path === 'string' && file.path.length > 0 && typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(file.sha256) && Number.isInteger(file.bytes) && (file.bytes as number) >= 0;
  });
}

function isScalarRecord(value: unknown): value is Readonly<Record<string, string | number | boolean>> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every((item) =>
    typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item));
}

function isSerializableValue(value: unknown, depth: number): boolean {
  if (value === undefined || value === null || typeof value === 'string' && value.length <= 4 * 1024 * 1024 || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (depth >= 16) return false;
  if (Array.isArray(value)) return value.length <= 10_000 && value.every((item) => isSerializableValue(item, depth + 1));
  if (!value || typeof value !== 'object') return false;
  const entries = Object.entries(value);
  return entries.length <= 10_000 && entries.every(([key, item]) => key.length <= 256 && isSerializableValue(item, depth + 1));
}

function isHostFile(value: unknown): value is HostFile {
  if (!value || typeof value !== 'object') return false;
  const file = value as Record<string, unknown>;
  return typeof file.uri === 'string' && file.uri.length > 0 && typeof file.name === 'string' && file.name.length > 0;
}

function isDiagnostic(value: unknown): value is Diagnostic {
  if (!value || typeof value !== 'object') return false;
  const diagnostic = value as Record<string, unknown>;
  return typeof diagnostic.code === 'string' && typeof diagnostic.message === 'string' &&
    ['error', 'warning', 'info', 'indeterminate'].includes(String(diagnostic.severity));
}
