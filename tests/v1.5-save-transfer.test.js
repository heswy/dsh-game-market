import test from 'node:test';import assert from 'node:assert/strict';
import {createHostHarness} from '../packages/host/test/support/harness.js';
import {createFileRegistry} from '../packages/host/test/support/packages.js';
import {ROUTES} from '../packages/shared/src/contracts.js';
import {LIMITS} from '../packages/shared/src/constants.js';
import {GM} from '../packages/shared/src/errors.js';
import {GM_STORE_READONLY,hostError} from '../packages/host/src/errors.js';
async function seed(h,score){return h.host.services.saves.save({gameId:'snake',key:'current',data:{score},operationId:'op-transfer-seed',reason:'manual'});}
function byteLength(value){return Buffer.byteLength(JSON.stringify(value),'utf8');}
/** Install a non-builtin fixture game so uninstall/deleteData is possible. */
async function installForTransfer(t,gameId='jump'){
 const fixture=await createFileRegistry(t,[{manifest:{id:gameId}}]);
 const h=await createHostHarness(t,{config:{registry:{url:fixture.indexPath,allowLocalFile:true}}});
 await h.host.registry.ready();
 await h.data(ROUTES.INSTALL,{body:{gameId,operationId:'op-install-'+gameId}});
 return h;
}
test('portable export contains only one game, validates cross-profile import and retains an importable backup',async t=>{
 const a=await createHostHarness(t),b=await createHostHarness(t);await seed(a,42);await seed(b,7);
 const portable=await a.host.services.saves.exportTransfer('snake');
 assert.deepEqual(Object.keys(portable).sort(),['format','gameId','gameVersion','saveSchemaVersion','sha256','values']);
 const result=await b.host.services.saves.importTransfer({gameId:'snake',expectedRevision:1,portable});assert.equal(result.revision,2);
 assert.deepEqual((await b.host.services.saves.get('snake',{includeData:true})).values,{current:{score:42}});
 const backup=await b.host.services.saves.exportTransfer('snake',{backup:true});assert.deepEqual(backup.values,{current:{score:7}});
 await assert.rejects(()=>b.host.services.saves.importTransfer({gameId:'snake',expectedRevision:1,portable}),{code:GM.STORAGE_CONFLICT});
});
test('tamper, game mismatch, schema and quota failures leave destination unchanged',async t=>{
 const a=await createHostHarness(t),b=await createHostHarness(t);await seed(a,42);await seed(b,7);const portable=await a.host.services.saves.exportTransfer('snake');
 for(const corrupt of [{...portable,values:{current:{score:999}}},{...portable,gameId:'other'},{...portable,saveSchemaVersion:99},{...portable,values:{current:'x'.repeat(1024*1024)}}]){
  await assert.rejects(()=>b.host.services.saves.importTransfer({gameId:'snake',expectedRevision:1,portable:corrupt}));
  assert.equal((await b.host.services.saves.get('snake',{includeData:true})).values.current.score,7);
 }
});
test('active game blocks imports; launch stays blocked during the actual import write',async t=>{
 const h=await createHostHarness(t);await seed(h,5);const portable=await h.host.services.saves.exportTransfer('snake');
 const info=await h.host.services.entry.launch({gameId:'snake'});
 await assert.rejects(()=>h.host.services.saves.importTransfer({gameId:'snake',expectedRevision:1,portable}),{code:GM.UPDATE_GAME_RUNNING});
 h.host.services.entry.releaseInstance(info.instanceId,'snake');
 const storage=h.host.storage,write=storage.writeJson.bind(storage);let blocked=false;
 storage.writeJson=async(...args)=>{if(String(args[0]).endsWith('current.json')){await assert.rejects(()=>h.host.services.entry.launch({gameId:'snake'}));blocked=true;}return write(...args);};
 await h.host.services.saves.importTransfer({gameId:'snake',expectedRevision:1,portable});assert.equal(blocked,true);
 assert.ok((await h.host.services.entry.launch({gameId:'snake'})).instanceId);
});
test('transfer routes expose the same constrained export and CAS import without game SDK additions',async t=>{
 const h=await createHostHarness(t);await seed(h,42);const value=await h.data('/api/game-market/save-export',{query:{gameId:'snake'}});
 const result=await h.data('/api/game-market/save-import',{body:{gameId:'snake',expectedRevision:1,portable:value}});assert.equal(result.revision,2);
});
import {portableSave} from '../packages/host/src/save-transfer.js';
test('signed files still enforce game and schema; missing CAS is never an overwrite',async t=>{
 const h=await createHostHarness(t);await seed(h,7);
 const file=portableSave({gameId:'snake',gameVersion:'1.0.0',saveSchemaVersion:99,values:{current:{score:9}}});
 await assert.rejects(()=>h.host.services.saves.importTransfer({gameId:'snake',expectedRevision:1,portable:file}),{code:GM.SAVE_SCHEMA_TOO_NEW});
 const other=portableSave({...file,gameId:'other',saveSchemaVersion:1});
 await assert.rejects(()=>h.host.services.saves.importTransfer({gameId:'snake',expectedRevision:1,portable:other}),{code:GM.INVALID_PARAM});
 const good=portableSave({...file,saveSchemaVersion:1});
 await assert.rejects(()=>h.host.services.saves.importTransfer({gameId:'snake',portable:good}),{code:GM.INVALID_PARAM});
 assert.equal((await h.host.services.saves.get('snake',{includeData:true})).values.current.score,7);
});
test('backup write failure cannot alter the existing save; old revision envelopes use their metadata revision',async t=>{
 const h=await createHostHarness(t);await seed(h,7);const p=await h.host.services.saves.exportTransfer('snake');const s=h.host.storage,write=s.writeJson.bind(s);
 s.writeJson=async(file,value,opts)=>{if(String(file).endsWith('transfer-backup.json'))throw Error('disk full');return write(file,value,opts);};
 await assert.rejects(()=>h.host.services.saves.importTransfer({gameId:'snake',expectedRevision:1,portable:p}));assert.equal((await h.host.services.saves.get('snake',{includeData:true})).values.current.score,7);
 s.writeJson=write;const raw=await h.host.services.saves.readCurrent('snake');delete raw.revision;await s.writeJson(h.host.services.saves.paths('snake').current,raw);
 assert.equal((await h.host.services.saves.importTransfer({gameId:'snake',expectedRevision:1,portable:p})).revision,2);
});
test('uninstall with deleteData is rejected while an import is writing, and deletes data afterwards',async t=>{
 const h=await installForTransfer(t);
 await h.host.services.saves.save({gameId:'jump',key:'current',data:{score:5},operationId:'op-seed-jump',reason:'manual'});
 const portable=await h.host.services.saves.exportTransfer('jump');
 const s=h.host.storage,write=s.writeJson.bind(s);
 let release=null;const gate=new Promise(resolve=>{release=resolve;});
 let reached=null;const arrived=new Promise(resolve=>{reached=resolve;});
 s.writeJson=async(file,value,opts)=>{if(String(file).endsWith('saves/jump/current.json')){reached();await gate;}return write(file,value,opts);};
 const importing=h.host.services.saves.importTransfer({gameId:'jump',expectedRevision:1,portable});
 await arrived;
 await assert.rejects(()=>h.host.services.install.uninstall({gameId:'jump',deleteData:true,confirmDataDeletion:true,operationId:'op-uninstall-during-import'}),{code:GM.INSTALL_IN_PROGRESS,retryable:true});
 assert.ok((await h.readDataJson('installations.json')).games.jump,'the installation must survive the rejected uninstall');
 release();
 assert.equal((await importing).revision,2);
 s.writeJson=write;
 const removed=await h.host.services.install.uninstall({gameId:'jump',deleteData:true,confirmDataDeletion:true,operationId:'op-uninstall-after-import'});
 assert.equal(removed.dataDeleted,true);
 assert.equal(await h.pathExists('saves/jump'),false);
});
test('import is rejected while deleteData is in progress and cannot recreate a fresh save',async t=>{
 const h=await installForTransfer(t);
 const portable=portableSave({gameId:'jump',gameVersion:'1.0.0',saveSchemaVersion:1,values:{current:{score:9}}});
 const s=h.host.storage,write=s.writeJson.bind(s);
 let release=null;const gate=new Promise(resolve=>{release=resolve;});
 let reached=null;const arrived=new Promise(resolve=>{reached=resolve;});
 s.writeJson=async(file,value,opts)=>{if(String(file).endsWith('installations.json')){reached();await gate;}return write(file,value,opts);};
 const removing=h.host.services.install.uninstall({gameId:'jump',deleteData:true,confirmDataDeletion:true,operationId:'op-uninstall-during-import'});
 await arrived;
 await assert.rejects(()=>h.host.services.saves.importTransfer({gameId:'jump',expectedRevision:0,portable}),{code:GM.INSTALL_IN_PROGRESS,retryable:true});
 release();
 assert.equal((await removing).dataDeleted,true);
 s.writeJson=write;
 assert.equal(await h.pathExists('saves/jump'),false);
});
test('a durable import whose meta.json write fails reports success with an explicit partial warning',async t=>{
 const h=await createHostHarness(t);await seed(h,7);
 const portable=portableSave({gameId:'snake',gameVersion:'1.0.0',saveSchemaVersion:1,values:{current:{score:42}}});
 const s=h.host.storage,write=s.writeJson.bind(s);
 s.writeJson=async(file,value,opts)=>{if(String(file).endsWith('meta.json'))throw hostError(GM_STORE_READONLY,'read-only');return write(file,value,opts);};
 const {response,payload}=await h.requestJson(ROUTES.SAVE_IMPORT,{body:{gameId:'snake',expectedRevision:1,portable}});
 s.writeJson=write;
 assert.equal(response.status,200,JSON.stringify(payload));
 assert.equal(payload.ok,true);
 assert.equal(payload.data.revision,2);
 assert.deepEqual(payload.data.warnings,['save-meta-write-failed']);
 assert.deepEqual((await h.host.services.saves.get('snake',{includeData:true})).values,{current:{score:42}});
});
test('a legal save near the 1 MiB quota exports under the transfer budget and imports through the route',async t=>{
 const source=await createHostHarness(t);
 const array=new Array(104800).fill(7);
 for(const key of ['a','b','c','d','e'])await source.host.services.saves.save({gameId:'snake',key,data:array,operationId:'op-quota-'+key});
 const envelope=await source.host.services.saves.readCurrent('snake');
 assert.ok(byteLength(envelope)<=LIMITS.saveTotalBytes,'fixture must stay inside the legal save quota');
 const portable=await source.host.services.saves.exportTransfer('snake');
 const {SAVE_TRANSFER_LIMITS,portableSaveFileText}=await import('../packages/shared/src/save-transfer-contract.js');
 const fileText=portableSaveFileText(portable);
 assert.ok(Buffer.byteLength(fileText)<=SAVE_TRANSFER_LIMITS.payloadBytes,'the exported file must fit its own budget');
 assert.ok(Buffer.byteLength(JSON.stringify(portable,null,2))>LIMITS.jsonBodyBytes-1024,'pretty-printing this legal save is what used to exceed the import gate');
 const body={gameId:'snake',expectedRevision:0,portable};
 assert.ok(byteLength(body)<=SAVE_TRANSFER_LIMITS.requestBytes,'the import body must fit the route budget');
 const target=await createHostHarness(t);
 const result=await target.data(ROUTES.SAVE_IMPORT,{body});
 assert.equal(result.revision,1);
 assert.deepEqual((await target.host.services.saves.get('snake',{includeData:true})).values,portable.values);
});
