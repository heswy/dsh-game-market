import test from 'node:test';import assert from 'node:assert/strict';
import {dshPageOrigin} from '../packages/host/src/page-origin.js';
test('only the packaged Electron Host selects the exact dsh-app frontend; web keeps its validated origin',()=>{
 const argv=['electron','/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js'];
 assert.equal(dshPageOrigin('http://127.0.0.1:12',{electron:'44',argv}),'dsh-app://app');
 assert.equal(dshPageOrigin('http://127.0.0.1:12',{electron:'44',argv:['node','web']}),'http://127.0.0.1:12');
 assert.equal(dshPageOrigin('https://bad.example/a',{argv:[]}),null);
});
