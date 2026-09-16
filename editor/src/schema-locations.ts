import type { TextRange } from './contracts.js';
import type { NormalizedDocument } from './model.js';

export const COMPOSITION_KEYWORDS = ['allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else'] as const;
export type SchemaRelationshipKind = 'root' | 'definition' | 'property' | 'tuple-member' | 'items' | 'values' | 'choice' | 'operand' | 'branch' | 'schema-keyword' | 'type-member';
export type SchemaForm = 'explicit-type' | 'explicit-any' | 'no-type' | 'empty' | 'typed-reference' | 'legacy-reference' | 'legacy-reference-rules' | 'malformed';
export interface SchemaLocation {
  readonly id: string;
  readonly pointer: string;
  readonly parentId?: string;
  readonly parentPointer?: string;
  readonly kind: SchemaRelationshipKind;
  readonly key: string;
  readonly label: string;
  readonly form: SchemaForm;
  readonly range?: TextRange;
  readonly selectable: boolean;
  readonly sourceSelectable: boolean;
  readonly value: unknown;
}
/** Simultaneous, longest-prefix pointer rewrites. A missing destination removes an identity. */
export interface PointerTransformation { readonly from: string; readonly to?: string; }
export function transformSchemaPointer(pointer: string, transforms: readonly PointerTransformation[]): string | undefined {
  const match = transforms.filter(t => pointer === t.from || pointer.startsWith(t.from + '/')).sort((a,b) => b.from.length - a.from.length)[0];
  return match ? match.to === undefined ? undefined : match.to + pointer.slice(match.from.length) : pointer;
}
export function schemaRecord(value: unknown): value is Readonly<Record<string, unknown>> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
export function schemaPointerToken(value: string): string { return value.replace(/~/g, '~0').split('/').join('~1'); }
export function schemaValueAt(document: unknown, pointer: string): unknown {
  return pointer === '' ? document : pointer.slice(1).split('/').reduce<unknown>((value, token) => value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[token.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined, document);
}
export function schemaForm(value: unknown): SchemaForm {
  if (!schemaRecord(value)) return 'malformed';
  if (Object.hasOwn(value, '$ref')) return typeof value.$ref !== 'string' ? 'malformed' : COMPOSITION_KEYWORDS.some(k => Object.hasOwn(value,k)) ? 'legacy-reference-rules' : 'legacy-reference';
  if (!Object.hasOwn(value, 'type')) return Object.keys(value).length ? 'no-type' : 'empty';
  if (schemaRecord(value.type)) return typeof value.type.$ref === 'string' ? 'typed-reference' : 'malformed';
  if (value.type === 'any') return 'explicit-any';
  return typeof value.type === 'string' || Array.isArray(value.type) && value.type.length > 0 ? 'explicit-type' : 'malformed';
}
export function schemaDeclarationLabel(value: unknown): string {
  switch (schemaForm(value)) {
    case 'malformed': return 'Malformed / opaque schema';
    case 'legacy-reference-rules': return 'Legacy schema form — direct $ref with sibling rules';
    case 'legacy-reference': return 'Legacy schema form — direct $ref';
    case 'typed-reference': return 'Canonical typed reference';
    case 'explicit-any': return 'Explicit any';
    case 'no-type': case 'empty': return 'No declared type';
    default: return 'Declared type: ' + (schemaRecord(value) && typeof value.type === 'string' ? value.type : 'type union');
  }
}
export function schemaSummary(value: unknown, contextual = false): string {
  const form = schemaForm(value);
  if (!schemaRecord(value)) return 'Malformed / opaque ' + (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);
  const ref = typeof value.$ref === 'string' ? value.$ref : schemaRecord(value.type) && typeof value.type.$ref === 'string' ? value.type.$ref : undefined;
  const kind = form === 'empty' ? (contextual ? 'Constraint set · No additional constraints' : 'Empty schema {}') : form === 'no-type' ? contextual ? 'Constraint set' : (COMPOSITION_KEYWORDS.some(k => Object.hasOwn(value,k)) ? 'Composition-only · No declared type' : 'No declared type') : ref ? schemaDeclarationLabel(value) + ' · ' + ref : schemaDeclarationLabel(value);
  const badges = COMPOSITION_KEYWORDS.filter(k => Object.hasOwn(value,k)).map(k => ({ allOf:'ALL', anyOf:'ANY', oneOf:'ONE', not:'NOT', if:'IF', then:'THEN', else:'ELSE' })[k]);
  const shape = schemaRecord(value.properties) ? ' · ' + Object.keys(value.properties).length + (value.type === 'tuple' ? ' tuple members' : ' properties') : schemaRecord(value.choices) ? ' · ' + Object.keys(value.choices).length + ' choices' : Object.hasOwn(value,'items') ? ' · Items' : Object.hasOwn(value,'values') ? ' · Values' : '';
  return kind + shape + (badges.length ? ' · ' + badges.join(' + ') : '');
}

export interface SchemaKeywordRegistration { readonly keyword: string; readonly shape: 'single' | 'map' | 'array'; }
/** Structural ownership only: annotation/default/example/unknown payloads are never searched. */
export const BUILTIN_SCHEMA_KEYWORDS: readonly SchemaKeywordRegistration[] = [
  ...['contains','propertyNames','keyNames','has'].map(keyword => ({ keyword, shape: 'single' as const })),
  ...['patternProperties','patternKeys'].map(keyword => ({ keyword, shape: 'map' as const })),
];
export interface LocationIdentitySnapshot { readonly identities: readonly { readonly pointer: string; readonly id: string }[]; }
export class SchemaLocationIndex {
  private sequence = 0;
  private byPointer = new Map<string, SchemaLocation>();
  private byId = new Map<string, SchemaLocation>();
  private registrations = [...BUILTIN_SCHEMA_KEYWORDS];
  private lastValue: unknown;
  private lastModel?: NormalizedDocument;
  register(keyword: SchemaKeywordRegistration): void { this.registrations = [...this.registrations.filter(k => k.keyword !== keyword.keyword), keyword]; this.lastModel = undefined; }
  get locations(): readonly SchemaLocation[] { return [...this.byPointer.values()]; }
  at(pointer: string): SchemaLocation | undefined { return this.byPointer.get(pointer); }
  identity(id: string | undefined): SchemaLocation | undefined { return id === undefined ? undefined : this.byId.get(id); }
  children(pointer: string): readonly SchemaLocation[] { return this.locations.filter(l => l.parentPointer === pointer); }
  ancestors(pointer: string): readonly SchemaLocation[] {
    const result: SchemaLocation[] = []; let location = this.at(pointer);
    while (location) { result.unshift(location); location = this.identity(location.parentId); }
    return result;
  }
  nearest(pointer: string): SchemaLocation | undefined {
    let current = pointer;
    while (!this.at(current) && current) current = current.slice(0,current.lastIndexOf('/'));
    return this.at(current);
  }
  /** Source edits carry no command identity. Match unchanged operand source values; discard ambiguous identities rather than selecting a different operand. */
  sourceTransforms(value: unknown): readonly PointerTransformation[] {
    const transforms: PointerTransformation[] = [];
    for (const location of this.locations.filter(l=>schemaRecord(l.value)).sort((a,b)=>a.pointer.length-b.pointer.length)) {
      const destination=transformSchemaPointer(location.pointer,transforms);
      if(destination===undefined)continue;
      const next=schemaValueAt(value,destination);if(!schemaRecord(next))continue;
      for(const keyword of ['allOf','anyOf','oneOf']) {
        const oldArray=(location.value as Record<string,unknown>)[keyword],newArray=next[keyword];
        if(!Array.isArray(oldArray)||!Array.isArray(newArray)||JSON.stringify(oldArray)===JSON.stringify(newArray))continue;
        const used=new Set<number>();
        const mappings=oldArray.map(operand=>{const fingerprint=JSON.stringify(operand);const index=newArray.findIndex((candidate,i)=>!used.has(i)&&JSON.stringify(candidate)===fingerprint);if(index>=0)used.add(index);return index;});
        const moves=mappings.some((index,i)=>index>=0&&index!==i)||oldArray.length!==newArray.length;
        if(!moves)continue;
        mappings.forEach((index,i)=>transforms.push({from:location.pointer+'/'+keyword+'/'+i,...(index<0?{}:{to:destination+'/'+keyword+'/'+index})}));
      }
    }
    return transforms;
  }
  capture(): LocationIdentitySnapshot { return { identities: this.locations.map(({pointer,id}) => ({pointer,id})) }; }
  refresh(value: unknown, model?: NormalizedDocument, transforms: readonly PointerTransformation[] = [], identities?: LocationIdentitySnapshot): void {
    if (value === this.lastValue && model === this.lastModel && !transforms.length && !identities) return;
    const prior = new Map((identities?.identities ?? this.locations).flatMap(l => {
      const pointer = transformSchemaPointer(l.pointer, transforms); return pointer === undefined ? [] : [[pointer,l.id] as const];
    }));
    this.byPointer.clear(); this.byId.clear(); this.lastValue = value; this.lastModel = model;
    const ranges = new Map(model?.nodes.map(n => [n.pointer,n.range]));
    const add = (candidate: unknown, pointer: string, kind: SchemaRelationshipKind, key: string, label: string, parent?: string): void => {
      if (this.byPointer.has(pointer)) return;
      const range = ranges.get(pointer);
      const location: SchemaLocation = { id: prior.get(pointer) ?? 'schema-' + ++this.sequence, pointer, kind, key, label, parentPointer: parent, parentId: parent === undefined ? undefined : this.at(parent)?.id, form: schemaForm(candidate), range, selectable: true, sourceSelectable: range !== undefined, value: candidate };
      this.byPointer.set(pointer, location); this.byId.set(location.id,location);
      if (!schemaRecord(candidate)) return;
      const single = (keyword: string, childKind: SchemaRelationshipKind, childLabel: string): void => { if (Object.hasOwn(candidate,keyword)) add(candidate[keyword], pointer + '/' + schemaPointerToken(keyword), childKind, keyword, childLabel, pointer); };
      const map = (keyword: string, childKind: SchemaRelationshipKind, prefix: string): void => { const entries = candidate[keyword]; if (schemaRecord(entries)) for (const [name, child] of Object.entries(entries)) add(child, pointer + '/' + keyword + '/' + schemaPointerToken(name), childKind, name, prefix + name, pointer); };
      map('properties', candidate.type === 'tuple' ? 'tuple-member' : 'property', candidate.type === 'tuple' ? 'Tuple member ' : 'Property ');
      single('items','items','Items'); single('values','values','Values'); map('choices','choice','Choice ');
      if (schemaRecord(candidate.additionalProperties)) single('additionalProperties','schema-keyword','Additional properties');
      for (const keyword of COMPOSITION_KEYWORDS) {
        const operand = candidate[keyword]; if (!Object.hasOwn(candidate,keyword)) continue;
        if (keyword === 'allOf' || keyword === 'anyOf' || keyword === 'oneOf') {
          if (Array.isArray(operand)) operand.forEach((child,index) => add(child, pointer + '/' + keyword + '/' + index, 'operand', keyword + ':' + index, ({allOf:'ALL',anyOf:'ANY',oneOf:'ONE'})[keyword] + ' operand ' + (index+1), pointer));
        } else single(keyword, keyword === 'not' ? 'operand' : 'branch', keyword.toUpperCase());
      }
      for (const registration of this.registrations) {
        if (registration.shape === 'single') single(registration.keyword,'schema-keyword',registration.keyword);
        else if (registration.shape === 'map') map(registration.keyword,'schema-keyword',registration.keyword + ' ');
        else if (Array.isArray(candidate[registration.keyword])) (candidate[registration.keyword] as unknown[]).forEach((child,index) => add(child,pointer + '/' + registration.keyword + '/' + index,'schema-keyword',registration.keyword + ':' + index,registration.keyword + ' ' + (index+1),pointer));
      }
      if (Array.isArray(candidate.type)) candidate.type.forEach((child,index) => { if (schemaRecord(child) && !Object.hasOwn(child,'$ref')) add(child,pointer + '/type/' + index,'type-member',String(index),'Type union member ' + (index+1),pointer); });
      definitions(candidate.definitions, pointer + '/definitions', pointer);
    };
    const isDeclaration = (entry: Readonly<Record<string, unknown>>): boolean => ['type','$ref','properties','items','values','choices','name',...COMPOSITION_KEYWORDS,...this.registrations.map(k => k.keyword)].some(k => Object.hasOwn(entry,k));
    const definitions = (entries: unknown, pointer: string, parent: string): void => {
      if (!schemaRecord(entries)) return;
      for (const [name, child] of Object.entries(entries)) {
        if (name === '$import' || name === '$importdefs') continue;
        const childPointer = pointer + '/' + schemaPointerToken(name);
        if (!schemaRecord(child) || isDeclaration(child)) add(child,childPointer,'definition',name,'Definition ' + name,parent);
        else definitions(child,childPointer,parent);
      }
    };
    add(value,'','root','','Inline root');
  }
}

export interface SchemaNavigationEntry { readonly id: string; readonly focusId?: string; }
export interface SchemaNavigationSnapshot { readonly identities: LocationIdentitySnapshot; readonly history: readonly SchemaNavigationEntry[]; readonly cursor: number; }
/** Design location history is distinct from selection of a control within the current sheet. */
export class SchemaLocationNavigation {
  private history: SchemaNavigationEntry[] = [];
  private cursor = -1;
  constructor(readonly index: SchemaLocationIndex) {}
  get current(): SchemaLocation | undefined { return this.index.identity(this.history[this.cursor]?.id); }
  get canBack(): boolean { return this.cursor > 0; }
  get canForward(): boolean { return this.cursor + 1 < this.history.length; }
  get focusId(): string | undefined { return this.history[this.cursor]?.focusId; }
  open(pointer: string, invokedBy?: string): boolean {
    const location = this.index.at(pointer); if (!location) return false;
    if (this.current?.id === location.id) return true;
    if (this.cursor >= 0 && invokedBy) this.history[this.cursor] = { ...this.history[this.cursor]!, focusId: invokedBy };
    this.history = this.history.slice(0,this.cursor+1); this.history.push({id:location.id}); this.cursor++;
    return true;
  }
  back(): SchemaLocation | undefined { if (this.canBack) this.cursor--; return this.current; }
  forward(): SchemaLocation | undefined { if (this.canForward) this.cursor++; return this.current; }
  capture(): SchemaNavigationSnapshot { return { identities:this.index.capture(), history:this.history.map(e => ({...e})), cursor:this.cursor }; }
  restore(state: SchemaNavigationSnapshot, value: unknown, model?: NormalizedDocument): void { this.index.refresh(value,model,[],state.identities); this.history = [...state.history]; this.cursor = state.cursor; }
  reconcile(fallback = ''): void {
    const before = this.history.slice(0,this.cursor+1).filter(e => this.index.identity(e.id));
    const after = this.history.slice(this.cursor+1).filter(e => this.index.identity(e.id));
    this.history = [...before,...after]; this.cursor = before.length-1;
    if (!this.current) this.open(this.index.nearest(fallback)?.pointer ?? '');
  }
  reset(): void { this.history = []; this.cursor = -1; }
}
