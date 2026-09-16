import type { Diagnostic } from '../contracts.js';
import type { CompositionKeyword } from '../composition.js';
import { compositionUnwrapReason } from '../commands.js';
import { COMPOSITION_KEYWORDS, schemaRecord, schemaSummary, schemaValueAt, schemaForm } from '../schema-locations.js';
import type { EvaluationTrace, InstanceValidationResult } from '../phase4/instance-workspace.js';

export interface CompositionReferenceChoice { readonly value: string; readonly label: string; }
export interface CompositionEditorOptions {
  readonly document: unknown;
  readonly targetPointer: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly evaluation?: InstanceValidationResult;
  readonly documentVersion?: number;
  readonly instanceVersion?: number;
  readonly references?: readonly CompositionReferenceChoice[];
  readonly active: boolean;
  readonly addComposerOpen?: boolean;
  readonly statusMessage?: string;
}
const arrays = ['allOf','anyOf','oneOf'] as const;
const branches = ['if','then','else'] as const;
const labels = { allOf:'ALL', anyOf:'ANY', oneOf:'ONE', not:'NOT', if:'IF', then:'THEN', else:'ELSE' } as const;
const descriptions = { allOf:'Every operand constrains the same current instance node.', anyOf:'At least one operand matches the same current instance node.', oneOf:'Exactly one operand matches the same current instance node. This is not Core choice.' };
const e = (text: string): string => text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

export function evaluationTracesAt(result: InstanceValidationResult | undefined, pointer: string, keyword?: string): readonly EvaluationTrace[] {
  const matches: EvaluationTrace[] = [];
  const visit = (trace: EvaluationTrace): void => {
    if (trace.schemaPointer === pointer && (!keyword || trace.keyword === keyword)) { matches.push(trace); if (!keyword) return; }
    trace.children.forEach(visit);
  };
  if (result) visit(result.trace);
  return matches;
}
/** Exact pointers only. Standalone branches are not aliases for an imaginary /if. */
export function evaluationTraceForRule(result: InstanceValidationResult | undefined, pointer: string, keyword: CompositionKeyword): EvaluationTrace | undefined {
  return evaluationTracesAt(result,pointer + '/' + keyword,keyword)[0];
}
/** A presentation projection of Validate. It does not run validation or use parser diagnostics as instance results. */
export function schemaEvaluationResult(options: Pick<CompositionEditorOptions,'evaluation'|'documentVersion'|'instanceVersion'>, pointer: string, keyword?: string): string {
  const result = options.evaluation;
  let traces = evaluationTracesAt(result,pointer,keyword);
  if (!traces.length && keyword === 'schema') traces = evaluationTracesAt(result,pointer);
  const stale = result && ((result.documentVersion !== undefined && options.documentVersion !== undefined && result.documentVersion !== options.documentVersion) || (result.instanceVersion !== undefined && options.instanceVersion !== undefined && result.instanceVersion !== options.instanceVersion));
  const applied = traces.filter(t => t.application !== 'not-applied');
  const state = stale ? 'Stale' : !result || !traces.length ? 'Not run' : !applied.length ? 'Not applied' : applied.some(t => t.status === 'invalid') ? 'invalid' : applied.some(t => t.status === 'indeterminate') ? 'indeterminate' : 'valid';
  const counts = ['valid','invalid','indeterminate'].map(status => applied.filter(t => t.status === status).length + ' ' + status).join(', ') + ', ' + (traces.length - applied.length) + ' Not applied';
  const detail = traces.map(t => (t.instancePointer || '(instance root)') + ': ' + (t.message ?? t.status)).join('; ');
  const text = state + (traces.length > 1 ? ' · ' + traces.length + ' occurrences' : '');
  const attrs = 'class="js-rule-result js-rule-result-' + state.toLowerCase().replace(/ /g,'-') + '" data-evaluation-state="' + state + '" data-evaluation-count="' + traces.length + '"';
  return traces.length ? '<button type="button" ' + attrs + ' data-schema-result="' + e(pointer) + '" title="' + e(counts + '. ' + detail) + '" aria-label="' + e(text + '. Open Validate trace. ' + counts) + '">' + e(text) + '</button>' : '<span ' + attrs + ' title="Run Validate for occurrences of this schema">' + text + '</span>';
}

export function compositionEditorView(options: CompositionEditorOptions): string {
  const schema = schemaValueAt(options.document,options.targetPointer);
  if (!schemaRecord(schema)) return '';
  const keys = COMPOSITION_KEYWORDS.filter(k => Object.hasOwn(schema,k));
  if (!options.active && !keys.length) return '';
  if (!keys.length && !options.addComposerOpen) {
    return '<section class="js-design-section js-composition-editor js-composition-empty" data-composition-editor data-composition-target="'+e(options.targetPointer)+'" data-authored-keywords=""><div class="js-section-head"><div><h2>Rules</h2><span class="js-section-meta">None</span></div><button type="button" data-composition-add-start="'+e(options.targetPointer)+'">Add rule</button></div>'+(options.statusMessage?'<p class="js-inline-status" role="status">'+e(options.statusMessage)+'</p>':'')+'</section>';
  }
  const pointer = options.targetPointer;
  const groups = arrays.filter(k => Object.hasOwn(schema,k)).map(keyword => {
    const value = schema[keyword], validArray = Array.isArray(value);
    const count = validArray ? value.length : 0;
    const malformed = !validArray || !count;
    return '<li class="js-rule-node' + (malformed ? ' js-rule-malformed' : '') + '" data-rule-keyword="' + keyword + '" data-rule-pointer="' + e(pointer+'/'+keyword) + '" data-operand-count="' + count + '"><div class="js-rule-row"><strong class="js-rule-operator" title="' + descriptions[keyword] + '">' + labels[keyword] + '</strong><span class="js-rule-summary">' + count + ' operands · same instance</span>' + schemaEvaluationResult(options,pointer+'/'+keyword,keyword) + (options.active ? menu('Actions for '+labels[keyword]+' rule','<label>Convert<select data-composition-convert data-composition-target="' + e(pointer) + '" data-composition-from="' + keyword + '">' + arrays.map(k => '<option value="'+k+'" '+(k===keyword?'selected':'')+' '+(k!==keyword && Object.hasOwn(schema,k)?'disabled':'')+'>'+labels[k]+'</option>').join('') + '</select></label><button type="button" data-composition-delete-rule="'+keyword+'" data-composition-target="'+e(pointer)+'">Delete rule</button>') : '') + '</div>' + (malformed ? opaque(value,pointer+'/'+keyword,keyword) : '') + (validArray ? '<ol class="js-rule-operands">'+value.map((operand,index) => operandRow(operand,pointer+'/'+keyword+'/'+index,options,keyword,index,count)).join('')+'</ol>' : '') + (options.active && validArray ? '<div class="js-rule-add">'+seedControl(options.references)+'<button type="button" data-composition-add-operand data-composition-target="'+e(pointer)+'" data-composition-keyword="'+keyword+'">Add operand to '+labels[keyword]+'</button></div>' : '')+'</li>';
  });
  if (Object.hasOwn(schema,'not')) groups.push('<li class="js-rule-node" data-rule-keyword="not" data-rule-pointer="'+e(pointer+'/not')+'"><div class="js-rule-row"><strong>NOT</strong><span>Exclude this schema at the same instance node</span>'+schemaEvaluationResult(options,pointer+'/not','not')+(options.active?menu('Actions for NOT rule','<button data-composition-delete-rule="not" data-composition-target="'+e(pointer)+'">Delete rule</button>'):'')+'</div><ol class="js-rule-operands">'+operandRow(schema.not,pointer+'/not',options,'not')+'</ol></li>');
  const authoredBranches = branches.filter(k => Object.hasOwn(schema,k));
  if (authoredBranches.length) groups.push('<li class="js-rule-node js-rule-conditional" data-rule-keyword="conditional" data-conditional-owner="'+e(pointer)+'" data-conditional-keywords="'+authoredBranches.join(' ')+'"><div class="js-rule-row"><strong class="js-rule-operator">CONDITIONAL</strong><span>'+authoredBranches.map(k=>labels[k]).join(' + ')+' · same instance</span>'+(options.active?menu('Actions for conditional','<button data-composition-delete-conditional data-composition-target="'+e(pointer)+'">Delete conditional</button>'):'')+'</div><ol class="js-rule-operands js-rule-branches">'+branches.map(keyword => Object.hasOwn(schema,keyword) ? operandRow(schema[keyword],pointer+'/'+keyword,options,keyword) : '<li class="js-rule-branch-empty js-rule-add" data-branch-keyword="'+keyword+'" data-branch-presence="not-authored"><strong>'+labels[keyword]+'</strong><span>Not authored</span>'+(options.active?seedControl(options.references)+'<button data-composition-add-branch="'+keyword+'" data-composition-target="'+e(pointer)+'">Add '+labels[keyword]+'</button>':'')+'</li>').join('')+'</ol></li>');
  const remaining = COMPOSITION_KEYWORDS.filter(k => !Object.hasOwn(schema,k));
  const add = options.active && remaining.length
    ? options.addComposerOpen
      ? '<div class="js-rule-add js-rule-add-root"><label>Add rule<select data-composition-add-rule-kind aria-label="Rule to add">'+remaining.map(k=>'<option value="'+k+'">'+labels[k]+'</option>').join('')+'</select></label>'+seedControl(options.references)+'<button data-composition-add-rule data-composition-target="'+e(pointer)+'">Add rule</button><button type="button" data-composition-add-cancel>Cancel</button></div>'
      : '<div class="js-rule-add-compact"><button type="button" data-composition-add-start="'+e(pointer)+'">Add rule</button></div>'
    : '';
  const diagnostics = options.diagnostics.filter(d=>d.location?.pointer && keys.some(k=> d.location!.pointer === pointer+'/'+k));
  return '<section class="js-design-section js-composition-editor" data-composition-editor data-composition-target="'+e(pointer)+'" data-authored-keywords="'+keys.join(' ')+'"><div class="js-section-head"><h2>Rules</h2><span>'+keys.length+' authored keywords</span></div>'+(!options.active?'<p class="js-capability-note">Rules are preserved but read-only because Conditional Composition is not active for this document.</p>':'')+(options.statusMessage?'<p class="js-inline-status" role="status">'+e(options.statusMessage)+'</p>':'')+'<ol class="js-rule-list" aria-label="Composition rules">'+(groups.join('')||'<li>No rules constrain this schema.</li>')+'</ol>'+add+(diagnostics.length?'<ul aria-label="Schema diagnostics">'+diagnostics.map(d=>'<li>'+e(d.code+': '+d.message)+'</li>').join('')+'</ul>':'')+'</section>';
}
function operandRow(value: unknown, pointer: string, options: CompositionEditorOptions, keyword: CompositionKeyword, index?: number, count?: number): string {
  const isBranch = branches.includes(keyword as typeof branches[number]);
  const form = schemaForm(value);
  const label = index === undefined ? labels[keyword] : 'Operand '+(index+1);
  const parent = pointer.slice(0,pointer.lastIndexOf('/'));
  const unsafe = compositionUnwrapReason(value);
  const movement = index !== undefined ? '<button data-composition-move="up" data-composition-operand="'+e(pointer)+'" '+(index===0?'disabled':'')+'>Move up (Alt+Up)</button><button data-composition-move="down" data-composition-operand="'+e(pointer)+'" '+(index+1===count?'disabled':'')+'>Move down (Alt+Down)</button><button data-composition-duplicate data-composition-operand="'+e(pointer)+'">Duplicate</button>' : '';
  const schemaActions = schemaRecord(value) ? '<label>Wrap in<select data-composition-wrap-kind><option value="allOf">ALL</option><option value="anyOf">ANY</option><option value="oneOf">ONE</option></select></label><button data-composition-wrap data-composition-operand="'+e(pointer)+'">Wrap</button><button data-composition-negate data-composition-operand="'+e(pointer)+'">Negate</button><button data-composition-unwrap data-composition-operand="'+e(pointer)+'" '+(unsafe?'disabled aria-disabled="true" title="'+e(unsafe)+'"':'')+'>Unwrap</button>'+(unsafe?'<small class="js-unwrap-reason">'+e(unsafe)+'</small>':'') : '';
  const removal = isBranch ? '<button data-composition-remove-branch="'+keyword+'" data-composition-target="'+e(parent)+'">Remove '+label+'</button>' : index === undefined ? '' : '<button data-composition-delete-operand data-composition-operand="'+e(pointer)+'">'+(count===1?'Delete last operand and entire rule':'Delete operand')+'</button>';
  return '<li class="js-rule-operand'+(form.startsWith('legacy')?' js-rule-legacy-ref':'')+(form==='malformed'?' js-rule-malformed':'')+'" data-operand-pointer="'+e(pointer)+'" data-schema-form="'+form+'" '+(isBranch?'data-branch-keyword="'+keyword+'" data-branch-presence="authored"':'')+'><div class="js-rule-operand-row"><span class="js-rule-order">'+label+'</span><span class="js-rule-schema-summary">'+e(schemaSummary(value))+'</span><button type="button" class="js-row-action js-schema-action-icon js-rule-schema-open" data-schema-open="'+e(pointer)+'" aria-label="Open schema '+label+'"><span aria-hidden="true">↗</span></button>'+schemaEvaluationResult(options,pointer,'schema')+(options.active?menu('Actions for '+label,movement+schemaActions+'<button data-composition-source="'+e(pointer)+'">Edit source</button>'+removal):'<button data-composition-source="'+e(pointer)+'">Source</button>')+'</div></li>';
}
function menu(label: string, contents: string): string { return '<details class="js-rule-menu"><summary aria-label="'+e(label)+'">⋯</summary><div>'+contents+'</div></details>'; }
function opaque(value: unknown, pointer: string, keyword: string): string { return '<div class="js-rule-opaque" data-opaque-keyword="'+keyword+'"><span>Malformed / opaque rule; authored source preserved.</span><button data-composition-source="'+e(pointer)+'">Edit source</button><pre>'+e(JSON.stringify(value,null,2))+'</pre></div>'; }
export function seedControl(references: readonly CompositionReferenceChoice[] = []): string {
  const types = ['string','boolean','int32','int64','double','decimal','datetime','duration','uuid','binary','object','tuple','choice','array','set','map','null','any'];
  return '<label>Complete seed<select data-composition-seed-kind aria-label="Complete schema seed"><option value="empty">Empty schema {}</option>'+types.map(t=>'<option value="type:'+t+'">Type · '+t+'</option>').join('')+references.map(r=>'<option value="ref:'+e(r.value)+'">Reference · '+e(r.label)+'</option>').join('')+'<option value="source">Source seed</option></select></label><label data-composition-seed-source-label hidden>Schema source<textarea data-composition-seed-source rows="4" spellcheck="false">{}</textarea></label>';
}
