/**
 * Resume policy for the platform's `resume-paused` handshake.
 *
 * The Runtime may deliver `resume` while Boot is still loading best/save, so the
 * game must remember it. Once the board is restored there are exactly two
 * sensible outcomes:
 * - the saved board was already running: hand control back and keep moving;
 * - the saved board never left its prompt: keep the game's own prompt visible
 *   (an explicit affordance), instead of hiding it under a static board.
 */
export const RESUME_PLAN = Object.freeze({
  IGNORE: 'ignore',
  PLAY: 'play',
  PROMPT: 'prompt',
});

export function planResume(mode, savedStatus) {
  if (mode === 'over' || mode === 'error') return RESUME_PLAN.IGNORE;
  return savedStatus === 'playing' ? RESUME_PLAN.PLAY : RESUME_PLAN.PROMPT;
}
