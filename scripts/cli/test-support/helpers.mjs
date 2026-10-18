import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../../..');
export const CLI = path.join(REPO_ROOT, 'scripts/cli/dsh-game.mjs');
export const CREATE_CLI = path.join(REPO_ROOT, 'scripts/cli/create-dsh-game.mjs');

export function tempDir(prefix = 'dsh-cli-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeFiles(root, files) {
  for (const [relative, content] of Object.entries(files)) {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (Buffer.isBuffer(content)) fs.writeFileSync(abs, content);
    else fs.writeFileSync(abs, content, 'utf8');
  }
}

export const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

export function manifest(overrides = {}) {
  return {
    manifestVersion: 1,
    id: 'demo-game',
    name: 'Demo Game',
    version: '1.0.0',
    author: { name: 'CLI Tester' },
    description: 'A deterministic fixture game used by the CLI tests.',
    categories: ['arcade'],
    capabilities: ['storage', 'score'],
    sdkVersion: '^1.0.0',
    runtimeVersion: '^1.0.0',
    preferredTheme: 'game-defined',
    viewport: { width: 960, height: 540, fit: 'contain' },
    score: { direction: 'higher-better', min: 0, max: 1000000, integer: true },
    save: { schemaVersion: 1 },
    ...overrides,
  };
}

export function fixtureFiles(overrides = {}) {
  const manifestValue = overrides.manifest === null ? null : manifest(overrides.manifest || {});
  const html =
    overrides.html ||
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Fixture</title>
    <link rel="stylesheet" href="src/styles.css" />
  </head>
  <body>
    <canvas id="game"></canvas>
    <img id="pixel" src="assets/pixel.png" alt="" />
    <script type="module" src="src/main.js"></script>
  </body>
</html>
`;
  const files = {
    'index.html': html,
    'dsh-game.config.json': `${JSON.stringify(
      { manifest: 'manifest.json', template: 'index.html', entry: 'src/main.js', out: 'dist/index.html' },
      null,
      2
    )}\n`,
    'src/styles.css': 'body { background-color: #07080a; background-image: url("../assets/pixel.png"); }\n',
    'src/main.js': `import { createScore } from './counter.js';

const game = DSH_GAME_SDK.createGameSDK();
export function boot() {
  return { game, score: createScore(3) };
}
boot();
`,
    'src/counter.js': `export function createScore(seed) {
  let value = seed;
  return {
    add(amount) {
      value += amount;
      return value;
    },
    get value() {
      return value;
    },
  };
}
`,
    'assets/pixel.png': PIXEL_PNG,
  };
  if (manifestValue !== null) files['manifest.json'] = `${JSON.stringify(manifestValue, null, 2)}\n`;
  return files;
}

export function createFixture(overrides = {}) {
  const dir = tempDir();
  writeFiles(dir, fixtureFiles(overrides));
  return dir;
}

export function runCli(args, options = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: options.cwd || REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
  });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

export function runCreate(args, options = {}) {
  const result = spawnSync(process.execPath, [CREATE_CLI, ...args], {
    cwd: options.cwd || REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
  });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
