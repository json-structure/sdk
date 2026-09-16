import {describe,it,expect} from 'vitest';
import {SchemaLocationIndex,SchemaLocationNavigation,schemaForm} from '../src/schema-locations.js';
import {DocumentSession} from '../src/session.js';
import {MoveCompositionOperandCommand,DuplicateCompositionOperandCommand,DeleteCompositionOperandCommand,WrapCompositionOperandCommand,UnwrapCompositionOperandCommand} from '../src/commands.js';
const meta='https://json-structure.org/meta/validation/v0/#';
describe('production schema-location index / command identity protocol units',()=>{
  it('owns all structural positions, including opaque branches, but never annotation payloads',()=>{
    const value={$schema:meta,properties:{payload:{$ref:'#/definitions/Base',oneOf:[{}]}},items:{if:0,then:{}},values:{not:{}},choices:{A:{}},contains:{allOf:[{}]},patternProperties:{'x/y':{anyOf:[{}]}},default:{allOf:[{}]},examples:[{if:{}}],extension:{not:{}},definitions:{NS:{Base:{type:'string'}}}};
    const session=new DocumentSession('memory://locations',JSON.stringify(value));const index=new SchemaLocationIndex();index.refresh(session.value,session.model);
    for(const p of ['/properties/payload','/properties/payload/oneOf/0','/items/if','/items/then','/values/not','/choices/A','/contains/allOf/0','/patternProperties/x~1y/anyOf/0','/definitions/NS/Base'])expect(index.at(p),p).toBeDefined();
    expect(index.at('/items/if')?.form).toBe('malformed');expect(index.at('/items/if')?.sourceSelectable).toBe(true);expect(index.at('/properties/payload')?.form).toBe('legacy-reference-rules');
    for(const p of ['/default','/examples/0','/extension'])expect(index.at(p)).toBeUndefined();
    const custom=new SchemaLocationIndex();custom.register({keyword:'registeredSchemas',shape:'map'});custom.refresh({registeredSchemas:{a:{then:{}}}});expect(custom.at('/registeredSchemas/a/then')?.parentPointer).toBe('/registeredSchemas/a');
  });
  it('reorders identities and descendants even for identical operands, and restores history snapshots',()=>{
    const session=new DocumentSession('memory://identity',JSON.stringify({$schema:meta,allOf:[{not:{}},{not:{}}]}));const index=new SchemaLocationIndex();index.refresh(session.value,session.model);const navigation=new SchemaLocationNavigation(index);
    navigation.open('');navigation.open('/allOf/0',index.at('/allOf/0')!.id);navigation.open('/allOf/0/not',index.at('/allOf/0/not')!.id);
    const id=navigation.current!.id,before=navigation.capture();
    const command=new MoveCompositionOperandCommand('/allOf/0','down');const result=command.execute({session,documentVersion:session.snapshot().documentVersion});session.applyTextEdits(result.edits);index.refresh(session.value,session.model,result.pointerTransforms);
    expect(navigation.current?.pointer).toBe('/allOf/1/not');expect(navigation.current?.id).toBe(id);expect(navigation.back()?.pointer).toBe('/allOf/1');
    navigation.restore(before,JSON.parse(session.savedText),session.model);expect(navigation.current?.pointer).toBe('/allOf/0/not');expect(navigation.current?.id).toBe(id);
  });
  it('reports insertion/deletion/wrapping transforms and refuses unsafe unwrap',()=>{
    const session=new DocumentSession('memory://transforms',JSON.stringify({$schema:meta,allOf:[{},{}]}));
    const context={session,documentVersion:session.snapshot().documentVersion};
    expect(new DuplicateCompositionOperandCommand('/allOf/0').execute(context).pointerTransforms).toEqual([{from:'/allOf/1',to:'/allOf/2'}]);
    expect(new DeleteCompositionOperandCommand('/allOf/0').execute(context).pointerTransforms).toEqual([{from:'/allOf/0'},{from:'/allOf/1',to:'/allOf/0'}]);
    const wrap=new WrapCompositionOperandCommand('/allOf/0','anyOf').execute(context);expect(wrap.pointerTransforms).toEqual([{from:'/allOf/0',to:'/allOf/0/anyOf/0'}]);session.applyTextEdits(wrap.edits);
    const unwrap=new UnwrapCompositionOperandCommand('/allOf/0');expect(unwrap.canExecute({session,documentVersion:session.snapshot().documentVersion})).toBe(true);
    session.update(JSON.stringify({$schema:meta,allOf:[{anyOf:[{}],description:'must retain'}]}),99);expect(unwrap.canExecute({session,documentVersion:99})).toBe(false);
  });
  it('rebases identities for independently edited Source operand reorders',()=>{
    const old={allOf:[{type:'string',not:{}},{type:'int32'}]};const next={allOf:[old.allOf[1],old.allOf[0]]};
    const index=new SchemaLocationIndex();index.refresh(old);const navigation=new SchemaLocationNavigation(index);navigation.open('');navigation.open('/allOf/0/not');const identity=navigation.current!.id;
    index.refresh(next,undefined,index.sourceTransforms(next));expect(navigation.current?.pointer).toBe('/allOf/1/not');expect(navigation.current?.id).toBe(identity);
  });
  it('never mistakes absent type for explicit any',()=>{expect(schemaForm({})).toBe('empty');expect(schemaForm({then:{}})).toBe('no-type');expect(schemaForm({type:'any'})).toBe('explicit-any');});
  it('removes deleted identities from forward navigation without selecting a replacement operand',()=>{
    const index=new SchemaLocationIndex();index.refresh({allOf:[{},{}]});const nav=new SchemaLocationNavigation(index);nav.open('');nav.open('/allOf/0');nav.back();
    index.refresh({allOf:[{}]},undefined,[{from:'/allOf/0'},{from:'/allOf/1',to:'/allOf/0'}]);nav.reconcile();expect(nav.current?.pointer).toBe('');expect(nav.canForward).toBe(false);
  });

});
