/**
 * V1.5 dual-format developer tooling: explicit `asset-zip-v2` scaffold/build/
 * validate/pack/publish, determinism, and the "no --format keeps M1 behavior"
 * compatibility guarantee (docs/V1.5-CONTRACTS §1–§4).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { createProject } from '../lib/create.mjs';
import { buildProject, loadConfig } from '../lib/project.mjs';
import { validatePath } from '../lib/validator.mjs';
import { packProject } from '../lib/pack.mjs';
import { publishProject } from '../lib/publish.mjs';
import { validatePackageTree } from '../lib/package-v2.mjs';
import { startDevServer } from '../dev-server.mjs';
import { buildZip } from '../lib/zip-writer.mjs';
import { createFixture, runCli, tempDir } from '../test-support/helpers.mjs';

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function makeZipProject(parent, options = {}) {
  return createProject({
    name: options.name || 'orbit-zip',
    template: 'vanilla',
    parentDir: parent,
    format: 'asset-zip-v2',
    author: 'Test Author',
    description: 'A generated asset-zip-v2 test game.',
  });
}

function treeHashes(root) {
  const out = new Map();
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else out.set(path.relative(root, abs).split(path.sep).join('/'), sha256(fs.readFileSync(abs)));
    }
  }
  walk(root);
  return out;
}

test('create --format asset-zip-v2 scaffolds a dsh-package.json layout', () => {
  const parent = tempDir();
  const created = makeZipProject(parent);
  assert.equal(created.format, 'asset-zip-v2');
  const config = loadConfig(created.targetDir);
  assert.equal(config.format, 'asset-zip-v2');
  assert.equal(config.outDir, 'dist');
  assert.deepEqual(config.resources, ['assets', 'levels', 'audio']);
  for (const file of ['assets/README.txt', 'levels/level-01.json', 'audio/README.txt', 'scripts/build.mjs', 'README.md']) {
    assert.ok(fs.existsSync(path.join(created.targetDir, file)), `missing ${file}`);
  }
  const buildScript = fs.readFileSync(path.join(created.targetDir, 'scripts/build.mjs'), 'utf8');
  assert.match(buildScript, /--format', 'asset-zip-v2'/);
  const indexHtml = fs.readFileSync(path.join(created.targetDir, 'index.html'), 'utf8');
  assert.doesNotMatch(indexHtml, /<script[\s>]/i, 'zip entry template must not inline scripts');
  assert.match(indexHtml, /rel="stylesheet"/);
  // PD-5: no template-specific "Orbit Catch" copy leaks into generated ZIP projects.
  assert.doesNotMatch(fs.readFileSync(path.join(created.targetDir, 'src/main.js'), 'utf8'), /Orbit Catch/);
  assert.doesNotMatch(indexHtml, /Orbit Catch/);
  assert.match(indexHtml, /aria-label="Game canvas"/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(created.targetDir, 'manifest.json'), 'utf8')).name, 'Orbit Zip');
});

test('build --format asset-zip-v2 externalises SDK/scripts/styles and writes a correct descriptor', async () => {
  const parent = tempDir();
  const created = makeZipProject(parent);
  const built = await buildProject(created.targetDir, { format: 'asset-zip-v2' });
  assert.equal(built.format, 'asset-zip-v2');
  const dist = path.join(created.targetDir, 'dist');
  const descriptor = JSON.parse(fs.readFileSync(path.join(dist, 'dsh-package.json'), 'utf8'));
  assert.equal(descriptor.formatVersion, 2);
  assert.equal(descriptor.gameManifest, 'game.json');
  const paths = descriptor.files.map((file) => file.path);
  assert.deepEqual(paths, paths.slice().sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
  for (const required of ['index.html', 'dsh-sdk.js', 'scripts/main.js', 'styles/styles.css', 'levels/level-01.json']) {
    assert.ok(paths.includes(required), `descriptor missing ${required}`);
  }
  for (const file of descriptor.files) {
    const data = fs.readFileSync(path.join(dist, file.path));
    assert.equal(data.length, file.size, `size mismatch ${file.path}`);
    assert.equal(sha256(data), file.sha256, `sha256 mismatch ${file.path}`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'game.json'), 'utf8'));
  assert.equal(manifest.id, 'orbit-zip');
  const entryHtml = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  assert.match(entryHtml, /<script src="dsh-sdk.js"><\/script>/);
  assert.match(entryHtml, /<script src="scripts\/main.js"><\/script>/);
  assert.match(entryHtml, /href="styles\/styles.css"/);
  assert.doesNotMatch(entryHtml, /<script(?![^>]*\bsrc=)[^>]*>/i, 'entry html must not gain inline scripts');
  assert.doesNotMatch(entryHtml, /<style[\s>]/i);
});

test('asset-zip-v2 build and pack are deterministic (byte-identical)', async () => {
  const parent = tempDir();
  const created = makeZipProject(parent);
  const first = await buildProject(created.targetDir, { format: 'asset-zip-v2' });
  const firstHashes = treeHashes(first.outDir);
  const firstPack = await (await import('../lib/package-v2.mjs')).packPackageV2(created.targetDir, { format: 'asset-zip-v2' });
  const second = await buildProject(created.targetDir, { format: 'asset-zip-v2' });
  const secondHashes = treeHashes(second.outDir);
  for (const [file, hash] of firstHashes) {
    assert.equal(secondHashes.get(file), hash, `non-deterministic ${file}`);
  }
  const secondPack = await (await import('../lib/package-v2.mjs')).packPackageV2(created.targetDir, { format: 'asset-zip-v2' });
  assert.equal(secondPack.sha256, firstPack.sha256, 'two packs must have the same sha256');
  assert.equal(secondPack.bytes, firstPack.bytes);
  assert.equal(firstPack.fileCount, 8);
  assert.equal(firstPack.selfTest.ok, true);
  assert.equal(firstPack.selfTest.matchesBuild, true);
  assert.equal(firstPack.permissions.length, firstPack.fileCount + 1);
  for (const entry of firstPack.permissions) assert.equal(entry.mode, '444');
});

test('validate really extracts the produced ZIP with the Host reader', async () => {
  const parent = tempDir();
  const created = makeZipProject(parent);
  const projectReport = await validatePath(created.targetDir, { format: 'asset-zip-v2' });
  assert.equal(projectReport.report.ok, true, JSON.stringify(projectReport.report.errors));
  assert.equal(projectReport.report.format, 'asset-zip-v2');
  assert.ok(projectReport.report.fileCount > 0);

  const { packPackageV2 } = await import('../lib/package-v2.mjs');
  const packed = await packPackageV2(created.targetDir, { format: 'asset-zip-v2' });
  const fileReport = await validatePath(packed.outFile, { format: 'asset-zip-v2' });
  assert.equal(fileReport.report.ok, true, JSON.stringify(fileReport.report.errors));
  assert.equal(fileReport.report.filesDigest, packed.filesDigest);
});

test('a tampered descriptor/file is rejected with an actionable code', async () => {
  const parent = tempDir();
  const created = makeZipProject(parent);
  await buildProject(created.targetDir, { format: 'asset-zip-v2' });
  const dist = path.join(created.targetDir, 'dist');
  fs.writeFileSync(path.join(dist, 'levels/level-01.json'), '{"level":999}\n', 'utf8');
  const { report } = await validatePath(dist, { format: 'asset-zip-v2' });
  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some((error) => /E_DESCRIPTOR_MISMATCH|E_ZIP|GM-4278/.test(error.code)),
    `unexpected errors: ${JSON.stringify(report.errors)}`
  );

  // A hand-made archive with an escaping path must be rejected by the Host reader.
  const zip = buildZip([
    { path: 'index.html', data: Buffer.from('<!doctype html><html></html>') },
    { path: '../escape.txt', data: Buffer.from('x') },
  ]);
  const badFile = path.join(parent, 'bad-1.0.0.dshgame.zip');
  fs.writeFileSync(badFile, zip.buffer);
  const badReport = await validatePath(badFile, { format: 'asset-zip-v2' });
  assert.equal(badReport.report.ok, false);
  assert.ok(badReport.report.errors.length > 0);
});

test('pack accepts a packed .dshgame.zip input and round-trips byte-identically', async () => {
  const parent = tempDir();
  const created = makeZipProject(parent);
  const { packPackageV2 } = await import('../lib/package-v2.mjs');
  const first = await packPackageV2(created.targetDir, { format: 'asset-zip-v2' });
  const outDir = path.join(parent, 'repack');
  const second = await packPackageV2(created.targetDir, { format: 'asset-zip-v2', input: first.outFile, outDir });
  assert.equal(second.sha256, first.sha256, 'packing a ZIP must reproduce the same archive');
  assert.equal(second.bytes, first.bytes);
  assert.equal(second.fileCount, first.fileCount);
  assert.equal(fs.readFileSync(second.outFile).equals(fs.readFileSync(first.outFile)), true);
  assert.equal(second.selfTest.ok, true);

  // `pack <zip>` without --out defaults to the archive's directory (same file, same bytes).
  const inPlace = await packPackageV2(created.targetDir, { format: 'asset-zip-v2', input: first.outFile });
  assert.equal(inPlace.outFile, first.outFile);
  assert.equal(inPlace.sha256, first.sha256);

  // CLI path (commandPack's input/format detection) must work too.
  const cliOut = path.join(parent, 'cli-out');
  fs.mkdirSync(cliOut, { recursive: true });
  const cli = runCli(['pack', first.outFile, '--format', 'asset-zip-v2', '--out', cliOut]);
  assert.equal(cli.status, 0, `${cli.stdout}${cli.stderr}`);
  assert.equal(sha256(fs.readFileSync(path.join(cliOut, first.fileName))), first.sha256);

  // `pack <dist>` writes next to the built tree by default.
  const fromDist = await packPackageV2(created.targetDir, { format: 'asset-zip-v2', input: path.join(created.targetDir, 'dist') });
  assert.equal(fromDist.outDir, path.join(created.targetDir, 'dist'));
  assert.equal(fromDist.sha256, first.sha256);
});

test('publish --format asset-zip-v2 emits a v2 entry, dry-run, no registry merge', async () => {
  const parent = tempDir();
  const created = makeZipProject(parent);
  const { packPackageV2 } = await import('../lib/package-v2.mjs');
  const packed = await packPackageV2(created.targetDir, { format: 'asset-zip-v2' });
  const result = await publishProject(created.targetDir, {
    format: 'asset-zip-v2',
    input: packed.outFile,
    url: `https://github.com/you/repo/releases/download/v1.0.0/${packed.fileName}`,
    cover: 'https://raw.githubusercontent.com/you/repo/main/cover.png',
    releasedAt: '2026-10-20T00:00:00Z',
    write: true,
  });
  assert.equal(result.format, 'asset-zip-v2');
  assert.equal(result.entry.package.format, 'asset-zip-v2');
  assert.equal(result.entry.package.filesDigest, packed.filesDigest);
  assert.equal(result.entry.package.sha256, packed.sha256);
  assert.ok(fs.existsSync(result.files.entry));
  assert.ok(fs.existsSync(result.files.upload));
  const entry = JSON.parse(fs.readFileSync(result.files.entry, 'utf8'));
  assert.equal(entry.package.format, 'asset-zip-v2');
  assert.match(entry.package.url, /\.dshgame\.zip$/);
  await assert.rejects(
    () =>
      publishProject(created.targetDir, {
        format: 'asset-zip-v2',
        input: packed.outFile,
        url: `https://github.com/you/repo/releases/download/v1.0.0/${packed.fileName}`,
        cover: 'https://example.com/c.png',
        registryDir: path.join(parent, 'registry'),
        write: false,
      }),
    /M2-D/
  );
});

test('publish documents match the package format (checklist + filesDigest naming)', async () => {
  const parent = tempDir();
  const zipProject = makeZipProject(parent);
  const { packPackageV2 } = await import('../lib/package-v2.mjs');
  const packed = await packPackageV2(zipProject.targetDir, { format: 'asset-zip-v2' });
  const zipResult = await publishProject(zipProject.targetDir, {
    format: 'asset-zip-v2',
    input: packed.outFile,
    url: `https://github.com/you/repo/releases/download/v1.0.0/${packed.fileName}`,
    cover: 'https://example.com/c.png',
    releasedAt: '2026-10-20T00:00:00Z',
  });
  const zipPlan = fs.readFileSync(zipResult.files.upload, 'utf8');
  const zipChecklist = fs.readFileSync(zipResult.files.checklist, 'utf8');
  assert.match(zipPlan, /Package format: asset-zip-v2/);
  assert.match(zipPlan, /filesDigest: `[a-f0-9]{64}`/);
  assert.doesNotMatch(zipPlan, /fileManifestDigest/);
  assert.match(zipChecklist, /asset-zip-v2 resource package/);
  assert.match(zipChecklist, /`filesDigest` matches the descriptor digest/);
  assert.doesNotMatch(zipChecklist, /single-file, self-contained HTML/);
  assert.equal(zipResult.entry.package.format, 'asset-zip-v2');
  assert.equal(zipResult.entry.package.filesDigest, packed.filesDigest);

  // Same registry-entry policy as html-v1: package host allowlist applies to ZIP too.
  await assert.rejects(
    () =>
      publishProject(zipProject.targetDir, {
        format: 'asset-zip-v2',
        input: packed.outFile,
        url: `https://evil.example.com/${packed.fileName}`,
        cover: 'https://example.com/c.png',
        write: false,
      }),
    (error) => {
      assert.equal(error.name, 'ValidationFailure');
      assert.ok(
        error.report.errors.some((item) => item.code === 'E_REGISTRY_INVALID' || item.gm === 'GM-5032'),
        JSON.stringify(error.report.errors)
      );
      return true;
    }
  );
  const allowlisted = await publishProject(zipProject.targetDir, {
    format: 'asset-zip-v2',
    input: packed.outFile,
    url: `https://evil.example.com/${packed.fileName}`,
    cover: 'https://example.com/c.png',
    allowedHosts: ['evil.example.com'],
    write: false,
  });
  assert.equal(allowlisted.ok, true);
  assert.equal(allowlisted.entry.package.url, `https://evil.example.com/${packed.fileName}`);

  const htmlFixture = createFixture();
  await buildProject(htmlFixture);
  const packedHtml = packProject(htmlFixture);
  const htmlResult = await publishProject(htmlFixture, {
    input: packedHtml.outFile,
    url: `https://github.com/you/repo/releases/download/v1.0.0/${packedHtml.fileName}`,
    cover: 'https://raw.githubusercontent.com/you/repo/main/cover.png',
    releasedAt: '2026-10-20T00:00:00Z',
  });
  const htmlPlan = fs.readFileSync(htmlResult.files.upload, 'utf8');
  const htmlChecklist = fs.readFileSync(htmlResult.files.checklist, 'utf8');
  assert.match(htmlPlan, /Package format: html-v1/);
  assert.doesNotMatch(htmlPlan, /filesDigest/);
  assert.match(htmlChecklist, /single-file, self-contained HTML package/);
  assert.equal(htmlResult.entry.package.filesDigest, undefined);
});

test('validate failures never print a fake "(0 bytes)" size (PD-3)', async () => {
  const parent = tempDir();
  const created = makeZipProject(parent);
  await buildProject(created.targetDir, { format: 'asset-zip-v2' });
  const dist = path.join(created.targetDir, 'dist');
  fs.writeFileSync(path.join(dist, 'levels/level-01.json'), '{"level":999}\n', 'utf8');
  const cli = runCli(['validate', dist]);
  assert.equal(cli.status, 1);
  assert.match(cli.stdout, /FAIL /);
  assert.doesNotMatch(cli.stdout, /\(0 bytes\)/);
  assert.match(cli.stdout, /\([1-9][0-9]* bytes\)/);
  const { formatReport } = await import('../lib/issues.mjs');
  const { makeReport } = await import('../lib/issues.mjs');
  const unknownSize = formatReport(makeReport({ errors: [{ code: 'E_ZIP_INVALID', message: 'x' }], bytes: 0 }));
  assert.doesNotMatch(unknownSize, /0 bytes/);
});

test('missing build dependencies map to an actionable E_TOOLCHAIN_DEPS_MISSING error', async () => {
  const { toolchainDepsError, TOOLCHAIN_DEPS_CODE } = await import('../lib/package-v2.mjs');
  const moduleError = Object.assign(new Error("Cannot find module 'yauzl' imported from zip.js"), { code: 'ERR_MODULE_NOT_FOUND' });
  const mapped = toolchainDepsError(moduleError);
  assert.equal(mapped.code, TOOLCHAIN_DEPS_CODE);
  assert.equal(mapped.exitCode, 2);
  assert.match(mapped.message, /yauzl/);
  assert.match(mapped.hint, /npm install/);
  const other = new Error('boom');
  assert.equal(toolchainDepsError(other), other);
});

test('publish --dry-run (asset-zip-v2) writes no files', async () => {
  const parent = tempDir();
  const created = makeZipProject(parent);
  const { packPackageV2 } = await import('../lib/package-v2.mjs');
  const packed = await packPackageV2(created.targetDir, { format: 'asset-zip-v2' });
  const outDir = path.join(parent, 'dry-run-out');
  const result = await publishProject(created.targetDir, {
    format: 'asset-zip-v2',
    input: packed.outFile,
    url: `https://github.com/you/repo/releases/download/v1.0.0/${packed.fileName}`,
    cover: 'https://example.com/c.png',
    outDir: outDir,
    write: false,
  });
  assert.equal(result.format, 'asset-zip-v2');
  assert.equal(fs.existsSync(outDir), false, '--dry-run must not create output files');
  assert.ok(result.entry.package.format === 'asset-zip-v2');
});

test('prebuilt projects (buildCommand + prebuiltDir) are finalised and validated', async () => {
  const parent = tempDir();
  const projectDir = path.join(parent, 'vite-project');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, 'manifest.json'),
    `${JSON.stringify(
      {
        manifestVersion: 1,
        id: 'vite-prebuilt',
        name: 'Vite Prebuilt',
        version: '1.0.0',
        author: { name: 'T' },
        description: 'd',
        categories: ['arcade'],
        capabilities: ['storage'],
        sdkVersion: '^1.0.0',
        runtimeVersion: '^1.0.0',
        viewport: { width: 960, height: 540, fit: 'contain' },
        save: { schemaVersion: 1 },
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(
    path.join(projectDir, 'dsh-game.config.json'),
    `${JSON.stringify(
      { format: 'asset-zip-v2', manifest: 'manifest.json', entryFile: 'index.html', prebuiltDir: 'dist', buildCommand: 'node build-step.mjs' },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(
    path.join(projectDir, 'build-step.mjs'),
    `import fs from 'node:fs';
fs.mkdirSync('dist/assets', { recursive: true });
fs.writeFileSync('dist/index.html', '<!doctype html><html><head><link rel="stylesheet" href="./assets/app.css" /></head><body><div id="root"></div><script type="module" src="./assets/app.js"></script></body></html>');
fs.writeFileSync('dist/assets/app.js', 'console.log("vite build");\\n');
fs.writeFileSync('dist/assets/app.css', 'body { margin: 0; }\\n');
`
  );
  const built = await buildProject(projectDir, { format: 'asset-zip-v2' });
  assert.equal(built.fileCount, 4); // index.html + assets/app.js + assets/app.css + game.json
  const descriptor = JSON.parse(fs.readFileSync(path.join(projectDir, 'dist', 'dsh-package.json'), 'utf8'));
  assert.deepEqual(
    descriptor.files.map((file) => file.path),
    ['assets/app.css', 'assets/app.js', 'game.json', 'index.html']
  );
  const report = await validatePath(projectDir, { format: 'asset-zip-v2', usePrebuilt: true });
  assert.equal(report.report.ok, true, JSON.stringify(report.report.errors));
});

test('Simulator loads asset-zip-v2 through a wrapper + resource origin and html-v1 unchanged', async () => {
  const zipParent = tempDir();
  const created = makeZipProject(zipParent);
  const zipSim = await startDevServer({ projectDir: created.targetDir, port: 0, build: true, format: 'asset-zip-v2' });
  try {
    assert.equal(zipSim.format, 'asset-zip-v2');
    const home = await (await fetch(zipSim.url)).text();
    assert.match(home, /"format":"asset-zip-v2"/);
    assert.match(home, /"wrapperUrl":"\/wrapper\?src=/);
    const wrapper = await fetch(new URL(zipSim.wrapperUrl, zipSim.url));
    const wrapperHtml = await wrapper.text();
    assert.equal(wrapper.status, 200);
    assert.match(wrapperHtml, /Content-Security-Policy/);
    assert.match(wrapperHtml, /sandbox="allow-scripts"/);
    const entry = await fetch(new URL(zipSim.entryUrl, zipSim.url));
    assert.equal(entry.status, 200);
    assert.equal(entry.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.ok(entry.headers.get('content-security-policy'));
    const js = await fetch(new URL(`${zipSim.resourcePrefix}/scripts/main.js`, zipSim.url));
    assert.equal(js.status, 200);
    const health = await (await fetch(new URL('/health', zipSim.url))).json();
    assert.equal(health.format, 'asset-zip-v2');
    assert.equal(health.fileCount, 8);
  } finally {
    await zipSim.close();
  }

  const htmlFixtureDir = createFixture();
  const htmlSim = await startDevServer({ projectDir: htmlFixtureDir, port: 0, build: true });
  try {
    assert.equal(htmlSim.format, 'html-v1');
    const game = await fetch(new URL('/game', htmlSim.url));
    assert.equal(game.status, 200);
    assert.equal(game.headers.get('content-type'), 'text/html; charset=utf-8');
  } finally {
    await htmlSim.close();
  }
});

test('create --format asset-zip-v2 (react) uses relative base + external assets, not single-file', () => {
  const parent = tempDir();
  const created = createProject({ name: 'vite-zip', template: 'react', parentDir: parent, format: 'asset-zip-v2' });
  assert.equal(created.format, 'asset-zip-v2');
  const projectDir = created.targetDir;
  const config = JSON.parse(fs.readFileSync(path.join(projectDir, 'dsh-game.config.json'), 'utf8'));
  assert.equal(config.format, 'asset-zip-v2');
  assert.equal(config.prebuiltDir, 'dist');
  assert.equal(config.buildCommand, 'npm run vite:build');
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts.build, 'node scripts/build.mjs');
  assert.equal(packageJson.scripts['vite:build'], 'tsc --noEmit && vite build');
  const viteConfig = fs.readFileSync(path.join(projectDir, 'vite.config.ts'), 'utf8');
  assert.match(viteConfig, /base:\s*'\.\/'/);
  assert.doesNotMatch(viteConfig, /viteSingleFile|vite-plugin-singlefile|dshGameManifestPlugin|dsh-game-manifest/);
  assert.match(viteConfig, /entryFileNames: 'assets\/\[name\]\.js'/);
  const indexHtml = fs.readFileSync(path.join(projectDir, 'index.html'), 'utf8');
  assert.match(indexHtml, /<script src="\/dsh-sdk\.js"><\/script>/);
  assert.match(indexHtml, /type="module" src="src\/main\.tsx"/);
  const zipSdkSource = fs.readFileSync(path.join(projectDir, 'src/sdk.ts'), 'utf8');
  // Regression: under `strict` + `useUnknownInCatchVariables`, App.tsx catches are
  // `unknown`; isGameError must stay a type predicate (like the vendor ESM
  // wrapper) or `npm run build` fails with TS18046 in the generated project.
  assert.match(zipSdkSource, /import type \{ Game, GameError \} from '@dsh-game\/sdk'/);
  assert.match(zipSdkSource, /isGameError\(error: unknown\): error is GameError/);
  assert.doesNotMatch(zipSdkSource, /isGameError\(error: unknown\): boolean/);
  const sdkGlobal = fs.readFileSync(path.join(projectDir, 'public/dsh-sdk.js'), 'utf8');
  assert.match(sdkGlobal, /^var DSH_GAME_SDK = /);
  assert.doesNotMatch(fs.readFileSync(path.join(projectDir, 'src/sdk.ts'), 'utf8'), /vendor\/dsh-game-sdk/);
  const buildScript = fs.readFileSync(path.join(projectDir, 'scripts/build.mjs'), 'utf8');
  assert.match(buildScript, /'--format', 'asset-zip-v2'/);
  assert.match(buildScript, /validate/, 'react build must validate the final ZIP');
  // No inline manifest injection is possible for a resource package.
  const manifestFile = fs.readFileSync(path.join(projectDir, 'manifest.json'), 'utf8');
  assert.equal(JSON.parse(manifestFile).id, 'vite-zip');
});

test('no --format keeps the M1 single-file behavior (create/build/pack default)', async () => {
  const parent = tempDir();
  const created = createProject({ name: 'classic-game', template: 'vanilla', parentDir: parent });
  assert.equal(created.format, 'html-v1');
  const config = loadConfig(created.targetDir);
  assert.equal(config.format, undefined);
  assert.equal(config.out, 'dist/index.html');
  const built = await buildProject(created.targetDir);
  assert.equal(built.outFile, path.join(created.targetDir, 'dist/index.html'));
  assert.ok(fs.existsSync(built.outFile));
  assert.equal(fs.existsSync(path.join(created.targetDir, 'dist/dsh-package.json')), false);
  const packed = packProject(created.targetDir);
  assert.match(packed.fileName, /^classic-game-1\.0\.0\.html$/);
  const report = await validatePath(created.targetDir);
  assert.equal(report.report.ok, true, JSON.stringify(report.report.errors));
});

test('--format rejects unknown values instead of silently falling back', async () => {
  const parent = tempDir();
  assert.throws(
    () => createProject({ name: 'bad-format', template: 'vanilla', parentDir: parent, format: 'zip-v9' }),
    /Unsupported package format/
  );
  const htmlFixtureDir = createFixture();
  await assert.rejects(() => buildProject(htmlFixtureDir, { format: 'zip-v9' }), /Unsupported package format/);
});
