import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {InstanceWorkspace,type EvaluationTrace} from '../src/phase4/instance-workspace.js';
const meta='https://json-structure.org/meta/validation/v0/#';
const flatten=(trace:EvaluationTrace):EvaluationTrace[]=>[trace,...trace.children.flatMap(flatten)];
describe('schema-location evaluator trace semantics',()=>{
  it('reports standalone then/else at their authored pointers, never inventing an if',()=>{
    for(const keyword of ['then','else']){const result=new InstanceWorkspace({$schema:meta,[keyword]:{type:'string'}},'value').validate();expect(result.status).toBe('indeterminate');expect(result.diagnostics[0]?.schemaPointer).toBe('/'+keyword);expect(result.diagnostics[0]?.message).toContain('does not define its evaluation');expect(flatten(result.trace).some(t=>t.schemaPointer==='/if')).toBe(false);}
  });
  it('evaluates legacy direct refs and sibling constraints at the same current node',()=>{
    const schema={$schema:meta,type:'object',properties:{payload:{$ref:'#/definitions/Base',oneOf:[{const:'A'},{const:'B'}]}},definitions:{Base:{type:'string'}}};
    const result=new InstanceWorkspace(schema,{payload:'C'}).validate();expect(result.status).toBe('invalid');expect(flatten(result.trace).find(t=>t.schemaPointer==='/properties/payload/oneOf')?.instancePointer).toBe('/payload');
  });
  it('keeps IF condition matching separate from selected branch status and marks unused branches not applied',()=>{
    const result=new InstanceWorkspace({$schema:meta,if:{type:'string'},then:{const:'A'},else:{}},'B').validate();
    expect(result.status).toBe('invalid');const conditional=flatten(result.trace).find(t=>t.keyword==='if')!;
    expect(conditional.children[0]?.status).toBe('valid');expect(conditional.children.find(t=>t.keyword==='then')?.status).toBe('invalid');expect(conditional.children.find(t=>t.keyword==='else')?.application).toBe('not-applied');
  });
  it('retains repeated map/array occurrences, exact versions and unique trace occurrence paths',()=>{
    const schema={$schema:meta,type:'map',values:{allOf:[{type:'int32'}]}};
    const result=new InstanceWorkspace(schema,{x:1,y:'bad'},{documentVersion:17,instanceVersion:3}).validate();const traces=flatten(result.trace);
    const rules=traces.filter(t=>t.keyword==='allOf');expect(rules.map(t=>t.instancePointer)).toEqual(['/x','/y']);expect(rules.map(t=>t.schemaPointer)).toEqual(['/values/allOf','/values/allOf']);expect(new Set(traces.map(t=>t.occurrencePath)).size).toBe(traces.length);expect(traces.every(t=>t.documentVersion===17&&t.instanceVersion===3)).toBe(true);
  });
  it('keeps cc-20 item rules distinct from root rules while retaining exact decimal strings',()=>{
    const schema=JSON.parse(readFileSync('tests/fixtures/conditional-composition-adversarial/20-scientific-measurement-units.struct.json','utf8'));
    const result=new InstanceWorkspace(schema,{experimentId:'550e8400-e29b-41d4-a716-446655440000',mode:'raw',baseline:'0.00000000',samples:[{kind:'temperature',value:'300.00000000'},{kind:'pressure',value:'100.00000000'}]},{documentVersion:5,instanceVersion:6}).validate();
    const traces=flatten(result.trace);expect(traces.filter(t=>t.keyword==='allOf'&&t.schemaPointer==='/properties/samples/items/allOf').map(t=>t.instancePointer)).toEqual(['/samples/0','/samples/1']);
    expect(traces.find(t=>t.keyword==='if'&&t.schemaPointer==='/if')?.instancePointer).toBe('');
    expect(schema.properties.samples.items.type).toEqual({$ref:'#/definitions/Measurement'});expect(schema.properties.samples.items.allOf[0].then.allOf[1].not.properties.value.maximum).toBe('-0.00000001');
  });
});
