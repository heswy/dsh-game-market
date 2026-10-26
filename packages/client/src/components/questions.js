import React from 'react';
import {buildAnswerBatch} from '../questions.js';
const h=React.createElement;
function phaseLabel(phase) {
  const keys={idle:'question.phase.idle',saving:'question.phase.saving',ready:'question.phase.ready','save-failed':'question.phase.save-failed',sending:'question.phase.sending',awaiting:'question.phase.awaiting',settled:'question.phase.settled',handled:'question.phase.handled',unavailable:'question.phase.unavailable'};
  return keys[phase] || keys.unavailable;
}

/** Trusted overlay: no question text or answer ever enters the game bridge. */
export function QuestionPanel({flow,state,t,onConversation,onResume}) {
  const [drafts,setDrafts]=React.useState({});
  const [invalid,setInvalid]=React.useState(false);
  const root=React.useRef(null);
  const composing=React.useRef(false);
  const wasOpen=React.useRef(false);
  const card=state.card;
  const questions=card ? card.questions : [];
  React.useEffect(()=>{setDrafts({});setInvalid(false);},[card && card.key]);
  React.useEffect(()=>{
    if(!state.open){if(wasOpen.current){const whale=document.querySelector('.dgm-whale-btn');if(whale)whale.focus({preventScroll:true});}wasOpen.current=false;return;}
    wasOpen.current=true;
    const node=root.current;
    const target=node && node.querySelector('input, textarea, button');
    if(target)target.focus({preventScroll:true});
  },[state.open,state.phase]);
  React.useEffect(()=>{if(state.phase==='settled'||state.phase==='handled')setDrafts({});},[state.phase]);
  if(!state.open)return null;
  const ready=state.phase==='ready';
  const finished=state.phase==='settled'||state.phase==='handled';
  function close(){flow.close();}
  function keys(e){
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();return;}
    if(e.key==='Enter' && (composing.current || e.isComposing || e.keyCode===229)){e.preventDefault();return;}
    if(e.key==='Tab'){
      const nodes=[...root.current.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)')];
      const first=nodes[0],last=nodes[nodes.length-1];
      if(e.shiftKey && document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first.focus();}
    }
  }
  function edit(q,value){setInvalid(false);setDrafts(previous=>({...previous,[q.id]:{...(previous[q.id]||{}),...value}}));}
  function submit(e){e.preventDefault();if(composing.current||!ready)return;let batch;try{batch=buildAnswerBatch(questions,drafts);}catch(_){setInvalid(true);return;}void flow.submit(batch);}
  return h('div',{className:'dgm-question-overlay',onKeyDown:keys},
    h('section',{className:'dgm-question-panel',ref:root,role:'dialog','aria-modal':'true','aria-label':t('question.title'),'data-question-phase':state.phase},
      h('header',{className:'dgm-question-header'},h('div',null,h('p',{className:'dgm-question-eyebrow'},t('question.eyebrow')),h('h2',null,t('question.title'))),
        h('button',{type:'button',className:'dgm-btn dgm-btn-quiet',onClick:close,'aria-label':t('question.collapse')},t('question.collapse'))),
      h('p',{className:'dgm-question-note',role:'status'},t(phaseLabel(state.phase))),
      ready || state.phase==='sending' ? h('form',{onSubmit:submit,onCompositionStart:()=>{composing.current=true;},onCompositionEnd:()=>{composing.current=false;}},
        h('div',{className:'dgm-question-scroll'},questions.map((q,index)=>{
          const draft=drafts[q.id]||{selected:[],custom:''};
          return h('fieldset',{key:q.id,disabled:!ready,className:'dgm-question-field'},
            h('legend',null,h('span',{className:'dgm-question-number'},String(index+1).padStart(2,'0')),q.question),
            q.header ? h('p',{className:'dgm-question-hint'},q.header):null,
            (q.options||[]).map(option=>h('label',{key:option.label,className:'dgm-question-option'},
              h('input',{type:q.multiSelect?'checkbox':'radio',name:'dgm-question-'+q.id,checked:(draft.selected||[]).includes(option.label),onChange:()=>{
                const selected=q.multiSelect ? (draft.selected||[]).includes(option.label)?draft.selected.filter(x=>x!==option.label):[...(draft.selected||[]),option.label]:[option.label];
                edit(q,{selected,...(!q.multiSelect?{custom:''}:{})});
              }}),h('span',null,option.label),option.description?h('small',null,option.description):null)),
            h('label',{className:'dgm-question-custom'},h('span',null,t((q.options||[]).length?'question.other':'question.text')),
              h('textarea',{rows:2,maxLength:16000,value:draft.custom||'',onChange:e=>edit(q,{custom:e.target.value}),placeholder:t('question.placeholder')})));
        })),
        invalid || state.error ? h('p',{className:'dgm-question-error',role:'alert'},t(invalid?'question.incomplete':'question.retry')):null,
        h('footer',{className:'dgm-question-footer'},h('button',{type:'button',className:'dgm-btn',onClick:onConversation,disabled:!ready},t('question.conversation')),
          h('button',{type:'submit',className:'dgm-btn dgm-btn-primary',disabled:!ready},t('question.submit')))) :
      h('footer',{className:'dgm-question-footer'},
        state.phase==='save-failed'?h('button',{type:'button',className:'dgm-btn dgm-btn-primary',onClick:()=>{void flow.open();}},t('question.retrySave')):null,
        finished?h('button',{type:'button',className:'dgm-btn dgm-btn-primary',onClick:()=>{flow.close();onResume();}},t('question.resume')):null,
        h('button',{type:'button',className:'dgm-btn',onClick:onConversation,disabled:state.phase==='saving'||state.phase==='sending'},t('question.conversation')))));
}
