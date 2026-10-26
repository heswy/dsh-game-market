import test from 'node:test';import assert from 'node:assert/strict';
import {createQuestionFlow} from '../packages/client/src/question-flow.js';
function fixture(){let card={key:'s:k',capability:'available',questions:[{id:'a'}]};let saved=false,answers=0,dismiss=0;const holds=new Set();let notify;const bridge={read:()=>card,answer:async()=>{answers++;},subscribe:fn=>{notify=fn;return()=>{};}};const flow=createQuestionFlow({bridge,sessionId:'s',pause:async()=>({ok:true,saveStale:!saved}),setHold:(id,on)=>on?holds.add(id):holds.delete(id)});return{flow,holds,get answers(){return answers},get dismiss(){return dismiss},repair:()=>saved=true,settle:()=>{card={capability:'unavailable'};notify();}};}
test('panel save failure blocks answers; retry resaves; collapse never dismisses, preserves pause and releases only its own hold',async()=>{const f=fixture();f.holds.add('update:other');await f.flow.open();assert.equal(f.flow.getSnapshot().phase,'save-failed');await f.flow.submit({answers:[]});assert.equal(f.answers,0);f.repair();await f.flow.open();assert.equal(f.flow.getSnapshot().phase,'ready');f.flow.close();assert.equal(f.dismiss,0);assert.deepEqual([...f.holds],['update:other']);f.flow.dispose();});
test('successful transport waits for native disappearance before settled; no duplicate send',async()=>{const f=fixture();f.repair();await f.flow.open();await f.flow.submit({answers:[]});assert.equal(f.flow.getSnapshot().phase,'awaiting');await f.flow.submit({answers:[]});assert.equal(f.answers,1);f.settle();assert.equal(f.flow.getSnapshot().phase,'settled');f.settle();assert.equal(f.flow.getSnapshot().phase,'settled');f.flow.dispose();assert.equal(f.holds.size,0);});
test('late save after dispose cannot reopen a panel',async()=>{let done;const flow=createQuestionFlow({bridge:{read:()=>({key:'k',capability:'available'}),subscribe:()=>()=>{}},sessionId:'s',pause:()=>new Promise(r=>done=r),setHold:()=>{}});const p=flow.open();flow.dispose();done({ok:true,saveStale:false});await p;assert.equal(flow.getSnapshot().open,false);});
test('continued disappearance while queued is not settlement; discarded reply reappears answerable',async()=>{
 let listener,settled=false;let card={key:'s:k',capability:'available',channel:'continued',pending:{},questions:[]};
 const bridge={read:()=>card,isSettled:()=>settled,answer:async()=>{},subscribe:fn=>{listener=fn;return()=>{};}};
 const flow=createQuestionFlow({bridge,sessionId:'s',pause:async()=>({ok:true,saveStale:false}),setHold:()=>{}});
 await flow.open();await flow.submit({answers:[]});card={capability:'unavailable'};listener();assert.equal(flow.getSnapshot().phase,'awaiting');
 card={key:'s:k',capability:'available',channel:'continued',pending:{},questions:[]};listener();assert.equal(flow.getSnapshot().phase,'ready');
 await flow.submit({answers:[]});settled=true;listener();assert.equal(flow.getSnapshot().phase,'settled');flow.dispose();
});
test('explicit retry reprobes Host storage before retrying a failed real save',async()=>{
 let readOnly=true,probes=0;const bridge={read:()=>({key:'s:k',capability:'available'}),subscribe:()=>()=>{}};
 const flow=createQuestionFlow({bridge,sessionId:'s',pause:async()=>({ok:true,saveStale:readOnly}),setHold:()=>{},recoverStorage:async()=>{probes++;readOnly=false;}});
 await flow.open();assert.equal(flow.getSnapshot().phase,'save-failed');await flow.open();assert.equal(probes,1);assert.equal(flow.getSnapshot().phase,'ready');flow.dispose();
});
