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
    const matches = this.index(fromDocumentUri).declarations.get(pointer) ?? [];
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return undefined;
    const supplied = this.documents.get(canonicalUri(fromDocumentUri));
    const schema = supplied ? pointerValue(supplied.document, pointer) : undefined;
    return isRecord(schema) ? { documentUri: supplied!.uri, sourcePointer: pointer, effectivePointer: pointer, schema, imports: [] } : undefined;
  }

  get indeterminate(): boolean { return this.index(this.rootUri).indeterminate; }

  private add(document: ResolvedSchemaDocument): void {
    this.documents.set(canonicalUri(document.uri), document);
    if (typeof document.document.$id === 'string') this.documents.set(canonicalUri(document.document.$id), document);
  }

  private index(uri: string, stack: readonly string[] = []): IndexedDocument {
    const key = canonicalUri(uri);
    const cached = this.indexes.get(key);
    if (cached) return cached;
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
        const external = this.documents.get(canonicalUri(resolveUri(supplied.uri, source)));
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
        else if (!name.startsWith('$') && (pointer === '/definitions' || pointer.startsWith('/definitions/'))) visitImports(child, `${pointer}/${escapePointer(name)}`);
      }
    };
    visitImports(supplied.document, '');

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

    const result = { declarations, indeterminate };
    this.indexes.set(key, result);
    return result;
  }
}

export function referencePointer(reference: string): string | undefined {
  if (reference === '#') return '';
  if (!reference.startsWith('#/')) return undefined;
  try { return decodeURIComponent(reference.slice(1)); } catch { return undefined; }
}

function hasType(value: Readonly<Record<string, unknown>>): boolean {
  return typeof value.type === 'string' || isRecord(value.type) || Array.isArray(value.type);
}
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
