/** Non-destructive git helpers for the content-repository publishing tool. */
import { spawnSync } from 'node:child_process';

export function createGit({ cwd, runner } = {}) {
  const directory = cwd;
  const run = runner || function runGit(args, options = {}) {
    return spawnSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      ...options,
    });
  };
  function call(args, { allowFailure = false } = {}) {
    const result = run(args);
    const output = {
      status: result.status,
      stdout: String(result.stdout || '').trim(),
      stderr: String(result.stderr || '').trim(),
    };
    if (!allowFailure && result.status !== 0) {
      const error = new Error(`git ${args.join(' ')} failed: ${output.stderr || output.stdout}`);
      error.code = 'E_PUBLISH_GIT';
      error.result = output;
      throw error;
    }
    return output;
  }
  return {
    run: call,
    isRepo() {
      return call(['rev-parse', '--is-inside-work-tree'], { allowFailure: true }).status === 0;
    },
    statusPorcelain() {
      return call(['status', '--porcelain']).stdout;
    },
    currentBranch() {
      return call(['rev-parse', '--abbrev-ref', 'HEAD']).stdout;
    },
    head() {
      return call(['rev-parse', 'HEAD']).stdout;
    },
    remoteUrl(remote = 'origin') {
      return call(['remote', 'get-url', remote], { allowFailure: true }).stdout;
    },
    fetchOrigin(base = 'main') {
      return call(['fetch', 'origin', base]).stdout;
    },
    remoteHead(base = 'main') {
      return call(['rev-parse', `origin/${base}`], { allowFailure: true }).stdout;
    },
    branchExists(branch) {
      return call(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { allowFailure: true }).status === 0;
    },
    isAncestor(ancestor, descendant) {
      return call(['merge-base', '--is-ancestor', ancestor, descendant], { allowFailure: true }).status === 0;
    },
    materializeRef(ref, target) {
      call(['worktree', 'add', '--detach', target, ref]);
      return target;
    },
    removeWorktree(target) {
      return call(['worktree', 'remove', '--force', target], { allowFailure: true }).stdout;
    },
    resetPaths(paths) {
      // Must throw: rollbackLocal relies on exceptions to report failures.
      return call(['reset', '-q', '--', ...paths]).stdout;
    },
    deleteBranch(branch) {
      // Must throw: a locked/remaining branch is a rollback failure, not noise.
      return call(['branch', '-D', branch]).stdout;
    },
    checkout(branch) {
      return call(['checkout', branch]);
    },
    hasCleanWorktree() {
      return this.statusPorcelain().length === 0;
    },
    createBranch(branch) {
      return call(['checkout', '-b', branch]);
    },
    add(paths) {
      return call(['add', '--', ...paths]);
    },
    commit(message) {
      return call(['commit', '-m', message]);
    },
    push(branch) {
      return call(['push', '-u', 'origin', branch]);
    },
  };
}
