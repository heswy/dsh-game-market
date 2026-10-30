#!/usr/bin/env node
/** Reopen an owned exact-install profile and verify the packaged ZIP game. */
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {openDesktop} from '../m4/desktop.mjs';
import {createCdpCapture} from '../m2/lib/lab.mjs';
import {openMarketPanel,launchFromRow,readUiState,waitFor} from '../m2/lib/ui.mjs';
import {readState,pressKey} from '../m2/m2-a08-orbit-courier.mjs';
import {createReport,sanitiseM3} from '../m3/lib.mjs';
const args=process.argv.slice(2),home=args[args.indexOf('--home')+1];
if(!home?.startsWith('/tmp/dsh-v15/m3/home-m5-native-'))throw Error('owned native profile required');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..'),raw=path.join(root,'docs/verification/v1.5/raw/m5');
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),report=createReport({id:'M5-installed-ZIP',title:'Reopen exact installed candidate and run packaged Orbit Courier',commands:['node scripts/verification/v1.5/m5/installed-game.mjs --home '+home]});
let desktop,capture;function check(name,ok,detail){report.add(name,Boolean(ok),detail);console.log((ok?'PASS ':'FAIL ')+name);if(!ok)throw Error(name);}
try{
 const manifest=JSON.parse(fs.readFileSync(path.join(home,'profiles/desktop/package.json'),'utf8'));report.record('exactProfileDependency',manifest.dependencies?.['dsh-game-market']);
 desktop=await openDesktop(home,{port:9497});const p=desktop.page;capture=createCdpCapture(p);await capture.start();await openMarketPanel(p);await launchFromRow(p,capture,'orbit-courier');
 const ready=await waitFor(async()=>{const state=await readState(capture);return state?.state?.phase==='ready'?state:null;},30000);
 report.record('nativeUI',await readUiState(p));report.record('runtimeText',await p.eval(`document.querySelector('.dgm-runtime')?.innerText || null`));
 report.record('frameDiagnostics',await Promise.all(capture.state.attached.filter(f=>f.type==='iframe').map(async f=>{try{return await capture.evaluate(f.sessionId,`({title:document.title,body:document.body.innerText.slice(0,1500),orbit:!!window.__orbitCourier,probe:!!window.__ORBIT_PROBE__})`);}catch(e){return {error:String(e.message)}}})));
 await p.shot(path.join(raw,'M5-installed-ZIP-'+stamp+'.png'));check('packaged ZIP reaches real ready state',ready);
 await pressKey(p,ready.sessionId,'Enter');const playing=await waitFor(async()=>{const state=await readState(capture);return state?.state?.phase==='playing'&&state.state.elapsedMs>1000?state:null;},10000);check('packaged ZIP actually advances after real keyboard input',playing,playing?.state);
}catch(e){report.add('completed',false,String(e.stack||e).split('\n').slice(0,6).join('\n'));}
finally{if(capture){report.record('browserLogs',capture.state.logs.slice(-12));report.record('browserConsole',capture.state.console.slice(-12));}if(desktop){desktop.page.dispose();await desktop.host.stop();report.add('owned App stopped',desktop.host.child.exitCode!==null||desktop.host.child.signalCode!==null);}}
const result=report.finish();fs.writeFileSync(path.join(raw,'M5-installed-ZIP-'+stamp+'.json'),JSON.stringify(sanitiseM3(result),null,2)+'\n');console.log(JSON.stringify(result,null,2));process.exitCode=result.passed?0:1;
