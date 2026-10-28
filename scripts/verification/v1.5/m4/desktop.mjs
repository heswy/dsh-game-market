/** Launch only an isolated instance of the installed Electron app. */
import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';
import {Cdp,sleep} from '../lib/harness.mjs';
export async function openDesktop(home,{port=9491,env={}}={}) {
  if(!home.startsWith('/tmp/dsh-v15/') && !home.startsWith('/private/tmp/dsh-v15/'))throw Error('refusing non-isolated home');
  if(!fs.existsSync(path.join(home,'profiles/desktop/package.json')))fs.cpSync(path.join(home,'profiles/web'),path.join(home,'profiles/desktop'),{recursive:true});
  const logFile=path.join(home,'m4-electron.log');const log=fs.openSync(logFile,'w');
  const child=spawn('/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness',[
    '--user-data-dir='+path.join(home,'electron-user-data'),'--remote-debugging-port='+port,
  ],{env:{...process.env,...env,DSH_HOME:home},stdio:['ignore',log,log]});
  fs.closeSync(log);
  async function stop(){
    if(child.exitCode===null && child.signalCode===null)child.kill('SIGTERM');
    for(let i=0;i<30 && child.exitCode===null && child.signalCode===null;i++)await sleep(200);
    if(child.exitCode===null && child.signalCode===null){child.kill('SIGKILL');await sleep(500);}
  }
  let page;
  const deadline=Date.now()+90000;
  try{
    while(Date.now()<deadline){
      if(child.exitCode!==null || child.signalCode!==null)throw Error('isolated Electron exited before ready; log '+logFile);
      try{
        if(!page)page=await Cdp.attach(port,{preferredUrlPrefix:'dsh-app://app/'});
        if(await page.eval('Boolean(window.__QPROBE__)'))return {page,host:{child,stop},logFile};
        const welcome=await page.eval(`Boolean(document.querySelector('#api-key'))`);
        if(welcome){
          await page.eval(`document.querySelector('#api-key').click()`);
          await sleep(200);
          await page.eval(`document.querySelector('#skip-key').click()`);
          page.dispose();page=null;
        }
      }catch(_){try{page?.dispose();}catch{}page=null;}
      await sleep(500);
    }
    throw Error('isolated Electron question client did not become ready; log '+logFile);
  }catch(error){try{page?.dispose();}catch{}await stop();throw error;}
}
