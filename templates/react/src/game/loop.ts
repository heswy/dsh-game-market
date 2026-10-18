/**
 * requestAnimationFrame loop with pause-safe dt (PRD §8.2.9 item 3).
 *
 * The loop never accumulates paused time: `start()` resets the timestamp, and
 * dt is capped so a background tab cannot fast-forward the game.
 */

export interface Loop {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

export function createLoop(onFrame: (dt: number) => boolean | void): Loop {
  let running = false;
  let handle = 0;
  let last = 0;

  function frame(timestamp: number): void {
    if (!running) return;
    const dt = Math.min(0.05, Math.max(0, (timestamp - last) / 1000));
    last = timestamp;
    const keepGoing = onFrame(dt);
    if (running && keepGoing !== false) {
      handle = requestAnimationFrame(frame);
    } else {
      running = false;
      handle = 0;
    }
  }

  return {
    start(): void {
      if (running) return;
      running = true;
      last = performance.now();
      handle = requestAnimationFrame(frame);
    },
    stop(): void {
      running = false;
      if (handle) cancelAnimationFrame(handle);
      handle = 0;
    },
    isRunning(): boolean {
      return running;
    },
  };
}
