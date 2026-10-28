#!/usr/bin/env node
/** Real installed Desktop exact Git install and UI update; isolated fixed-index fixture. */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {prepareHome,BUNDLE,appendPatch} from '../questions/lib/probe.mjs';
import {openDesktop} from '../m4/desktop.mjs';
import {Probe,injectProbeRow,createReport,sanitiseM3,sleep} from '../m3/lib.mjs';
import {makeScenarioEnvironment,startTransport,buildIndexBody,installExactWithRetry,waitForHostVersion,ensureMarketPanelOpen,ensureUpdateSectionRendered,beginUpdateThroughUi,waitForOperation,inspectFromPage,healthFromPage,ensureDiscoveryTarget,readUpdateUi,refreshDiscoveryThroughUi} from '../m3/v1-common.mjs';
import {createCdpCapture} from '../m2/lib/lab.mjs';
import {launchFromRow,leaveRuntime,waitFor} from '../m2/lib/ui.mjs';
import {readState,pressKey,waitForProbeHook} from '../m2/m2-a08-orbit-courier.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');
const args=process.argv.slice(2),get=k=>args[args.indexOf(k)+1];
const base=get('--base'),target=get('--target'),version=get('--version');
if(!/^[0-9a-f]{40}$/.test(base)||!/^[0-9a-f]{40}$/.test(target)||!version)throw Error('--base --target full commit and --version required');
const hops=[{commit:target,version}];
if(args.includes('--next'))hops.push({commit:get('--next'),version:get('--next-version')});
for(const hop of hops){if(!/^[0-9a-f]{40}$/.test(hop.commit)||!hop.version)throw Error('invalid next target');hop.identity=JSON.parse(execFileSync('git',['show',hop.commit+':platform-updates/release.json'],{cwd:root,encoding:'utf8'}));}
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),tag='m5-native-'+stamp;
const raw=path.join(root,'docs/verification/v1.5/raw/m5');fs.mkdirSync(raw,{recursive:true});
const runDir=path.join('/tmp/dsh-v15/m3',tag),report=createReport({id:'M5-native-install-update',title:'Actual Desktop exact public Git install, UI update, game save, App restart',commands:['node scripts/verification/v1.5/m5/native-install-update.mjs '+args.join(' ')]});
let desktop,transport,probe,home;const children=[];
function check(name,ok,detail){console.log((ok?'PASS ':'FAIL ')+name);report.add(name,Boolean(ok),detail);if(!ok)throw Error(name);}
try{
 const env=makeScenarioEnvironment(tag);transport=await startTransport(env);check('network gate',transport.networkGate.ok,transport.networkGate);
 transport.control.setFixtureBody(buildIndexBody({versions:[{version,commit:target}]}));
 home=await prepareHome(tag,{port:58492,dir:path.join(runDir,'questions')});
 // Neutral test-only paths avoid the adapter mistaking an unrelated probe for a linked product row.
 const neutral=path.join(runDir,'qprobe');fs.cpSync(BUNDLE,neutral,{recursive:true});
 const patch=path.join(home,'profiles/web/cordis.patch.yml');fs.writeFileSync(patch,fs.readFileSync(patch,'utf8').replaceAll(BUNDLE,neutral));
 injectProbeRow(home,{runDir:path.join(runDir,'probe'),bootTag:tag});
 const nativeEnv=transport.envForHost({marker:tag});
 desktop=await openDesktop(home,{port:9497,env:nativeEnv});children.push(desktop.host.child);probe=new Probe(tag,{runDir:path.join(runDir,'probe'),home});await probe.waitReady();report.record('nativeBoot',probe.boot);
 const disk=JSON.parse(fs.readFileSync(path.join(home,'profiles/desktop/package.json'),'utf8'));
 check('fresh native profile has no product dependency',!disk.dependencies?.['dsh-game-market']);
 const installed=await installExactWithRetry(probe,{spec:`https://github.com/heswy/dsh-game-market.git#${base}`,requestIdBase:tag,attempts:3});
 report.record('publicGitInstall',installed);check('native manager applied public exact Git base',installed.result?.application==='applied',installed.result);
 const ready=await waitForHostVersion(probe,'1.3.0');check('base Host loaded',ready.ok,ready);
 probe.commands=[];probe.writeInbox();desktop.page.dispose();await desktop.host.stop();desktop=null;
 appendPatch(home,'- id: dsh-game-market\n  config:\n    platformUpdate:\n      channel: test','desktop');
 report.record('channel','explicit test channel in isolated Desktop profile; production stable unchanged');
 desktop=await openDesktop(home,{port:9497,env:nativeEnv});children.push(desktop.host.child);
 let p=desktop.page;await p.send('Page.reload');await p.until('Boolean(window.__QPROBE__)',90000,300);await ensureMarketPanelOpen(p);
 // Base 1.3.0 ZIP cannot run in native origin (M4 fixes it); its HTML game is the legacy upgrade/save regression.
 const capture=createCdpCapture(p);await capture.start();await launchFromRow(p,capture,'snake');
 const snakeFrame=await waitFor(async()=>{for(const frame of capture.state.attached){try{if(await capture.evaluate(frame.sessionId,'window.__dshSnakeDebug?.().mode === "ready"'))return frame;}catch{}}return null;},20000);
 check('base actual game document is ready',snakeFrame);
 const started=await capture.evaluate(snakeFrame.sessionId,`(()=>{const button=document.getElementById('primary');if(!button||button.hidden)return false;button.click();return true;})()`);check('start through legacy game visible UI button',started);await sleep(700);
 const played=await capture.evaluate(snakeFrame.sessionId,'window.__dshSnakeDebug()');check('base game actually advanced',played.mode==='playing'&&played.moving,played);await leaveRuntime(p);
 const savePath=path.join(home,'storages/dsh-game-market/saves/snake/current.json');check('base actual game persisted a save',fs.existsSync(savePath));const before=JSON.parse(fs.readFileSync(savePath,'utf8'));
 let previousOperationId=null;
 for(const hop of hops){
 const {version,commit,identity:expected}=hop;
 transport.control.setFixtureBody(buildIndexBody({versions:[{version,commit}]}));
 await ensureUpdateSectionRendered(p);const refreshed=await refreshDiscoveryThroughUi(p,{allowApiFallback:false});check(version+' refresh uses real UI',refreshed.clicked,refreshed);
 const discovered=await ensureDiscoveryTarget(p,{version,commit,allowApiFallback:false});check(version+' discovered through UI',discovered.ok,discovered);
 const begin=await beginUpdateThroughUi(p,{expectVersion:version,previousOperationId});check(version+' native UI starts target update',begin.operationId&&begin.dialogMatchesTargetVersion,begin);
 previousOperationId=begin.operationId;
 const settled=await waitForOperation(p,['updated','pending-restart','stale-runtime','activating','failed','verification-failed'],{timeoutMs:420000});report.record(version+' updateTerminal',settled);
 check(version+' native installation reaches activation or restart state',['updated','pending-restart','stale-runtime','activating'].includes(settled.state),settled);
 const after=JSON.parse(fs.readFileSync(savePath,'utf8'));check(version+' real game save preserved across native update',JSON.stringify(before)===JSON.stringify(after));
 probe.commands=[];probe.writeInbox();desktop.page.dispose();await desktop.host.stop();desktop=null;
 desktop=await openDesktop(home,{port:9497,env:nativeEnv});children.push(desktop.host.child);p=desktop.page;await ensureMarketPanelOpen(p);
 const health=await healthFromPage(p),inspect=await inspectFromPage(p);report.record(version+' reopenedHealth',health);report.record(version+' reopenedIdentity',inspect);
 check(version+' reopened native Host reports candidate',inspect.data?.host?.version===version&&inspect.data.host.commit===commit,inspect.data?.host);
 await ensureUpdateSectionRendered(p);const identities=(await readUpdateUi(p)).identities;report.record(version+' nativeRenderedIdentities',identities);check(version+' rendered Host and Client both carry candidate identity',identities.length>=2&&identities[0].version===version&&identities[0].commitAttr===commit&&identities[1].version===version&&identities[1].commitAttr===expected.clientBuildCommit,identities);
 const activated=await waitForOperation(p,['updated','failed','verification-failed'],{timeoutMs:90000});check(version+' operation confirms actual activation',activated.state==='updated'&&activated.observation?.operationId===begin.operationId,activated);
 check(version+' reopened profile dependency is immutable target',fs.readFileSync(path.join(home,'profiles/desktop/package.json'),'utf8').includes(commit));
 check(version+' save survives actual App restart',JSON.stringify(before)===JSON.stringify(JSON.parse(fs.readFileSync(savePath,'utf8'))));
 }
 const restoredCapture=createCdpCapture(p);await restoredCapture.start();await launchFromRow(p,restoredCapture,'snake');
 const restored=await waitFor(async()=>{for(const frame of restoredCapture.state.attached){try{const state=await restoredCapture.evaluate(frame.sessionId,'window.__dshSnakeDebug?.() || null');if(state?.restoredSave)return state;}catch{}}return null;},20000);
 check('actual legacy game loaded pre-update save after both hops',restored?.restoredSave===true,restored);await leaveRuntime(p);
 const gameCapture=restoredCapture;await launchFromRow(p,gameCapture,'orbit-courier');const state=await waitFor(async()=>{const current=await readState(gameCapture);return current?.state?.phase==='ready'?current:null;},30000);check('candidate ZIP real document is initialized',state);await pressKey(p,state.sessionId,'Enter');const playing=await waitFor(async()=>{const current=await readState(gameCapture);return current?.state?.phase==='playing'&&current.state.elapsedMs>1000?current:null;},10000);check('candidate ZIP actually plays in native origin',playing,playing?.state);
 await p.shot(path.join(raw,'M5-native-update-'+stamp+'.png'));
}catch(e){report.add('completed',false,String(e.stack||e).split('\n').slice(0,6).join('\n'));}
finally{if(desktop){desktop.page.dispose();await desktop.host.stop();}if(transport){report.record('isolatedIndexTransport',transport.audit());await transport.close();}report.add('owned App instances stopped',children.every(c=>c.exitCode!==null||c.signalCode!==null));}
const result=report.finish();fs.writeFileSync(path.join(raw,'M5-native-update-'+stamp+'.json'),JSON.stringify(sanitiseM3(result),null,2)+'\n');console.log(JSON.stringify(result,null,2));process.exitCode=result.passed?0:1;
