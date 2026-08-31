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
export interface ConversionRequest extends ProtocolEnvelope { readonly kind: 'conversion'; readonly documentVersion: DocumentVersion; readonly converterId: string; readonly options: Readonly<Record<string, string | number | boolean>>; }
/**
 * Defines the conversion result shape.
 */
export interface ConversionResult extends ProtocolEnvelope { readonly documentVersion: DocumentVersion; readonly succeeded: boolean; readonly outputs: readonly HostFile[]; readonly diagnostics: readonly Diagnostic[]; }
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
/**
 * Defines the editor host shape.
 */
export interface EditorHost {
  readonly kind: HostKind;
  readDocument(): Promise<DocumentSnapshot>;
  applyTextEdits(request: ApplyTextEditsRequest): Promise<ApplyResult>;
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
  return v.protocolVersion === PROTOCOL_VERSION && typeof v.requestId === 'string' && v.requestId.trim().length > 0;
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
