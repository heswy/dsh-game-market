/** Trusted progress transfer UI; never copies sessions or profile settings. */
import React from 'react';
import {LIMITS} from '../../../shared/src/constants.js';
import {GM} from '../../../shared/src/errors.js';
const h=React.createElement;
export function SaveTransferPanel({request,t,api,onClose,onDone}) {
  const {game,action}=request;
  const [portable,setPortable]=React.useState(null);
  const [revision,setRevision]=React.useState(null);
  const [overwrite,setOverwrite]=React.useState(false);
  const [phase,setPhase]=React.useState('idle');
  const [error,setError]=React.useState(null);
  const root=React.useRef(null);
  const alive=React.useRef(true);
  React.useEffect(()=>{alive.current=true;root.current?.focus();return()=>{alive.current=false;};},[]);
  function fail(e){
    if(!alive.current)return;
    setPhase('idle');
    const code=e&&e.code;
    setError(code===GM.SAVE_NOT_FOUND?'transfer.error.empty':code===GM.UPDATE_GAME_RUNNING?'transfer.error.running':code===GM.STORAGE_CONFLICT?'transfer.error.conflict':code===GM.SAVE_SCHEMA_TOO_NEW?'transfer.error.schema':'transfer.error.invalid');
  }
  async function selectFile(event){
    const file=event.target.files?.[0];setPortable(null);setOverwrite(false);setError(null);if(!file)return;
    if(file.size>LIMITS.jsonBodyBytes-1024){setError('transfer.error.invalid');return;}
    setPhase('reading');
    try{
      const value=JSON.parse(await file.text());
      if(value.format!=='dsh-game-save-v1'||value.gameId!==game.id||!value.values||typeof value.sha256!=='string')throw new Error('invalid');
      let current;
      try{current=await api.saveTransferState(game.id);}catch(e){if(e.code!==GM.SAVE_NOT_FOUND)throw e;current={revision:0};}
      if(!alive.current)return;
      setPortable(value);setRevision(current.revision);setPhase('ready');
    }catch(e){fail(e);}
  }
  async function exportFile(){
    setPhase('busy');setError(null);
    try{
      const value=await api.downloadSaveTransfer(game.id,action==='backup');
      if(!alive.current)return;
      const blob=new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'});
      const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;
      link.download=game.id+'-'+value.gameVersion+(action==='backup'?'-backup':'-save')+'.json';
      root.current.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      setPhase('done');
    }catch(e){fail(e);}
  }
  async function importFile(){
    if(!portable||phase!=='ready'||(revision>0&&!overwrite))return;
    setPhase('busy');setError(null);
    try{await api.importSaveTransfer({gameId:game.id,expectedRevision:revision,portable});if(!alive.current)return;setPhase('done');onDone();}
    catch(e){setPortable(null);fail(e);}
  }
  function close(){if(phase==='busy'||phase==='reading')return;onClose();setTimeout(()=>document.querySelector('.dgm-row[data-row-id="'+game.id+'"] .dgm-row-menu-btn')?.focus(),0);}
  function keys(e){
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}
    if(e.key==='Tab'){
      const nodes=[...root.current.querySelectorAll('button:not(:disabled),input:not(:disabled)')];const first=nodes[0],last=nodes[nodes.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }
  }
  const busy=phase==='busy'||phase==='reading';
  return h('div',{className:'dgm-overlay',onKeyDown:keys},h('section',{className:'dgm-modal',role:'dialog','aria-modal':'true','aria-label':t('transfer.title'),tabIndex:-1,ref:root,'data-transfer-phase':phase},
    h('h2',{className:'dgm-modal-title'},t('transfer.title')+' · '+game.name),
    h('p',{className:'dgm-modal-body'},t(action==='import'?'transfer.import.note':'transfer.export.note')),
    action==='import'&&phase!=='done'?h('input',{type:'file',accept:'.json,application/json',onChange:selectFile,disabled:busy,'aria-label':t('transfer.choose')}):null,
    portable&&phase!=='done'?h('p',{className:'dgm-modal-body'},t('transfer.preview',{version:portable.gameVersion,schema:portable.saveSchemaVersion})):null,
    portable&&revision>0&&phase!=='done'?h('label',{className:'dgm-modal-body'},h('input',{type:'checkbox',checked:overwrite,onChange:e=>setOverwrite(e.target.checked),disabled:busy}),t('transfer.overwrite')):null,
    error?h('p',{role:'alert',className:'dgm-question-error'},t(error)):null,
    phase==='done'?h('p',{role:'status',className:'dgm-modal-body'},t(action==='import'?'transfer.import.done':'transfer.export.done')):null,
    busy?h('p',{role:'status'},t('transfer.busy')):null,
    h('div',{className:'dgm-modal-actions'},h('button',{type:'button',className:'dgm-btn',onClick:close,disabled:busy},t('common.close')),
      phase!=='done'?h('button',{type:'button',className:'dgm-btn dgm-btn-primary',onClick:action==='import'?importFile:exportFile,disabled:busy||(action==='import'&&(!portable||(revision>0&&!overwrite)))},t(action==='import'?'transfer.confirm':'transfer.download')):null)));
}
