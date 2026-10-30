/** Actual installed Desktop, isolated profile, product plugin row. */
import fs from 'node:fs';import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareHome} from '../questions/lib/probe.mjs';
import {injectProbeRow} from '../lib/harness.mjs';
import {openDesktop} from '../m4/desktop.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');
export async function startDesktopLab({name,pluginRoot=root,port=9495,home:existingHome=null}={}){
 const home=existingHome||await prepareHome(name,{port:58491,dir:path.join('/tmp','dgm-'+name+'-bus')});
 if(!existingHome)injectProbeRow(home,{id:'dsh-game-market',entry:path.join(pluginRoot,'index.js')});
 const opened=await openDesktop(home,{port});
 return {home,page:opened.page,host:opened.host,hostOrigin:'dsh-app://app',hostPids:[opened.host.child.pid],restarts:0,
  async stop(){opened.page.dispose();await opened.host.stop();},
  async cleanup(){opened.page.dispose();await opened.host.stop();fs.rmSync(home,{recursive:true,force:true});}};
}
