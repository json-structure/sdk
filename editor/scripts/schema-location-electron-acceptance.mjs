import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import axe from 'axe-core';
import {CdpClient,freePort,waitForTargets,waitForExit} from '../../vscode/scripts/vsix-ui-acceptance.mjs';
import {corpusNavigationPlan,driveMountedCorpus} from '../tests/support/schema-location-corpus.mjs';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixtures=path.join(project,'tests/fixtures/conditional-composition-adversarial');
const manifest=JSON.parse(await readFile(path.join(fixtures,'manifest.json'),'utf8'));
const executable=process.env.JSON_STRUCTURE_ELECTRON_EXECUTABLE||path.join(project,'release/win-unpacked/JSON Structure Editor.exe');
const scratch=path.join(project,'build','schema-location-electron-'+process.pid);
const only=process.env.JSON_STRUCTURE_CORPUS_IDS?.split(',');
const entries=manifest.documents.filter(e=>!only||only.includes(e.id));
const totals={documents:0,locations:0,carriers:0,keywords:0,canonicalReferences:0,legacyReferences:0,hashProtected:0};
await mkdir(scratch,{recursive:true});
try {
  for(const entry of entries){
    const source=await readFile(path.join(fixtures,entry.file),'utf8');
    const fixture=path.join(scratch,entry.file);await writeFile(fixture,source,'utf8');
    const port=await freePort();
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
    const child=spawn(executable,['--disable-gpu','--no-sandbox','--remote-debugging-port='+port,'--user-data-dir='+path.join(scratch,'user-'+entry.id),fixture],{cwd:path.dirname(executable),env,stdio:'ignore',windowsHide:true});
    let client;
    try {
      const targets=await waitForTargets(port);const target=targets.find(t=>t.type==='page');if(!target)throw new Error('Packaged Electron renderer missing');client=new CdpClient(target);await client.connect();
      const wait=async(predicate)=>{const end=Date.now()+30000;while(Date.now()<end){if(await client.evaluate(predicate))return;await new Promise(r=>setTimeout(r,100));}throw new Error('Timeout: '+predicate+'; renderer '+JSON.stringify(await client.evaluate('({url:location.href,title:document.querySelector("[data-document-title]")?.textContent,text:document.body.innerText.slice(0,1500)})')));};
      await wait('document.querySelector(".js-shell") !== null && document.querySelector("[data-document-title]")?.textContent?.endsWith('+JSON.stringify(entry.file)+')');
      await client.command('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
      const coverage=await client.evaluateChecked('('+driveMountedCorpus.toString()+')(document.querySelector(".json-structure-editor"),'+JSON.stringify(corpusNavigationPlan(JSON.parse(source)))+','+JSON.stringify(entry.conditionalKeywordsByPointer)+',{delay:5,requireLayout:true})');
      if(!coverage)throw new Error(entry.id+' mounted corpus driver threw; no coverage may be claimed');
      // Save the actual mounted session via the normal host keyboard command before comparing disk bytes.
      await client.evaluate('window.dispatchEvent(new KeyboardEvent("keydown",{key:"s",ctrlKey:true,bubbles:true})); true');await new Promise(r=>setTimeout(r,250));
      if(await readFile(fixture,'utf8')!==source)throw new Error(entry.id+' no-edit traversal changed saved source bytes');
      if(entry.sourcePreservation.required){if(Buffer.byteLength(source)!==entry.sourcePreservation.byteLength||createHash('sha256').update(source).digest('hex')!==entry.sourcePreservation.sha256)throw new Error(entry.id+' protected fixture differs from manifest');totals.hashProtected++;}
      for(const key of ['locations','carriers','keywords','canonicalReferences','legacyReferences'])totals[key]+=coverage[key];totals.documents++;
      console.log('PACKAGED_ELECTRON '+entry.id+' '+JSON.stringify(coverage));
      if(['cc-02','cc-05','cc-07','cc-17','cc-20'].includes(entry.id)){
        for (const viewport of [{width:720,height:450},{width:390,height:844}]) {
        await client.command('Emulation.setDeviceMetricsOverride',{...viewport,deviceScaleFactor:1,mobile:false});
        await client.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
        const compact=await client.evaluateChecked('('+driveMountedCorpus.toString()+')(document.querySelector(".json-structure-editor"),'+JSON.stringify(corpusNavigationPlan(JSON.parse(source)))+','+JSON.stringify(entry.conditionalKeywordsByPointer)+',{delay:5,compact:true,requireLayout:true})');
        if(!compact)throw new Error(entry.id+' compact/200% equivalent navigation failed');
        await client.evaluate(axe.source);
        const accessibility=await client.evaluate('axe.run(document.querySelector("[data-panel-mode=design]"),{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21a","wcag21aa"]}}).then(r=>r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary,html:n.html}))})))');
        const layout=await client.evaluate('({rail:document.querySelector(".js-activity").getBoundingClientRect().width,pointerDirection:getComputedStyle(document.querySelector("[data-schema-location-pointer]")).direction,headingFocused:document.activeElement?.hasAttribute("data-schema-heading")})');
        if(layout?.rail!==46 || layout?.pointerDirection!=='ltr')throw new Error(entry.id+' rail/pointer direction regression '+JSON.stringify(layout));
        console.log('PACKAGED_ELECTRON_COMPACT '+entry.id+' '+JSON.stringify({viewport,locations:compact.locations,layout,accessibility}));
        if(accessibility?.some(v=>v.impact==='critical'||v.impact==='serious'))throw new Error(entry.id+' serious/critical accessibility violations');
        }
      }
    }finally{
      try{await client?.evaluate('void window.electronAPI.executeWindowCommand("quit");true');}catch{}
      await waitForExit(child,5000);if(child.exitCode===null)child.kill();client?.close();
    }
  }
  console.log('SCHEMA_LOCATION_PACKAGED_ELECTRON_ACCEPTANCE PASS '+JSON.stringify(totals));
}finally{await rm(scratch,{recursive:true,force:true,maxRetries:8,retryDelay:250});}
