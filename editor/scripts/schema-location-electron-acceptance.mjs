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
        await client.evaluate('document.querySelector("[data-schema-open]")?.click();true');
        await wait('document.querySelector("[data-schema-location-bar]") !== null');
        const layout=await client.evaluate(`(()=>{
          const activity=document.querySelector(".js-activity"),center=document.querySelector(".js-center"),design=document.querySelector("[data-panel-mode=design]"),bar=document.querySelector("[data-schema-location-bar]"),pointer=document.querySelector("[data-schema-location-pointer]");
          const rows=[...document.querySelectorAll(".js-inline-property-row")].map(row=>row.getBoundingClientRect().height);
          return {rail:getComputedStyle(activity).display==="none"?0:activity.getBoundingClientRect().width,centerWidth:center.clientWidth,centerScrollWidth:center.scrollWidth,designWidth:design.clientWidth,designScrollWidth:design.scrollWidth,barHeight:bar.getBoundingClientRect().height,maxPropertyRowHeight:Math.max(0,...rows),pointerDirection:getComputedStyle(pointer).direction,headingFocused:document.activeElement?.hasAttribute("data-schema-heading")};
        })()`);
        const contrasts=await client.evaluate(`(()=>{
          const host=document.querySelector(".json-structure-editor"),original=host.dataset.theme;
          const rgb=value=>value.match(/[\\d.]+/g).slice(0,3).map(Number);
          const luminance=color=>color.map(channel=>{const value=channel/255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
          const ratio=(foreground,background)=>{const values=[luminance(rgb(foreground)),luminance(rgb(background))].sort((a,b)=>b-a);return (values[0]+.05)/(values[1]+.05);};
          const results=["dark","light","contrast"].map(theme=>{host.dataset.theme=theme;const controls=[...document.querySelectorAll(".js-schema-action:not(:disabled),.js-schema-breadcrumb-action:not(:disabled)")].filter(control=>control.getBoundingClientRect().width>0);return {theme,min:Math.min(...controls.map(control=>{const style=getComputedStyle(control);return ratio(style.color,style.backgroundColor);})),count:controls.length};});
          host.dataset.theme=original;return results;
        })()`);
        const expectedRail=viewport.width<=620?0:46;
        const maxBarHeight=viewport.width<=620?54:40;
        if(layout?.rail!==expectedRail || layout?.pointerDirection!=='ltr' || layout?.barHeight>maxBarHeight || layout?.centerScrollWidth>layout?.centerWidth+1 || layout?.designScrollWidth>layout?.designWidth+1 || layout?.maxPropertyRowHeight>180)throw new Error(entry.id+' compact layout regression '+JSON.stringify({viewport,layout}));
        if(contrasts.some(result=>result.count===0||result.min<4.5))throw new Error(entry.id+' schema control contrast regression '+JSON.stringify(contrasts));
        console.log('PACKAGED_ELECTRON_COMPACT '+entry.id+' '+JSON.stringify({viewport,locations:compact.locations,layout,contrasts,accessibility}));
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
