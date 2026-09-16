import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createVSIX} from '@vscode/vsce';
import {CdpClient,freePort,vscodeExecutable,runCli,waitForTargets,waitForWebview,waitFor,waitForExit} from './vsix-ui-acceptance.mjs';
import {corpusNavigationPlan,driveMountedCorpus} from '../../editor/tests/support/schema-location-corpus.mjs';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixtures=path.resolve(project,'../editor/tests/fixtures/conditional-composition-adversarial');
const manifest=JSON.parse(await readFile(path.join(fixtures,'manifest.json'),'utf8'));
const artifact=path.resolve(process.argv[2]||path.join(project,'json-structure-win32-x64-0.1.20.vsix'));
const scratch=path.join(project,'build','schema-location-vsix-'+process.pid),driver=path.join(scratch,'driver'),user=path.join(scratch,'user-data'),extensions=path.join(scratch,'extensions');
const only=process.env.JSON_STRUCTURE_CORPUS_IDS?.split(',');const entries=manifest.documents.filter(e=>!only||only.includes(e.id));
const totals={documents:0,locations:0,carriers:0,keywords:0,canonicalReferences:0,legacyReferences:0,hashProtected:0};
await mkdir(driver,{recursive:true});
const sources=new Map();for(const entry of entries){const source=await readFile(path.join(fixtures,entry.file),'utf8');sources.set(entry.id,source);await writeFile(path.join(scratch,entry.file),source,'utf8');}
const commands=entries.map(e=>({command:'jsonStructureCorpus.open.'+e.id,title:'JSON Structure Corpus: Open '+e.id}));
await writeFile(path.join(driver,'package.json'),JSON.stringify({name:'json-structure-schema-location-driver',displayName:'JSON Structure Corpus Driver',publisher:'jsonstructure-tests',version:'0.0.0',engines:{vscode:'^1.110.0'},activationEvents:['onStartupFinished'],main:'./extension.js',contributes:{commands}},null,2));
await writeFile(path.join(driver,'extension.js'),
  'const vscode=require("vscode");const path=require("path");const entries='+JSON.stringify(entries.map(e=>({id:e.id,file:e.file})))+';exports.activate=function(context){for(const entry of entries)context.subscriptions.push(vscode.commands.registerCommand("jsonStructureCorpus.open."+entry.id,async()=>{await vscode.commands.executeCommand("workbench.action.files.saveAll");await vscode.commands.executeCommand("workbench.action.closeAllEditors");await vscode.commands.executeCommand("vscode.openWith",vscode.Uri.file(path.join(process.env.JSON_STRUCTURE_CORPUS_ROOT,entry.file)),"jsonStructure.editor");}));setTimeout(()=>vscode.commands.executeCommand("jsonStructureCorpus.open."+entries[0].id),1000);};');
const driverVsix=path.join(scratch,'corpus-driver.vsix');await createVSIX({cwd:driver,packagePath:driverVsix,dependencies:false});
const executable=await vscodeExecutable();for(const vsix of [artifact,driverVsix])runCli(executable,['--user-data-dir',user,'--extensions-dir',extensions,'--install-extension',vsix,'--force']);
const port=await freePort();const env={...process.env,JSON_STRUCTURE_CORPUS_ROOT:scratch};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(executable,['--user-data-dir',user,'--extensions-dir',extensions,'--new-window','--skip-welcome','--skip-release-notes','--disable-workspace-trust','--remote-debugging-port='+port,scratch],{cwd:project,env,stdio:'ignore',windowsHide:true});
const clients=new Map();let main;
try{
  const targets=await waitForTargets(port);main=new CdpClient(targets.find(t=>t.type==='page'));await main.connect();clients.set(main.target.webSocketDebuggerUrl,main);
  await new Promise(r=>setTimeout(r,3000));
  for(const entry of entries){
    // The first fixture uses the normal startup openWith hook; later files use the visible VS Code palette.
    if(entry!==entries[0]) {
    await main.command('Input.dispatchKeyEvent',{type:'keyDown',key:'F1',code:'F1',windowsVirtualKeyCode:112,nativeVirtualKeyCode:112});await main.command('Input.dispatchKeyEvent',{type:'keyUp',key:'F1',code:'F1',windowsVirtualKeyCode:112,nativeVirtualKeyCode:112});
    await waitFor(main,undefined,undefined,'visible VS Code command palette',`document.querySelector('.quick-input-widget input') !== null && getComputedStyle(document.querySelector('.quick-input-widget')).display !== 'none'`);await main.command('Input.insertText',{text:'JSON Structure Corpus: Open '+entry.id});await waitFor(main,undefined,undefined,'matching corpus file command',`[...document.querySelectorAll('.quick-input-widget .monaco-list-row')].some(row=>row.textContent?.includes(${JSON.stringify('JSON Structure Corpus: Open '+entry.id)}))`);
    await main.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});await main.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
    }
    await new Promise(r=>setTimeout(r,1000));const view=await waitForWebview(port,clients);const {client,contextId,sessionId}=view;
    await waitFor(client,contextId,sessionId,entry.file,'document.querySelector("[data-document-title]")?.textContent?.endsWith('+JSON.stringify(entry.file)+')');
    const source=sources.get(entry.id);
    const width=await client.evaluate('innerWidth',contextId,sessionId);
    const coverage=await client.evaluateChecked('('+driveMountedCorpus.toString()+')(document.querySelector(".json-structure-editor"),'+JSON.stringify(corpusNavigationPlan(JSON.parse(source)))+','+JSON.stringify(entry.conditionalKeywordsByPointer)+',{delay:10,compact:'+String(width<=1120)+',requireLayout:true})',contextId,sessionId);
    if(!coverage)throw new Error(entry.id+' installed VSIX visible-control navigation failed (no coverage may be claimed)');
    console.log('VSIX_BEFORE_SAVE '+entry.id+' '+JSON.stringify({unchanged:await readFile(path.join(scratch,entry.file),'utf8')===source}));
    await main.command('Input.dispatchKeyEvent',{type:'keyDown',key:'s',code:'KeyS',windowsVirtualKeyCode:83,nativeVirtualKeyCode:83,modifiers:2});await main.command('Input.dispatchKeyEvent',{type:'keyUp',key:'s',code:'KeyS',windowsVirtualKeyCode:83,nativeVirtualKeyCode:83,modifiers:2});await new Promise(r=>setTimeout(r,300));
    const persisted=await readFile(path.join(scratch,entry.file),'utf8');if(persisted!==source){let offset=0;while(offset<Math.min(source.length,persisted.length)&&source[offset]===persisted[offset])offset++;throw new Error(entry.id+' no-edit traversal changed installed-host source bytes '+JSON.stringify({before:source.length,after:persisted.length,offset,beforeSpan:source.slice(Math.max(0,offset-30),offset+120),afterSpan:persisted.slice(Math.max(0,offset-30),offset+120)}));}
    if(entry.sourcePreservation.required){if(Buffer.byteLength(source)!==entry.sourcePreservation.byteLength||createHash('sha256').update(source).digest('hex')!==entry.sourcePreservation.sha256)throw new Error(entry.id+' protected source no longer matches manifest');totals.hashProtected++;}
    if(entry.id==='cc-17') {
      await client.evaluateChecked(`(async()=>{
        const root=document.querySelector('.json-structure-editor');
        const click=selector=>{const button=root.querySelector(selector);if(!button)throw new Error('Missing mutation control '+selector);button.scrollIntoView({block:'nearest'});button.focus();button.click();};
        if(getComputedStyle(root.querySelector('.js-outline')).display==='none')click('[data-mobile-drawer="types"]');
        click('.js-tree-inline-root');click('[data-schema-child-key="payload"] [data-schema-open]');
        const seed=root.querySelector('[data-rule-keyword="oneOf"] > .js-rule-add [data-composition-seed-kind]');seed.value='ref:#/definitions/BasePayload';seed.dispatchEvent(new Event('change',{bubbles:true}));
        click('[data-rule-keyword="oneOf"] > .js-rule-add [data-composition-add-operand]');
        return true;
      })()`,contextId,sessionId);
      const waitText=async (predicate,expected)=>{const end=Date.now()+15000;let nextSave=0;while(Date.now()<end){if(Date.now()>=nextSave){await main.command('Input.dispatchKeyEvent',{type:'keyDown',key:'s',code:'KeyS',windowsVirtualKeyCode:83,nativeVirtualKeyCode:83,modifiers:2});await main.command('Input.dispatchKeyEvent',{type:'keyUp',key:'s',code:'KeyS',windowsVirtualKeyCode:83,nativeVirtualKeyCode:83,modifiers:2});nextSave=Date.now()+600;}const text=await readFile(path.join(scratch,entry.file),'utf8');if(predicate(text)){await new Promise(r=>setTimeout(r,250));const stable=await readFile(path.join(scratch,entry.file),'utf8');if(stable===text&&predicate(stable))return stable;}await new Promise(r=>setTimeout(r,100));}const actual=await readFile(path.join(scratch,entry.file),'utf8');let offset=0;if(expected)while(offset<Math.min(actual.length,expected.length)&&actual[offset]===expected[offset])offset++;console.log('VSIX_SOURCE_DIFFERENCE '+JSON.stringify({actualLength:actual.length,expectedLength:expected?.length,actualOperands:JSON.parse(actual).properties.payload.oneOf.length,offset,actualSpan:actual.slice(Math.max(0,offset-20),offset+120),expectedSpan:expected?.slice(Math.max(0,offset-20),offset+120)}));throw new Error('Timed out waiting for installed mutation/undo/redo source '+JSON.stringify(await client.evaluate('({pointer:document.querySelector("[data-schema-location-bar]")?.dataset.schemaPointer,count:document.querySelector("[data-rule-keyword=oneOf]")?.dataset.operandCount,status:[...document.querySelectorAll("[role=status]")].map(e=>e.textContent).filter(Boolean)})',contextId,sessionId)));};
      const authoredCount=JSON.parse(source).properties.payload.oneOf.length;
      const modified=await waitText(text=>JSON.parse(text).properties.payload.oneOf.length===authoredCount+1);
      const newOperand=JSON.parse(modified).properties.payload.oneOf.at(-1);
      if(JSON.stringify(newOperand)!==JSON.stringify({type:{$ref:'#/definitions/BasePayload'}}))throw new Error('Installed mutation did not author a canonical typed ref');
      const location=await client.evaluate('document.querySelector("[data-schema-location-bar]")?.dataset.schemaPointer',contextId,sessionId);
      if(location!=='/properties/payload')throw new Error('Installed mutation lost the local legacy schema selection');
      const historyKey=async key=>{const state=await client.evaluateChecked(`(()=>{const heading=document.querySelector('[data-schema-heading]');heading.focus();const event=new KeyboardEvent('keydown',{key:${JSON.stringify(key)},ctrlKey:true,bubbles:true,cancelable:true});heading.dispatchEvent(event);return {prevented:event.defaultPrevented,count:document.querySelector('[data-rule-keyword=oneOf]')?.dataset.operandCount};})()`,contextId,sessionId);console.log('VSIX_HISTORY_KEY '+key+' '+JSON.stringify(state));await new Promise(resolve=>setTimeout(resolve,750));};
      await historyKey('z');await waitText(text=>text===source,source);
      await historyKey('y');await waitText(text=>text===modified,modified);
      await historyKey('z');await waitText(text=>text===source);
      console.log('INSTALLED_VSIX_MUTATION cc-17 canonical ref + undo/redo retained all original source bytes');
    }
    for(const key of ['locations','carriers','keywords','canonicalReferences','legacyReferences'])totals[key]+=coverage[key];totals.documents++;
    console.log('INSTALLED_VSIX '+entry.id+' '+JSON.stringify(coverage));
  }
  console.log('SCHEMA_LOCATION_INSTALLED_VSIX_ACCEPTANCE PASS '+path.basename(artifact)+' '+JSON.stringify(totals));
}finally{
  try{await main?.command('Browser.close');}catch{}
  for(const client of clients.values())client.close();await waitForExit(child,5000);if(child.exitCode===null)child.kill();
  await rm(scratch,{recursive:true,force:true,maxRetries:12,retryDelay:300});
}
