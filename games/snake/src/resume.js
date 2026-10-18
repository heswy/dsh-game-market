/**
 * Resume policy for the platform's `resume-paused` handshake.
 *
 * The Runtime may deliver `resume` while Boot is still loading best/save, so the
 * game must remember it. The platform modal is the only confirmation prompt: once
 * the player confirms, the game starts playing instead of showing a second prompt.
 */
export const RESUME_PLAN = Object.freeze({
  IGNORE: 'ignore',
  PLAY: 'play',
});

export function planResume(mode, savedStatus) {
  void savedStatus;
  if (mode === 'over' || mode === 'error') return RESUME_PLAN.IGNORE;
  return RESUME_PLAN.PLAY;
}
