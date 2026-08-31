import type { Diagnostic, DocumentSnapshot, RecoveryState } from './contracts.js';
import type { NormalizedDocument } from './model.js';
import { parseDocument, type ParseResult } from './parser.js';
import { resolveCapabilities, type CapabilityResolution } from './capabilities.js';
import { resolveDocumentReferences, type ExternalDocumentInput } from './resolver.js';
import type { ResolvedSchemaDocument } from './phase4/resolved-schema.js';

/**
 * API for document session.
 */
export class DocumentSession {
  private lastValid?: { model: NormalizedDocument; value: unknown };
  private current: DocumentSnapshot;
  private parsedValue?: unknown;
  private externalDocuments: readonly ExternalDocumentInput[] = [];
  constructor(readonly uri: string, text: string, documentVersion = 1) { this.current = this.update(text, documentVersion); }
  update(text: string, documentVersion: number): DocumentSnapshot {
    const result: ParseResult = parseDocument(this.uri, text);
    this.parsedValue = result.value;
    const resolvedModel = result.model ? resolveDocumentReferences(result.model, this.externalDocuments) : undefined;
    if (resolvedModel && result.recovery === 'valid') this.lastValid = { model: resolvedModel, value: result.value };
    const recovery: RecoveryState = result.recovery;
    this.current = { uri: this.uri, text, documentVersion, recovery, diagnostics: result.diagnostics, model: resolvedModel ?? this.lastValid?.model };
    return this.current;
  }
  setExternalDocuments(documents: readonly ExternalDocumentInput[]): DocumentSnapshot {
    this.externalDocuments = [...documents];
    return this.update(this.current.text, this.current.documentVersion);
  }
  snapshot(): DocumentSnapshot { return this.current; }
  get value(): unknown { return this.parsedValue ?? this.lastValid?.value; }
  get model(): NormalizedDocument | undefined { return this.current.model; }
  get resolvedSchemaDocuments(): readonly ResolvedSchemaDocument[] {
    return this.externalDocuments.flatMap((input) => {
      if ('value' in input && input.value && typeof input.value === 'object' && !Array.isArray(input.value)) return [{ uri: input.uri, document: input.value }];
      return [];
    });
  }
  get capabilities(): CapabilityResolution { return resolveCapabilities(this.value); }
  get diagnostics(): readonly Diagnostic[] { return this.current.diagnostics; }
}
