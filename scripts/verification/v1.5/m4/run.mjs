#!/usr/bin/env node
/** Product M4 UI + native DSH question path; scripted model only, isolated profile. */
import {openDesktop} from './desktop.mjs';
import {sourceIdentity} from './source.mjs';
import fs from 'node:fs';import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createReport,ensureRuntime,runtimeIdentity,injectProbeRow} from '../lib/harness.mjs';
import {HostBridge,prepareHome,bootHost,openProbePage,findAskCall,findAskResult} from '../questions/lib/probe.mjs';
import {blockGameSaveWrites,restoreGameSaveWrites} from '../m3/save-fault.mjs';
import {sanitiseM3} from '../m3/lib.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');
const raw=path.join(root,'docs/verification/v1.5/raw/m4');fs.mkdirSync(raw,{recursive:true});
const scenario=process.argv.find(x=>x.startsWith('--scenario='))?.split('=')[1] || 'open';
const saveFault=process.argv.includes('--save-fault');
const desktop=process.argv.includes('--desktop');
const stamp=(desktop?'desktop-':'')+scenario+'-'+new Date().toISOString().replace(/[:.]/g,'-');
const report=createReport({id:'M4-product',title:'Real Game Market UI, native questions and HTML wrapper',commands:['DSH_V15_WORK=/tmp/dsh-v15/m3 node scripts/verification/v1.5/m4/run.mjs '+process.argv.slice(2).join(' ')]});
let host,page,restoreWrites,bridge,sessionId;const dir='/tmp/dgm-m4-'+stamp;
async function check(name,expr){const found=await page.until(expr,20000,200);report.add(name,found!==null);if(found===null)throw new Error(name);}
async function click(selector){await page.eval(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('missing ${selector}');n.click();})()`);}
try{
 report.record('source',sourceIdentity(root));
 ensureRuntime();report.record('runtime',runtimeIdentity());
 const home=await prepareHome('m4-'+stamp,{port:58361,dir});
 injectProbeRow(home,{id:'dsh-game-market',entry:path.join(root,'index.js')});
 bridge=new HostBridge(dir);
 if(desktop){const opened=await openDesktop(home);host=opened.host;page=opened.page;report.add('installed Electron uses isolated profile',true);report.record('browserIdentity',await page.send('Browser.getVersion'));}
 else{host=await bootHost(home,{port:58361,logName:'m4-'+stamp});const opened=await openProbePage(host,{cdpPort:9491});page=opened.page;report.add('native probe control loaded',opened.bootstrapped);}

 const created=await page.eval(`window.__QPROBE__.createSession(${JSON.stringify(dir)},${JSON.stringify(scenario==='continued'?'qprobe-timed':null)})`);
 sessionId=created?.result?.value?.sessionId;if(!sessionId)throw Error('create session failed');
 await page.eval(`window.__QPROBE__.openSession(${JSON.stringify(sessionId)})`);
 await check('session bound',`window.__QPROBE__.sessions().mainSessionId===${JSON.stringify(sessionId)}`);
 await page.eval(`window.__QPROBE__.selectConversation()`);
 await check('game tab registered',`Boolean(document.querySelector('[role="tab"][id*="game"], [data-view-id="game"]')) || document.body.innerText.includes('游戏')`);
 // Open via the public layout seam, then all game/question interactions use real product buttons.
 await page.eval(`window.__QPROBE__.selectPanel ? window.__QPROBE__.selectPanel('dsh-game-market') : window.__QPROBE__.selectGamePanel()`);
 // The probe's own selection helper is keyed to its dummy panel. Public UI route is the sidebar row.
 await page.eval(`(()=>{const nodes=[...document.querySelectorAll('button')];const b=nodes.find(n=>n.getAttribute('title')==='游戏市场'||n.getAttribute('aria-label')==='游戏市场'||n.textContent.trim()==='游戏市场'||n.getAttribute('aria-label')==='Game Market');if(b)b.click();})()`);
 await check('real Game Market mounted',`Boolean(document.querySelector('.dgm-root'))`);
 await click('#dgm-tab-mygames');
 await check('snake product play button',`Boolean(document.querySelector('.dgm-row[data-row-id="snake"] .dgm-row-play'))`);
 await click('.dgm-row[data-row-id="snake"] .dgm-row-play');
 await check('actual snake runtime playing',`document.querySelector('.dgm-runtime')?.getAttribute('data-runtime-state')==='playing'`);
 report.add('html game runs through resource wrapper',await page.eval(`document.querySelector('.dgm-stage-canvas iframe')?.src.includes('/wrapper?')`));
 report.add('outer wrapper is trusted (no sandbox)',await page.eval(`document.querySelector('.dgm-stage-canvas iframe')?.getAttribute('sandbox')===null`));
 report.record('officialLogo',await page.eval(`(()=>{const svg=document.querySelector('.dgm-whale-btn svg');return svg?{viewBox:svg.getAttribute('viewBox'),pathLength:svg.querySelector('path')?.getAttribute('d').length}:null;})()`));
 await bridge.setScenario({mode:scenario==='continued'?'timed':scenario,timeoutSeconds:2});await page.eval(`window.__QPROBE__.promptSession(${JSON.stringify(sessionId)},'M4 product question')`);
 await check('native pending delivered',`window.__QPROBE__.statusOf(${JSON.stringify(sessionId)})?.hasPendingObject===true`);
 if(scenario==='continued')await check('native continued RPC face delivered',`window.__QPROBE__.statusOf(${JSON.stringify(sessionId)})?.pending?.snapshot?.channel==='rpc'`);
 if(saveFault){restoreWrites=blockGameSaveWrites(home,['snake']);}
 await check('whale reflects pending question',`Boolean(document.querySelector('.dgm-whale-btn[data-state="waiting-user"]'))`);
 await click('.dgm-whale-btn');
 if(saveFault){await check('real disk write failure blocks product question',`Boolean(document.querySelector('[data-question-phase="save-failed"]'))`);report.add('failed save exposes no submit',await page.eval(`!document.querySelector('.dgm-question-panel button[type="submit"]')`));restoreGameSaveWrites(restoreWrites);restoreWrites=null;await click('.dgm-question-footer .dgm-btn-primary');}
 await check('product question ready after save',`document.querySelector('[data-question-phase="ready"]')!==null`);
 await click('.dgm-question-option input');
 if(scenario==='multi'){
   await click('.dgm-question-option:nth-of-type(2) input');
   await page.eval(`(()=>{const inputs=document.querySelectorAll('.dgm-question-custom textarea');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(inputs[0],'补充');inputs[0].dispatchEvent(new Event('input',{bubbles:true}));setter.call(inputs[1],'中文输入');inputs[1].dispatchEvent(new Event('input',{bubbles:true}));})()`);
 }
 const logo=await page.eval(`(async()=>{const svg=document.querySelector('.dgm-whale-btn svg');if(!svg)return null;const d=svg.querySelector('path').getAttribute('d');const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(d));return {viewBox:svg.getAttribute('viewBox'),sha256:[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')};})()`);
 report.add('official FishLogo exact outline',logo?.sha256==='5bee701f39229e6dbb3950e8ed7fe69aedc6de462df916ace5e84563715abc47'&&logo?.viewBox==='0 0 23.16 17.04',logo);
 await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
 await page.shot(path.join(raw,'m4-question-light-'+stamp+'.png'));
 report.record('lightLogoColor',await page.eval(`getComputedStyle(document.querySelector('.dgm-whale')).color`));
 await page.eval(`Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});document.dispatchEvent(new Event('visibilitychange'));`);
 await check('hidden page stops presence animation',`document.querySelector('.dgm-presence')?.getAttribute('data-visible')==='false' && getComputedStyle(document.querySelector('.dgm-whale')).animationName==='none'`);
 await page.eval(`delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));`);
 report.add('visible event cannot resume game while question owns hold',await page.eval(`document.querySelector('.dgm-runtime')?.getAttribute('data-runtime-state')==='paused'`));
 await page.send('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:false});
 await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'},{name:'prefers-reduced-motion',value:'reduce'}]});
 await check('narrow sheet stays within viewport and clear of top controls',`(()=>{const r=document.querySelector('.dgm-question-panel')?.getBoundingClientRect();return r && r.left>=15 && r.right<=360 && r.top>=112 && r.bottom<=812;})()`);
 report.record('darkLogoColor',await page.eval(`getComputedStyle(document.querySelector('.dgm-whale')).color`));
 report.add('reduced motion stops whale',await page.eval(`getComputedStyle(document.querySelector('.dgm-whale')).animationName==='none'`));
 await page.eval(`document.querySelector('.dgm-question-option input').focus();document.querySelector('.dgm-question-option input').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));`);
 await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
 await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
 report.add('IME Enter does not submit',await page.eval(`Boolean(document.querySelector('[data-question-phase="ready"]'))`));
 await page.eval(`document.querySelector('.dgm-question-option input').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));`);

 await page.shot(path.join(raw,'m4-question-'+stamp+'.png'));
 await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await check('collapse removes only product dialog',`!document.querySelector('.dgm-question-panel')`);
 await check('collapsed dialog returns focus to an unobstructed whale',`document.activeElement?.classList.contains('dgm-whale-btn') && !document.querySelector('.dgm-overlay[role="dialog"],.dgm-overlay .dgm-modal')`);
 report.add('collapse keeps native question answerable',await page.eval(`window.__QPROBE__.statusOf(${JSON.stringify(sessionId)})?.hasPendingObject===true`));
 const before=await bridge.events(sessionId);report.add('collapse emits no ASK_CANCELLED',!JSON.stringify(before).includes('ASK_CANCELLED'));
 await click('.dgm-whale-btn');
 await check('reopened panel ready',`document.querySelector('[data-question-phase="ready"]')!==null`);
 report.add('draft selection survives collapse',await page.eval(`document.querySelector('.dgm-question-option input')?.checked===true`));
 await click('.dgm-question-panel button[type="submit"]');
 await check('native settlement confirmed in product',`Boolean(document.querySelector('[data-question-phase="settled"]'))`);
 await bridge.waitIdle(sessionId,45000);const events=await bridge.events(sessionId);const call=findAskCall(events),result=call&&findAskResult(events,call.callId);
 if(scenario==='continued'){
   const reply=events.find(e=>e.type==='user/message'&&e.source?.kind==='user-question-reply');
   report.add('continued answer settles original call through native steer',Boolean(reply)&&reply.source.callId===call?.callId,reply?.source);
 }else{
   report.add('same native call contains exact product answer',result?.result?.answers?.[0]?.selected?.[0]==='QPROBE_OPT_A',result);
   if(scenario==='multi')report.add('multi batch preserves both selected labels and exact custom text',result?.result?.answers?.[0]?.selected?.length===2&&result.result.answers[0].custom==='补充'&&result.result.answers[1].custom==='中文输入',result);
 }

 report.add('no native cancellation',!JSON.stringify(events).includes('ASK_CANCELLED'));
 report.add('game stays paused until explicit resume',await page.eval(`document.querySelector('.dgm-runtime')?.getAttribute('data-runtime-state')==='paused'`));
 await page.eval(`document.querySelector('.dgm-question-footer .dgm-btn-primary').click()`);
 await check('explicit continue resumes actual game',`document.querySelector('.dgm-runtime')?.getAttribute('data-runtime-state')==='playing'`);
}catch(error){if(bridge&&sessionId)report.record('failureEvents',await bridge.events(sessionId).catch(()=>null));if(page){report.record('failureNativePending',await page.eval('window.__QPROBE__.statusAll()').catch(()=>null));report.record('failureDom',await page.eval(`({page:document.querySelector('.dgm-root')?.getAttribute('data-page'),phase:document.querySelector('[data-question-phase]')?.getAttribute('data-question-phase'),text:document.querySelector('.dgm-root')?.innerText?.slice(-1600)})`).catch(()=>null));await page.shot(path.join(raw,'m4-failure-'+stamp+'.png')).catch(()=>{});}report.add('run completed',false,String(error?.stack||error).split('\n').slice(0,5).join('\n'));}
finally{if(restoreWrites)restoreGameSaveWrites(restoreWrites);try{page?.dispose();}catch{}if(host)await host.stop();report.add('owned browser stopped',!page?.chrome||page.chrome.exitCode!==null||page.chrome.signalCode!==null);report.add('isolated Host stopped',!host||host.child?.exitCode!==null||host.child?.signalCode!==null);}
const result=report.finish();fs.writeFileSync(path.join(raw,'M4-product-'+stamp+'.json'),JSON.stringify(sanitiseM3(result),null,2)+'\n');console.log(JSON.stringify({passed:result.passed,checks:result.checks},null,2));process.exitCode=result.passed?0:1;
