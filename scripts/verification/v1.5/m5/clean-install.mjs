#!/usr/bin/env node
/** Direct candidate install into a fresh actual Desktop profile; no product dev row. */
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
import {prepareHome,BUNDLE} from '../questions/lib/probe.mjs';import {openDesktop} from '../m4/desktop.mjs';
import {Probe,injectProbeRow,createReport,sanitiseM3} from '../m3/lib.mjs';
import {makeScenarioEnvironment,startTransport,buildIndexBody,installExactWithRetry,waitForHostVersion,ensureMarketPanelOpen,ensureUpdateSectionRendered,readUpdateUi,inspectFromPage} from '../m3/v1-common.mjs';
import {createCdpCapture} from '../m2/lib/lab.mjs';import {launchFromRow,waitFor} from '../m2/lib/ui.mjs';import {readState,pressKey} from '../m2/m2-a08-orbit-courier.mjs';
const args=process.argv.slice(2),commit=args[args.indexOf('--commit')+1];if(!/^[0-9a-f]{40}$/.test(commit))throw Error('full --commit required');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..'),identity=JSON.parse(execFileSync('git',['show',commit+':platform-updates/release.json'],{cwd:root,encoding:'utf8'}));
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),tag='m5-native-clean-'+stamp,dir=path.join('/tmp/dsh-v15/m3',tag),raw=path.join(root,'docs/verification/v1.5/raw/m5');
const report=createReport({id:'M5-native-clean-install',title:'Fresh actual Desktop direct immutable candidate install and packaged ZIP play',commands:['node scripts/verification/v1.5/m5/clean-install.mjs --commit '+commit]});let desktop,transport;
function check(name,ok,detail){report.add(name,Boolean(ok),detail);console.log((ok?'PASS ':'FAIL ')+name);if(!ok)throw Error(name);}
try{
 const scenario=makeScenarioEnvironment(tag);transport=await startTransport(scenario);check('public network gate',transport.networkGate.ok,transport.networkGate);transport.control.setFixtureBody(buildIndexBody({versions:[]}));
 const home=await prepareHome(tag,{port:58492,dir:path.join(dir,'questions')}),neutral=path.join(dir,'qprobe');fs.cpSync(BUNDLE,neutral,{recursive:true});const patch=path.join(home,'profiles/web/cordis.patch.yml');fs.writeFileSync(patch,fs.readFileSync(patch,'utf8').replaceAll(BUNDLE,neutral));
 injectProbeRow(home,{runDir:path.join(dir,'probe'),bootTag:tag});desktop=await openDesktop(home,{port:9497,env:transport.envForHost({marker:tag})});const p=desktop.page,probe=new Probe(tag,{runDir:path.join(dir,'probe'),home});await probe.waitReady();report.record('nativeBoot',probe.boot);
 const manifest=()=>JSON.parse(fs.readFileSync(path.join(home,'profiles/desktop/package.json'),'utf8'));check('fresh profile starts without product dependency',!manifest().dependencies?.['dsh-game-market']);
 const install=await installExactWithRetry(probe,{spec:`https://github.com/heswy/dsh-game-market.git#${commit}`,requestIdBase:tag,attempts:3});check('native manager directly installs public candidate',install.result?.application==='applied',install);
 const host=await waitForHostVersion(probe,identity.version);check('candidate Host loaded from actual package',host.ok,host);probe.commands=[];probe.writeInbox();
 await p.send('Page.reload');await p.until('Boolean(window.__QPROBE__)',90000,300);await ensureMarketPanelOpen(p);const inspect=await inspectFromPage(p);check('actual Host identifies immutable install target',inspect.data?.host?.version===identity.version&&inspect.data.host.commit===commit,inspect.data?.host);
 await ensureUpdateSectionRendered(p);const rows=(await readUpdateUi(p)).identities;check('native UI binds Host R and Client P',rows[0]?.version===identity.version&&rows[0]?.commitAttr===commit&&rows[1]?.version===identity.version&&rows[1]?.commitAttr===identity.clientBuildCommit,rows);check('profile records exact public Git dependency',manifest().dependencies?.['dsh-game-market']?.includes(commit),manifest().dependencies?.['dsh-game-market']);
 const capture=createCdpCapture(p);await capture.start();await launchFromRow(p,capture,'orbit-courier');const ready=await waitFor(async()=>{const state=await readState(capture);return state?.state?.phase==='ready'?state:null;},30000);check('directly installed candidate ZIP initializes',ready);
 await pressKey(p,ready.sessionId,'Enter');const played=await waitFor(async()=>{const state=await readState(capture);return state?.state?.phase==='playing'&&state.state.elapsedMs>1000?state:null;},10000);check('directly installed ZIP advances with real keyboard input',played,played?.state);await p.shot(path.join(raw,'M5-clean-install-'+stamp+'.png'));
}catch(e){report.add('completed',false,String(e.stack||e).split('\n').slice(0,6).join('\n'));}
finally{if(desktop){desktop.page.dispose();await desktop.host.stop();report.add('owned App stopped',desktop.host.child.exitCode!==null||desktop.host.child.signalCode!==null);}if(transport){report.record('isolatedIndexTransport',transport.audit());await transport.close();}}
const result=report.finish();fs.writeFileSync(path.join(raw,'M5-clean-install-'+stamp+'.json'),JSON.stringify(sanitiseM3(result),null,2)+'\n');console.log(JSON.stringify(result,null,2));process.exitCode=result.passed?0:1;
