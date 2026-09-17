/**
 * Typed host boundary for effective-import resolution.
 *
 * Keeping these exports in a small host entry lets packaged hosts share the
 * resolver/materializer without copying schema-rewriting logic.
 */
export {
  discoverImportSources,
  loadExternalDocuments,
  resourceSnapshot,
  resolveResourceUri,
  defaultExternalDocumentLimits,
  type ExternalDocumentLimits,
  type ResourceReader,
} from '../external-documents.js';
export {
  materializeEffectiveImports,
  ResolvedSchemaContext,
  type ResolvedSchemaDocument,
  type ResolvedSchemaOptions,
} from '../phase4/resolved-schema.js';
