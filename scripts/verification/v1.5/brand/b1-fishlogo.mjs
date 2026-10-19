#!/usr/bin/env node
/**
 * S-B1 — official DeepSeek mark probe (V1.5 M0).
 *
 * Proves, against the DSH build the user actually has installed:
 *   1. where the official mark really lives inside app.asar, and under which license;
 *   2. whether a third-party `dsh.client` package can resolve the host-provided
 *      `@deepseek-ai/dsh-client-ui-primitives` module at runtime;
 *   3. how `FishLogo` renders in the light and dark theme palettes;
 *   4. what the project's own zero-dependency bundler can and cannot express today.
 *
 * Everything runs in an isolated DSH_HOME under `/tmp/dsh-v15/`; the daily
 * profile and the installed App are never written.
 *
 * Exit code is non-zero when a required check fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ASAR_ROOT,
  CHROME,
  WORK,
  Cdp,
  createReport,
  ensure,
  ensureRuntime,
  injectProbeRow,
  makeHome,
  runtimeIdentity,
  sha256File,
  sleep,
  startHost,
  writeJson,
} from '../lib/harness.mjs';
import { bundleModuleLoader } from '../../../../scripts/bundle-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// NOTE: harness.repoRoot uses `new URL(import.meta.url).pathname`, which keeps
// `%20` in this workspace path; evidence must land in the real worktree, so the
// probe resolves its own root with fileURLToPath.
const REPO_ROOT = path.resolve(HERE, '../../../..');
const RAW = path.join(REPO_ROOT, 'docs/verification/v1.5/raw/brand');
const FIXTURES = path.join(HERE, 'fixtures/probe-client');
const PORT = Number(process.env.DSH_V15_BRAND_PORT || 58210);
const CDP_PORT = Number(process.env.DSH_V15_BRAND_CDP || 9462);
/** `--self-test-fail` runs the static half plus one forced failure (exit-code proof). */
const SELF_TEST_FAIL = process.argv.includes('--self-test-fail');

const report = createReport({
  id: 'S-B1',
  title: 'Official DeepSeek mark: source, license and third-party module resolution',
  commands: ['node scripts/verification/v1.5/brand/b1-fishlogo.mjs'],
});

const DSH_PACKAGES = `${ASAR_ROOT}/dsh/node_modules/@deepseek-ai`;

/**
 * Redact only real secrets and user paths. `harness.sanitize()` also collapses
 * any 40+ hex run, which is exactly the SHA-256 evidence this probe exists to
 * record, so hash-bearing artifacts use this narrower filter instead.
 */
function redact(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/token=[A-Za-z0-9._~+/=-]+/g, 'token=<redacted>')
    .replace(/(Bearer|api[-_]?key|authorization)["'\s:=]+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 <redacted>')
    .replace(/\/Users\/[^/\s"']+/g, '/Users/<user>');
}

function pkgJson(packageName) {
  return JSON.parse(fs.readFileSync(`${DSH_PACKAGES}/${packageName}/package.json`, 'utf8'));
}

/** Find the built web-frontend bundle that carries the platform module seed table. */
function findFrontendBundle() {
  const assets = `${DSH_PACKAGES}/dsh-web-frontend/dist/assets`;
  const candidates = fs.readdirSync(assets).filter((name) => /^index-.*\.js$/.test(name));
  for (const name of candidates) {
    const file = path.join(assets, name);
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes('@deepseek-ai/dsh-client-ui-primitives') && text.includes('FISH_LOGO_PATH')) return { file, text };
  }
  throw new Error(`no web-frontend asset under ${assets} carries the primitives module`);
}

// ---------------------------------------------------------------------------
// 1. Static facts: where the mark lives and under which license
// ---------------------------------------------------------------------------

async function collectAsarFacts() {
  ensureRuntime();
  const frontend = findFrontendBundle();
  const facts = { asar: `${ASAR_ROOT}`, files: {}, primitives: {}, licenses: {} };

  const brandClient = `${DSH_PACKAGES}/dsh-client-ui-brand-official/lib/client.js`;
  const brandLicense = `${DSH_PACKAGES}/dsh-client-ui-brand-official/LICENSE`;
  const favicon = `${DSH_PACKAGES}/dsh-web-frontend/dist/favicon.svg`;
  const frontendPackage = `${DSH_PACKAGES}/dsh-web-frontend/package.json`;
  const appPackage = `${ASAR_ROOT}/package.json`;
  const electronPackage = JSON.parse(fs.readFileSync(appPackage, 'utf8'));
  const frontendPkg = JSON.parse(fs.readFileSync(frontendPackage, 'utf8'));
  const brandPkg = pkgJson('dsh-client-ui-brand-official');

  for (const [label, file] of Object.entries({
    'brand-official/lib/client.js': brandClient,
    'brand-official/LICENSE': brandLicense,
    'brand-official/package.json': `${DSH_PACKAGES}/dsh-client-ui-brand-official/package.json`,
    'web-frontend/dist/assets': frontend.file,
    'web-frontend/dist/favicon.svg': favicon,
    'web-frontend/package.json': frontendPackage,
    'app.asar/package.json': appPackage,
  })) {
    facts.files[label] = { path: file.replace(ASAR_ROOT, '<asar>'), sha256: await sha256File(file), bytes: fs.statSync(file).size };
  }

  facts.licenses = {
    app: { name: electronPackage.name, version: electronPackage.version, license: electronPackage.license ?? null },
    brandOfficial: { name: brandPkg.name, version: brandPkg.version, license: brandPkg.license ?? null },
    webFrontend: { name: frontendPkg.name, version: frontendPkg.version, license: frontendPkg.license ?? null },
    primitivesDeclaredAs: {
      devDependencyOf: 'dsh-web-frontend',
      version: (frontendPkg.devDependencies || {})['@deepseek-ai/dsh-client-ui-primitives'] ?? null,
      installedAsOwnPackage: fs.existsSync(`${DSH_PACKAGES}/dsh-client-ui-primitives`),
    },
  };
  facts.licenses.brandLicenseText = fs.readFileSync(brandLicense, 'utf8').split('\n').slice(0, 3).join('\n');

  // The platform seed table is what makes an undeclared bare require work.
  const seedMatch = /staticModules:(\w+)\(\)/.exec(frontend.text);
  const seedFnMatch = /function (\w+)\(\)\{return\{(react:[^}]*)\}\}/.exec(frontend.text);
  facts.platformSeedTable = {
    wiredAtBoot: /staticModules:\w+\(\)/.test(frontend.text),
    bootExpression: seedMatch ? `__ModuleLoader__.create({ boot, staticModules:${seedMatch[1]}(), ... })` : null,
    specifiers: seedFnMatch
      ? [...seedFnMatch[2].matchAll(/"([^"]+)":/g)].map((match) => match[1]).concat(['react'])
      : null,
  };
  // Normalize the react key (it is unquoted in the compiled table).
  if (facts.platformSeedTable.specifiers) {
    facts.platformSeedTable.specifiers = [...new Set(facts.platformSeedTable.specifiers)].sort();
  }

  // The official mark itself: exported path + viewBox from the primitives module.
  const viewBoxMatch = /const (\w+)=\{width:([\d.]+),height:([\d.]+)\},(\w+)="(M[\s\S]*?)";/.exec(frontend.text);
  if (!viewBoxMatch) throw new Error('FISH_LOGO_VIEWBOX / FISH_LOGO_PATH not found in the frontend bundle');
  const logoPath = viewBoxMatch[5];
  const componentMatch = new RegExp(`function (\\w+)\\(\\{size:(\\w+)=24,className:(\\w+)\\}\\)\\{return \\w+\\.jsx\\("svg",\\{width:\\w+,height:\\w+\\*${viewBoxMatch[1]}\\.height/${viewBoxMatch[1]}\\.width`).exec(
    frontend.text,
  );
  facts.primitives = {
    viewBox: { width: Number(viewBoxMatch[2]), height: Number(viewBoxMatch[3]) },
    pathSha256: (await import('node:crypto')).createHash('sha256').update(logoPath).digest('hex'),
    pathLength: logoPath.length,
    pathPrefix: logoPath.slice(0, 48),
    fishLogoComponentFound: Boolean(componentMatch),
    fishLogoComponentSource: componentMatch
      ? 'function FishLogo({size=24,className}){return jsx("svg",{width:size,height:size*V.height/V.width,className,viewBox:`0 0 ${V.width} ${V.height}`,fill:"none","aria-hidden":"true",children:jsx("path",{d:PATH,fill:"currentColor"})})}'
      : null,
    fillStrategy: /fill:"currentColor"/.test(frontend.text) ? 'currentColor (inherits the theme text color)' : null,
    exportedFromModule: ['FishLogo', 'FISH_LOGO_PATH', 'FISH_LOGO_VIEWBOX'].every((name) => frontend.text.includes(`${name}:`)),
  };

  // A real official SVG file shipped in the App (fallback asset source).
  const faviconText = fs.readFileSync(favicon, 'utf8');
  facts.officialSvgFile = {
    path: favicon.replace(ASAR_ROOT, '<asar>'),
    viewBox: (faviconText.match(/viewBox="([^"]+)"/) || [])[1] ?? null,
    pathCount: (faviconText.match(/<path\b/g) || []).length,
    bytes: Buffer.byteLength(faviconText),
    sha256: await sha256File(favicon),
  };

  writeJson(path.join(RAW, 'b1-asar-facts.json'), facts);
  fs.writeFileSync(path.join(RAW, 'fish-logo-path.txt'), `${logoPath}\n`, 'utf8');
  return { facts, logoPath, frontendText: frontend.text };
}

// ---------------------------------------------------------------------------
// 2. What the project's own bundler can express today
// ---------------------------------------------------------------------------

function checkBundler() {
  const root = path.join(WORK, 'brand-bundler-fixture');
  fs.rmSync(root, { recursive: true, force: true });
  ensure(root);
  const yes = path.join(root, 'yes.js');
  const no = path.join(root, 'no.js');
  fs.writeFileSync(yes, "import React from 'react';\nexport const ok = typeof React === 'object';\n", 'utf8');
  fs.writeFileSync(
    no,
    "import { FishLogo } from '@deepseek-ai/dsh-client-ui-primitives';\nexport const ok = typeof FishLogo === 'function';\n",
    'utf8',
  );

  let reactBundle = null;
  let reactError = null;
  try {
    reactBundle = bundleModuleLoader({ entry: yes, root, id: 'probe-bundler-yes' });
  } catch (error) {
    reactError = String(error.message || error);
  }
  let bareImportError = null;
  try {
    bundleModuleLoader({ entry: no, root, id: 'probe-bundler-no' });
  } catch (error) {
    bareImportError = String(error.message || error);
  }

  const evidence = {
    reactOnly: {
      built: reactBundle !== null,
      error: reactError,
      hasFactoryRequireShape: reactBundle !== null && /factory: function \(require\)/.test(reactBundle),
      emitsRequireReact: reactBundle !== null && reactBundle.includes("require('react')"),
      shapeSample: reactBundle === null ? null : reactBundle.split('\n').slice(0, 6).join('\n'),
    },
    primitivesImport: {
      rejected: bareImportError !== null,
      error: bareImportError,
    },
    requiredExtension:
      'scripts/bundle-lib.mjs must accept a reviewed external allowlist (at minimum "react-dom/client" and ' +
      '"@deepseek-ai/dsh-client-ui-primitives") and emit `require("<specifier>")` for it, exactly as it already does for "react".',
  };
  writeJson(path.join(RAW, 'b1-bundler-capability.json'), evidence);
  return evidence;
}

// ---------------------------------------------------------------------------
// 3. Runtime probe against an isolated host + headless Chrome
// ---------------------------------------------------------------------------

function launchChrome({ port, forceDark }) {
  const dir = path.join(WORK, `chrome-${port}`);
  fs.rmSync(dir, { recursive: true, force: true });
  const args = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1280,800',
  ];
  if (forceDark) args.push('--force-dark-mode');
  args.push('about:blank');
  return spawn(CHROME, args, { stdio: 'ignore' });
}

async function collectRuntime() {
  const home = await makeHome('brand', { port: PORT });
  injectProbeRow(home, { id: 'dsh-brand-probe', entry: path.join(FIXTURES, 'index.js') });
  const host = await startHost(home, { port: PORT, logName: 'brand-host' });
  let page = await Cdp.launch({ port: CDP_PORT, windowSize: '1280,800' });
  const runtime = { home, hostUrl: host.url.replace(/token=.*/, 'token=<redacted>'), probe: null, hostLogTail: null };

  try {
    await page.navigate(host.url);
    const loaded = await page.until(
      'Boolean(window.__DSH_BRAND_PROBE__ && window.__DSH_BRAND_PROBE__.requires && window.__DSH_BRAND_PROBE__.requires.primitives)',
      90000,
      500,
    );
    report.add('probe module materialized in a real DSH page', loaded !== null, loaded === null ? 'timed out waiting for __DSH_BRAND_PROBE__' : `${loaded} ms`);
    if (loaded === null) {
      runtime.hostLogTail = host.log().split('\n').slice(-40).join('\n');
      return runtime;
    }

    // Let React mount the swatch, then measure both themes.
    await page.until("Boolean(document.getElementById('dsh-brand-probe-mark') && document.querySelector('#dsh-brand-probe-mark svg'))", 20000, 300);

    const capture = async (label) => {
      const value = await page.eval('window.__DSH_BRAND_PROBE_MEASURE__()');
      runtime.probe = runtime.probe || {};
      runtime.probe[label] = value;
      await page.shot(path.join(RAW, `b1-fishlogo-${label}.png`));
      return value;
    };

    // Default theme preference is "system", so emulating the media feature is the
    // real resolution path of the host theme service.
    await page.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'light' }],
    });
    await page.until("!document.body.hasAttribute('data-ds-dark-theme')", 8000, 200);
    const light = await capture('light');

    await page.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'dark' }],
    });
    const flipped = await page.until("document.body.hasAttribute('data-ds-dark-theme')", 8000, 200);
    runtime.probe = runtime.probe || {};
    runtime.probe.themeFlipVia = flipped === null ? 'cdp-media-emulation-failed' : 'cdp-media-emulation';
    await sleep(400);
    let dark = await capture('dark');

    if (flipped === null) {
      // Fallback: CDP media emulation did not propagate; relaunch Chrome with the
      // platform-level dark preference instead of faking tokens in the page.
      page.dispose();
      const child = launchChrome({ port: CDP_PORT, forceDark: true });
      await sleep(2500);
      page = await Cdp.attach(CDP_PORT);
      page.chrome = child;
      await page.navigate(host.url);
      const ready = await page.until(
        "Boolean(window.__DSH_BRAND_PROBE__ && document.body.hasAttribute('data-ds-dark-theme'))",
        60000,
        400,
      );
      dark = ready !== null ? await page.eval('window.__DSH_BRAND_PROBE_MEASURE__()') : null;
      runtime.probe.dark = dark;
      runtime.probe.themeFlipVia = 'force-dark-mode-chrome';
      if (dark) await page.shot(path.join(RAW, 'b1-fishlogo-dark.png'));
    }

    const probeState = await page.eval(
      'JSON.parse(JSON.stringify({ requires: window.__DSH_BRAND_PROBE__.requires, render: window.__DSH_BRAND_PROBE__.render }))',
    );
    runtime.probe = { ...(runtime.probe || {}), resolution: probeState };

    // --- assertions ---------------------------------------------------------
    const requires = probeState.requires || {};
    report.add('third-party dsh.client resolves react', requires.react && requires.react.ok === true, requires.react);
    report.add(
      'third-party dsh.client resolves react-dom/client',
      requires.reactDomClient && requires.reactDomClient.ok === true,
      requires.reactDomClient,
    );
    report.add(
      'third-party dsh.client resolves @deepseek-ai/dsh-client-ui-primitives',
      requires.primitives && requires.primitives.ok === true,
      requires.primitives && requires.primitives.ok ? { exportCount: requires.primitives.exportCount } : requires.primitives,
    );
    report.add(
      'primitives exports the official FishLogo component',
      Boolean(requires.primitives && requires.primitives.hasFishLogo === true),
      { hasFishLogo: requires.primitives && requires.primitives.hasFishLogo },
    );
    report.add(
      'primitives exports FISH_LOGO_PATH + FISH_LOGO_VIEWBOX',
      Boolean(requires.primitives && requires.primitives.pathIsString === true && requires.primitives.viewBox),
      { pathLength: requires.primitives && requires.primitives.pathLength, viewBox: requires.primitives && requires.primitives.viewBox },
    );
    report.add(
      'negative control: unknown specifier still throws',
      Boolean(requires.negativeControl && requires.negativeControl.threw === true),
      requires.negativeControl,
    );
    report.add('probe rendered the mark into the page', Boolean(probeState.render && probeState.render.ok === true), probeState.render);

    const svgAttributes = (value) => (value && value.svg) || null;
    report.add(
      'rendered SVG carries the official viewBox and currentColor fill',
      Boolean(
        svgAttributes(light) &&
          svgAttributes(light).viewBox === `0 0 ${FACTS.primitives.viewBox.width} ${FACTS.primitives.viewBox.height}` &&
          svgAttributes(light).pathFill === 'currentColor',
      ),
      svgAttributes(light),
    );
    report.add(
      'rendered mark is painted (non-empty ink in both themes)',
      Boolean(light && light.ink && light.ink.painted && dark && dark.ink && dark.ink.painted),
      { lightInk: light && light.ink, darkInk: dark && dark.ink },
    );
    report.add(
      'light theme paints dark ink',
      Boolean(light && light.ink && light.ink.painted && light.ink.averageLuminance < 0.5),
      light && light.ink,
    );
    report.add(
      'dark theme paints light ink',
      Boolean(dark && dark.ink && dark.ink.painted && dark.ink.averageLuminance > 0.5),
      dark && dark.ink,
    );
    report.add(
      'mark color follows the theme (light != dark)',
      Boolean(
        light && dark && light.svg && dark.svg && light.svg.computedColor !== dark.svg.computedColor &&
          light.ink && dark.ink && light.ink.averageLuminance !== dark.ink.averageLuminance,
      ),
      {
        light: light && light.svg && light.svg.computedColor,
        dark: dark && dark.svg && dark.svg.computedColor,
        flip: runtime.probe.themeFlipVia,
      },
    );
    report.add(
      'runtime path bytes match the ASAR path bytes (sha256 + length)',
      Boolean(
        light && light.svg && light.svg.pathSha256 === FACTS.primitives.pathSha256 &&
          light.svg.pathLength === FACTS.primitives.pathLength,
      ),
      {
        runtime: light && light.svg && { pathLength: light.svg.pathLength, pathSha256: light.svg.pathSha256 },
        asar: { pathLength: FACTS.primitives.pathLength, pathSha256: FACTS.primitives.pathSha256 },
      },
    );
    report.add('light theme page state', Boolean(light && light.theme && light.theme.dark === false), light && light.theme);
    report.add('dark theme page state', Boolean(dark && dark.theme && dark.theme.dark === true), dark && dark.theme);
  } finally {
    try {
      page.dispose();
    } catch {
      /* ignore */
    }
    await host.stop();
    runtime.hostLogTail = runtime.hostLogTail ?? host.log().split('\n').slice(-25).join('\n');
  }
  return runtime;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

ensure(RAW);
const identity = runtimeIdentity();
const { facts, logoPath } = await collectAsarFacts();
const FACTS = facts;
const bundler = checkBundler();

report.add(
  'official mark source located in ASAR (primitives bundled into the web frontend asset)',
  Boolean(facts.files['web-frontend/dist/assets'] && facts.primitives.exportedFromModule),
  { asset: facts.files['web-frontend/dist/assets'].path, sha256: facts.files['web-frontend/dist/assets'].sha256 },
);
report.add(
  'brand-official package is MIT and uses FishLogo',
  facts.licenses.brandOfficial.license === 'MIT' && facts.primitives.fishLogoComponentFound,
  { license: facts.licenses.brandOfficial.license },
);
report.add(
  'platform seed table carries the primitives specifier at boot',
  Boolean(facts.platformSeedTable.wiredAtBoot && (facts.platformSeedTable.specifiers || []).includes('@deepseek-ai/dsh-client-ui-primitives')),
  facts.platformSeedTable,
);
report.add(
  'an official whale SVG file ships in the App (distributable fallback source)',
  facts.officialSvgFile.pathCount >= 1,
  facts.officialSvgFile,
);
report.add('react-only bundle still builds with the current bundler', bundler.reactOnly.built === true, bundler.reactOnly);
report.add(
  'current bundler rejects the primitives bare import (build-tool change required)',
  bundler.primitivesImport.rejected === true,
  bundler.primitivesImport,
);

let runtime = null;
let runtimeError = null;
if (SELF_TEST_FAIL) {
  // Documented self-test: proves the script really exits non-zero on a failed
  // assertion instead of only printing FAIL. Used by the verification report.
  report.add('self-test: forced failing check (must exit 1)', false, { forced: true });
} else {
  try {
    runtime = await collectRuntime();
  } catch (error) {
    runtimeError = String((error && error.stack) || error).slice(0, 800);
    report.add('runtime probe completed without throwing', false, runtimeError);
  }
  report.add(
    'runtime probe produced rendered+measured light/dark evidence',
    Boolean(runtime && runtime.probe && runtime.probe.light && runtime.probe.dark),
    {
      hasLight: Boolean(runtime && runtime.probe && runtime.probe.light),
      hasDark: Boolean(runtime && runtime.probe && runtime.probe.dark),
      themeFlipVia: runtime && runtime.probe ? runtime.probe.themeFlipVia : null,
    },
  );
}

const result = report.finish({
  dsh: identity,
  asarFactsFile: 'docs/verification/v1.5/raw/brand/b1-asar-facts.json',
  bundlerFile: 'docs/verification/v1.5/raw/brand/b1-bundler-capability.json',
  screenshots: ['b1-fishlogo-light.png', 'b1-fishlogo-dark.png'],
  fishLogoPathFile: 'docs/verification/v1.5/raw/brand/fish-logo-path.txt',
  fishLogoPathSha256: facts.primitives.pathSha256,
  fishLogoPathLength: logoPath.length,
  runtime: runtime
    ? {
        home: runtime.home,
        hostUrl: runtime.hostUrl,
        themeFlipVia: runtime.probe && runtime.probe.themeFlipVia,
        hostLogTail: runtime.hostLogTail ? redact(runtime.hostLogTail) : null,
        measurements: runtime.probe ?? null,
      }
    : { error: runtimeError },
});
writeJson(path.join(RAW, SELF_TEST_FAIL ? 'b1-selftest-report.json' : 'b1-report.json'), result);

console.log(`\n[S-B1] ${result.passed ? 'PASS' : 'FAIL'} — ${result.checks.filter((c) => c.ok).length}/${result.checks.length} checks ok`);
for (const check of result.checks) {
  console.log(`  ${check.ok ? 'ok  ' : 'FAIL'} ${check.name}${check.ok ? '' : ` :: ${JSON.stringify(check.detail).slice(0, 300)}`}`);
}
console.log(`[S-B1] evidence: docs/verification/v1.5/raw/brand/`);
process.exit(result.passed ? 0 : 1);
