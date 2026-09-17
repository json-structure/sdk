/** Independent raw-fixture oracle. Do not import production parsers, indexes, selectors or renderers here. */
export const ruleKeywords = ['allOf','anyOf','oneOf','not','if','then','else'];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const token = value => value.replace(/~/g,'~0').replace(/\//g,'~1');
export function corpusNavigationPlan(document) {
  const roots = [];
  const build = (value,pointer,kind,key,label,extra={}) => {
    const node={value,step:{pointer,kind,key,label,...extra},children:[]};
    if (!record(value)) return node;
    for (const [name,child] of Object.entries(record(value.properties)?value.properties:{})) node.children.push(build(child,pointer+'/properties/'+token(name),value.type==='tuple'?'tuple-member':'property',name,(value.type==='tuple'?'Tuple member ':'Property ')+name));
    for (const keyword of ['items','values']) if(Object.hasOwn(value,keyword))node.children.push(build(value[keyword],pointer+'/'+keyword,keyword,keyword,keyword==='items'?'Items':'Values'));
    for(const [name,child] of Object.entries(record(value.choices)?value.choices:{}))node.children.push(build(child,pointer+'/choices/'+token(name),'choice',name,'Choice '+name));
    if(record(value.additionalProperties))node.children.push(build(value.additionalProperties,pointer+'/additionalProperties','schema-keyword','additionalProperties','Additional properties'));
    for(const keyword of ruleKeywords)if(Object.hasOwn(value,keyword)) {
      if(['allOf','anyOf','oneOf'].includes(keyword)) {if(Array.isArray(value[keyword]))value[keyword].forEach((child,index)=>node.children.push(build(child,pointer+'/'+keyword+'/'+index,'operand',keyword+':'+index,({allOf:'ALL',anyOf:'ANY',oneOf:'ONE'})[keyword]+' operand '+(index+1),{keyword,index})));}
      else node.children.push(build(value[keyword],pointer+'/'+keyword,keyword==='not'?'operand':'branch',keyword,keyword.toUpperCase(),{keyword}));
    }
    for(const keyword of ['contains','propertyNames','keyNames','has'])if(Object.hasOwn(value,keyword))node.children.push(build(value[keyword],pointer+'/'+keyword,'schema-keyword',keyword,keyword));
    for(const keyword of ['patternProperties','patternKeys'])for(const [name,child] of Object.entries(record(value[keyword])?value[keyword]:{}))node.children.push(build(child,pointer+'/'+keyword+'/'+token(name),'schema-keyword',name,keyword+' '+name));
    if(Array.isArray(value.type))value.type.forEach((child,index)=>{if(record(child)&&!Object.hasOwn(child,'$ref'))node.children.push(build(child,pointer+'/type/'+index,'type-member',String(index),'Type union member '+(index+1)));});
    definitions(value.definitions,pointer+'/definitions');
    return node;
  };
  const definitions=(entries,pointer)=>{for(const [name,value]of Object.entries(record(entries)?entries:{})){
    const p=pointer+'/'+token(name);
    if(record(value)&&Object.keys(value).length&&!['type','$ref','name','properties','items','values','choices',...ruleKeywords].some(k=>Object.hasOwn(value,k)))definitions(value,p);
    else roots.push(build(value,p,'definition',name,'Definition '+name));
  }};
  const root=build(document,'','root','','Inline root');
  if(['type','$ref','properties','items','values','choices',...ruleKeywords].some(k=>Object.hasOwn(document,k)))roots.unshift(root);
  return roots;
}

/** Portable mounted/packaged acceptance. Clicks visible controls only; no production handles or HTML injection. */
export async function driveMountedCorpus(root, roots, manifestCarriers, options={}) {
  const keys=['allOf','anyOf','oneOf','not','if','then','else'];
  const stats={locations:0,carriers:0,keywords:0,canonicalReferences:0,legacyReferences:0,visitedCarriers:[],relationships:0};
  const fail=message=>{throw new Error('Schema-location corpus: '+message);};
  const eq=(a,b,message)=>{if(JSON.stringify(a)!==JSON.stringify(b))fail(message+'; actual '+JSON.stringify(a)+'; expected '+JSON.stringify(b));};
  const rec=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const settle=()=>new Promise(resolve=>setTimeout(resolve,options.delay ?? 0));
  const click=async button=>{
    if(!button || button.disabled || button.closest('[hidden]'))fail('Required visible navigation control is unavailable');
    for(let parent=button.parentElement;parent && parent!==root;parent=parent.parentElement)if(parent.tagName==='DETAILS'&&!parent.open)fail('Navigation control is in a closed disclosure');
    button.scrollIntoView?.({block:'nearest'});if(options.requireLayout){const bounds=button.getBoundingClientRect(),style=getComputedStyle(button);if(bounds.width<1||bounds.height<1||style.visibility==='hidden'||style.display==='none'||button.closest('[inert]'))fail('Navigation action is not visibly selectable: '+button.outerHTML);}button.focus();button.click();await settle();
  };
  const sheet=()=>root.querySelector('[data-schema-sheet]');
  const surface=()=>sheet()??root.querySelector('[data-panel-mode="design"]');
  const formOf=value=>!rec(value)?'malformed':Object.hasOwn(value,'$ref')?(typeof value.$ref!=='string'?'malformed':keys.some(k=>Object.hasOwn(value,k))?'legacy-reference-rules':'legacy-reference'):!Object.hasOwn(value,'type')?(Object.keys(value).length?'no-type':'empty'):rec(value.type)?(typeof value.type.$ref==='string'?'typed-reference':'malformed'):value.type==='any'?'explicit-any':typeof value.type==='string'||Array.isArray(value.type)&&value.type.length?'explicit-type':'malformed';
  const usesPrimary=(node,form=formOf(node.value))=>(node.step.kind==='root'||node.step.kind==='definition')&&(form==='explicit-type'||form==='explicit-any')&&!(rec(node.value)&&Array.isArray(node.value.type));
  const verify=node=>{
    const {pointer,label}=node.step, value=node.value;
    const bar=root.querySelector('[data-schema-location-bar]');
    const current=sheet();
    const form=formOf(value);
    const primary=usesPrimary(node,form);
    if(primary){
      if(current)fail('Ordinary root/definition unexpectedly opened a schema sheet at '+pointer);
      if(bar)fail('Ordinary root/definition unexpectedly rendered a location bar at '+pointer);
    }else{
      if(!bar)fail('No location bar at '+pointer);
      eq(bar.dataset.schemaPointer,pointer,'exact pointer');eq(bar.dataset.schemaRelationship,label,'relationship at '+pointer);stats.relationships++;
      if(!current)fail('No schema sheet at '+pointer);
      eq(current.dataset.schemaSheet,pointer,'sheet pointer');
      eq(current.querySelector('[data-schema-declaration]')?.dataset.declarationForm,form,'declaration form at '+pointer);
      if(form==='no-type'||form==='empty')eq(current.querySelector('[data-declaration-label]')?.textContent,current.hasAttribute('data-overlay-context')?'Constraint set':'No declared type','absent type is an implied-base constraint set, never any');
    }
    const active=surface();if(!active)fail('No active Design surface at '+pointer);
    if(rec(value)&&typeof value.type==='string'){if(active.hasAttribute('data-overlay-context')){eq(active.querySelector('[data-overlay-authored-type]')?.dataset.overlayAuthoredType,value.type,'read-only authored type retained at '+pointer);if(active.querySelector('[data-inline-definition-type]'))fail('Contextual mode unexpectedly exposes an arbitrary type picker');}else eq(active.querySelector('[data-inline-definition-type]')?.value,value.type,'type control retains '+value.type+' at '+pointer);}
    if(!rec(value)){if(!current?.querySelector('[data-schema-opaque]'))fail('Opaque source not represented at '+pointer);return;}
    const reference=typeof value.$ref==='string'?value.$ref:rec(value.type)&&typeof value.type.$ref==='string'?value.type.$ref:undefined;
    if(reference){eq(active.querySelector('[data-schema-reference]')?.dataset.schemaReference,reference,'reference bytes at '+pointer);if(typeof value.$ref==='string')stats.legacyReferences++;else stats.canonicalReferences++;}
    const authored=keys.filter(k=>Object.hasOwn(value,k));
    const rules=active.querySelector('[data-composition-editor]');
    if(authored.length){eq(rules?.dataset.authoredKeywords.split(' '),authored,'authored keyword set at '+pointer);eq(manifestCarriers[pointer],authored,'independent manifest carrier '+pointer);stats.carriers++;stats.keywords+=authored.length;stats.visitedCarriers.push(pointer);}
    else if(rules)eq(rules.dataset.authoredKeywords,'','no invented rules');
    for(const keyword of ['allOf','anyOf','oneOf'])if(Object.hasOwn(value,keyword)){
      const group=rules.querySelector('[data-rule-keyword="'+keyword+'"]');if(!group)fail('Missing group '+keyword);
      eq(group.dataset.rulePointer,pointer+'/'+keyword,'exact group pointer');
      const expected=Array.isArray(value[keyword])?value[keyword].map((_,index)=>pointer+'/'+keyword+'/'+index):[];
      eq([...group.querySelectorAll('[data-operand-pointer]')].map(el=>el.dataset.operandPointer),expected,'operand count/order '+pointer+'/'+keyword);
      if(!Array.isArray(value[keyword])||!value[keyword].length){if(!group.querySelector('[data-opaque-keyword]'))fail('Malformed group is not opaque');}
    }
    if(['if','then','else'].some(k=>Object.hasOwn(value,k))){
      const group=rules.querySelector('[data-rule-keyword="conditional"]');
      eq(group.dataset.conditionalKeywords,['if','then','else'].filter(k=>Object.hasOwn(value,k)).join(' '),'conditional keyword presence');
      if(group.hasAttribute('data-rule-pointer'))fail('Synthetic conditional rule pointer');
      for(const keyword of ['if','then','else']){const row=group.querySelector('[data-branch-keyword="'+keyword+'"]');const present=Object.hasOwn(value,keyword);eq(row?.dataset.branchPresence,present?'authored':'not-authored','branch presence '+keyword);if(present)eq(row.dataset.operandPointer,pointer+'/'+keyword,'exact branch pointer');else{if(row.hasAttribute('data-operand-pointer'))fail('Synthetic missing branch pointer');if(!row.textContent.includes('Not authored'))fail('Missing Not authored state');}}
    }
    if(active.querySelector('.js-composition-schema-editor,.js-rule-nested,.js-rule-disclosure'))fail('Recursive/reduced operand editor at '+pointer);
  };
  const childButton=async step=>{
    const current=surface();if(step.kind==='operand'||step.kind==='branch'){
      const group=current.querySelector('[data-rule-keyword="'+(step.kind==='branch'?'conditional':step.keyword)+'"]');
      if(step.kind==='branch')return group?.querySelector('[data-branch-keyword="'+step.keyword+'"] [data-schema-open]');
      return group?.querySelectorAll('[data-schema-open]')[step.index??0];
    }
    const locate=()=>[...surface().querySelectorAll('[data-schema-child-kind]')].find(el=>el.dataset.schemaChildKind===step.kind&&el.dataset.schemaChildKey===step.key);
    let row=locate(),button=row?.querySelector('[data-schema-open]');
    if(button?.closest('[hidden]')){
      await click(row?.querySelector('[data-property-menu]'));
      row=locate();button=row?.querySelector('[data-schema-open]');
    }
    return button;
  };
  const visit=async node=>{
    verify(node);stats.locations++;
    for(const child of node.children){
      await click(await childButton(child.step));
      eq(root.ownerDocument.activeElement?.hasAttribute('data-schema-heading'),true,'drill-in heading focus');
      await visit(child);
      await click(root.querySelector('[data-schema-back]'));
      const bar=root.querySelector('[data-schema-location-bar]');
      if(usesPrimary(node)){if(sheet())fail('Back did not restore primary owner surface');if(bar)fail('Back retained nested location bar on primary owner');}
      else {eq(bar?.dataset.schemaPointer,node.step.pointer,'Back restores parent');eq(bar?.dataset.schemaRelationship,node.step.label,'Back restores relationship');}
      const active=root.ownerDocument.activeElement;
      eq(active?.dataset.schemaOpen??active?.closest('[data-property-editor]')?.dataset.propertyEditor,child.step.pointer,'Back restores invoking control');
    }
  };
  for(const node of roots){
    let toggle=root.querySelector('[data-mobile-drawer="types"]');
    if(options.compact&&toggle&&!root.querySelector('.js-drawer-open'))await click(toggle);
    const candidates=[...root.querySelectorAll('.js-tree [data-select]')];
    const button=node.step.kind==='root'?candidates.find(b=>b.classList.contains('js-tree-inline-root')):candidates.find(b=>b.dataset.select?.split('/').at(-1)?.replace(/~1/g,'/').replace(/~0/g,'~')===node.step.key);
    await click(button);await visit(node);
  }
  eq([...stats.visitedCarriers].sort(),Object.keys(manifestCarriers).sort(),'all manifest carriers reached through visible controls');
  return stats;
}
