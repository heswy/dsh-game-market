/** Owns only the game's pause/hold and this panel's visibility, never native cancellation. */
export function createQuestionFlow({bridge,sessionId,pause,setHold,recoverStorage}) {
  let state={open:false,phase:'idle',card:null};let disposed=false;let generation=0;
  const listeners=new Set();const hold='question:'+sessionId;
  function patch(value){state={...state,...value};for(const fn of listeners)fn();}
  function close(){generation++;setHold(hold,false);patch({open:false});}
  function isSettled(card,current){return typeof bridge.isSettled==='function'?bridge.isSettled(card):current.key!==card.key || current.settled;}
  const stop=bridge.subscribe(()=>{
    if(!state.open || !state.card || state.phase==='settled' || state.phase==='handled') return;
    const current=bridge.read(sessionId);
    if(isSettled(state.card,current)) {
      patch({phase:state.phase==='awaiting' || state.phase==='sending' ? 'settled':'handled'});
    } else if(current.key!==state.card.key) {
      if(state.phase==='awaiting' || state.phase==='sending')patch({phase:'awaiting'});
      else patch({phase:'handled'});
    } else if(state.phase==='awaiting' && current.capability==='available' && current.pending!==state.card.pending && !current.submitted) {
      patch({phase:'ready',card:current,error:false}); // queued reply was discarded; native card is answerable again.
    }
  });
  async function open(){
    if(disposed || state.phase==='saving' || state.phase==='sending')return;
    const card=bridge.read(sessionId);
    if(card.capability!=='available'){patch({open:true,phase:'unavailable',card:null});return;}
    const retrying=state.phase==='save-failed';
    const run=++generation;setHold(hold,true);patch({open:true,phase:'saving',card,error:false});
    let result;try{if(retrying && typeof recoverStorage==='function')await recoverStorage();result=await pause();}catch(_){result=null;}
    if(disposed || run!==generation)return;
    const current=bridge.read(sessionId);
    if(current.key!==card.key || current.capability!=='available'){patch({phase:'handled'});return;}
    patch({phase:result && result.ok===true && result.saveStale===false?(current.submitted?'awaiting':'ready'):'save-failed'});
  }
  async function submit(batch){
    if(disposed || !state.open || state.phase!=='ready')return;
    const card=state.card;const run=generation;patch({phase:'sending',error:false});
    try{
      await bridge.answer(card,batch);
      if(disposed || run!==generation)return;
      const current=bridge.read(sessionId);
      patch({phase:isSettled(card,current)?'settled':'awaiting'});
    }catch(error){
      if(disposed || run!==generation)return;
      const current=bridge.read(sessionId);
      patch({phase:current.key!==card.key || current.settled || (error && error.message==='already-handled')?'handled':error && error.code==='REPLY_QUEUED'?'awaiting':'ready',error:true});
    }
  }
  return {open,close,submit,getSnapshot:()=>state,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},dispose(){disposed=true;close();stop();listeners.clear();}};
}
