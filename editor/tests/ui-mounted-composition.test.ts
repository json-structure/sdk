// @vitest-environment happy-dom
import {afterEach,describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mountJsonStructureEditor,type JsonStructureEditorHandle} from '../src/ui/index.js';
const meta='https://json-structure.org/meta/validation/v0/#';
let handle:JsonStructureEditorHandle|undefined;
afterEach(()=>{handle?.dispose();handle=undefined;document.body.replaceChildren();});
function mount(value:unknown):HTMLElement{const root=document.createElement('div');document.body.append(root);handle=mountJsonStructureEditor(root,{text:typeof value==='string'?value:JSON.stringify(value),title:'rules.struct.json'});return root;}
function get(root:HTMLElement,selector:string):HTMLElement{const result=root.querySelector(selector);if(!result)throw new Error('Missing mounted control '+selector);return result;}
function click(root:HTMLElement,selector:string):void{const button=get(root,selector);if(button.disabled)throw new Error('Disabled control '+selector);const menu=button.closest('.js-rule-menu');if(menu&&!menu.open)menu.querySelector('summary').click();button.focus();button.click();}
function change(root:HTMLElement,selector:string,value:string):void{const input=get(root,selector);input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));}
function key(root:HTMLElement,selector:string,key:string,extra:Record<string,unknown>={}):void{const control=get(root,selector);control.focus();control.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,...extra}));}
const settle=()=>new Promise(resolve=>setTimeout(resolve,25));
const value=()=>JSON.parse(handle!.getText());
const pointer=(root:HTMLElement)=>get(root,'[data-schema-location-bar]').dataset.schemaPointer;
const operand=(keyword:string,index:number)=>'[data-rule-keyword="'+keyword+'"] [data-operand-pointer]:nth-child('+(index+1)+')';
describe('mounted schema-location authoring journeys',()=>{
  it('drills into complete object operands and reuses full property editing, then restores invoking row focus',async()=>{
    const root=mount({$schema:meta,allOf:[{type:'object',properties:{city:{type:'string',maxLength:32}}}]});
    click(root,operand('allOf',0)+' [data-schema-open]');expect(pointer(root)).toBe('/allOf/0');expect(document.activeElement.hasAttribute('data-schema-heading')).toBe(true);
    click(root,'[data-property-field-activate="name"]');change(root,'input[data-inline-property="name"]','town');await settle();expect(value().allOf[0].properties).toHaveProperty('town');
    click(root,'[data-schema-child-key="town"] [data-schema-open]');expect(pointer(root)).toBe('/allOf/0/properties/town');expect(root.textContent).toContain('maxLength');
    click(root,'[data-schema-back]');expect(document.activeElement.dataset.schemaOpen).toBe('/allOf/0/properties/town');click(root,'[data-schema-back]');expect(pointer(root)).toBe('');expect(document.activeElement.dataset.schemaOpen).toBe('/allOf/0');
  });
  it('authors all seven rules independently, with empty or explicit seeds and never silent type:any',async()=>{
    const root=mount({$schema:meta,type:'string'});
    for(const keyword of ['then','else','if','allOf','anyOf','oneOf','not']){change(root,'.js-rule-add-root [data-composition-add-rule-kind]',keyword);click(root,'.js-rule-add-root [data-composition-add-rule]');await settle();expect(value()[keyword]).toEqual(['allOf','anyOf','oneOf'].includes(keyword)?[{}]:{});}
    click(root,'[data-branch-keyword="if"] [data-composition-remove-branch]');await settle();expect(Object.hasOwn(value(),'if')).toBe(false);expect(value().then).toEqual({});expect(value().else).toEqual({});expect(root.querySelector('[data-operand-pointer="/if"]')).toBeNull();
  });
  it('adds complete type, canonical reference and source seeds without erasing legacy bytes',async()=>{
    const fixture=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'fixtures/conditional-composition-adversarial/17-legacy-property-direct-ref.struct.json'),'utf8');const root=mount(fixture);const authored=JSON.parse(fixture);
    click(root,'[data-schema-child-key="payload"] [data-schema-open]');expect(get(root,'[data-schema-declaration]').dataset.declarationForm).toBe('legacy-reference-rules');
    change(root,'[data-rule-keyword="oneOf"] > .js-rule-add [data-composition-seed-kind]','ref:#/definitions/BasePayload');click(root,'[data-rule-keyword="oneOf"] > .js-rule-add [data-composition-add-operand]');await settle();
    expect(value().properties.payload.oneOf.at(-1)).toEqual({type:{$ref:'#/definitions/BasePayload'}});
    expect(value().properties.payload.$ref).toBe(authored.properties.payload.$ref);
    expect(value().properties.payload.oneOf.slice(0,-1)).toEqual(authored.properties.payload.oneOf);
    const legacy=(v:unknown):string[]=>v&&typeof v==='object'?(Array.isArray(v)?v.flatMap(legacy):[...(Object.hasOwn(v,'$ref')&&Object.keys(v).includes('$ref')?[String((v as Record<string,unknown>).$ref)]:[]),...Object.entries(v).filter(([k])=>k!=='type').flatMap(([,c])=>legacy(c))]):[];
    expect(legacy(value())).toEqual(legacy(authored));expect(legacy(value())).toHaveLength(8);
    change(root,'[data-rule-keyword="oneOf"] > .js-rule-add [data-composition-seed-kind]','source');get(root,'[data-rule-keyword="oneOf"] [data-composition-seed-source]').value='{"type":"decimal","const":"0.00000001","precision":20,"scale":8,"description":"exact"}';click(root,'[data-rule-keyword="oneOf"] > .js-rule-add [data-composition-add-operand]');await settle();expect(value().properties.payload.oneOf.at(-1).const).toBe('0.00000001');
  });
  it('reorders logical selection and forward history, with keyboard undo/redo restoring focus',async()=>{
    const root=mount({$schema:meta,allOf:[{type:'string',description:'Alpha'},{type:'int32',description:'Beta'}]});
    click(root,operand('allOf',0)+' [data-schema-open]');click(root,'[data-schema-back]');
    key(root,operand('allOf',0)+' [data-schema-open]','ArrowDown',{altKey:true});await settle();expect(value().allOf[1].description).toBe('Alpha');expect(document.activeElement.dataset.schemaOpen).toBe('/allOf/1');
    click(root,'[data-schema-forward]');expect(pointer(root)).toBe('/allOf/1');expect(get(root,'[data-schema-member="description"] pre').textContent).toBe('"Alpha"');
    key(root,'[data-schema-heading]','z',{ctrlKey:true});await settle();expect(value().allOf[0].description).toBe('Alpha');expect(pointer(root)).toBe('');expect(document.activeElement.dataset.schemaOpen).toBe('/allOf/0');
    key(root,'[data-schema-heading]','y',{ctrlKey:true});await settle();expect(value().allOf[1].description).toBe('Alpha');expect(document.activeElement.dataset.schemaOpen).toBe('/allOf/1');
  });
  it('supports duplicate, convert, wrap/negate, safe unwrap, and explicit unsafe refusal',async()=>{
    const root=mount({$schema:meta,allOf:[{anyOf:[{type:'string'}]},{allOf:[{}],description:'retain'},7]});
    const unsafe=get(root,operand('allOf',1)+' [data-composition-unwrap]');expect(unsafe.disabled).toBe(true);expect(unsafe.title).toContain('discard sibling');
    click(root,operand('allOf',0)+' [data-composition-unwrap]');await settle();expect(value().allOf[0]).toEqual({type:'string'});
    click(root,operand('allOf',2)+' [data-composition-duplicate]');await settle();expect(value().allOf.slice(-2)).toEqual([7,7]);
    const convert=get(root,'[data-composition-convert]');convert.closest('details').querySelector('summary').click();change(root,'[data-composition-convert]','anyOf');await settle();expect(value().anyOf).toHaveLength(4);
    click(root,operand('anyOf',0)+' [data-composition-wrap]');await settle();expect(value().anyOf[0]).toEqual({allOf:[{type:'string'}]});
    click(root,operand('anyOf',0)+' [data-composition-negate]');await settle();expect(value().anyOf[0]).toEqual({not:{allOf:[{type:'string'}]}});
  });
  it('deletes the last n-ary operand as the entire rule and preserves authored invalid empty arrays',async()=>{
    const root=mount({$schema:meta,allOf:[{}],anyOf:[]});click(root,operand('allOf',0)+' [data-composition-delete-operand]');await settle();expect(Object.hasOwn(value(),'allOf')).toBe(false);expect(value().anyOf).toEqual([]);expect(root.querySelector('[data-opaque-keyword="anyOf"]')).not.toBeNull();
    key(root,'[data-schema-heading]','z',{ctrlKey:true});await settle();expect(value().allOf).toEqual([{}]);expect(value().anyOf).toEqual([]);
  });
  it('edits an opaque source token explicitly and returns to Design with all siblings intact',async()=>{
    const source='{ "$schema": "'+meta+'", "allOf": [7, { "$ref" : "#/definitions/Base", "x-extra" : [1,2] }], "definitions": {"Base":{"type":"string"}}, "keep" : "verbatim" }';
    const root=mount(source);click(root,operand('allOf',0)+' [data-schema-open]');expect(get(root,'[data-schema-declaration]').dataset.declarationForm).toBe('malformed');click(root,'[data-composition-source]');
    get(root,'[data-schema-source-text]').value='{"type":"string","description":"repaired"}';click(root,'[data-schema-source-apply]');await settle();expect(pointer(root)).toBe('/allOf/0');expect(handle!.getText()).toBe(source.replace('[7,','[{"type":"string","description":"repaired"},'));expect(document.activeElement.hasAttribute('data-schema-heading')).toBe(true);
    key(root,'[data-schema-heading]','z',{ctrlKey:true});await settle();expect(handle!.getText()).toBe(source);
  });
  it('projects repeated evaluator occurrences and versioned stale/not-applied states, with trace drill-back',async()=>{
    const root=mount({$schema:meta,type:'array',items:{type:'int32',if:{minimum:0},then:{maximum:5},else:{minimum:-5}}});
    click(root,'[data-schema-child-kind="items"] [data-schema-open]');expect(root.textContent).toContain('Not run');click(root,'[data-mode="instance"]');get(root,'[data-instance-text]').value='[2,9,-2]';get(root,'[data-instance-text]').dispatchEvent(new Event('input',{bubbles:true}));click(root,'[data-instance-validate]');click(root,'[data-mode="design"]');
    const result=get(root,'[data-schema-declaration] [data-schema-result]');expect(result.dataset.evaluationCount).toBe('3');expect(result.dataset.evaluationState).toBe('invalid');click(root,'[data-schema-declaration] [data-schema-result]');expect(root.querySelector('[data-panel-mode="instance"]').hidden).toBe(false);
    const trace=get(root,'[data-trace-schema-open="/items"]');trace.click();expect(pointer(root)).toBe('/items');
    change(root,'[data-inline-definition-type]','int64');await settle();expect(root.querySelector('[data-evaluation-state="Stale"]')).not.toBeNull();
  });
  it('has keyboard overflow/Escape restoration and a Go to Schema Location palette fallback',async()=>{
    const root=mount({$schema:meta,then:{}});key(root,'[data-branch-keyword="then"] [data-schema-open]','F10',{shiftKey:true});const menu=get(root,'[data-branch-keyword="then"] .js-rule-menu');expect(menu.open).toBe(true);document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));expect(menu.open).toBe(false);expect(document.activeElement.tagName).toBe('SUMMARY');
    key(root,'[data-schema-heading]','P',{ctrlKey:true,shiftKey:true});expect(root.textContent).toContain('Go to Schema Location');key(root,'[data-action-select]','Escape');
  });
});
