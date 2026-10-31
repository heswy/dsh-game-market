#!/usr/bin/env node
/**
 * Actual Desktop UI export -> fresh independent profile import -> restart -> Continue.
 *
 * Default mode runs both sides on one machine (A exports, B imports).
 * `--portable <file>` is the *target-machine* mode for the physical
 * cross-machine gate: copy the JSON exported on machine A to machine B, then
 * run this command on B. Evidence records the host identity and the portable
 * file SHA-256 on both sides so the two records can be paired.
 */
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {startDesktopLab} from './desktop-lab.mjs';
import {createCdpCapture} from '../m2/lib/lab.mjs';
import {openMarketPanel,openMyGamesTab,launchFromRow,leaveRuntime,waitFor} from '../m2/lib/ui.mjs';
import {readState,pressKey,waitForProbeHook} from '../m2/m2-a08-orbit-courier.mjs';
import {createReport,sleep,runtimeIdentity} from '../lib/harness.mjs';
import {sanitiseM3} from '../m3/lib.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');const raw=path.join(root,'docs/verification/v1.5/raw/m5');fs.mkdirSync(raw,{recursive:true});
const args=process.argv.slice(2),portableArg=(()=>{const i=args.indexOf('--portable');return i>=0?args[i+1]:null})();
if(portableArg!==null&&!fs.existsSync(portableArg))throw Error('--portable file not found: '+portableArg);
const targetMode=portableArg!==null;
const stamp=new Date().toISOString().replace(/[:.]/g,'-');const downloads=path.join('/tmp','dgm-m5-downloads-'+stamp);fs.mkdirSync(downloads,{recursive:true});
const sha256File=(file)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const hostIdentity={hostname:os.hostname(),platform:process.platform,arch:process.arch};
const report=createReport({
  id:targetMode?'M5-Desktop-migration-target':'M5-Desktop-migration',
  title:targetMode?'Cross-machine target profile imports exported progress and resumes after App restart':'Native UI save portability and App restart',
  commands:['node scripts/verification/v1.5/m5/migration.mjs'+(targetMode?' --portable '+portableArg:'')],
});
let a,b,capture;
let captureB=null;
async function check(name,ok,detail){report.add(name,Boolean(ok),detail);if(!ok)throw Error(name);}
async function until(page,expr){return page.until(expr,20000,200);}
async function menu(page,action){const label={export:/导出游戏进度|Export progress/,import:/导入游戏进度|Import progress/}[action];await openMyGamesTab(page);const selected=await waitFor(async()=>{const state=await page.eval(`(()=>{const row=document.querySelector('.dgm-row[data-row-id="orbit-courier"]');if(!row)return 'no-row';const scope=row.querySelector('.dgm-menu');if(!scope){const btn=row.querySelector('.dgm-row-menu-btn');if(!btn)return 'no-btn';btn.click();return 'clicked';}const buttons=[...scope.querySelectorAll('button')];const target=buttons.find(x=>(${label}).test((x.textContent||'').trim()));if(!target)return 'no-item:'+buttons.map(x=>(x.textContent||'').trim()).join('|');target.click();return 'selected:'+((target.textContent||'').trim());})()`);return typeof state==='string'&&state.startsWith('selected:')?state:null;},15000,500);report.record('menuSelected-'+action,selected);await sleep(800);report.record('menuAfter-'+action,await page.eval(`(()=>{const row=document.querySelector('.dgm-row[data-row-id="orbit-courier"]');const menu=row&&row.querySelector('.dgm-menu');return {row:Boolean(row),menu:menu?[...menu.querySelectorAll('button')].map(b=>({label:(b.textContent||'').trim(),disabled:b.disabled})):null,overlays:document.querySelectorAll('.dgm-overlay').length,transfer:Boolean(document.querySelector('[data-transfer-phase]')),toasts:[...document.querySelectorAll('.dgm-toast,.dgm-toast-item')].map(x=>(x.textContent||'').trim()).slice(0,5)};})()`));}
async function closeDialog(page){await page.eval(`document.querySelector('[data-transfer-phase] .dgm-modal-actions .dgm-btn').click()`);}
try{
 report.record('runtime',runtimeIdentity());report.record('host',hostIdentity);report.record('mode',targetMode?'target-machine':'same-machine');
 let portable=null,portableFile=null,expectedElapsed=0;
 if(targetMode){
  portableFile=path.join('/tmp','dgm-m5-portable-'+stamp+'.json');
  fs.copyFileSync(portableArg,portableFile);
  portable=JSON.parse(fs.readFileSync(portableArg,'utf8'));
  await check('portable file carries orbit-courier progress',portable.gameId==='orbit-courier'&&Object.keys(portable).sort().join(',')==='format,gameId,gameVersion,saveSchemaVersion,sha256,values');
  expectedElapsed=Number(portable.values?.run?.elapsedMs)||0;
  await check('portable file carries live elapsed progress',expectedElapsed>0,{expectedElapsed});
  report.record('portableFile',{file:portableArg,stagedFile:portableFile,sha256:sha256File(portableArg),bytes:fs.statSync(portableArg).size});
 }else{
  a=await startDesktopLab({name:'m5-transfer-a-'+stamp,port:9496});let p=a.page;
  capture=createCdpCapture(p);await capture.start();await openMarketPanel(p);await launchFromRow(p,capture,'orbit-courier');await waitForProbeHook(capture);
  const first=await readState(capture);await pressKey(p,first.sessionId,'Enter');await sleep(3500);
  const before=await readState(capture);await check('source actual game has live elapsed progress',before?.state?.elapsedMs>1500,before?.state&&{elapsedMs:before.state.elapsedMs,score:before.state.score});
  await leaveRuntime(p);await p.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
  await menu(p,'export');await p.eval(`document.querySelector('[data-transfer-phase] .dgm-btn-primary').click()`);
  await check('native export reports download start',await until(p,`Boolean(document.querySelector('[data-transfer-phase="done"]'))`));
  const downloaded=await waitFor(async()=>{const f=fs.readdirSync(downloads).find(x=>x.endsWith('-save.json'));return f?path.join(downloads,f):null;},15000);
  await check('browser produced portable file',downloaded);portableFile=downloaded;portable=JSON.parse(fs.readFileSync(downloaded,'utf8'));
  await check('export contains game progress only',portable.gameId==='orbit-courier'&&Object.keys(portable).sort().join(',')==='format,gameId,gameVersion,saveSchemaVersion,sha256,values');
  expectedElapsed=Number(portable.values?.run?.elapsedMs)||0;
  await check('export carries live elapsed progress',expectedElapsed>0,{expectedElapsed,sourceElapsed:before?.state?.elapsedMs});
  report.record('portableFile',{file:downloaded,sha256:sha256File(downloaded),bytes:fs.statSync(downloaded).size});
  await closeDialog(p);await a.stop();a=null;
 }
 b=await startDesktopLab({name:'m5-transfer-b-'+stamp,port:9496});let p=b.page;captureB=createCdpCapture(p);await captureB.start();await openMarketPanel(p);await menu(p,'import');await check('import dialog opens',await until(p,`Boolean(document.querySelector('[data-transfer-phase] input[type=file]'))`));
 report.record('transferDialog',await p.eval(`(()=>{const d=document.querySelector('[data-transfer-phase]');const input=d&&d.querySelector('input[type=file]');return d?{phase:d.getAttribute('data-transfer-phase'),text:(d.innerText||'').slice(0,300),fileInputs:input?1:0}:null;})()`));
 const dom=await p.send('DOM.getDocument');const node=await p.send('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'[data-transfer-phase] input[type=file]'});await p.send('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[portableFile]});
 await check('destination previews imported save',await until(p,`Boolean(document.querySelector('[data-transfer-phase="ready"]'))`));
 await p.eval(`document.querySelector('[data-transfer-phase] .dgm-btn-primary').click()`);await check('native import succeeds into clean profile',await until(p,`Boolean(document.querySelector('[data-transfer-phase="done"]'))`));
 const disk=JSON.parse(fs.readFileSync(path.join(b.home,'storages/dsh-game-market/saves/orbit-courier/current.json'),'utf8'));
 await check('all portable values preserved byte-for-byte semantically',JSON.stringify(disk.values)===JSON.stringify(portable.values));
 await closeDialog(p);const home=b.home;await b.stop();b=null;
 b=await startDesktopLab({name:'m5-transfer-reopen-'+stamp,port:9496,home});p=b.page;capture=createCdpCapture(p);await capture.start();await openMarketPanel(p);await launchFromRow(p,capture,'orbit-courier');await waitForProbeHook(capture);
 const reopened=await readState(capture);
 const available=await capture.evaluate(reopened.sessionId,`Boolean(document.getElementById('btn-continue'))`);
 await check('real App restart offers game Continue from imported progress',available);
 await pressKey(p,reopened.sessionId,'Enter');await sleep(700);const resumed=await readState(capture);
 await check('Continue restores imported elapsed progress after actual App restart',resumed?.state?.phase==='playing'&&resumed.state.elapsedMs>=expectedElapsed-1500,{portableElapsed:expectedElapsed,after:resumed?.state?.elapsedMs});
 await p.shot(path.join(raw,'M5-migration-'+(targetMode?'target-':'')+stamp+'.png'));
}catch(e){report.add('completed',false,String(e?.stack||e).split('\n').slice(0,5).join('\n'));}
finally{const owned=[a,b].filter(Boolean);for(const lab of owned)await lab.stop();report.add('owned Desktop instances stopped',owned.every(lab=>lab.host.child.exitCode!==null||lab.host.child.signalCode!==null));if(captureB){report.record('browserConsole',captureB.state.console.slice(-20));report.record('browserLogs',captureB.state.logs.slice(-20));}}
const result=report.finish();fs.writeFileSync(path.join(raw,'M5-migration-'+(targetMode?'target-':'')+stamp+'.json'),JSON.stringify(sanitiseM3(result),null,2)+'\n');console.log(JSON.stringify(result,null,2));process.exitCode=result.passed?0:1;
