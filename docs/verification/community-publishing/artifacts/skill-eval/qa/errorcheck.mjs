import fs from 'node:fs';
import { connectToPage, sleep } from './cdp.mjs';

const evidence = { steps: [] };
const parentConsoleErrors = [];
let sessionId = null;
let targetId = null;
const gameRequests = [];

function record(step, data) {
  evidence.steps.push({ step, ...data });
  console.log('STEP', step, JSON.stringify(data));
}

async function ensureSession(cdp) {
  const { targetInfos } = await cdp.send('Target.getTargets');
  const target = targetInfos.find((entry) => entry.type === 'iframe' && entry.url.includes('/game'));
  if (!target) throw new Error('iframe target missing');
  if (sessionId && targetId === target.targetId) return sessionId;
  const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  sessionId = attached.sessionId;
  targetId = target.targetId;
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Network.enable', {}, sessionId);
  return sessionId;
}

async function gameEval(cdp, expression) {
  const sid = await ensureSession(cdp);
  return cdp.evaluate(expression, { sessionId: sid });
}

const hookSource = `(() => {
  window.__qaHook = true;
  function send(payload) {
    try { parent.postMessage(Object.assign({ __emberQa: true }, payload), '*'); } catch (_error) {}
  }
  window.addEventListener('error', (event) => send({ type: 'error', message: event.message, source: event.filename, line: event.lineno }));
  window.addEventListener('unhandledrejection', (event) => send({ type: 'rejection', message: String((event.reason && event.reason.message) || event.reason) }));
  const original = console.error.bind(console);
  console.error = (...args) => {
    send({ type: 'console.error', message: args.map((arg) => {
      try { return typeof arg === 'string' ? arg : JSON.stringify(arg); } catch (_error) { return String(arg); }
    }).join(' ') });
    original(...args);
  };
})();`;

const cdp = await connectToPage();
cdp.on('Runtime.exceptionThrown', (params, sid) => parentConsoleErrors.push({ type: 'exception', sessionId: sid || null, text: params.exceptionDetails?.text || '' }));
cdp.on('Runtime.consoleAPICalled', (params, sid) => {
  if (params.type === 'error') parentConsoleErrors.push({ type: 'console.error', sessionId: sid || null, args: params.args });
});
cdp.on('Network.requestWillBeSent', (params, sid) => {
  if (sid) gameRequests.push(params.request?.url);
});
await cdp.send('Runtime.enable');
await cdp.send('Network.enable');
await cdp.evaluate(`(() => {
  window.__qaGameErrors = [];
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (data && data.__emberQa) window.__qaGameErrors.push(data);
  });
  return true;
})()`);
await ensureSession(cdp);
await cdp.send('Page.enable', {}, await ensureSession(cdp));
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: hookSource }, await ensureSession(cdp));

await cdp.evaluate("document.querySelector('[data-command=\"reload\"]').click(); true");
await cdp.waitFor("document.getElementById('status-text').textContent === 'ready'", { timeout: 15000 });
await sleep(1000);
record('hook-installed', { hook: await gameEval(cdp, 'window.__qaHook === true') });

const hint = await gameEval(cdp, "document.getElementById('hint').textContent");
if (hint.includes('Space start') || hint.includes('Space continue') || hint.includes('空格')) {
  await gameEval(cdp, "document.getElementById('game').focus(); true");
  await cdp.key(' ', 'Space', 32, await ensureSession(cdp));
  await sleep(700);
}
await gameEval(cdp, "document.getElementById('game').focus(); true");
const sid = await ensureSession(cdp);
await cdp.keyDown('ArrowRight', 'ArrowRight', 39, sid);
await sleep(700);
await cdp.keyUp('ArrowRight', 'ArrowRight', 39, sid);
await sleep(700);

record('runtime', {
  hint: await gameEval(cdp, "document.getElementById('hint').textContent"),
  theme: await gameEval(cdp, "document.documentElement.dataset.theme"),
  hookErrors: await cdp.evaluate('window.__qaGameErrors'),
  consoleErrors: parentConsoleErrors,
  gameRequests: [...new Set(gameRequests)],
  externalRequests: [
    ...new Set(
      gameRequests.filter(
        (url) => !url.startsWith('http://127.0.0.1:4321') && !url.startsWith('data:') && !url.startsWith('blob:')
      )
    ),
  ],
});

fs.writeFileSync('/tmp/dsh-skill-eval-ember-drift-20261019/qa/errorcheck-evidence.json', `${JSON.stringify(evidence, null, 2)}\n`);
console.log('DONE');
cdp.close();
