import type { OverlayContext } from '../overlay-context.js';
import { type SchemaLocation, type SchemaLocationIndex, type SchemaLocationNavigation, schemaDeclarationLabel, schemaRecord, schemaSummary } from '../schema-locations.js';
import type { CompositionEditorOptions } from './composition-workspace.js';
import { schemaEvaluationResult } from './composition-workspace.js';
const e = (text: string): string => text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
export interface SchemaSheetOptions {
  readonly overlay?: OverlayContext;
  readonly overlayFullSchema?: boolean;
  readonly overlayLocalOnly?: boolean;
  readonly overlayDocument?: unknown;
  readonly index: SchemaLocationIndex;
  readonly navigation: SchemaLocationNavigation;
  readonly source: string;
  readonly knownMembers: ReadonlySet<string>;
}
export function schemaOpenButton(pointer: string, label: string, compact = false): string {
  return '<button type="button" class="'+(compact?'js-row-action js-schema-action-icon js-schema-open-action':'js-schema-action')+'" data-schema-open="'+e(pointer)+'" aria-label="Open local schema '+e(label)+'">'+(compact?'<span aria-hidden="true">↗</span>':'Open schema')+'</button>';
}
export function schemaLocationBar(options: SchemaSheetOptions): string {
  const location = options.navigation.current;
  if (!location) return '';
  const ancestors = options.index.ancestors(location.pointer);
  const pointer = location.pointer || '"" (document root)';
  return '<nav class="js-schema-location-bar" aria-label="Schema location" title="'+e(pointer)+'" data-schema-location-bar data-schema-pointer="'+e(location.pointer)+'" data-schema-relationship="'+e(location.label)+'"><div class="js-location-history"><button type="button" class="js-schema-action js-schema-history-action" data-schema-back '+(!options.navigation.canBack?'disabled':'')+' aria-label="Back to previous schema">Back</button><button type="button" class="js-schema-action js-schema-history-action" data-schema-forward '+(!options.navigation.canForward?'disabled':'')+' aria-label="Forward to next schema">Forward</button></div><ol class="js-schema-breadcrumbs" aria-label="Schema breadcrumbs">'+ancestors.map((item,index)=>'<li '+(index<ancestors.length-2?'class="js-breadcrumb-ancestor"':'')+'><button type="button" class="js-schema-breadcrumb-action" title="'+e(item.pointer || 'Document root')+'" data-schema-breadcrumb="'+e(item.pointer)+'" '+(item.id===location.id?'aria-current="location"':'')+'>'+e(item.label)+'</button></li>').join('')+'</ol><details class="js-schema-location-details"><summary class="js-schema-action" aria-label="Show exact schema pointer">Pointer</summary><div><code dir="ltr" class="js-exact-pointer" data-schema-location-pointer>'+e(pointer)+'</code></div></details><button type="button" class="js-schema-action" data-schema-location-source="'+e(location.pointer)+'">Source</button><button type="button" class="js-schema-action" data-schema-goto aria-label="Go to Schema Location">Go to…</button></nav>';
}
export function schemaDeclarationView(location: SchemaLocation, typeControl: string, metadata: string, evaluation?: CompositionEditorOptions): string {
  const value = location.value;
  const ref = schemaRecord(value) && (typeof value.$ref === 'string' ? value.$ref : schemaRecord(value.type) && typeof value.type.$ref === 'string' ? value.type.$ref : undefined);
  const reference = ref ? '<div class="js-schema-reference"><code dir="ltr" data-schema-reference="'+e(ref)+'">'+e(ref)+'</code><button type="button" class="js-schema-action" data-schema-reference-go="'+e(ref)+'">Go to referenced type</button></div>' : '';
  const heading = metadata
    ? '<div class="js-eyebrow js-schema-heading-anchor" data-schema-heading tabindex="-1">Schema location</div>'
    : '<header class="js-schema-context-header"><div class="js-eyebrow">Nested schema</div><h1 data-schema-heading tabindex="-1">'+e(location.label)+'</h1></header>';
  const localMetadata = !metadata && schemaRecord(value)
    ? '<dl class="js-schema-local-metadata">'+(typeof value.name === 'string'?'<div><dt>Name</dt><dd data-schema-authored-name>'+e(value.name)+'</dd></div>':'')+(typeof value.description === 'string'?'<div><dt>Description</dt><dd data-schema-authored-description>'+e(value.description)+'</dd></div>':'')+'</dl>'
    : '';
  return '<section class="js-design-section js-schema-declaration" data-schema-declaration data-declaration-form="'+location.form+'">'+heading+'<p data-declaration-label>'+e(schemaDeclarationLabel(value))+'</p>'+metadata+localMetadata+typeControl+reference+(evaluation?schemaEvaluationResult(evaluation,location.pointer,'schema'):'')+'</section>';
}
export function schemaChildLocations(options: SchemaSheetOptions, excluded: ReadonlySet<string> = new Set()): string {
  const current = options.navigation.current; if (!current) return '';
  const children = options.index.children(current.pointer).filter(child => child.kind !== 'operand' && child.kind !== 'branch' && child.kind !== 'definition' && !excluded.has(child.pointer));
  return children.length ? '<ul class="js-schema-children" aria-label="Schema-valued children">'+children.map(child=>'<li data-schema-child-kind="'+child.kind+'" data-schema-child-key="'+e(child.key)+'"><strong>'+e(child.label)+'</strong><span>'+e(schemaSummary(child.value))+'</span>'+schemaOpenButton(child.pointer,child.label)+'</li>').join('')+'</ul>' : '';
}
const structural = new Set(['type','$ref','properties','items','values','choices','definitions','allOf','anyOf','oneOf','not','if','then','else']);
export function schemaMemberInventory(location: SchemaLocation, known: ReadonlySet<string>): string {
  if (!schemaRecord(location.value)) return '';
  const entries = Object.entries(location.value).filter(([key]) => !structural.has(key) && !known.has(key));
  return entries.length ? '<details class="js-schema-unsupported-members"><summary>Unsupported source members <span>'+entries.length+'</span></summary><dl class="js-schema-member-inventory" aria-label="Unsupported source members">'+entries.map(([key,value])=>'<div data-schema-member="'+e(key)+'"><dt>'+e(key)+'</dt><dd><pre>'+e(JSON.stringify(value,null,2))+'</pre></dd></div>').join('')+'</dl></details>' : '';
}
