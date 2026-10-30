#!/usr/bin/env node
/** Actual Desktop UI export -> fresh independent profile import -> restart -> Continue. */
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {startDesktopLab} from './desktop-lab.mjs';
import {createCdpCapture} from '../m2/lib/lab.mjs';
import {openMarketPanel,openMyGamesTab,launchFromRow,leaveRuntime,waitFor} from '../m2/lib/ui.mjs';
import {readState,pressKey,waitForProbeHook} from '../m2/m2-a08-orbit-courier.mjs';
import {createReport,sleep,runtimeIdentity} from '../lib/harness.mjs';
import {sanitiseM3} from '../m3/lib.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');const raw=path.join(root,'docs/verification/v1.5/raw/m5');fs.mkdirSync(raw,{recursive:true});
const stamp=new Date().toISOString().replace(/[:.]/g,'-');const downloads=path.join('/tmp','dgm-m5-downloads-'+stamp);fs.mkdirSync(downloads,{recursive:true});
const report=createReport({id:'M5-Desktop-migration',title:'Native UI save portability and App restart',commands:['DSH_V15_WORK=/tmp/dsh-v15/m3 node scripts/verification/v1.5/m5/migration.mjs']});
let a,b,capture;
async function check(name,ok,detail){report.add(name,Boolean(ok),detail);if(!ok)throw Error(name);}
async function until(page,expr){return page.until(expr,20000,200);}
async function menu(page,label){await openMyGamesTab(page);await until(page,`Boolean(document.querySelector('.dgm-row[data-row-id="orbit-courier"] .dgm-row-menu-btn'))`);await page.eval(`document.querySelector('.dgm-row[data-row-id="orbit-courier"] .dgm-row-menu-btn').click()`);await until(page,`Boolean(document.querySelector('.dgm-menu'))`);await page.eval(`(()=>{const b=[...document.querySelectorAll('.dgm-menu button')].find(x=>x.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('missing menu');b.click();})()`);}
async function closeDialog(page){await page.eval(`document.querySelector('[data-transfer-phase] .dgm-modal-actions .dgm-btn').click()`);}
try{
 report.record('runtime',runtimeIdentity());a=await startDesktopLab({name:'m5-transfer-a-'+stamp,port:9496});let p=a.page;
 capture=createCdpCapture(p);await capture.start();await openMarketPanel(p);await launchFromRow(p,capture,'orbit-courier');await waitForProbeHook(capture);
 const first=await readState(capture);await pressKey(p,first.sessionId,'Enter');await sleep(3500);
 const before=await readState(capture);await check('source actual game has live elapsed progress',before?.state?.elapsedMs>1500,before?.state&&{elapsedMs:before.state.elapsedMs,score:before.state.score});
 await leaveRuntime(p);await p.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
 await menu(p,'导出游戏进度');await p.eval(`document.querySelector('[data-transfer-phase] .dgm-btn-primary').click()`);
 await check('native export reports download start',await until(p,`Boolean(document.querySelector('[data-transfer-phase="done"]'))`));
 const downloaded=await waitFor(async()=>{const f=fs.readdirSync(downloads).find(x=>x.endsWith('-save.json'));return f?path.join(downloads,f):null;},15000);
 await check('browser produced portable file',downloaded);const portable=JSON.parse(fs.readFileSync(downloaded,'utf8'));
 await check('export contains game progress only',portable.gameId==='orbit-courier'&&Object.keys(portable).sort().join(',')==='format,gameId,gameVersion,saveSchemaVersion,sha256,values');
 await closeDialog(p);await a.stop();a=null;
 b=await startDesktopLab({name:'m5-transfer-b-'+stamp,port:9496});p=b.page;await openMarketPanel(p);await menu(p,'导入游戏进度');
 const dom=await p.send('DOM.getDocument');const node=await p.send('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'[data-transfer-phase] input[type=file]'});await p.send('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[downloaded]});
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
 await check('Continue restores imported elapsed progress after actual App restart',resumed?.state?.phase==='playing'&&resumed.state.elapsedMs>=before.state.elapsedMs-1500,{before:before.state.elapsedMs,after:resumed?.state?.elapsedMs});
 await p.shot(path.join(raw,'M5-migration-'+stamp+'.png'));
}catch(e){report.add('completed',false,String(e?.stack||e).split('\n').slice(0,5).join('\n'));}
finally{const owned=[a,b].filter(Boolean);for(const lab of owned)await lab.stop();report.add('owned Desktop instances stopped',owned.every(lab=>lab.host.child.exitCode!==null||lab.host.child.signalCode!==null));}
const result=report.finish();fs.writeFileSync(path.join(raw,'M5-migration-'+stamp+'.json'),JSON.stringify(sanitiseM3(result),null,2)+'\n');console.log(JSON.stringify(result,null,2));process.exitCode=result.passed?0:1;
