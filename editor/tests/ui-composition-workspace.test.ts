import { describe,expect,it } from 'vitest';
import { compositionEditorView, evaluationTraceForRule } from '../src/ui/composition-workspace.js';
import { InstanceWorkspace } from '../src/phase4/instance-workspace.js';
const validation='https://json-structure.org/meta/validation/v0/#';
describe('compact Rules renderer units — not navigation acceptance',()=>{
  it('renders only local groups and summaries, with drill-in controls rather than mini editors',()=>{
    const document={$schema:validation,allOf:[{anyOf:[{type:'array',items:{if:{type:'string'},then:{}}}]}],oneOf:[{type:'tuple',properties:{x:{type:'int32'}},tuple:['x']},{type:'choice',choices:{A:{type:'null'}}}],not:{},if:{},then:{},else:{}};
    const html=compositionEditorView({document,targetPointer:'',diagnostics:[],active:true});
    for(const label of ['ALL','ONE','NOT','CONDITIONAL','IF','THEN','ELSE'])expect(html).toContain(label);
    expect(html).toContain('data-schema-open="/allOf/0"');
    expect(html).not.toContain('data-schema-open="/allOf/0/anyOf/0"');
    expect(html).not.toMatch(/js-rule-disclosure|js-rule-nested|js-composition-schema-editor/);
    expect(html).toContain('Declared type: tuple');expect(html).toContain('Declared type: choice');
  });
  it('represents standalone THEN and ELSE without synthetic rule pointers and keeps absent branches explicit',()=>{
    const html=compositionEditorView({document:{$schema:validation,then:{},else:7},targetPointer:'',diagnostics:[],active:true});
    expect(html).not.toContain('data-rule-pointer="/if"');expect(html).not.toContain('data-operand-pointer="/if"');
    expect(html).toContain('data-operand-pointer="/then"');expect(html).toContain('data-operand-pointer="/else"');
    expect(html).toContain('Not authored');expect(html).toContain('Malformed / opaque number');
  });
  it('preserves malformed groups, legacy refs, and disables unsafe unwrap with a reason',()=>{
    const html=compositionEditorView({document:{$schema:validation,allOf:[{$ref:'#/definitions/Base',oneOf:[{}]},{type:'string',allOf:[{}]}],anyOf:[],oneOf:{}},targetPointer:'',diagnostics:[],active:true});
    expect(html).toContain('Legacy schema form');expect(html).toContain('data-opaque-keyword="anyOf"');expect(html).toContain('data-opaque-keyword="oneOf"');
    expect(html).toContain('Unsafe unwrap: would discard sibling');expect(html).toContain('disabled aria-disabled="true"');
  });
  it('projects only Validate results, with exact standalone and not-applied states',()=>{
    const document={$schema:validation,type:'string',if:{const:'yes'},then:{},else:{}};
    const result=new InstanceWorkspace(document,'yes',{documentVersion:1,instanceVersion:1}).validate();
    const html=compositionEditorView({document,targetPointer:'',diagnostics:[],active:true,evaluation:result,documentVersion:1,instanceVersion:1});
    expect(html).toContain('Not applied');expect(html).toContain('data-schema-result="/then"');
    const standalone=new InstanceWorkspace({$schema:validation,then:{}},{}).validate();
    expect(evaluationTraceForRule(standalone,'','then')?.schemaPointer).toBe('/then');
    expect(evaluationTraceForRule(standalone,'','then')?.status).toBe('indeterminate');
    expect(evaluationTraceForRule(standalone,'','if')).toBeUndefined();
    expect(compositionEditorView({document,targetPointer:'',diagnostics:[],active:true,evaluation:result,documentVersion:2,instanceVersion:1})).toContain('Stale');
  });
  it('projects malformed IF evaluation as indeterminate instead of falsely Not run',()=>{
    const document={$schema:validation,if:7};const result=new InstanceWorkspace(document,{}).validate();
    const html=compositionEditorView({document,targetPointer:'',diagnostics:[],active:true,evaluation:result});expect(html).toContain('data-schema-result="/if"');expect(html).toContain('data-evaluation-state="indeterminate"');
  });
  it('keeps inactive authored rules read-only',()=>{
    const html=compositionEditorView({document:{allOf:[{}]},targetPointer:'',diagnostics:[],active:false});expect(html).toContain('read-only');expect(html).not.toContain('data-composition-add-rule');
  });
  it('keeps empty active Rules compact until Add rule is invoked',()=>{
    const compact=compositionEditorView({document:{type:'object'},targetPointer:'',diagnostics:[],active:true});
    expect(compact).toContain('js-composition-empty');expect(compact).toContain('Rules');expect(compact).toContain('None');
    expect(compact).toContain('data-composition-add-start');expect(compact).not.toContain('data-composition-seed-kind');
    const expanded=compositionEditorView({document:{type:'object'},targetPointer:'',diagnostics:[],active:true,addComposerOpen:true});
    expect(expanded).not.toContain('data-composition-seed-kind');expect(expanded).not.toContain('Complete seed');expect(expanded).toContain('data-composition-add-cancel');
  });
});
