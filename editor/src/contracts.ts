export const PROTOCOL_VERSION = 1 as const;
export type HostKind = 'electron' | 'vscode' | 'memory';
export type JsonPointer = string;
export type NodeId = string & { readonly __nodeId: unique symbol };
export type DocumentVersion = number;
export interface TextPosition { readonly line: number; readonly column: number; readonly offset?: number; }
export interface TextRange { readonly start: TextPosition; readonly end: TextPosition; readonly startOffset?: number; readonly endOffset?: number; }
export interface TextEdit { readonly range: TextRange; readonly newText: string; }
export interface SourceLocation { readonly uri: string; readonly pointer: JsonPointer; readonly range?: TextRange; }
export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'indeterminate';
export interface Diagnostic { readonly code: string; readonly message: string; readonly severity: DiagnosticSeverity; readonly location?: SourceLocation; readonly related?: readonly SourceLocation[]; }
export type RecoveryState = 'valid' | 'invalid' | 'incomplete' | 'indeterminate';
export interface DocumentSnapshot { readonly uri: string; readonly text: string; readonly documentVersion: DocumentVersion; readonly recovery: RecoveryState; readonly diagnostics: readonly Diagnostic[]; readonly model?: import('./model.js').NormalizedDocument; }
export interface ProtocolEnvelope { readonly protocolVersion: typeof PROTOCOL_VERSION; readonly requestId: string; }
export interface ApplyTextEditsRequest extends ProtocolEnvelope { readonly documentVersion: DocumentVersion; readonly edits: readonly TextEdit[]; }
export interface ApplyResult extends ProtocolEnvelope { readonly documentVersion: DocumentVersion; readonly applied: boolean; readonly diagnostics: readonly Diagnostic[]; }
export interface OpenDialogRequest extends ProtocolEnvelope { readonly kind: 'open-dialog'; readonly filters?: readonly string[]; readonly allowMultiple?: boolean; }
export interface HostFile { readonly uri: string; readonly name: string; }
export interface SaveDialogRequest extends ProtocolEnvelope { readonly kind: 'save-dialog'; readonly suggestedName?: string; }
export interface ResourceSnapshot extends ProtocolEnvelope { readonly uri: string; readonly content: string; readonly contentHash: string; }
export interface ResourceChange extends ProtocolEnvelope { readonly uri: string; readonly contentHash: string; readonly documentVersion?: DocumentVersion; }
export interface WriteResourceRequest extends ProtocolEnvelope { readonly kind: 'write-resource'; readonly uri: string; readonly content: string; }
export interface ConversionRequest extends ProtocolEnvelope { readonly kind: 'conversion'; readonly documentVersion: DocumentVersion; readonly converterId: string; readonly options: Readonly<Record<string, string | number | boolean>>; }
export interface ConversionResult extends ProtocolEnvelope { readonly documentVersion: DocumentVersion; readonly succeeded: boolean; readonly outputs: readonly HostFile[]; readonly diagnostics: readonly Diagnostic[]; }
export interface OpenGeneratedOutputRequest extends ProtocolEnvelope { readonly kind: 'open-generated-output'; readonly outputs: readonly HostFile[]; readonly application?: string; }
export interface OpenGeneratedOutputResult extends ProtocolEnvelope { readonly opened: boolean; readonly message?: string; }
export interface ProgressEvent extends ProtocolEnvelope { readonly documentVersion: DocumentVersion; readonly phase: string; readonly percent?: number; readonly message?: string; }
export interface EditorHost {
  readonly kind: HostKind;
  readDocument(): Promise<DocumentSnapshot>;
  applyTextEdits(request: ApplyTextEditsRequest): Promise<ApplyResult>;
}
export interface SerializableRequest<T extends string = string> extends ProtocolEnvelope { readonly kind: T; }
export function isProtocolEnvelope(value: unknown): value is ProtocolEnvelope {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.protocolVersion === PROTOCOL_VERSION && typeof v.requestId === 'string' && v.requestId.trim().length > 0;
}
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
