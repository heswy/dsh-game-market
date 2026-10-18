import test from 'node:test';
import assert from 'node:assert/strict';
import { RESUME_PLAN, planResume } from '../src/resume.js';

test('a running board resumes motion', function () {
  assert.equal(planResume('ready', 'playing'), RESUME_PLAN.PLAY);
  assert.equal(planResume('paused', 'playing'), RESUME_PLAN.PLAY);
  assert.equal(planResume('boot', 'playing'), RESUME_PLAN.PLAY);
});

test('an unstarted board keeps its own prompt', function () {
  assert.equal(planResume('ready', 'ready'), RESUME_PLAN.PROMPT);
  assert.equal(planResume('paused', 'ready'), RESUME_PLAN.PROMPT);
  assert.equal(planResume('boot', 'ready'), RESUME_PLAN.PROMPT);
});

test('finished or broken games ignore resume', function () {
  assert.equal(planResume('over', 'over'), RESUME_PLAN.IGNORE);
  assert.equal(planResume('error', 'ready'), RESUME_PLAN.IGNORE);
});
