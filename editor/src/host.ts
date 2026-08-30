import { isApplyTextEditsRequest, PROTOCOL_VERSION, type ApplyResult, type DocumentSnapshot, type EditorHost } from './contracts.js';
import { DocumentSession } from './session.js';
import type { TextEdit } from './contracts.js';

export class InMemoryEditorHost implements EditorHost {
  readonly kind = 'memory' as const;
  private readonly session: DocumentSession;
  private undoStack: string[] = [];
  constructor(uri: string, text: string) { this.session = new DocumentSession(uri, text); }
  async readDocument(): Promise<DocumentSnapshot> { return this.session.snapshot(); }
  async applyTextEdits(request: unknown): Promise<ApplyResult> {
    const snapshot = this.session.snapshot();
    if (!isApplyTextEditsRequest(request)) {
      const requestId = request && typeof request === 'object' && typeof (request as Record<string, unknown>).requestId === 'string' ? (request as Record<string, unknown>).requestId as string : '';
      return { protocolVersion: PROTOCOL_VERSION, requestId, documentVersion: snapshot.documentVersion, applied: false, diagnostics: [{ code: 'host.malformed-request', message: 'Malformed edit request.', severity: 'error' }] };
    }
    if (snapshot.recovery !== 'valid') return { protocolVersion: PROTOCOL_VERSION, requestId: request.requestId, documentVersion: snapshot.documentVersion, applied: false, diagnostics: [{ code: 'host.invalid-state', message: 'Document recovery state does not accept command writes.', severity: 'error' }] };
    if (request.documentVersion !== snapshot.documentVersion) return { protocolVersion: PROTOCOL_VERSION, requestId: request.requestId, documentVersion: snapshot.documentVersion, applied: false, diagnostics: [{ code: 'host.stale-version', message: 'Document version is stale.', severity: 'error' }] };
    const edits = [...request.edits].sort((a, b) => (b.range.startOffset ?? 0) - (a.range.startOffset ?? 0));
    if (edits.some((edit, index) => index > 0 && (edits[index - 1].range.startOffset ?? 0) < (edit.range.endOffset ?? 0))) return { protocolVersion: PROTOCOL_VERSION, requestId: request.requestId, documentVersion: snapshot.documentVersion, applied: false, diagnostics: [{ code: 'host.overlap', message: 'Overlapping edits are not accepted.', severity: 'error' }] };
    try {
      let text = snapshot.text;
      for (const edit of edits) text = apply(text, edit);
      this.undoStack.push(snapshot.text);
      const next = this.session.update(text, snapshot.documentVersion + 1);
      if (next.recovery !== 'valid') {
        this.undoStack.pop();
        this.session.update(snapshot.text, snapshot.documentVersion);
        return { protocolVersion: PROTOCOL_VERSION, requestId: request.requestId, documentVersion: snapshot.documentVersion, applied: false, diagnostics: next.diagnostics };
      }
      return { protocolVersion: PROTOCOL_VERSION, requestId: request.requestId, documentVersion: next.documentVersion, applied: true, diagnostics: next.diagnostics };
    } catch (error) { return { protocolVersion: PROTOCOL_VERSION, requestId: request.requestId, documentVersion: snapshot.documentVersion, applied: false, diagnostics: [{ code: 'host.invalid-edit', message: String(error), severity: 'error' }] }; }
  }
  async undo(): Promise<DocumentSnapshot> {
    const text = this.undoStack.pop();
    if (text === undefined) return this.session.snapshot();
    return this.session.update(text, this.session.snapshot().documentVersion + 1);
  }
}
function apply(text: string, edit: TextEdit): string {
  const start = edit.range.startOffset; const end = edit.range.endOffset;
  if (start === undefined || end === undefined || start < 0 || end < start || end > text.length) throw new Error('Edit range is outside the document.');
  return text.slice(0, start) + edit.newText + text.slice(end);
}
