/** Portable game progress only: never copies a DSH profile or credentials. */
import {createHash} from 'node:crypto';
import {LIMITS} from '../../shared/src/constants.js';
import {GM} from '../../shared/src/errors.js';
import {hostError} from './errors.js';
import {isPlainObject,isValidStorageKey,jsonByteLength,validateStoredValue,validateGameId} from './validation.js';
import {parseVersion} from './semver.js';
const FORMAT='dsh-game-save-v1';
function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value && typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function digest(value){return createHash('sha256').update(canonical(value)).digest('hex');}
export function portableSave({gameId,gameVersion,saveSchemaVersion,values}) {
  validateGameId(gameId);if(!parseVersion(gameVersion))throw hostError(GM.INVALID_PARAM,'Invalid game version');
  if(!Number.isSafeInteger(saveSchemaVersion)||saveSchemaVersion<1)throw hostError(GM.SAVE_SCHEMA,'Invalid portable schema');
  if(!isPlainObject(values)||Object.keys(values).length===0||Object.keys(values).length>LIMITS.saveKeys)throw hostError(GM.STORAGE_QUOTA,'Invalid portable keys');
  const checked={};
  for(const key of Object.keys(values)){
    if(!isValidStorageKey(key))throw hostError(GM.STORAGE_KEY_INVALID,'Invalid portable key');
    checked[key]=validateStoredValue(values[key]);
    if(jsonByteLength(checked[key])>LIMITS.saveValueBytes)throw hostError(GM.SAVE_TOO_LARGE,'Portable value exceeds limit');
  }
  const payload={format:FORMAT,gameId,gameVersion,saveSchemaVersion,values:checked};
  const result={...payload,sha256:digest(payload)};
  if(jsonByteLength(result)>LIMITS.jsonBodyBytes-1024)throw hostError(GM.SAVE_TOO_LARGE,'Portable save exceeds transfer limit');
  return result;
}
export function validatePortableSave(value) {
  if(!isPlainObject(value)||value.format!==FORMAT||Object.keys(value).sort().join(',')!=='format,gameId,gameVersion,saveSchemaVersion,sha256,values')throw hostError(GM.SAVE_CORRUPT,'Invalid portable save');
  const checked=portableSave(value);
  if(checked.sha256!==value.sha256)throw hostError(GM.ASSET_INTEGRITY,'Portable save checksum mismatch');
  return checked;
}
