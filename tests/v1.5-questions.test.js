import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuestionAdapter, buildAnswerBatch } from '../packages/client/src/questions.js';

const questions = [{id:'one',question:'Choose',options:[{label:'A (Recommended)'},{label:'B'}]}, {id:'many',question:'Add',multiSelect:true,options:[{label:'X'},{label:'Y'}]}];
function fixture(overrides={}) {
 let cardState = {state:'open',channel:'waterfall',closed:false};
 let answers=[]; let rpc=[]; let dismissals=0; const listeners=new Set();
 const pending={kind:'question',key:'k',sessionId:'s',questions,hasWaterfall:()=>cardState.channel==='waterfall',snapshot:()=>cardState,subscribe:()=>()=>{},answer:async batch=>{answers.push(batch);cardState={...cardState,closed:true};},dismiss:()=>{dismissals++;},...overrides};
 const rows=new Map([['s',{pendingInteraction:pending}]]);
 const adapter=createQuestionAdapter({getStatuses:()=>rows,subscribeStatuses:fn=>{listeners.add(fn);return ()=>listeners.delete(fn);},readSettled:()=>false,answerContinued:async (...args)=>{rpc.push(args);return true;}});
 return {adapter,pending,rows,answers,rpc,get dismissals(){return dismissals},setState:s=>{cardState=s;},publish:()=>{for(const fn of listeners)fn();}};
}
test('answer batch keeps original labels, single custom overrides and multi custom supplements; requires every question',()=>{
 assert.deepEqual(buildAnswerBatch(questions,{one:{selected:['A (Recommended)'],custom:' own '},many:{selected:['X'],custom:' plus '}}),{answers:[{id:'one',selected:[],custom:'own'},{id:'many',selected:['X'],custom:'plus'}]});
 assert.throws(()=>buildAnswerBatch(questions,{one:{selected:['B']}}));
 assert.throws(()=>buildAnswerBatch(questions,{one:{selected:['forged']},many:{selected:['X']}}));
});
test('live open answers use pending channel only and never dismiss',async()=>{
 const f=fixture();const card=f.adapter.read('s');assert.equal(card.capability,'available');
 await f.adapter.answer(card,buildAnswerBatch(questions,{one:{selected:['B']},many:{selected:['Y']}}));
 assert.equal(f.answers.length,1);assert.equal(f.rpc.length,0);assert.equal(f.dismissals,0);
 await assert.rejects(()=>f.adapter.answer(card,{answers:[]})); f.adapter.dispose();
});
test('stale keys, changed session, replacement object and sensitive review cannot answer',async()=>{
 const f=fixture();const old=f.adapter.read('s');f.rows.set('s',{pendingInteraction:{...f.pending,key:'new'}});f.publish();
 await assert.rejects(()=>f.adapter.answer(old,{answers:[]}));assert.equal(f.adapter.read('other').capability,'unavailable');
 f.rows.set('s',{pendingInteraction:{...f.pending,kind:'plan-review'}});f.publish();assert.equal(f.adapter.read('s').capability,'degraded');assert.equal(f.answers.length,0);f.adapter.dispose();
});
test('continued uses native RPC once; concurrent submissions and false result do not report settled',async()=>{
 const f=fixture({callId:'call'});f.setState({state:'continued',channel:'rpc',closed:false});const card=f.adapter.read('s');
 const batch=buildAnswerBatch(questions,{one:{selected:['B']},many:{selected:['X']}});
 const first=f.adapter.answer(card,batch); await assert.rejects(()=>f.adapter.answer(card,batch));await first;
 assert.equal(f.rpc.length,1);assert.equal(f.answers.length,0);assert.equal(f.adapter.read('s').settled,false);f.adapter.dispose();
});
test('malformed face and no channel fail closed; subscriptions release on dispose',()=>{
 const f=fixture({hasWaterfall:null});assert.equal(f.adapter.read('s').capability,'degraded');f.adapter.dispose();
});
test('accepted continued answer cannot be resent while native confirmation is pending',async()=>{
 const f=fixture({callId:'call'});f.setState({state:'continued',channel:'rpc',closed:false});const card=f.adapter.read('s');
 const batch=buildAnswerBatch(questions,{one:{selected:['B']},many:{selected:['X']}});
 await f.adapter.answer(card,batch);await assert.rejects(()=>f.adapter.answer(card,batch));assert.equal(f.rpc.length,1);assert.equal(f.adapter.read('s').submitted,true);f.adapter.dispose();
});
import {configureQuestions,questionBridge} from '../packages/client/src/questions.js';
test('late uiSession service is attached through an optional dependency scope',()=>{
 const f=fixture();let injected=false;const ctx={inject(names,fn){injected=true;assert.deepEqual(names,['uiSession','remote','remote.userQuestions','sessions']);return fn({uiSession:{sessionStatus:{getSnapshot:()=>f.rows,subscribe:()=>()=>{}}},remote:{userQuestions:{answer:async()=>true}}});}};
 const stop=configureQuestions(ctx);assert.equal(injected,true);assert.equal(questionBridge.read('s').capability,'available');stop();assert.equal(questionBridge.read('s').capability,'unavailable');f.adapter.dispose();
});
test('configured continued bridge unwraps the native RemoteResult envelope and preserves queued errors',async()=>{
 const f=fixture({callId:'native-call'});f.setState({state:'continued',channel:'rpc',closed:false});let result={ok:true,value:true};
 const stop=configureQuestions({uiSession:{sessionStatus:{getSnapshot:()=>f.rows,subscribe:()=>()=>{}}},sessions:{binding:()=>({session:{projections:{faceOf:()=>({getSnapshot:()=>({active:[],settled:[]})})}}})},remote:{userQuestions:{answer:async()=>result}}});
 const batch=buildAnswerBatch(questions,{one:{selected:['B']},many:{selected:['X']}});
 await questionBridge.answer(questionBridge.read('s'),batch);assert.equal(questionBridge.read('s').submitted,true);stop();f.adapter.dispose();
});
test('continued RPC capability is declared in the optional scope even when uiSession already exists',()=>{
 const f=fixture();let names=null;const status={getSnapshot:()=>f.rows,subscribe:()=>()=>{}};
 const stop=configureQuestions({uiSession:{sessionStatus:status},inject(deps,fn){names=deps;return fn({uiSession:{sessionStatus:status},remote:{userQuestions:{answer:async()=>({ok:true,value:true})}}});}});
 assert.ok(names?.includes('remote.userQuestions'));stop();f.adapter.dispose();
});
test('malformed question entries and throwing live capabilities degrade without crashing the game',()=>{
 for(const overrides of [{questions:[null]},{hasWaterfall:()=>{throw Error('unavailable')}},{subscribe:()=>{throw Error('unavailable')}}]){
  const f=fixture(overrides);assert.doesNotThrow(()=>f.adapter.read('s'));assert.equal(f.adapter.read('s').capability,'degraded');f.adapter.dispose();
 }
});
test('continued face without observable native settlement is degraded',()=>{
 const f=fixture({callId:'c'});f.setState({state:'continued',channel:'rpc',closed:false});
 const adapter=createQuestionAdapter({getStatuses:()=>f.rows,subscribeStatuses:()=>()=>{},answerContinued:async()=>true,readSettled:()=>null});
 assert.equal(adapter.read('s').capability,'degraded');adapter.dispose();f.adapter.dispose();
});
