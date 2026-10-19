import fs from 'node:fs';
import { connectToPage, sleep } from './cdp.mjs';

const SHOTS = '/tmp/dsh-skill-eval-ember-drift-20261019/qa/shots';
const evidence = { steps: [] };
const errors = [];
let sessionId = null;
let targetId = null;

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
  return sessionId;
}

async function gameEval(cdp, expression) {
  const sid = await ensureSession(cdp);
  return cdp.evaluate(expression, { sessionId: sid });
}

async function getHint(cdp) {
  return gameEval(cdp, "document.getElementById('hint').textContent");
}

async function getSave(cdp) {
  return cdp.evaluate('state.save.current || null');
}

async function refreshSave(cdp) {
  await cdp.evaluate("document.querySelector('[data-command=\"before-save\"]').click(); true");
  await sleep(80);
  return getSave(cdp);
}

async function clickCommand(cdp, command) {
  await cdp.evaluate(`document.querySelector('[data-command="${command}"]').click(); true`);
}

async function keyHold(cdp, key, code, keyCode, milliseconds) {
  const sid = await ensureSession(cdp);
  await cdp.keyDown(key, code, keyCode, sid);
  await sleep(milliseconds);
  await cdp.keyUp(key, code, keyCode, sid);
}

async function keyTap(cdp, key, code, keyCode) {
  await keyHold(cdp, key, code, keyCode, 60);
  await sleep(350);
}

async function setStage(cdp, width, height) {
  await cdp.evaluate(`(() => {
    const frame = document.getElementById('frame');
    frame.style.width = '${width}px';
    frame.style.height = '${height}px';
    frame.style.maxWidth = 'none';
    return true;
  })()`);
  await sleep(600);
}

const cdp = await connectToPage();
cdp.on('Runtime.exceptionThrown', (params, sid) =>
  errors.push({ type: 'exception', sessionId: sid || null, text: params.exceptionDetails?.text || '' })
);
cdp.on('Runtime.consoleAPICalled', (params, sid) => {
  if (params.type === 'error') errors.push({ type: 'console.error', sessionId: sid || null, args: params.args });
});
await cdp.send('Runtime.enable');
await ensureSession(cdp);

record('initial', {
  hint: await getHint(cdp),
  theme: await gameEval(cdp, "document.documentElement.dataset.theme"),
  viewport: await gameEval(cdp, '({w:window.innerWidth,h:window.innerHeight,dpr:window.devicePixelRatio})'),
  save: await getSave(cdp),
});

// Real Continue from the save created by the media pass.
await gameEval(cdp, "document.getElementById('game').focus(); true");
await cdp.key(' ', 'Space', 32, await ensureSession(cdp));
await sleep(800);
record('continue-space', { hint: await getHint(cdp) });
await sleep(1200);
let save = await refreshSave(cdp);
record('after-continue-save', { score: save && save.score, timeLeft: save && save.timeLeft, shipX: save && save.shipX });

// A key moves left; D key moves right.
const startX = save && save.shipX;
await keyHold(cdp, 'a', 'KeyA', 65, 700);
const afterA = await refreshSave(cdp);
await keyHold(cdp, 'd', 'KeyD', 68, 700);
const afterD = await refreshSave(cdp);
record('ad-keys', {
  startX,
  afterA: afterA && afterA.shipX,
  afterD: afterD && afterD.shipX,
  leftWorks: afterA && startX !== null ? afterA.shipX < startX : false,
  rightWorks: afterD && afterA ? afterD.shipX > afterA.shipX : false,
});

// Local P pause/resume.
await keyTap(cdp, 'p', 'KeyP', 80);
record('p-paused', { hint: await getHint(cdp) });
await keyTap(cdp, 'p', 'KeyP', 80);
record('p-resumed', { hint: await getHint(cdp) });

// Short 640x360 and narrow 375x667 viewports with the clean media stage.
await setStage(cdp, 640, 360);
record('640x360', {
  hint: await getHint(cdp),
  viewport: await gameEval(cdp, '({w:window.innerWidth,h:window.innerHeight})'),
});
await cdp.screenshot(`${SHOTS}/qa-640x360-playing-light.png`, { x: 0, y: 0, width: 640, height: 360 });
console.log('SHOT qa-640x360-playing-light.png');

await setStage(cdp, 375, 667);
record('375x667', {
  hint: await getHint(cdp),
  viewport: await gameEval(cdp, '({w:window.innerWidth,h:window.innerHeight})'),
});
await cdp.screenshot(`${SHOTS}/qa-375x667-playing-light.png`, { x: 0, y: 0, width: 375, height: 667 });
console.log('SHOT qa-375x667-playing-light.png');
await setStage(cdp, 1280, 720);

// Safe-area geometry inside the game: HUD y starts below 112 and the DOM hint
// never enters the bottom-right 96x96 Agent zone.
record('safe-area', await gameEval(cdp, `(() => {
  const hint = document.getElementById('hint').getBoundingClientRect();
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    hintRightGap: window.innerWidth - hint.right,
    hintBottomGap: window.innerHeight - hint.bottom,
    hintTop: hint.top,
    hintLeft: hint.left,
  };
})()`));

record('errors', errors);
fs.writeFileSync('/tmp/dsh-skill-eval-ember-drift-20261019/qa/finalqa-evidence.json', `${JSON.stringify(evidence, null, 2)}\n`);
console.log('DONE');
cdp.close();
