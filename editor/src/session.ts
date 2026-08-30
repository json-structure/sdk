import type { Diagnostic, DocumentSnapshot, RecoveryState } from './contracts.js';
import type { NormalizedDocument } from './model.js';
import { parseDocument, type ParseResult } from './parser.js';
import { resolveCapabilities, type CapabilityResolution } from './capabilities.js';

export class DocumentSession {
  private lastValid?: { model: NormalizedDocument; value: unknown };
  private current: DocumentSnapshot;
  private parsedValue?: unknown;
  constructor(readonly uri: string, text: string, documentVersion = 1) { this.current = this.update(text, documentVersion); }
  update(text: string, documentVersion: number): DocumentSnapshot {
    const result: ParseResult = parseDocument(this.uri, text);
    this.parsedValue = result.value;
    if (result.model && result.recovery === 'valid') this.lastValid = { model: result.model, value: result.value };
    const recovery: RecoveryState = result.recovery;
    this.current = { uri: this.uri, text, documentVersion, recovery, diagnostics: result.diagnostics, model: result.model ?? this.lastValid?.model };
    return this.current;
  }
  snapshot(): DocumentSnapshot { return this.current; }
  get value(): unknown { return this.parsedValue ?? this.lastValid?.value; }
  get model(): NormalizedDocument | undefined { return this.current.model; }
  get capabilities(): CapabilityResolution { return resolveCapabilities(this.value); }
  get diagnostics(): readonly Diagnostic[] { return this.current.diagnostics; }
}
