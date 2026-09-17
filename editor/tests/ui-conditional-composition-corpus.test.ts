// @vitest-environment happy-dom
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { mountJsonStructureEditor, type JsonStructureEditorHandle } from '../src/ui/index.js';
import { corpusNavigationPlan, driveMountedCorpus } from './support/schema-location-corpus.mjs';
const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'conditional-composition-adversarial');
const manifest=JSON.parse(readFileSync(join(fixtureRoot,'manifest.json'),'utf8')) as {documentCount:number;documents:{id:string;file:string;conditionalKeywordsByPointer:Record<string,string[]>;sourcePreservation:{required:boolean;byteLength?:number;sha256?:string}}[]};
let handle: JsonStructureEditorHandle | undefined;
afterEach(()=>{handle?.dispose();handle=undefined;document.body.replaceChildren();});
describe('frozen independent corpus — mounted visible-control navigation (not renderer injection)',()=>{
  for(const entry of manifest.documents)it(entry.id+' reaches every carrier, structural child and reference without changing source',async()=>{
    const source=readFileSync(join(fixtureRoot,entry.file),'utf8');
    const raw=JSON.parse(source);
    const root=document.createElement('div');document.body.append(root);
    handle=mountJsonStructureEditor(root,{text:source,title:entry.file});
    const coverage=await driveMountedCorpus(root,corpusNavigationPlan(raw),entry.conditionalKeywordsByPointer);
    expect(coverage.carriers).toBe(Object.keys(entry.conditionalKeywordsByPointer).length);
    expect(coverage.keywords).toBe(Object.values(entry.conditionalKeywordsByPointer).reduce((count,keywords)=>count+keywords.length,0));
    const referenceCounts = {canonical:0,legacy:0};
    const countRaw = (candidate:unknown, member=''):void => {
      if(candidate===null||typeof candidate!=='object')return;
      if(Array.isArray(candidate)){candidate.forEach(item=>countRaw(item,member));return;}
      const schema=candidate as Record<string,unknown>;
      if(typeof schema.$ref==='string'&&member!=='type')referenceCounts.legacy++;
      if(schema.type&&typeof schema.type==='object'&&!Array.isArray(schema.type)&&typeof (schema.type as Record<string,unknown>).$ref==='string')referenceCounts.canonical++;
      Object.entries(schema).forEach(([key,child])=>countRaw(child,key));
    };
    countRaw(raw);
    expect(coverage.canonicalReferences).toBe(referenceCounts.canonical);
    expect(coverage.legacyReferences).toBe(referenceCounts.legacy);
    expect(handle.getText()).toBe(source);
    if(entry.sourcePreservation.required){expect(Buffer.byteLength(handle.getText())).toBe(entry.sourcePreservation.byteLength);expect(createHash('sha256').update(handle.getText()).digest('hex')).toBe(entry.sourcePreservation.sha256);}
    console.log(entry.id+' mounted coverage '+JSON.stringify(coverage));
  },120_000);
  it('retains the independent manifest size',()=>{expect(manifest.documents).toHaveLength(manifest.documentCount);});
});
