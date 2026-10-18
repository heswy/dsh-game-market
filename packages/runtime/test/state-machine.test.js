import test from 'node:test';
import assert from 'node:assert/strict';

import { canTransition, createStateMachine, isRuntimeState, RUNTIME_STATES } from '../src/state-machine.js';

test('runtime exposes the documented states', () => {
  assert.deepEqual(RUNTIME_STATES, [
    'idle',
    'loading',
    'ready',
    'playing',
    'paused',
    'saving',
    'error',
    'exited',
  ]);
  assert.equal(isRuntimeState('playing'), true);
  assert.equal(isRuntimeState('bogus'), false);
});

test('happy-path transitions are allowed', () => {
  assert.equal(canTransition('idle', 'loading'), true);
  assert.equal(canTransition('loading', 'ready'), true);
  assert.equal(canTransition('ready', 'playing'), true);
  assert.equal(canTransition('playing', 'paused'), true);
  assert.equal(canTransition('paused', 'saving'), true);
  assert.equal(canTransition('saving', 'paused'), true);
  assert.equal(canTransition('paused', 'playing'), true);
  assert.equal(canTransition('playing', 'exited'), true);
});

test('resume-paused can move ready -> paused directly', () => {
  assert.equal(canTransition('ready', 'paused'), true);
});

test('illegal transitions are rejected', () => {
  assert.equal(canTransition('playing', 'ready'), false);
  assert.equal(canTransition('loading', 'playing'), false);
  assert.equal(canTransition('exited', 'playing'), false);
  assert.equal(canTransition('playing', 'playing'), false);
});

test('state machine ignores invalid transitions and reports them', () => {
  const invalid = [];
  const machine = createStateMachine({ onInvalidTransition: (from, to) => invalid.push([from, to]) });
  assert.equal(machine.get(), 'idle');
  assert.equal(machine.transition('ready'), false);
  assert.equal(machine.get(), 'idle');
  assert.equal(machine.transition('loading'), true);
  assert.equal(machine.transition('ready'), true);
  assert.equal(machine.get(), 'ready');
  assert.deepEqual(invalid, [['idle', 'ready']]);
});

test('state machine can destroy from idle and reset for relaunch', () => {
  const machine = createStateMachine();
  assert.equal(machine.transition('exited'), true);
  assert.equal(machine.get(), 'exited');
  assert.equal(machine.transition('loading'), true);
  machine.reset('idle');
  assert.equal(machine.get(), 'idle');
});
