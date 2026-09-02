import { validCoreTypeValue } from '../parser.js';
import { resolveCapabilities } from '../capabilities.js';

export interface ResolvedSchemaDocument {
  readonly uri: string;
  readonly document: Readonly<Record<string, unknown>>;
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

export interface ResolvedSchemaOptions {
  readonly documentUri?: string;
  readonly resolvedDocuments?: readonly ResolvedSchemaDocument[];
}

interface IndexedDocument {
  readonly declarations: ReadonlyMap<string, readonly ResolvedSchemaLocation[]>;
  readonly indeterminate: boolean;
}

export class ResolvedSchemaContext {
  private readonly documents = new Map<string, ResolvedSchemaDocument>();
  private readonly ambiguousDocuments = new Set<string>();
  private readonly indexes = new Map<string, IndexedDocument>();
  readonly rootUri: string;

  constructor(readonly root: Readonly<Record<string, unknown>>, options: ResolvedSchemaOptions = {}) {
    this.rootUri = options.documentUri ?? 'memory://root';
    this.add({ uri: this.rootUri, document: root });
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

  get indeterminate(): boolean { return this.index(this.rootUri).indeterminate; }

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
    return undefined;
  }

  private propertyFor(location: ResolvedSchemaLocation, name: string, seen: Set<string>): ResolvedSchemaLocation | undefined {
    const identity = `${locationIdentity(location)}\u0000property:${name}`;
    if (seen.has(identity)) return undefined;
    const nextSeen = new Set(seen).add(identity);
    if (isRecord(location.schema.properties) && isRecord(location.schema.properties[name])) {
      return schemaChildLocation(location, `properties/${escapePointer(name)}`, location.schema.properties[name] as Readonly<Record<string, unknown>>);
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
    if (this.ambiguousDocuments.has(key)) return { declarations: new Map(), indeterminate: true };
    const supplied = this.documents.get(key);
    if (!supplied || stack.includes(key)) return { declarations: new Map(), indeterminate: true };

    const declarations = new Map<string, ResolvedSchemaLocation[]>();
    let indeterminate = false;
    const add = (effectivePointer: string, documentUri: string, sourcePointer: string, schema: unknown, imports: readonly ImportProvenance[]): void => {
      if (!isRecord(schema)) return;
      const entries = declarations.get(effectivePointer) ?? [];
      entries.push({ documentUri, sourcePointer, effectivePointer, schema, imports });
      declarations.set(effectivePointer, entries);
    };

    const visitImports = (candidate: unknown, pointer: string): void => {
      if (!isRecord(candidate)) return;
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
        const destination = pointer === '' || pointer === '/definitions' ? '/definitions' : pointer;
        for (const locations of externalIndex.declarations.values()) for (const location of locations) {
          let suffix: string | undefined;
          if (location.effectivePointer.startsWith('/definitions/')) suffix = location.effectivePointer.slice('/definitions'.length);
          else if (keyword === '$import' && location.effectivePointer === '' && typeof external.document.name === 'string') suffix = `/${escapePointer(external.document.name)}`;
          if (suffix === undefined) continue;
          const effectivePointer = `${destination}${suffix}`;
          const origin: ImportProvenance = {
            documentUri: location.documentUri,
            pointer: location.sourcePointer,
            importSource: source,
            importPointer: pointer === '' ? `/${keyword}` : `${pointer}/${keyword}`,
            keyword
          };
          add(effectivePointer, location.documentUri, location.sourcePointer, location.schema, [...location.imports, origin]);
        }
      }
      for (const [name, child] of Object.entries(candidate)) {
        if (name === 'definitions' && pointer === '') visitImports(child, '/definitions');
        else if (!name.startsWith('$') && (pointer === '/definitions' || pointer.startsWith('/definitions/')) && isRecord(child) && !isSchemaDeclaration(child)) {
          visitImports(child, `${pointer}/${escapePointer(name)}`);
        }
      }
    };
    if (resolveCapabilities(supplied.document).importActive) visitImports(supplied.document, '');

    const visitDefinitions = (candidate: unknown, pointer: string): void => {
      if (!isRecord(candidate)) return;
      for (const [name, declaration] of Object.entries(candidate)) {
        if (name.startsWith('$') || !isRecord(declaration)) continue;
        const declarationPointer = `${pointer}/${escapePointer(name)}`;
        if (hasType(declaration)) {
          declarations.set(declarationPointer, []);
          add(declarationPointer, supplied.uri, declarationPointer, declaration, []);
        } else visitDefinitions(declaration, declarationPointer);
      }
    };
    visitDefinitions(supplied.document.definitions, '/definitions');
    if (hasType(supplied.document)) add('', supplied.uri, '', supplied.document, []);
    pruneDanglingLocalTypeReferences(declarations, supplied.uri);

    const result = { declarations, indeterminate };
    this.indexes.set(key, result);
    return result;
  }
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

function isSchemaDeclaration(value: Readonly<Record<string, unknown>>): boolean {
  return Object.prototype.hasOwnProperty.call(value, 'type') ||
    Object.prototype.hasOwnProperty.call(value, '$ref') ||
    ['allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else'].some((keyword) => Object.prototype.hasOwnProperty.call(value, keyword));
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
function escapePointer(value: string): string { return value.replace(/~/g, '~0').replace(/\//g, '~1'); }
function canonicalUri(value: string): string { try { const uri = new URL(value); uri.hash = ''; return uri.href; } catch { return value; } }
function resolveUri(base: string, source: string): string { try { return new URL(source.split('#', 1)[0] ?? source, base).href; } catch { return source; } }
