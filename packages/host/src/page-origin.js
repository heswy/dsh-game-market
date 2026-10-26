/** rc.3 Desktop serves the renderer on its secure privileged custom scheme. */
export function dshPageOrigin(webOrigin, {electron = process.versions.electron, argv = process.argv} = {}) {
  const desktopHost = argv.some(arg => typeof arg === 'string' && /[/\\]@deepseek-ai[/\\]dsh-desktop-host[/\\]lib[/\\]index\.js$/.test(arg));
  if (electron && desktopHost) return 'dsh-app://app';
  try {
    const parsed = new URL(webOrigin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    return parsed.origin;
  } catch (_) { return null; }
}
