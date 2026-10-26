/** De facto DSH question face. Live objects stay in the trusted Client only. */
export function buildAnswerBatch(questions, drafts) {
  if (!Array.isArray(questions) || !questions.length) throw new Error('unavailable');
  return { answers: questions.map(q => {
    const draft = drafts[q.id] || {};
    const custom = typeof draft.custom === 'string' ? draft.custom.trim() : '';
    const selected = Array.isArray(draft.selected) ? [...new Set(draft.selected)] : [];
    const labels = (q.options || []).map(o => o.label);
    if (selected.some(label => !labels.includes(label)) || (!q.multiSelect && selected.length > 1)) throw new Error('invalid');
    if (!custom && !selected.length) throw new Error('incomplete');
    return {id:q.id,selected:custom && !q.multiSelect ? [] : selected,...(custom ? {custom} : {})};
  }) };
}

export function createQuestionAdapter({getStatuses, subscribeStatuses, answerContinued, readSettled}) {
  const listeners = new Set();
  const watched = new Map();
  const inFlight = new Set();
  const submitted = new WeakSet();
  let revision = 0;
  let disposed = false;
  function notify() { revision++; for (const fn of listeners) fn(); }
  function statuses() { try { return getStatuses(); } catch (_) { return null; } }
  function refresh() {
    const rows = statuses();
    const live = new Set();
    if (rows && typeof rows.forEach === 'function') rows.forEach(row => {
      const pending = row && row.pendingInteraction;
      if (!pending || typeof pending.subscribe !== 'function') return;
      live.add(pending);
      if (!watched.has(pending)) {
        try { watched.set(pending, pending.subscribe(notify)); } catch (_) { /* degraded at read */ }
      }
    });
    for (const [pending, stop] of watched) if (!live.has(pending)) {
      if (typeof stop === 'function') stop(); watched.delete(pending);
    }
    notify();
  }
  let stopStatuses = null;
  try { stopStatuses = subscribeStatuses(refresh); } catch (_) { /* capability is checked on read */ }
  refresh();
  function read(sessionId) {
    const rows = statuses();
    const row = rows && typeof rows.get === 'function' ? rows.get(sessionId) : null;
    const p = row && row.pendingInteraction;
    const base = {capability:'unavailable',key:null,settled:false};
    if (disposed || !p) return base;
    if (p.kind !== 'question' || p.review !== undefined || p.sessionId !== sessionId || typeof p.key !== 'string'
      || typeof p.answer !== 'function' || typeof p.snapshot !== 'function' || typeof p.hasWaterfall !== 'function'
      || typeof p.subscribe !== 'function' || !watched.has(p)) return {...base,capability:'degraded'};
    let state;
    try { state = p.snapshot(); } catch (_) { return {...base,capability:'degraded'}; }
    const qs = p.questions;
    if (Array.isArray(qs) && qs.some(q=>!q || typeof q!=='object')) return {...base,capability:'degraded'};
    if (!Array.isArray(qs) || !qs.length || new Set(qs.map(q=>q.id)).size !== qs.length || qs.some(q=>!q || typeof q.id !== 'string' || typeof q.question !== 'string'
      || (q.options !== undefined && (!Array.isArray(q.options) || q.options.some(o=>!o || typeof o.label !== 'string'))))) return {...base,capability:'degraded'};
    let waterfall=false;try{waterfall=p.hasWaterfall();}catch(_){return {...base,capability:'degraded'};}
    const open = state && state.state === 'open' && state.channel === 'waterfall' && waterfall;
    let observed=null;try{if(typeof readSettled==='function' && typeof p.callId==='string')observed=readSettled(sessionId,p.callId);}catch(_){}
    const continued = typeof observed === 'boolean' && state && state.state === 'continued' && state.channel === 'rpc' && typeof p.callId === 'string' && typeof answerContinued === 'function';
    return {capability:state && !state.closed && (open || continued) ? 'available':'degraded',key:sessionId+':'+p.key,sessionId,pending:p,
      questions:qs,submitted:submitted.has(p),channel:open?'open':'continued',settled:Boolean(state && state.closed)};
  }
  async function answer(card, batch) {
    const live = read(card.sessionId);
    if (live.capability !== 'available' || live.key !== card.key || live.pending !== card.pending || inFlight.has(card.key) || submitted.has(live.pending)) throw new Error('unavailable');
    if (!batch || !Array.isArray(batch.answers) || batch.answers.length !== live.questions.length) throw new Error('invalid');
    const drafts = Object.create(null);
    for (const a of batch.answers) { if (!a || drafts[a.id]) throw new Error('invalid'); drafts[a.id] = a; }
    const checked = buildAnswerBatch(live.questions,drafts);
    inFlight.add(card.key);
    try {
      if (live.channel === 'open') await live.pending.answer(checked);
      else if (await answerContinued(live.sessionId,live.pending.callId,checked) !== true) throw new Error('already-handled');
      submitted.add(live.pending);
      return {accepted:true}; // settlement is observed separately, never inferred from transport.
    } finally { inFlight.delete(card.key); notify(); }
  }
  function isSettled(card){
    if(card.channel==='continued')return typeof readSettled==='function' && readSettled(card.sessionId,card.pending.callId)===true;
    const live=read(card.sessionId);return live.key!==card.key || live.settled===true;
  }
  return {read,answer,isSettled,subscribe:fn=>{listeners.add(fn);return ()=>listeners.delete(fn);},getSnapshot:()=>revision,
    dispose(){disposed=true;if(typeof stopStatuses==='function')stopStatuses();for(const stop of watched.values())if(typeof stop==='function')stop();watched.clear();listeners.clear();}};
}

let adapter = null;
let revision = 0;
const listeners = new Set();
function publish() { revision++; for (const fn of listeners) fn(); }
export const questionBridge = {
  subscribe(fn) { listeners.add(fn);return ()=>listeners.delete(fn); },
  getSnapshot() { return revision; },
  read(sessionId) { return adapter ? adapter.read(sessionId) : {capability:'unavailable',key:null}; },
  isSettled(card) { return adapter ? adapter.isSettled(card) : false; },
  answer(card,batch) { return adapter ? adapter.answer(card,batch) : Promise.reject(new Error('unavailable')); },
};
export function configureQuestions(ctx, scoped = false) {
  // Cordis remote namespaces require declared injection, even if uiSession
  // happens to be present already. Optional scope keeps the Market usable
  // when the native question plugin is missing.
  if (!scoped && typeof ctx.inject === 'function') {
    return ctx.inject(['uiSession', 'remote', 'remote.userQuestions', 'sessions'], child => configureQuestions(child, true));
  }
  let service;
  try { service = ctx.uiSession; } catch (_) { service = null; }
  const status = service && service.sessionStatus;
  if (!status || typeof status.getSnapshot !== 'function' || typeof status.subscribe !== 'function') {
    return ()=>{};
  }
  function questionProjection(sessionId) {
    try{return ctx.sessions.binding(sessionId)?.session.projections.faceOf('userQuestions');}catch(_){return null;}
  }
  function subscribeSources(fn) {
    const projections=new Map();
    function reconcile(){
      let rows;try{rows=ctx.sessions.list.getSnapshot().byId;}catch(_){rows={};}
      const ids=new Set(Object.keys(rows));
      for(const [id,stop] of projections)if(!ids.has(id)){stop();projections.delete(id);}
      for(const id of ids){if(projections.has(id))continue;const face=questionProjection(id);if(face)projections.set(id,face.subscribe(fn));}
      fn();
    }
    const stopStatus=status.subscribe(reconcile);
    let stopList;try{stopList=ctx.sessions.list.subscribe(reconcile);}catch(_){}
    reconcile();
    return ()=>{stopStatus();if(stopList)stopList();for(const stop of projections.values())stop();};
  }
  const own = createQuestionAdapter({getStatuses:()=>status.getSnapshot(),subscribeStatuses:subscribeSources,
    readSettled:(sessionId,callId)=>{
      const value=questionProjection(sessionId)?.getSnapshot();
      if(!value || !Array.isArray(value.active) || !Array.isArray(value.settled))return null;
      return value.settled.some(row=>row.callId===callId);
    },
    answerContinued:async (sessionId,callId,batch)=>{
      const result=await ctx.remote.userQuestions.answer(sessionId,callId,batch);
      if(!result || result.ok!==true){const error=new Error('native-rejected');error.code=result && result.error && result.error.code;throw error;}
      return result.value;
    }});
  adapter = own; const stop=own.subscribe(publish); publish();
  return ()=>{stop();own.dispose();if(adapter===own)adapter=null;publish();};
}
