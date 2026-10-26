/** Host-provided official mark, capability probed rather than assumed. No copied artwork. */
export function resolveFishLogo(load) {
  try { const module=load('@deepseek-ai/dsh-client-ui-primitives');return module && typeof module.FishLogo==='function'?module.FishLogo:null; }
  catch (_) { return null; }
}
