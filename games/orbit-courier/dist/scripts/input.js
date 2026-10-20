/**
 * Orbit Courier input: keyboard first, pointer/touch as an optional layer.
 *
 * Keyboard owns the game (arrows/WASD steer, Space/P pause, M mute, Enter
 * confirm). Pointer input repeats the same intent: dragging around the centre
 * rotates the ship, tapping a ring band switches lanes. All listeners are
 * detachable so the panel teardown leaves nothing behind.
 */

const KEY_LEFT = ['ArrowLeft', 'KeyA'];
const KEY_RIGHT = ['ArrowRight', 'KeyD'];
const KEY_INWARD = ['ArrowUp', 'KeyW'];
const KEY_OUTWARD = ['ArrowDown', 'KeyS'];
const KEY_PAUSE = ['Space', 'KeyP'];
const KEY_MUTE = ['KeyM'];
const KEY_ENTER = ['Enter', 'NumpadEnter'];

function isTypingTarget(target) {
  if (!target || typeof target.tagName !== 'string') return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable === true;
}

/** Discrete actions the shell reacts to; steering is polled through `read()`. */
export function createInput(options = {}) {
  const rotateSources = new Set();
  const ringSources = new Set();
  const disposers = [];
  let pointer = null;
  let pointerEnabled = Boolean(options.pointerEnabled);

  function onKeyDown(event) {
    if (isTypingTarget(event.target)) return;
    const code = event.code;
    if (KEY_LEFT.includes(code)) rotateSources.add(-1);
    else if (KEY_RIGHT.includes(code)) rotateSources.add(1);
    else if (KEY_INWARD.includes(code)) ringSources.add(-1);
    else if (KEY_OUTWARD.includes(code)) ringSources.add(1);
    else if (KEY_PAUSE.includes(code)) {
      event.preventDefault();
      if (typeof options.onPauseToggle === 'function') options.onPauseToggle();
    } else if (KEY_MUTE.includes(code)) {
      event.preventDefault();
      if (typeof options.onMuteToggle === 'function') options.onMuteToggle();
    } else if (KEY_ENTER.includes(code)) {
      if (typeof options.onConfirm === 'function') options.onConfirm(event);
    } else if (code === 'Escape') {
      if (typeof options.onEscape === 'function') options.onEscape();
    } else {
      return;
    }
    if (typeof options.onGesture === 'function') options.onGesture();
    if (rotatesOrSteers(code) && typeof options.onSteer === 'function') options.onSteer();
  }

  function rotatesOrSteers(code) {
    return KEY_LEFT.includes(code) || KEY_RIGHT.includes(code) || KEY_INWARD.includes(code) || KEY_OUTWARD.includes(code);
  }

  function onKeyUp(event) {
    const code = event.code;
    if (KEY_LEFT.includes(code)) rotateSources.delete(-1);
    else if (KEY_RIGHT.includes(code)) rotateSources.delete(1);
    else if (KEY_INWARD.includes(code)) ringSources.delete(-1);
    else if (KEY_OUTWARD.includes(code)) ringSources.delete(1);
  }

  function clearSteering() {
    rotateSources.clear();
    ringSources.clear();
  }

  function onWindowBlur() {
    clearSteering();
  }

  /** Poll the current steering intent for one frame. */
  function read() {
    let rotate = 0;
    if (rotateSources.has(-1) && !rotateSources.has(1)) rotate = -1;
    else if (rotateSources.has(1) && !rotateSources.has(-1)) rotate = 1;
    let ring = 0;
    if (ringSources.has(-1) && !ringSources.has(1)) ring = -1;
    else if (ringSources.has(1) && !ringSources.has(-1)) ring = 1;
    if (pointer) {
      rotate = pointer.rotate;
      if (pointer.ring !== 0) {
        ring = pointer.ring;
        pointer.ring = 0;
      }
    }
    return { rotate, ring };
  }

  function attachPointer(surface, geometry) {
    if (!pointerEnabled || !surface) return;
    const listener = (name, handler, target) => {
      const node = target || surface;
      node.addEventListener(name, handler, { passive: false });
      disposers.push(() => node.removeEventListener(name, handler));
    };
    listener('pointerdown', (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      if (typeof options.onGesture === 'function') options.onGesture();
      event.preventDefault();
      const point = surfacePoint(surface, event);
      pointer = { active: true, start: point, last: point, rotate: 0, ring: 0 };
      try {
        surface.setPointerCapture(event.pointerId);
      } catch (error) {
        /* pointer capture is best-effort */
      }
    });
    listener('pointermove', (event) => {
      if (!pointer || !pointer.active) return;
      event.preventDefault();
      const point = surfacePoint(surface, event);
      const center = geometry();
      const before = Math.atan2(pointer.last.y - center.y, pointer.last.x - center.x);
      const after = Math.atan2(point.y - center.y, point.x - center.x);
      let delta = after - before;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      if (Math.abs(delta) > 0.004) pointer.rotate = delta > 0 ? 1 : -1;
      pointer.last = point;
    });
    const end = (event) => {
      if (!pointer || !pointer.active) return;
      event.preventDefault();
      const point = surfacePoint(surface, event);
      const center = geometry();
      const moved = Math.hypot(point.x - pointer.start.x, point.y - pointer.start.y);
      if (moved < 10) {
        const distance = Math.hypot(point.x - center.x, point.y - center.y);
        const rings = (center.rings || [0.5]).slice();
        let best = 0;
        let bestDelta = Infinity;
        rings.forEach((radius, index) => {
          const diff = Math.abs(distance - radius * center.scale);
          if (diff < bestDelta) {
            bestDelta = diff;
            best = index;
          }
        });
        pointer.ring = best - (center.currentRing || 0);
        if (pointer.ring !== 0) pointer.ring = pointer.ring > 0 ? 1 : -1;
      }
      pointer.rotate = 0;
      pointer.active = false;
    };
    listener('pointerup', end);
    listener('pointercancel', end);
    listener('pointerleave', () => {
      if (pointer) {
        pointer.active = false;
        pointer.rotate = 0;
      }
    });
  }

  function surfacePoint(surface, event) {
    const rect = surface.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * surface.width,
      y: ((event.clientY - rect.top) / rect.height) * surface.height,
    };
  }

  function dispose() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onWindowBlur);
    for (const off of disposers.splice(0)) off();
    clearSteering();
    pointer = null;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onWindowBlur);

  return { read, attachPointer, dispose, clearSteering };
}
