import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LosslessText} from '../src/losslessText.ts';
const encode=text=>new TextEncoder().encode(text),normalize=text=>text.replace(/\r\n|\r/g,'\n').replace(/\n/g,'\r\n');
test('frozen corpus source is not normalized by no-edit VS Code Save',()=>{
  const root=new URL('../../editor/tests/fixtures/conditional-composition-adversarial/',import.meta.url);
  const manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8'));
  for(const entry of manifest.documents){const bytes=readFileSync(new URL(entry.file,root)),raw=new TextDecoder().decode(bytes),model=normalize(raw),text=new LosslessText(model,bytes,'\r\n');assert.equal(text.text,raw,entry.id);assert.deepEqual(Buffer.from(text.bytesToRestore(encode(model))??encode(model)),bytes,entry.id);}
});
test('source edits after mixed line endings map to native offsets, retaining unrelated bytes',()=>{
  const raw='{\r\n  "a": 1,\n  "b": 2\r\n}\n',model=normalize(raw),text=new LosslessText(model,encode(raw));
  const offset=raw.indexOf('2'),edits=text.prepare([{range:{startOffset:offset,endOffset:offset+1},newText:'3'}]);assert.equal(edits[0].range.startOffset,model.indexOf('2'));
  const next=model.replace('2','3');text.observe(next);assert.equal(text.text,raw.replace('2','3'));assert.equal(new TextDecoder().decode(text.bytesToRestore(encode(next))),raw.replace('2','3'));
  text.observe(model);assert.equal(text.text,raw);text.observe(next);assert.equal(text.text,raw.replace('2','3'));
});
test('native external edits and rejected optimistic commands do not lose authored bytes',()=>{
  const raw='{\r\n  "x": 1\n}\n',model=normalize(raw),text=new LosslessText(model,encode(raw));
  text.prepare([{range:{startOffset:raw.indexOf('1'),endOffset:raw.indexOf('1')+1},newText:'2'}]);text.cancel();assert.equal(text.text,raw);
  text.observe(model.replace('1','4'),[{rangeOffset:model.indexOf('1'),rangeLength:1,text:'4'}]);assert.equal(text.text,raw.replace('1','4'));
});
test('guard refuses to overwrite changed files or an explicitly different encoding',()=>{
  const raw='{\r\n"x":1\n}\n',text=new LosslessText(normalize(raw),encode(raw));assert.equal(text.bytesToRestore(encode('{"external":true}')),undefined);assert.equal(text.bytesToRestore(new Uint8Array([255,254,0,2])),undefined);
});
test('preserves UTF-8 BOM independently of normalized text and handles unicode offsets',()=>{
  const raw='{\n"text":"温度 😀",\r\n"x":2\n}',bytes=encode('\ufeff'+raw),model=normalize(raw),text=new LosslessText(model,bytes);assert.equal(text.text,raw);const offset=raw.indexOf('2');assert.equal(text.sourceToModel(offset),model.indexOf('2'));assert.deepEqual(text.bytesToRestore(encode('\ufeff'+model)),bytes);
});
