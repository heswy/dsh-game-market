/**
 * Static ESM dependency of `main.js` (relative import inside the package).
 * `fetch()` of a JSON level is the dynamic, repeated resource read.
 */
export const MODULE_ID = 'level-loader@probe-1';

export async function loadLevel(url) {
  const response = await fetch(url, { cache: 'no-store', mode: 'cors' });
  const text = await response.text();
  if (!response.ok) throw new Error(`level fetch failed: ${response.status}`);
  return { status: response.status, bytes: text.length, level: JSON.parse(text) };
}

export function levelSignature(level) {
  return `${level.id}:${Array.isArray(level.obstacles) ? level.obstacles.length : 0}:${level.goal}`;
}
