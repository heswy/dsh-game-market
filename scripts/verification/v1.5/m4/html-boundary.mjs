#!/usr/bin/env node
/** HTML-v1 navigation A/B: same hostile bytes, direct legacy vs new wrapper. */
import {sourceIdentity} from './source.mjs';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {Cdp,createCdpCapture,createSinkOrigin,startIsolatedHost,waitForDshPage,installZipFromPage,launchFromPage,sleep,createReport,runtimeIdentity} from '../m1/lib/lab.mjs';
import {buildManifest,buildPackage} from '../../../../packages/host/test/support/packages.js';
import {sanitiseM3} from '../m3/lib.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');const raw=path.join(root,'docs/verification/v1.5/raw/m4');fs.mkdirSync(raw,{recursive:true});
const stamp=new Date().toISOString().replace(/[:.]/g,'-');const report=createReport({id:'M4-html-boundary',title:'HTML-v1 wrapper navigation falsifiable A/B',commands:['DSH_V15_WORK=/tmp/dsh-v15/m3 node scripts/verification/v1.5/m4/html-boundary.mjs '+process.argv.slice(2).join(' ')]});
let isolated,page,sink,capture;
try{
 report.record('source',sourceIdentity(root));
 sink=createSinkOrigin({port:58368});await sink.start();
 isolated=await startIsolatedHost({name:'m4-boundary-'+stamp,ports:{bootstrap:58365,host:58366},pluginRoot:root});
 page=await Cdp.launch({port:9493});capture=createCdpCapture(page);await capture.start();await page.navigate(isolated.host.url);await waitForDshPage(page,isolated.hostOrigin);
 report.record('runtime',runtimeIdentity());
 const id='m4-html-navigation';const target=sink.origin+'/escape';
 const pkg=buildPackage(buildManifest({id}),{extra:`<script>window.__M4_ATTEMPT__=false;setTimeout(function(){window.__M4_ATTEMPT__=true;parent.postMessage({m4Attempt:true},'*');location.replace(${JSON.stringify(target)});},800);</script>`});
 const installed=await installZipFromPage(page,pkg.bytes,{operationId:'op_m4_boundary_'+Date.now().toString(36),contentType:'text/html'});
 report.add('host installs valid hostile html-v1',installed.status===200,installed.body);
 const launched=await launchFromPage(page,{gameId:id});const info=launched.body?.data || launched.body;
 report.add('host issues legacy URL plus additive wrapper',launched.status===200&&Boolean(info.wrapperUrl),{status:launched.status,keys:Object.keys(info||{})});
 if(!info.wrapperUrl)throw Error('no launch info');
 await page.eval(`(()=>{const f=document.createElement('iframe');f.id='m4-boundary';f.sandbox='allow-scripts';f.src=${JSON.stringify(info.entryUrl)};document.body.append(f);})()`);
 await sleep(2000);report.add('positive control: legacy direct game really escapes to sink',sink.requests().some(r=>r.path==='/escape'),sink.requests());
 await page.eval(`document.getElementById('m4-boundary').remove()`);sink.reset();
 await page.eval(`(()=>{window.__M4_WRAPPED_ATTEMPT__=false;window.addEventListener('message',e=>{if(e.source===document.getElementById('m4-boundary')?.contentWindow && e.data?.m4Attempt===true)window.__M4_WRAPPED_ATTEMPT__=true;});const f=document.createElement('iframe');f.id='m4-boundary';f.src=${JSON.stringify(info.wrapperUrl)};document.body.append(f);})()`);
 await sleep(2200);
 const attempted=await page.eval('window.__M4_WRAPPED_ATTEMPT__===true');
 report.add('wrapped game executes and attempts the same external navigation',attempted===true);
 report.add('wrapper blocks actual external navigation, sink remains empty',sink.requests().length===0,sink.requests());
 const layout=await capture.evaluateInFrame('/wrapper',`(()=>{if(location.pathname==='/wrapper'){const f=document.querySelector('iframe');return {sandbox:f.getAttribute('sandbox'),count:document.querySelectorAll('iframe').length};}return null;})()`);
 report.add('game remains opaque sandbox allow-scripts only',layout?.value?.sandbox==='allow-scripts',layout?.value);
}catch(error){report.add('completed',false,String(error?.stack||error).split('\n').slice(0,5).join('\n'));}
finally{try{page?.dispose();}catch{}if(isolated)await isolated.stop();if(sink)await sink.stop();report.add('owned host stopped',!isolated||isolated.host.child.exitCode!==null||isolated.host.child.signalCode!==null);}
const result=report.finish();fs.writeFileSync(path.join(raw,'M4-html-boundary-'+stamp+'.json'),JSON.stringify(sanitiseM3(result),null,2)+'\n');console.log(JSON.stringify(result,null,2));process.exitCode=result.passed?0:1;
