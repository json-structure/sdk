import type { Diagnostic } from '../contracts.js';
import { validCoreTypeValue } from '../parser.js';
import { resolveCapabilities } from '../capabilities.js';

const DUAL_IMPORT_DIAGNOSTIC_CODE = 'json.keyword-invalid';
const DUAL_IMPORT_DIAGNOSTIC_MESSAGE = 'Only one of $import or $importdefs is permitted at a single namespace location.';

export interface ResolvedSchemaDocument {
  readonly uri: string;
  readonly document: Readonly<Record<string, unknown>>;
  readonly diagnostics?: readonly Diagnostic[];
}

export interface ImportProvenance {
  readonly documentUri: string;
  readonly pointer: string;
  readonly importSource: string;
  readonly importPointer: string;
  readonly keyword: '$import' | '$importdefs';
}

export interface ResolvedSchemaLocation {
  readonly documentUri: string;
  readonly sourcePointer: string;
  readonly effectivePointer: string;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly imports: readonly ImportProvenance[];
}

export interface ResolvedSchemaCollision {
  readonly effectivePointer: string;
  readonly locations: readonly ResolvedSchemaLocation[];
}

export interface ResolvedSchemaOptions {
  readonly documentUri?: string;
  readonly resolvedDocuments?: readonly ResolvedSchemaDocument[];
  readonly diagnostics?: readonly Diagnostic[];
}

export interface ResolvedSchemaImportLocation {
  readonly documentUri: string;
  readonly namespacePointer: string;
  readonly importPointer: string;
  readonly importSource?: string;
  readonly keyword: '$import' | '$importdefs';
}

export interface ResolvedSchemaImportCollision {
  readonly documentUri: string;
  readonly namespacePointer: string;
  readonly imports: readonly ResolvedSchemaImportLocation[];
  readonly diagnostic: Diagnostic;
}

interface IndexedDocument {
  readonly declarations: ReadonlyMap<string, readonly ResolvedSchemaLocation[]>;
  readonly indeterminate: boolean;
  readonly importCollisions: readonly ResolvedSchemaImportCollision[];
  readonly diagnostics: readonly Diagnostic[];
  readonly collisions: readonly ResolvedSchemaCollision[];
}

export class ResolvedSchemaContext {
  private readonly documents = new Map<string, ResolvedSchemaDocument>();
  private readonly ambiguousDocuments = new Set<string>();
  private readonly indexes = new Map<string, IndexedDocument>();
  private readonly importParentDocuments = new WeakMap<ImportProvenance, string>();
  readonly rootUri: string;

  constructor(readonly root: Readonly<Record<string, unknown>>, options: ResolvedSchemaOptions = {}) {
    this.rootUri = options.documentUri ?? 'memory://root';
    this.add({ uri: this.rootUri, document: root, diagnostics: options.diagnostics });
    for (const document of options.resolvedDocuments ?? []) this.add(document);
  }

  resolve(reference: string, fromDocumentUri = this.rootUri): ResolvedSchemaLocation | undefined {
    const pointer = referencePointer(reference);
    if (pointer === undefined) return undefined;
    if (this.ambiguousDocuments.has(canonicalUri(fromDocumentUri))) return undefined;
    const matches = this.index(fromDocumentUri).declarations.get(pointer) ?? [];
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return undefined;
    const supplied = this.documents.get(canonicalUri(fromDocumentUri));
    const schema = supplied ? pointerValue(supplied.document, pointer) : undefined;
    return isRecord(schema) && hasType(schema)
      ? { documentUri: supplied!.uri, sourcePointer: pointer, effectivePointer: pointer, schema, imports: [] }
      : undefined;
  }

  /** Resolves inline or inherited schema locations in addition to reusable declarations. */
  resolveSchema(reference: string, fromDocumentUri = this.rootUri): ResolvedSchemaLocation | undefined {
    const direct = this.resolve(reference, fromDocumentUri);
    if (direct) return direct;
    const pointer = referencePointer(reference);
    if (pointer === undefined) return undefined;
    const owners = [...this.index(fromDocumentUri).declarations.entries()]
      .filter(([, locations]) => locations.length === 1)
      .map(([, locations]) => locations[0]!)
      .filter((location) => pointer.startsWith(`${location.effectivePointer}/`))
      .sort((left, right) => right.effectivePointer.length - left.effectivePointer.length);
    for (const owner of owners) {
      const suffix = pointer.slice(owner.effectivePointer.length + 1).split('/').map(unescapePointer);
      const resolved = this.walkSchemaPath(owner, suffix);
      if (resolved) return resolved;
    }
    return undefined;
  }

  /** Dereferences reusable type aliases while preserving the final declaration origin. */
  dereference(location: ResolvedSchemaLocation): ResolvedSchemaLocation | undefined {
    return this.dereferenceLocation(location, new Set());
  }

  /** Resolves the effective identity inherited through aliases and base declarations. */
  effectiveIdentity(reference: string, fromDocumentUri = this.rootUri): readonly string[] | undefined {
    const location = this.resolve(reference, fromDocumentUri);
    return location ? this.identityFor(location, new Set()) : undefined;
  }

  /** Lists effective property names inherited through aliases and base declarations. */
  effectivePropertyNames(reference: string, fromDocumentUri = this.rootUri): ReadonlySet<string> | undefined {
    const location = this.resolve(reference, fromDocumentUri);
    return location ? this.namesFor(location, 'properties', new Set()) : undefined;
  }

  /** Lists effective relation names inherited through aliases and base declarations. */
  effectiveRelationNames(reference: string, fromDocumentUri = this.rootUri): ReadonlySet<string> | undefined {
    const location = this.resolve(reference, fromDocumentUri);
    return location ? this.namesFor(location, 'relations', new Set()) : undefined;
  }

  /** Tests whether a candidate declaration is the target type or one of its subtypes. */
  isAssignable(
    candidateReference: string,
    targetReference: string,
    candidateDocumentUri = this.rootUri,
    targetDocumentUri = candidateDocumentUri
  ): boolean {
    const candidate = this.resolve(candidateReference, candidateDocumentUri);
    const target = this.resolve(targetReference, targetDocumentUri);
    return !!candidate && !!target && this.locationAssignable(candidate, target, new Set());
  }

  /** Checks whether a scope resolves to a collection of the target type or one of its subtypes. */
  collectionAccepts(
    scopeReference: string,
    targetReference: string,
    scopeDocumentUri = this.rootUri,
    targetDocumentUri = scopeDocumentUri
  ): boolean {
    const collection = this.resolveSchema(scopeReference, scopeDocumentUri);
    const target = this.resolve(targetReference, targetDocumentUri);
    if (!collection || !target) return false;
    const concrete = this.dereference(collection);
    if (!concrete || !['array', 'set', 'map'].includes(String(concrete.schema.type))) return false;
    const member = concrete.schema.type === 'map' ? concrete.schema.values : concrete.schema.items;
    if (!isRecord(member)) return false;
    const reference = directTypeReference(member.type);
    if (reference === undefined) return false;
    const candidate = this.resolve(reference, concrete.documentUri);
    return !!candidate && this.locationAssignable(candidate, target, new Set());
  }

  /** Lists every unambiguous effective declaration visible from the root document. */
  declarations(): readonly ResolvedSchemaLocation[] {
    return [...this.index(this.rootUri).declarations.entries()]
      .filter(([, locations]) => locations.length === 1)
      .map(([, locations]) => locations[0]!)
      .filter((location) => location.effectivePointer.startsWith('/definitions/'))
      .sort((left, right) => left.effectivePointer.localeCompare(right.effectivePointer));
  }

  documentFor(documentUri = this.rootUri): Readonly<Record<string, unknown>> | undefined {
    return this.documents.get(canonicalUri(documentUri))?.document;
  }

  capabilitiesFor(documentUri = this.rootUri): ReturnType<typeof resolveCapabilities> {
    return resolveCapabilities(this.documents.get(canonicalUri(documentUri))?.document ?? {});
  }

  importingDocumentFor(origin: ImportProvenance): string | undefined {
    return this.importParentDocuments.get(origin);
  }

  get indeterminate(): boolean { return this.index(this.rootUri).indeterminate; }
  get importCollisions(): readonly ResolvedSchemaImportCollision[] { return this.index(this.rootUri).importCollisions; }

  get diagnostics(): readonly Diagnostic[] { return this.index(this.rootUri).diagnostics; }

  get collisions(): readonly ResolvedSchemaCollision[] { return this.index(this.rootUri).collisions; }

  private dereferenceLocation(location: ResolvedSchemaLocation, seen: Set<string>): ResolvedSchemaLocation | undefined {
    const identity = locationIdentity(location);
    if (seen.has(identity)) return undefined;
    seen.add(identity);
    const reference = directTypeReference(location.schema.type);
    if (reference === undefined) return location;
    const target = this.resolve(reference, location.documentUri);
    return target ? this.dereferenceLocation(target, seen) : undefined;
  }

  private identityFor(location: ResolvedSchemaLocation, seen: Set<string>): readonly string[] | undefined {
    const identity = locationIdentity(location);
    if (seen.has(identity)) return undefined;
    const nextSeen = new Set(seen).add(identity);
    const direct = stringArray(location.schema.identity);
    if (direct.length > 0) {
      const names = this.namesFor(location, 'properties', new Set());
      return names && new Set(direct).size === direct.length && direct.every((name) => names.has(name)) ? direct : undefined;
    }
    const alias = directTypeReference(location.schema.type);
    if (alias !== undefined) {
      const target = this.resolve(alias, location.documentUri);
      return target ? this.identityFor(target, nextSeen) : undefined;
    }
    const inherited = baseReferences(location.schema).flatMap((reference) => {
      const base = this.resolve(reference, location.documentUri);
      const value = base ? this.identityFor(base, nextSeen) : undefined;
      return value ? [value] : [];
    });
    const distinct = new Map(inherited.map((value) => [JSON.stringify(value), value]));
    return distinct.size === 1 ? distinct.values().next().value : undefined;
  }

  private namesFor(location: ResolvedSchemaLocation, keyword: 'properties' | 'relations', seen: Set<string>): ReadonlySet<string> | undefined {
    const identity = `${locationIdentity(location)}\u0000${keyword}`;
    if (seen.has(identity)) return undefined;
    const nextSeen = new Set(seen).add(identity);
    const names = new Set<string>();
    const alias = directTypeReference(location.schema.type);
    if (alias !== undefined) {
      const target = this.resolve(alias, location.documentUri);
      const inherited = target ? this.namesFor(target, keyword, nextSeen) : undefined;
      if (!inherited) return undefined;
      for (const name of inherited) names.add(name);
    }
    for (const reference of baseReferences(location.schema)) {
      const base = this.resolve(reference, location.documentUri);
      const inherited = base ? this.namesFor(base, keyword, nextSeen) : undefined;
      if (!inherited) return undefined;
      for (const name of inherited) names.add(name);
    }
    const authored = location.schema[keyword];
    if (isRecord(authored)) for (const name of Object.keys(authored)) names.add(name);
    return names;
  }

  private locationAssignable(candidate: ResolvedSchemaLocation, target: ResolvedSchemaLocation, seen: Set<string>): boolean {
    const resolvedCandidate = this.dereference(candidate);
    const resolvedTarget = this.dereference(target);
    if (!resolvedCandidate || !resolvedTarget) return false;
    if (sameLocation(resolvedCandidate, resolvedTarget)) return true;
    const identity = locationIdentity(resolvedCandidate);
    if (seen.has(identity)) return false;
    const nextSeen = new Set(seen).add(identity);
    return baseReferences(resolvedCandidate.schema).some((reference) => {
      const base = this.resolve(reference, resolvedCandidate.documentUri);
      return !!base && this.locationAssignable(base, resolvedTarget, nextSeen);
    });
  }

  private walkSchemaPath(location: ResolvedSchemaLocation, tokens: readonly string[]): ResolvedSchemaLocation | undefined {
    if (tokens.length === 0) return location;
    const concrete = this.dereference(location);
    if (!concrete) return undefined;
    const [keyword, name, ...rest] = tokens;
    if (keyword === 'properties' && name !== undefined) {
      const property = this.propertyFor(concrete, name, new Set());
      return property ? this.walkSchemaPath(property, rest) : undefined;
    }
    if ((keyword === 'items' || keyword === 'values') && isRecord(concrete.schema[keyword])) {
      const child = schemaChildLocation(concrete, keyword, concrete.schema[keyword] as Readonly<Record<string, unknown>>);
      return this.walkSchemaPath(child, name === undefined ? rest : [name, ...rest]);
    }
    if (keyword === 'choices' && name !== undefined && isRecord(concrete.schema.choices) && isRecord(concrete.schema.choices[name])) {
      const child = schemaChildLocation(concrete, `choices/${escapePointer(name)}`, concrete.schema.choices[name] as Readonly<Record<string, unknown>>);
      return this.walkSchemaPath(child, rest);
    }
    if (['allOf', 'anyOf', 'oneOf'].includes(keyword) && name !== undefined && Array.isArray(concrete.schema[keyword])) {
      const index = Number(name);
      const branches = concrete.schema[keyword];
      if (Number.isInteger(index) && index >= 0 && index < branches.length && isRecord(branches[index])) {
        const child = schemaChildLocation(concrete, `${keyword}/${name}`, branches[index]);
        return this.walkSchemaPath(child, rest);
      }
    }
    if (['not', 'if', 'then', 'else'].includes(keyword) && name === undefined && isRecord(concrete.schema[keyword])) {
      const child = schemaChildLocation(concrete, keyword, concrete.schema[keyword]);
      return this.walkSchemaPath(child, rest);
    }
    return undefined;
  }

  private propertyFor(location: ResolvedSchemaLocation, name: string, seen: Set<string>): ResolvedSchemaLocation | undefined {
    const identity = `${locationIdentity(location)}\u0000property:${name}`;
    if (seen.has(identity)) return undefined;
    const nextSeen = new Set(seen).add(identity);
    const authored = isRecord(location.schema.properties) ? ownValue(location.schema.properties, name) : undefined;
    if (isRecord(authored)) {
      return schemaChildLocation(location, `properties/${escapePointer(name)}`, authored);
    }
    const alias = directTypeReference(location.schema.type);
    if (alias !== undefined) {
      const target = this.resolve(alias, location.documentUri);
      const property = target ? this.propertyFor(target, name, nextSeen) : undefined;
      if (property) return { ...property, effectivePointer: `${location.effectivePointer}/properties/${escapePointer(name)}` };
    }
    for (const reference of baseReferences(location.schema)) {
      const base = this.resolve(reference, location.documentUri);
      const property = base ? this.propertyFor(base, name, nextSeen) : undefined;
      if (property) return { ...property, effectivePointer: `${location.effectivePointer}/properties/${escapePointer(name)}` };
    }
    return undefined;
  }

  private add(document: ResolvedSchemaDocument): void {
    const register = (identity: string): void => {
      const key = canonicalUri(identity);
      const existing = this.documents.get(key);
      if (existing && existing !== document) this.ambiguousDocuments.add(key);
      else this.documents.set(key, document);
    };
    register(document.uri);
    if (typeof document.document.$id === 'string') register(document.document.$id);
  }

  private index(uri: string, stack: readonly string[] = []): IndexedDocument {
    const key = canonicalUri(uri);
    const cached = this.indexes.get(key);
    if (cached) return cached;
    if (this.ambiguousDocuments.has(key)) return { declarations: new Map(), indeterminate: true, collisions: [], importCollisions: [], diagnostics: [] };
    const supplied = this.documents.get(key);
    if (!supplied || stack.includes(key)) return { declarations: new Map(), indeterminate: true, collisions: [], importCollisions: [], diagnostics: [] };

    const declarations = new Map<string, ResolvedSchemaLocation[]>();
    const importCollisions: ResolvedSchemaImportCollision[] = [];
    const diagnostics: Diagnostic[] = [];
    const capabilities = resolveCapabilities(supplied.document);
    const compositionActive = capabilities.conditionalCompositionActive;
    let indeterminate = false;
    const add = (effectivePointer: string, documentUri: string, sourcePointer: string, schema: unknown, imports: readonly ImportProvenance[]): void => {
      if (!isRecord(schema)) return;
      const entries = declarations.get(effectivePointer) ?? [];
      entries.push({ documentUri, sourcePointer, effectivePointer, schema, imports });
      declarations.set(effectivePointer, entries);
    };

    const activeNamespace = (pointer: string): boolean => {
      if (pointer === '') return true;
      if (pointer === '/definitions') return isRecord(supplied.document.definitions);
      if (!pointer.startsWith('/definitions/') || !isRecord(supplied.document.definitions)) return false;
      let current: unknown = supplied.document.definitions;
      for (const part of pointer.slice('/definitions/'.length).split('/').map(unescapePointer)) {
        if (!isRecord(current)) return false;
        current = ownValue(current, part);
        if (!isRecord(current) || validCoreTypeValue(current.type)) return false;
      }
      return true;
    };
    const visitImportKeywords = (candidate: Readonly<Record<string, unknown>>, pointer: string): void => {
      if (!activeNamespace(pointer)) return;
      const importKeywords = (['$import', '$importdefs'] as const).filter((keyword) => candidate[keyword] !== undefined);
      if (importKeywords.length === 2) {
        const imports = importKeywords.map((keyword) => {
          const source = candidate[keyword];
          return {
            documentUri: supplied.uri,
            namespacePointer: pointer,
            importPointer: importPointer(pointer, keyword),
            ...(typeof source === 'string' ? { importSource: source } : {}),
            keyword
          };
        });
        const diagnostic = parserDualImportDiagnostic(supplied, pointer);
        importCollisions.push({ documentUri: supplied.uri, namespacePointer: pointer, imports, diagnostic });
        diagnostics.push(diagnostic);
        indeterminate = true;
      }
      for (const keyword of ['$import', '$importdefs'] as const) {
        const source = candidate[keyword];
        if (typeof source !== 'string') continue;
        const externalKey = canonicalUri(resolveUri(supplied.uri, source));
        const external = this.ambiguousDocuments.has(externalKey) ? undefined : this.documents.get(externalKey);
        if (!external || stack.includes(canonicalUri(external.uri))) {
          indeterminate = true;
          continue;
        }
        const externalIndex = this.index(external.uri, [...stack, key]);
        indeterminate ||= externalIndex.indeterminate;
        importCollisions.push(...externalIndex.importCollisions);
        diagnostics.push(...externalIndex.diagnostics);
        const destination = pointer === '' || pointer === '/definitions' ? '/definitions' : pointer;
        for (const locations of externalIndex.declarations.values()) for (const location of locations) {
          if (!hasType(location.schema)) continue;
          let suffix: string | undefined;
          if (location.effectivePointer.startsWith('/definitions/')) suffix = location.effectivePointer.slice('/definitions'.length);
          else if (keyword === '$import' && location.effectivePointer === '' && typeof external.document.name === 'string') suffix = '/' + escapePointer(external.document.name);
          if (suffix === undefined) continue;
          const effectivePointer = destination + suffix;
          const origin: ImportProvenance = {
            documentUri: location.documentUri,
            pointer: location.sourcePointer,
            importSource: source,
            importPointer: pointer === '' ? '/' + keyword : pointer + '/' + keyword,
            keyword
          };
          this.importParentDocuments.set(origin, supplied.uri);
          add(effectivePointer, location.documentUri, location.sourcePointer, location.schema, [...location.imports, origin]);
        }
      }
    };
    const visitSchema = (candidate: unknown, pointer: string): void => {
      if (!isRecord(candidate)) return;
      visitImportKeywords(candidate, pointer);
      if (isRecord(candidate.definitions)) visitNamespace(candidate.definitions, pointer + '/definitions');
      visitSchemaMap(candidate.properties, pointer + '/properties');
      if (isRecord(candidate.additionalProperties)) visitSchema(candidate.additionalProperties, pointer + '/additionalProperties');
      visitSchemaValue(candidate.items, pointer + '/items');
      visitSchemaValue(candidate.values, pointer + '/values');
      visitSchemaMap(candidate.choices, pointer + '/choices');
      if (capabilities.validationActive) {
        visitSchemaValue(candidate.contains, pointer + '/contains');
        visitSchemaValue(candidate.propertyNames, pointer + '/propertyNames');
        visitSchemaValue(candidate.keyNames, pointer + '/keyNames');
        visitSchemaValue(candidate.has, pointer + '/has');
        visitSchemaMap(candidate.patternProperties, pointer + '/patternProperties');
        visitSchemaMap(candidate.patternKeys, pointer + '/patternKeys');
      }
      if (capabilities.conditionalCompositionActive) {
        visitSchemaArray(candidate.allOf, pointer + '/allOf');
        visitSchemaArray(candidate.anyOf, pointer + '/anyOf');
        visitSchemaArray(candidate.oneOf, pointer + '/oneOf');
        visitSchemaValue(candidate.not, pointer + '/not');
        visitSchemaValue(candidate.if, pointer + '/if');
        visitSchemaValue(candidate.then, pointer + '/then');
        visitSchemaValue(candidate.else, pointer + '/else');
      }
      if (Array.isArray(candidate.type)) candidate.type.forEach((entry, index) => visitSchema(entry, pointer + '/type/' + index));
    };
    const visitNamespace = (candidate: unknown, pointer: string): void => {
      if (!isRecord(candidate) || !activeNamespace(pointer)) return;
      visitImportKeywords(candidate, pointer);
      for (const [name, child] of Object.entries(candidate)) {
        if (name === '$import' || name === '$importdefs' || !isRecord(child)) continue;
        const childPointer = pointer + '/' + escapePointer(name);
        if (name === 'definitions') visitNamespace(child, childPointer);
        else if (isSchemaDeclaration(child)) visitSchema(child, childPointer);
        else visitNamespace(child, childPointer);
      }
    };
    const visitSchemaMap = (candidate: unknown, pointer: string): void => {
      if (!isRecord(candidate)) return;
      for (const [name, child] of Object.entries(candidate)) visitSchema(child, pointer + '/' + escapePointer(name));
    };
    const visitSchemaArray = (candidate: unknown, pointer: string): void => {
      if (!Array.isArray(candidate)) return;
      candidate.forEach((entry, index) => visitSchema(entry, pointer + '/' + index));
    };
    const visitSchemaValue = (candidate: unknown, pointer: string): void => {
      if (Array.isArray(candidate)) visitSchemaArray(candidate, pointer);
      else visitSchema(candidate, pointer);
    };
    if (capabilities.importActive) visitSchema(supplied.document, '');

    const visitDefinitions = (candidate: unknown, pointer: string): void => {
      if (!isRecord(candidate)) return;
      for (const [name, declaration] of Object.entries(candidate)) {
        if (name.startsWith('$') || !isRecord(declaration)) continue;
        const declarationPointer = `${pointer}/${escapePointer(name)}`;
        if (hasType(declaration)) {
          if (!declarations.has(declarationPointer)) declarations.set(declarationPointer, []);
          add(declarationPointer, supplied.uri, declarationPointer, declaration, []);
        } else visitDefinitions(declaration, declarationPointer);
      }
    };
    visitDefinitions(supplied.document.definitions, '/definitions');
    if (hasType(supplied.document) || compositionActive && isCompositionDeclaration(supplied.document)) add('', supplied.uri, '', supplied.document, []);
    pruneDanglingLocalTypeReferences(declarations, supplied.uri);
    const collisions = [...declarations.entries()]
      .filter(([, locations]) => locations.length > 1)
      .map(([effectivePointer, locations]) => ({ effectivePointer, locations: [...locations] }));
    indeterminate ||= collisions.length > 0;

    const uniqueImportCollisions = uniqueImportCollisionEntries(importCollisions);
    const uniqueDiagnostics = uniqueDiagnosticsEntries(diagnostics);
    const result = { declarations, indeterminate, collisions, importCollisions: uniqueImportCollisions, diagnostics: uniqueDiagnostics };
    this.indexes.set(key, result);
    return result;
  }
}

/** Materializes declarations supplied by effective imports for converters that cannot resolve imports themselves. */
export function materializeEffectiveImports(root: Readonly<Record<string, unknown>>, context: ResolvedSchemaContext): Readonly<Record<string, unknown>> {
  if (context.indeterminate) {
    const importCollisions = context.importCollisions;
    const collisions = context.collisions;
    const detail = [
      importCollisions.length > 0 ? ` Import collisions: ${importCollisions.map(formatImportCollision).join('; ')}` : '',
      collisions.length > 0 ? ` Declaration collisions: ${collisions.map(formatCollision).join('; ')}` : ''
    ].join('');
    throw new Error(`Effective imports are indeterminate; verify every imported document is available and unambiguous before conversion.${detail}`);
  }
  const mappings = new Map<string, string>();
  for (const location of context.declarations()) {
    const key = materializationMappingKey(importScopeKey(location.imports), location.documentUri, location.sourcePointer);
    if (!mappings.has(key)) mappings.set(key, location.effectivePointer);
    for (let index = 0; index < location.imports.length; index++) {
      const visiblePointer = pointerVisibleAtImport(location, index);
      if (visiblePointer === undefined) continue;
      const parentImports = location.imports.slice(index + 1);
      const parentUri = context.importingDocumentFor(location.imports[index]!) ?? context.rootUri;
      const visibleKey = materializationMappingKey(importScopeKey(parentImports), parentUri, visiblePointer);
      if (!mappings.has(visibleKey)) mappings.set(visibleKey, location.effectivePointer);
    }
  }
  const capabilities = resolveCapabilities(root);
  const result = materializeSchemaNode(root, '', context.rootUri, [], mappings, root, capabilities);
  if (!isRecord(result)) throw new Error('The conversion source must be a JSON object.');
  for (const location of context.declarations()) {
    if (location.imports.length === 0 || !location.effectivePointer.startsWith('/definitions/')) continue;
    const sourceRoot = context.documentFor(location.documentUri) ?? location.schema;
    const materialized = materializeSchemaNode(
      location.schema,
      location.sourcePointer,
      location.documentUri,
      location.imports,
      mappings,
      sourceRoot,
      context.capabilitiesFor(location.documentUri)
    );
    setPointerValue(result, location.effectivePointer, materialized);
  }
  return result;
}

function materializeSchemaNode(
  value: unknown,
  pointer: string,
  documentUri: string,
  imports: readonly ImportProvenance[],
  mappings: ReadonlyMap<string, string>,
  namespaceRoot: Readonly<Record<string, unknown>>,
  capabilities: ReturnType<typeof resolveCapabilities>
): unknown {
  if (!isRecord(value)) return value;
  const directReference = isTypeReference(value);
  const result: Record<string, unknown> = {};
  const namespace = capabilities.importActive && activeNamespacePointer(namespaceRoot, pointer);
  for (const [key, child] of Object.entries(value)) {
    if (namespace && (key === '$import' || key === '$importdefs')) continue;
    let transformed: unknown = child;
    if (key === '$root' && pointer === '' && typeof child === 'string') {
      transformed = rewriteReference(child, documentUri, imports, mappings);
    } else if (key === '$ref' && directReference && typeof child === 'string') {
      transformed = rewriteReference(child, documentUri, imports, mappings);
    } else if (key === '$extends' || key === '$addins') {
      transformed = rewriteReferenceValue(child, documentUri, imports, mappings);
    } else if (key === 'type') {
      transformed = materializeTypeValue(child, pointer + '/type', documentUri, imports, mappings, namespaceRoot, capabilities);
    } else if (key === 'definitions' && isRecord(child)) {
      transformed = materializeNamespace(child, pointer + '/definitions', documentUri, imports, mappings, namespaceRoot, capabilities);
    } else if (key === 'properties' && isRecord(child)) {
      transformed = materializeSchemaMap(child, pointer + '/properties', documentUri, imports, mappings, namespaceRoot, capabilities);
    } else if (key === 'additionalProperties' && isRecord(child)) {
      transformed = materializeSchemaNode(child, pointer + '/additionalProperties', documentUri, imports, mappings, namespaceRoot, capabilities);
    } else if (key === 'items' || key === 'values') {
      transformed = materializeSchemaValue(child, pointer + '/' + key, documentUri, imports, mappings, namespaceRoot, capabilities);
    } else if (key === 'choices' && isRecord(child)) {
      transformed = materializeSchemaMap(child, pointer + '/choices', documentUri, imports, mappings, namespaceRoot, capabilities);
    } else if (capabilities.validationActive && (key === 'contains' || key === 'propertyNames' || key === 'keyNames' || key === 'has')) {
      transformed = materializeSchemaValue(child, pointer + '/' + key, documentUri, imports, mappings, namespaceRoot, capabilities);
    } else if (capabilities.validationActive && (key === 'patternProperties' || key === 'patternKeys') && isRecord(child)) {
      transformed = materializeSchemaMap(child, pointer + '/' + key, documentUri, imports, mappings, namespaceRoot, capabilities);
    } else if (capabilities.conditionalCompositionActive && (key === 'allOf' || key === 'anyOf' || key === 'oneOf' || key === 'not' || key === 'if' || key === 'then' || key === 'else')) {
      transformed = materializeSchemaValue(child, pointer + '/' + key, documentUri, imports, mappings, namespaceRoot, capabilities);
    } else if (capabilities.relationsActive && key === 'relations' && isRecord(child)) {
      transformed = materializeRelationMap(child, documentUri, imports, mappings);
    }
    defineOwnProperty(result, key, transformed);
  }
  return result;
}

function materializeNamespace(
  value: Readonly<Record<string, unknown>>,
  pointer: string,
  documentUri: string,
  imports: readonly ImportProvenance[],
  mappings: ReadonlyMap<string, string>,
  namespaceRoot: Readonly<Record<string, unknown>>,
  capabilities: ReturnType<typeof resolveCapabilities>
): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  const namespace = capabilities.importActive && activeNamespacePointer(namespaceRoot, pointer);
  for (const [key, child] of Object.entries(value)) {
    if (namespace && (key === '$import' || key === '$importdefs')) continue;
    if (key === 'definitions' && isRecord(child)) {
      defineOwnProperty(result, key, materializeNamespace(child, pointer + '/definitions', documentUri, imports, mappings, namespaceRoot, capabilities));
    } else if (isRecord(child)) {
      const childPointer = pointer + '/' + escapePointer(key);
      defineOwnProperty(result, key, isSchemaDeclaration(child)
        ? materializeSchemaNode(child, childPointer, documentUri, imports, mappings, namespaceRoot, capabilities)
        : materializeNamespace(child, childPointer, documentUri, imports, mappings, namespaceRoot, capabilities));
    } else {
      defineOwnProperty(result, key, child);
    }
  }
  return result;
}

function materializeSchemaMap(
  value: Readonly<Record<string, unknown>>,
  pointer: string,
  documentUri: string,
  imports: readonly ImportProvenance[],
  mappings: ReadonlyMap<string, string>,
  namespaceRoot: Readonly<Record<string, unknown>>,
  capabilities: ReturnType<typeof resolveCapabilities>
): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    defineOwnProperty(result, key, isRecord(child)
      ? materializeSchemaNode(child, pointer + '/' + escapePointer(key), documentUri, imports, mappings, namespaceRoot, capabilities)
      : child);
  }
  return result;
}

function materializeSchemaValue(
  value: unknown,
  pointer: string,
  documentUri: string,
  imports: readonly ImportProvenance[],
  mappings: ReadonlyMap<string, string>,
  namespaceRoot: Readonly<Record<string, unknown>>,
  capabilities: ReturnType<typeof resolveCapabilities>
): unknown {
  if (Array.isArray(value)) {
    return value.map((child, index) => isRecord(child)
      ? materializeSchemaNode(child, pointer + '/' + index, documentUri, imports, mappings, namespaceRoot, capabilities)
      : child);
  }
  return isRecord(value)
    ? materializeSchemaNode(value, pointer, documentUri, imports, mappings, namespaceRoot, capabilities)
    : value;
}

function materializeTypeValue(
  value: unknown,
  pointer: string,
  documentUri: string,
  imports: readonly ImportProvenance[],
  mappings: ReadonlyMap<string, string>,
  namespaceRoot: Readonly<Record<string, unknown>>,
  capabilities: ReturnType<typeof resolveCapabilities>
): unknown {
  if (isTypeReference(value)) return materializeTypeReference(value, documentUri, imports, mappings);
  if (!Array.isArray(value)) return value;
  return value.map((entry, index) => {
    if (isTypeReference(entry)) return materializeTypeReference(entry, documentUri, imports, mappings);
    return isRecord(entry)
      ? materializeSchemaNode(entry, pointer + '/' + index, documentUri, imports, mappings, namespaceRoot, capabilities)
      : entry;
  });
}

function materializeTypeReference(
  value: Readonly<Record<string, unknown>>,
  documentUri: string,
  imports: readonly ImportProvenance[],
  mappings: ReadonlyMap<string, string>
): Readonly<Record<string, unknown>> {
  if (typeof value.$ref !== 'string') return value;
  const reference = rewriteReference(value.$ref, documentUri, imports, mappings);
  return reference === value.$ref ? value : { ...value, $ref: reference };
}

function materializeRelationMap(
  value: Readonly<Record<string, unknown>>,
  documentUri: string,
  imports: readonly ImportProvenance[],
  mappings: ReadonlyMap<string, string>
): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const [name, relation] of Object.entries(value)) {
    if (!isRecord(relation)) {
      defineOwnProperty(result, name, relation);
      continue;
    }
    const transformed: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(relation)) {
      defineOwnProperty(transformed, key, (key === 'targettype' || key === 'qualifiertype') && isTypeReference(child)
        ? materializeTypeReference(child, documentUri, imports, mappings)
        : child);
    }
    defineOwnProperty(result, name, transformed);
  }
  return result;
}

function rewriteReferenceValue(
  value: unknown,
  documentUri: string,
  imports: readonly ImportProvenance[],
  mappings: ReadonlyMap<string, string>
): unknown {
  if (typeof value === 'string') return rewriteReference(value, documentUri, imports, mappings);
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return value.map((entry) => rewriteReference(entry, documentUri, imports, mappings));
  }
  return value;
}

function rewriteReference(
  reference: string,
  documentUri: string,
  imports: readonly ImportProvenance[],
  mappings: ReadonlyMap<string, string>
): string {
  const pointer = referencePointer(reference);
  if (pointer === undefined) return reference;
  const mapped = mappings.get(materializationMappingKey(importScopeKey(imports), documentUri, pointer));
  return mapped === undefined ? reference : '#' + mapped;
}

function isTypeReference(value: unknown): value is Readonly<Record<string, unknown>> {
  return isRecord(value) && typeof value.$ref === 'string' &&
    Object.keys(value).every((key) => key === '$ref' || key === 'description') &&
    (value.description === undefined || typeof value.description === 'string');
}

function pointerVisibleAtImport(location: ResolvedSchemaLocation, importIndex: number): string | undefined {
  let pointer = location.sourcePointer;
  if (pointer === '') {
    if (typeof location.schema.name !== 'string') return undefined;
    pointer = '/' + escapePointer(location.schema.name);
  }
  for (let index = 0; index <= importIndex; index++) {
    const origin = location.imports[index];
    if (!origin) return undefined;
    const marker = origin.importPointer.lastIndexOf('/$');
    if (marker < 0) return undefined;
    const namespacePointer = origin.importPointer.slice(0, marker);
    const destination = namespacePointer === '' || namespacePointer === '/definitions' ? '/definitions' : namespacePointer;
    if (!pointer.startsWith('/definitions/')) {
      if (origin.keyword !== '$import') return undefined;
      pointer = destination + pointer;
    } else {
      pointer = destination + pointer.slice('/definitions'.length);
    }
  }
  return pointer;
}

function importScopeKey(imports: readonly ImportProvenance[]): string {
  return imports.map((origin) => [origin.importSource, origin.importPointer, origin.keyword].join('\u0001')).join('\u0002');
}

function materializationMappingKey(scope: string, documentUri: string, sourcePointer: string): string {
  return scope + '\u0000' + canonicalUri(documentUri) + '#' + sourcePointer;
}

function activeNamespacePointer(root: Readonly<Record<string, unknown>>, pointer: string): boolean {
  if (pointer === '') return true;
  if (pointer === '/definitions') return isRecord(root.definitions);
  if (!pointer.startsWith('/definitions/') || !isRecord(root.definitions)) return false;
  let current: unknown = root.definitions;
  for (const part of pointer.slice('/definitions/'.length).split('/').map(unescapePointer)) {
    if (!isRecord(current)) return false;
    current = ownValue(current, part);
    if (!isRecord(current) || validCoreTypeValue(current.type)) return false;
  }
  return true;
}

function defineOwnProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}

function importPointer(namespacePointer: string, keyword: '$import' | '$importdefs'): string {
  return namespacePointer === '' ? '/' + keyword : namespacePointer + '/' + keyword;
}

function parserDualImportDiagnostic(document: ResolvedSchemaDocument, pointer: string): Diagnostic {
  const existing = document.diagnostics?.find((diagnostic) =>
    diagnostic.code === DUAL_IMPORT_DIAGNOSTIC_CODE && diagnostic.location?.pointer === pointer);
  return existing ?? {
    code: DUAL_IMPORT_DIAGNOSTIC_CODE,
    message: DUAL_IMPORT_DIAGNOSTIC_MESSAGE,
    severity: 'error',
    location: { uri: document.uri, pointer }
  };
}

function uniqueImportCollisionEntries(collisions: readonly ResolvedSchemaImportCollision[]): readonly ResolvedSchemaImportCollision[] {
  const seen = new Set<string>();
  return collisions.filter((collision) => {
    const key = `${canonicalUri(collision.documentUri)}#${collision.namespacePointer}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueDiagnosticsEntries(diagnostics: readonly Diagnostic[]): readonly Diagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const location = diagnostic.location;
    const key = [diagnostic.code, diagnostic.message, location?.uri ?? '', location?.pointer ?? ''].join('\u0000');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatImportCollision(collision: ResolvedSchemaImportCollision): string {
  const imports = collision.imports.map((entry) =>
    `${entry.importPointer} (${entry.keyword}${entry.importSource === undefined ? '' : `: ${entry.importSource}`})`).join(', ');
  return `${collision.documentUri}#${collision.namespacePointer} (${imports}): ${collision.diagnostic.message}`;
}

function formatCollision(collision: ResolvedSchemaCollision): string {
  const declarations = collision.locations.map((location) => {
    const origin = location.imports.length === 0
      ? `${location.documentUri}#${location.sourcePointer}`
      : `${location.documentUri}#${location.sourcePointer} via ${location.imports.map((entry) => entry.importPointer).join(' -> ')}`;
    return origin;
  }).join(', ');
  return `${collision.effectivePointer} (${declarations})`;
}

function setPointerValue(root: Record<string, unknown>, pointer: string, value: unknown): void {
  const tokens = pointer.slice(1).split('/').map(unescapePointer);
  if (tokens.length < 2 || tokens[0] !== 'definitions') return;
  let current = root;
  for (const token of tokens.slice(0, -1)) {
    const existing = Object.prototype.hasOwnProperty.call(current, token) ? current[token] : undefined;
    if (isRecord(existing)) current = existing;
    else {
      const next: Record<string, unknown> = {};
      defineOwnProperty(current, token, next);
      current = next;
    }
  }
  const leaf = tokens[tokens.length - 1];
  if (leaf !== undefined && !Object.prototype.hasOwnProperty.call(current, leaf)) defineOwnProperty(current, leaf, value);
}
export function referencePointer(reference: string): string | undefined {
  if (!reference.startsWith('#')) return undefined;
  try {
    const pointer = decodeURIComponent(reference.slice(1));
    return (pointer === '' || pointer.startsWith('/')) && !/~(?:[^01]|$)/.test(pointer) ? pointer : undefined;
  } catch {
    return undefined;
  }
}

function hasType(value: Readonly<Record<string, unknown>>): boolean {
  return validCoreTypeValue(value.type) && coreTypeReferences(value.type).every((reference) => referencePointer(reference) !== undefined);
}

function isCompositionDeclaration(value: Readonly<Record<string, unknown>>): boolean {
  return ['allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else'].some((keyword) => Object.prototype.hasOwnProperty.call(value, keyword));
}

function isSchemaDeclaration(value: Readonly<Record<string, unknown>>): boolean {
  if (Object.prototype.hasOwnProperty.call(value, 'type')) return true;
  if (typeof value.$ref === 'string' || typeof value.$extends === 'string' || Array.isArray(value.$extends)) return true;
  return [
    'definitions', 'properties', 'items', 'values', 'choices',
    'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else',
    'contains', 'propertyNames', 'keyNames', 'has', 'patternProperties', 'patternKeys'
  ].some((keyword) => Object.prototype.hasOwnProperty.call(value, keyword));
}
function pruneDanglingLocalTypeReferences(declarations: Map<string, ResolvedSchemaLocation[]>, documentUri: string): void {
  let changed: boolean;
  do {
    changed = false;
    for (const [pointer, locations] of declarations) {
      const retained = locations.filter((location) => {
        if (location.documentUri !== documentUri || location.imports.length > 0) return true;
        return coreTypeReferences(location.schema.type).every((reference) => {
          const target = referencePointer(reference);
          return target !== undefined && declarations.get(target)?.length === 1;
        });
      });
      if (retained.length === locations.length) continue;
      changed = true;
      if (retained.length === 0) declarations.delete(pointer);
      else declarations.set(pointer, retained);
    }
  } while (changed);
}
function coreTypeReferences(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(coreTypeReferences);
  if (!isRecord(value)) return [];
  if (typeof value.$ref === 'string') return [value.$ref];
  const references = coreTypeReferences(value.type);
  if (isRecord(value.items)) references.push(...coreTypeReferences(value.items.type));
  if (isRecord(value.values)) references.push(...coreTypeReferences(value.values.type));
  return references;
}
function directTypeReference(value: unknown): string | undefined {
  return isRecord(value) && Object.keys(value).every((key) => key === '$ref' || key === 'description') &&
    typeof value.$ref === 'string' ? value.$ref : undefined;
}
function baseReferences(schema: Readonly<Record<string, unknown>>): readonly string[] {
  return typeof schema.$extends === 'string' ? [schema.$extends] : stringArray(schema.$extends);
}
function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : [];
}
function locationIdentity(location: ResolvedSchemaLocation): string {
  return `${canonicalUri(location.documentUri)}#${location.sourcePointer}`;
}
function sameLocation(left: ResolvedSchemaLocation, right: ResolvedSchemaLocation): boolean {
  return canonicalUri(left.documentUri) === canonicalUri(right.documentUri) && left.sourcePointer === right.sourcePointer;
}
function schemaChildLocation(location: ResolvedSchemaLocation, suffix: string, schema: Readonly<Record<string, unknown>>): ResolvedSchemaLocation {
  return {
    ...location,
    sourcePointer: `${location.sourcePointer}/${suffix}`,
    effectivePointer: `${location.effectivePointer}/${suffix}`,
    schema
  };
}
function unescapePointer(value: string): string { return value.replace(/~1/g, '/').replace(/~0/g, '~'); }
function pointerValue(root: unknown, pointer: string): unknown {
  if (pointer === '') return root;
  let current = root;
  for (const token of pointer.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, token)) return undefined;
    current = current[token];
  }
  return current;
}
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function ownValue(value: Readonly<Record<string, unknown>>, key: string): unknown { return Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined; }
function escapePointer(value: string): string { return value.replace(/~/g, '~0').replace(/\//g, '~1'); }
function canonicalUri(value: string): string { try { const uri = new URL(value); uri.hash = ''; return uri.href; } catch { return value; } }
function resolveUri(base: string, source: string): string { try { return new URL(source.split('#', 1)[0] ?? source, base).href; } catch { return source; } }
