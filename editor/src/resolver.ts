import type { Diagnostic, DocumentSnapshot, JsonPointer, SourceLocation } from './contracts.js';
import type {
  DefinitionProjection,
  ImportOrigin,
  ImportResolutionFact,
  NormalizedDocument,
  ReferenceResolutionFact,
  ReferenceResolutionProjection,
  ResolvedReferenceKind,
  ResolutionStatus
} from './model.js';

export interface ExternalDocumentDescriptor {
  readonly uri: string;
  readonly model?: NormalizedDocument;
  readonly snapshot?: DocumentSnapshot;
  readonly availability?: 'available' | 'unavailable' | 'stale';
}
export type ExternalDocumentInput = NormalizedDocument | DocumentSnapshot | ExternalDocumentDescriptor;
export interface ResolveReferencesResult extends ReferenceResolutionProjection {
  readonly diagnostics: readonly Diagnostic[];
}

export function resolveDocumentReferences(document: NormalizedDocument, externalDocuments: readonly ExternalDocumentInput[] = []): NormalizedDocument {
  const resolution = resolveReferences(document, externalDocuments);
  const resolverDiagnostics = resolution.diagnostics.filter((diagnostic) => {
    const pointer = diagnostic.location?.pointer;
    return !pointer || !document.projections.diagnostics.some((existing) => existing.pointer === pointer && existing.severity === 'error');
  });
  return {
    ...document,
    projections: {
      ...document.projections,
      resolution: { references: resolution.references, imports: resolution.imports },
      diagnostics: [
        ...document.projections.diagnostics,
        ...resolverDiagnostics.map((diagnostic) => ({
          code: diagnostic.code,
          severity: diagnostic.severity,
          pointer: diagnostic.location?.pointer
        }))
      ]
    }
  };
}

interface SuppliedDocument {
  readonly uri: string;
  readonly model?: NormalizedDocument;
  readonly status: 'available' | 'unavailable' | 'stale' | 'incomplete';
}
interface EffectiveDeclaration {
  readonly pointer: JsonPointer;
  readonly sourcePointer: JsonPointer;
  readonly documentUri: string;
  readonly definition: DefinitionProjection;
  readonly importOrigins: readonly ImportOrigin[];
}
interface EffectiveDocument {
  readonly declarations: ReadonlyMap<JsonPointer, readonly EffectiveDeclaration[]>;
  readonly references: readonly EffectiveReferenceSite[];
  readonly imports: readonly ImportResolutionFact[];
  readonly status: ResolutionStatus;
  readonly reason?: string;
}
interface EffectiveReferenceSite {
  readonly pointer: JsonPointer;
  readonly target: string;
  readonly kind: ResolvedReferenceKind;
  readonly reason?: string;
}

export function resolveReferences(document: NormalizedDocument, externalDocuments: readonly ExternalDocumentInput[] = []): ResolveReferencesResult {
  const supplied = suppliedDocuments(externalDocuments);
  const cache = new Map<string, EffectiveDocument>();
  const effective = buildEffectiveDocument(document, supplied, cache, []);
  const initialReferences = effective.references.map((site) => resolveSite(site, document, effective));
  const cyclicSites = cyclicInheritanceSites(initialReferences, effective.declarations);
  const references = initialReferences.map((fact) => cyclicSites.has(`${fact.kind}|${fact.pointer}`)
    ? { ...fact, status: 'unresolved' as const, reason: 'Inheritance cycle detected.' }
    : fact);
  const diagnostics = [
    ...effective.imports.flatMap((fact) => importDiagnostic(document, fact)),
    ...references.flatMap((fact) => referenceDiagnostic(document, fact))
  ];
  return { references, imports: effective.imports, diagnostics };
}

function suppliedDocuments(inputs: readonly ExternalDocumentInput[]): ReadonlyMap<string, readonly SuppliedDocument[]> {
  const result = new Map<string, SuppliedDocument[]>();
  for (const input of inputs) {
    const supplied = suppliedDocument(input);
    const identities = [supplied.uri, supplied.model?.documentId].filter((value): value is string => typeof value === 'string');
    for (const key of new Set(identities.flatMap(uriKeys))) {
      const entries = result.get(key) ?? [];
      entries.push(supplied);
      result.set(key, entries);
    }
  }
  return result;
}

function suppliedDocument(input: ExternalDocumentInput): SuppliedDocument {
  if (isNormalizedDocument(input)) return { uri: input.uri, model: input, status: input.recovery === 'valid' ? 'available' : 'incomplete' };
  if (isDocumentSnapshot(input)) {
    return {
      uri: input.uri,
      model: input.model,
      status: input.recovery === 'valid' && input.model ? 'available' : input.recovery === 'incomplete' || input.recovery === 'invalid' ? 'incomplete' : 'stale'
    };
  }
  const snapshot = input.snapshot;
  const model = input.model ?? snapshot?.model;
  const availability = input.availability ?? 'available';
  if (availability === 'unavailable') return { uri: input.uri, status: 'unavailable' };
  if (availability === 'stale') return { uri: input.uri, model, status: 'stale' };
  if (snapshot && snapshot.recovery !== 'valid') return { uri: input.uri, model, status: 'incomplete' };
  return { uri: input.uri, model, status: model ? 'available' : 'unavailable' };
}

function buildEffectiveDocument(
  document: NormalizedDocument,
  supplied: ReadonlyMap<string, readonly SuppliedDocument[]>,
  cache: Map<string, EffectiveDocument>,
  stack: readonly string[]
): EffectiveDocument {
  const cached = cache.get(document.uri);
  if (cached) return cached;
  if (stack.includes(document.uri)) return { declarations: new Map(), references: [], imports: [], status: 'unresolved', reason: 'Import cycle detected.' };

  const declarations = new Map<JsonPointer, EffectiveDeclaration[]>();
  const references: EffectiveReferenceSite[] = referenceSites(document);
  for (const definition of document.projections.definitions) {
    if (!definition.reusable) continue;
    const occurrences = Math.max(1, document.nodes.filter((node) => node.pointer === definition.pointer).length);
    for (let index = 0; index < occurrences; index++) {
      addDeclaration(declarations, definition.pointer, {
        pointer: definition.pointer,
        sourcePointer: definition.pointer,
        documentUri: document.uri,
        definition,
        importOrigins: []
      });
    }
  }

  let importFacts: ImportResolutionFact[] = [];
  let documentStatus: ResolutionStatus = 'resolved';
  let documentReason: string | undefined;
  for (const projection of document.projections.imports) {
    const sourceKey = canonicalDocumentUri(projection.source);
    const candidates = supplied.get(sourceKey) ?? [];
    let status: ResolutionStatus = 'resolved';
    let reason: string | undefined;
    let importedPointers: JsonPointer[] = [];
    let external: SuppliedDocument | undefined;

    const distinctCandidates = [...new Set(candidates)];
    if (distinctCandidates.length > 1) {
      status = 'unresolved';
      reason = 'Multiple supplied external documents match this import URI.';
    } else if (distinctCandidates.length === 0 || distinctCandidates[0].status === 'unavailable') {
      status = 'indeterminate';
      reason = 'The external document was not supplied or is unavailable.';
    } else {
      external = distinctCandidates[0];
      if (external.status !== 'available' || !external.model) {
        status = 'indeterminate';
        reason = external.status === 'stale' ? 'The supplied external document is stale.' : 'The supplied external document is incomplete or invalid.';
      } else if (stack.includes(external.model.uri) || external.model.uri === document.uri) {
        status = 'unresolved';
        reason = 'Import cycle detected.';
      } else {
        const externalEffective = buildEffectiveDocument(external.model, supplied, cache, [...stack, document.uri]);
        if (externalEffective.status !== 'resolved') {
          status = externalEffective.status;
          reason = externalEffective.reason;
        }
        const destination = importDestination(projection.namespacePointer);
        const imported = importedDeclarations(external.model, externalEffective, projection.keyword, destination, projection.source, projection.pointer);
        const acceptedPointers: JsonPointer[] = [];
        for (const declaration of imported) {
          const local = declarations.get(declaration.pointer) ?? [];
          if (local.some((entry) => entry.importOrigins.length === 0)) continue;
          addDeclaration(declarations, declaration.pointer, declaration);
          importedPointers.push(declaration.pointer);
          acceptedPointers.push(declaration.pointer);
        }
        references.push(...importedReferenceSites(external.model, externalEffective, projection.keyword, destination, acceptedPointers));
      }
    }

    if (status !== 'resolved') {
      documentStatus = mergeStatus(documentStatus, status);
      documentReason ??= reason;
    }
    importFacts.push({
      pointer: projection.pointer,
      namespacePointer: projection.namespacePointer,
      source: projection.source,
      documentUri: external?.model?.uri ?? external?.uri,
      provenance: projection.provenance,
      status,
      importedPointers: [...new Set(importedPointers)].sort(),
      reason
    });
  }

  for (const [pointer, entries] of declarations) {
    if (entries.length > 1) {
      documentStatus = 'unresolved';
      documentReason ??= `Ambiguous duplicate effective declaration at ${pointer}.`;
      const implicatedImports = new Set(entries.flatMap((entry) => entry.importOrigins.map((origin) => origin.importPointer)));
      importFacts = importFacts.map((fact) => implicatedImports.has(fact.pointer)
        ? { ...fact, status: 'unresolved', reason: `Imported declaration collides at ${pointer}.` }
        : fact);
    }
  }
  const result = { declarations, references, imports: importFacts, status: documentStatus, reason: documentReason };
  cache.set(document.uri, result);
  return result;
}

function importedDeclarations(
  external: NormalizedDocument,
  effective: EffectiveDocument,
  keyword: '$import' | '$importdefs',
  destination: JsonPointer,
  importSource: string,
  importPointer: JsonPointer
): EffectiveDeclaration[] {
  const result: EffectiveDeclaration[] = [];
  for (const entries of effective.declarations.values()) {
    for (const entry of entries) {
      if (!entry.definition.reusable) continue;
      const relative = entry.pointer.slice('/definitions'.length);
      const pointer = `${destination}${relative}`;
      result.push(withImportOrigin(entry, pointer, importSource, importPointer, keyword));
    }
  }
  if (keyword === '$import') {
    const root = external.projections.definitions.find((definition) => definition.pointer === '');
    if (root && external.name) {
      const pointer = `${destination}/${escapePointerPart(external.name)}`;
      result.push(withImportOrigin({ pointer: '', sourcePointer: '', documentUri: external.uri, definition: root, importOrigins: [] }, pointer, importSource, importPointer, keyword));
    }
  }
  return result;
}

function importedReferenceSites(
  external: NormalizedDocument,
  effective: EffectiveDocument,
  keyword: '$import' | '$importdefs',
  destination: JsonPointer,
  acceptedPointers: readonly JsonPointer[]
): EffectiveReferenceSite[] {
  const result: EffectiveReferenceSite[] = [];
  for (const site of effective.references) {
    const pointer = importedPointer(site.pointer, external, keyword, destination);
    if (!pointer || !acceptedPointers.some((accepted) => pointer === accepted || pointer.startsWith(`${accepted}/`))) continue;
    const parsed = parsePointerFragment(site.target);
    if (!parsed.pointer) {
      result.push({ ...site, pointer });
      continue;
    }
    if (parsed.pointer === '') {
      if (keyword === '$import' && external.name) {
        result.push({ ...site, pointer, target: `#${destination}/${escapePointerPart(external.name)}` });
      } else {
        result.push({ ...site, pointer, reason: 'The imported declaration references a document root that $importdefs does not import.' });
      }
      continue;
    }
    if (parsed.pointer.startsWith('/definitions/')) {
      result.push({ ...site, pointer, target: `#${destination}${parsed.pointer.slice('/definitions'.length)}` });
    } else {
      result.push({ ...site, pointer });
    }
  }
  return result;
}

function importedPointer(pointer: JsonPointer, external: NormalizedDocument, keyword: '$import' | '$importdefs', destination: JsonPointer): JsonPointer | undefined {
  if (pointer.startsWith('/definitions/')) return `${destination}${pointer.slice('/definitions'.length)}`;
  if (keyword === '$import' && external.name) return `${destination}/${escapePointerPart(external.name)}${pointer}`;
  return undefined;
}

function withImportOrigin(
  declaration: EffectiveDeclaration,
  pointer: JsonPointer,
  importSource: string,
  importPointer: JsonPointer,
  provenance: '$import' | '$importdefs'
): EffectiveDeclaration {
  const origin: ImportOrigin = {
    documentUri: declaration.documentUri,
    pointer: declaration.sourcePointer,
    importSource,
    importPointer,
    provenance: provenance === '$import' ? 'import' : 'importdefs'
  };
  return { ...declaration, pointer, importOrigins: [...declaration.importOrigins, origin] };
}

function referenceSites(document: NormalizedDocument): Array<{ pointer: JsonPointer; target: string; kind: ResolvedReferenceKind }> {
  const sites = new Map<string, { pointer: JsonPointer; target: string; kind: ResolvedReferenceKind }>();
  const add = (pointer: string, target: string, kind: ResolvedReferenceKind): void => {
    sites.set(`${kind}|${pointer}`, { pointer, target, kind });
  };
  for (const reference of document.projections.references) {
    if (reference.kind === 'root') add(reference.pointer, reference.target, 'root');
    else if (reference.kind === 'extends') add(reference.pointer, reference.target, 'extends');
    else if (!reference.pointer.endsWith('/targettype/$ref') && !reference.pointer.endsWith('/qualifiertype/$ref')) add(reference.pointer, reference.target, 'ref');
  }
  for (const definition of document.projections.definitions) {
    for (const relation of definition.relations) {
      if (relation.targetTypeRef) add(`${relation.pointer}/targettype/$ref`, relation.targetTypeRef, 'relation-target');
      if (relation.qualifierTypeRef) add(`${relation.pointer}/qualifiertype/$ref`, relation.qualifierTypeRef, 'relation-qualifier');
    }
  }
  return [...sites.values()].sort((left, right) => left.pointer.localeCompare(right.pointer) || left.kind.localeCompare(right.kind));
}

function resolveSite(
  site: EffectiveReferenceSite,
  document: NormalizedDocument,
  effective: EffectiveDocument
): ReferenceResolutionFact {
  if (site.reason) return { pointer: site.pointer, target: site.target, kind: site.kind, status: 'unresolved', importOrigins: [], reason: site.reason };
  const parsed = parsePointerFragment(site.target);
  if (!parsed.pointer) return { ...site, status: 'unresolved', importOrigins: [], reason: parsed.reason };
  const entries = effective.declarations.get(parsed.pointer) ?? [];
  if (entries.length === 1) {
    const entry = entries[0];
    if (site.kind === 'relation-target' && !entry.definition.identity) {
      return {
        ...site,
        normalizedTarget: parsed.pointer,
        status: 'unresolved',
        targetPointer: entry.sourcePointer,
        targetDocumentUri: entry.documentUri,
        importOrigins: entry.importOrigins,
        reason: 'Relation target must resolve to an object or tuple declaration with a valid identity.'
      };
    }
    return {
      ...site,
      normalizedTarget: parsed.pointer,
      status: 'resolved',
      targetPointer: entry.sourcePointer,
      targetDocumentUri: entry.documentUri,
      importOrigins: entry.importOrigins
    };
  }
  if (entries.length > 1) {
    return { ...site, normalizedTarget: parsed.pointer, status: 'unresolved', importOrigins: [], reason: 'The effective declaration path is ambiguous.' };
  }
  const coveringImports = document.projections.imports.filter((candidate) => pointerWithinImport(parsed.pointer!, candidate.namespacePointer));
  const unresolvedImport = coveringImports.map((candidate) => effective.imports.find((fact) => fact.pointer === candidate.pointer)).find((fact) => fact?.status !== 'resolved');
  if (unresolvedImport?.status === 'indeterminate') {
    return { ...site, normalizedTarget: parsed.pointer, status: 'indeterminate', importOrigins: [], reason: unresolvedImport.reason };
  }
  return { ...site, normalizedTarget: parsed.pointer, status: 'unresolved', importOrigins: [], reason: 'No reusable declaration exists at the target path.' };
}

function parsePointerFragment(value: string): { pointer?: JsonPointer; reason?: string } {
  if (value === '#') return { pointer: '' };
  if (!value.startsWith('#/')) return { reason: 'Reference must be a JSON Pointer URI fragment beginning with #/.' };
  let decoded: string;
  try { decoded = decodeURIComponent(value.slice(1)); }
  catch { return { reason: 'Reference contains malformed URI percent-encoding.' }; }
  if (!decoded.startsWith('/') || /~(?:[^01]|$)/.test(decoded)) return { reason: 'Reference contains malformed JSON Pointer escaping.' };
  return { pointer: decoded };
}

function pointerWithinImport(pointer: string, namespacePointer: string): boolean {
  const destination = importDestination(namespacePointer);
  return pointer === destination || pointer.startsWith(`${destination}/`);
}

function importDestination(namespacePointer: string): JsonPointer {
  return namespacePointer === '' || namespacePointer === '/definitions' ? '/definitions' : namespacePointer;
}

function addDeclaration(map: Map<JsonPointer, EffectiveDeclaration[]>, pointer: JsonPointer, declaration: EffectiveDeclaration): void {
  const entries = map.get(pointer) ?? [];
  entries.push(declaration);
  map.set(pointer, entries);
}

function mergeStatus(left: ResolutionStatus, right: ResolutionStatus): ResolutionStatus {
  if (left === 'unresolved' || right === 'unresolved') return 'unresolved';
  if (left === 'indeterminate' || right === 'indeterminate') return 'indeterminate';
  return 'resolved';
}

function diagnosticLocation(document: NormalizedDocument, pointer: JsonPointer): SourceLocation {
  const node = document.nodes.find((candidate) => candidate.pointer === pointer);
  return { uri: document.uri, pointer, range: node?.range };
}

function importDiagnostic(document: NormalizedDocument, fact: ImportResolutionFact): Diagnostic[] {
  if (fact.status === 'resolved') return [];
  return [{
    code: fact.status === 'indeterminate' ? 'resolution.import-indeterminate' : 'resolution.import-unresolved',
    message: fact.reason ?? 'Import could not be resolved.',
    severity: fact.status === 'indeterminate' ? 'indeterminate' : 'error',
    location: diagnosticLocation(document, fact.pointer)
  }];
}

function referenceDiagnostic(document: NormalizedDocument, fact: ReferenceResolutionFact): Diagnostic[] {
  if (fact.status === 'resolved') return [];
  return [{
    code: fact.status === 'indeterminate' ? 'resolution.reference-indeterminate' : 'resolution.reference-unresolved',
    message: fact.reason ?? 'Reference could not be resolved.',
    severity: fact.status === 'indeterminate' ? 'indeterminate' : 'error',
    location: diagnosticLocation(document, fact.pointer)
  }];
}

function canonicalDocumentUri(value: string): string {
  try {
    const uri = new URL(value);
    uri.hash = '';
    return uri.href;
  } catch {
    return value;
  }
}

function uriKeys(value: string): string[] {
  const canonical = canonicalDocumentUri(value);
  return canonical === value ? [value] : [canonical, value];
}

function escapePointerPart(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function isNormalizedDocument(value: ExternalDocumentInput): value is NormalizedDocument {
  return 'projections' in value && 'nodes' in value;
}

function isDocumentSnapshot(value: ExternalDocumentInput): value is DocumentSnapshot {
  return 'documentVersion' in value && 'text' in value;
}

function cyclicInheritanceSites(
  facts: readonly ReferenceResolutionFact[],
  declarations: ReadonlyMap<JsonPointer, readonly EffectiveDeclaration[]>
): ReadonlySet<string> {
  const edges = facts.filter((fact) => fact.status === 'resolved' && fact.kind === 'extends' && fact.normalizedTarget);
  const graph = new Map<string, Array<{ target: string; key: string }>>();
  for (const fact of edges) {
    const source = owningDefinitionPointer(declarations, fact.pointer);
    if (!source || !fact.normalizedTarget) continue;
    const list = graph.get(source) ?? [];
    list.push({ target: fact.normalizedTarget, key: `${fact.kind}|${fact.pointer}` });
    graph.set(source, list);
  }
  const cyclic = new Set<string>();
  const visit = (node: string, path: readonly string[], edgeKeys: readonly string[]): void => {
    const cycleStart = path.indexOf(node);
    if (cycleStart >= 0) {
      edgeKeys.slice(cycleStart).forEach((key) => cyclic.add(key));
      return;
    }
    for (const edge of graph.get(node) ?? []) visit(edge.target, [...path, node], [...edgeKeys, edge.key]);
  };
  for (const node of graph.keys()) visit(node, [], []);
  return cyclic;
}

function owningDefinitionPointer(declarations: ReadonlyMap<JsonPointer, readonly EffectiveDeclaration[]>, pointer: string): string | undefined {
  return [...declarations.keys()]
    .filter((declarationPointer) => declarationPointer !== '' && (pointer === declarationPointer || pointer.startsWith(`${declarationPointer}/`)))
    .sort((left, right) => right.length - left.length)[0];
}