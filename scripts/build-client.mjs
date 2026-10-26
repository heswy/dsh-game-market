#!/usr/bin/env node
/**
 * Build the DSH Client bundle from packages/client/src/main.js.
 *
 * The generated client.js is committed because the DSH bundle loader consumes a
 * prebuilt browser artifact (same convention as other DSH client plugins).
 *
 * V1.5 M3: the bundle carries its own immutable build identity:
 *   version     = package.json version at build time
 *   buildCommit = platform-updates/release.json.clientBuildCommit, when that
 *                 file exists (release commit R declares the version commit P)
 *
 * The identity is embedded as a literal replacement inside the bundle, so it
 * only ever comes from the built artifact (never from Host responses). A
 * release.json whose version disagrees with package.json fails the build
 * loudly: release tooling relies on that to self-prove the release commit.
 *
 * Deterministic: building the same tree twice produces byte-identical output.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bundleModuleLoader } from './bundle-lib.mjs';
import { BUNDLE_ID, RUNTIME_VERSION, SDK_VERSION } from '../packages/shared/src/constants.js';
import { parseReleaseIdentity, serializeBuildIdentity } from '../packages/client/src/build-identity.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const entry = path.join(root, 'packages/client/src/main.js');

/** The one source line the identity literal replaces (must stay unique). */
const IDENTITY_LINE_RE = /^(\s*)const RAW_IDENTITY = '__DGM_CLIENT_BUILD_IDENTITY__';$/m;

function fail(message) {
  console.error('[build:client] ' + message);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { out: path.join(root, 'client.js'), release: path.join(root, 'platform-updates/release.json') };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--out' || flag === '--release') {
      const value = argv[i + 1];
      if (typeof value !== 'string' || value.length === 0) fail(flag + ' requires a path');
      args[flag.slice(2)] = path.resolve(process.cwd(), value);
      i += 1;
      continue;
    }
    fail('unknown argument: ' + flag);
  }
  return args;
}

function readPackageVersion() {
  const pkgPath = path.join(root, 'package.json');
  let pkg = null;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch (error) {
    fail('cannot read package.json: ' + (error && error.message ? error.message : String(error)));
  }
  if (!pkg || typeof pkg.version !== 'string' || pkg.version.length === 0) {
    fail('package.json must declare a version');
  }
  return pkg.version;
}

/**
 * Resolve the build identity from package.json + the optional release.json.
 *
 * - absent release.json  -> {version: package.json version, buildCommit: null}
 * - matching version     -> {version, buildCommit: release.json.clientBuildCommit}
 * - version mismatch     -> this is the normal state at the next version-bump
 *                           commit P (the previous release's release.json is
 *                           still present): warn and embed buildCommit null.
 * - unreadable/invalid   -> hard failure (E_RELEASE_CLIENT_IDENTITY_INVALID).
 */
function resolveBuildIdentity(packageVersion, releasePath) {
  if (!fs.existsSync(releasePath)) {
    return { version: packageVersion, buildCommit: null, source: 'package.json', stale: false };
  }
  let document = null;
  try {
    document = JSON.parse(fs.readFileSync(releasePath, 'utf8'));
  } catch (error) {
    fail(
      'E_RELEASE_CLIENT_IDENTITY_INVALID: cannot parse ' +
        path.relative(root, releasePath) +
        ': ' +
        (error && error.message ? error.message : String(error))
    );
  }
  const parsed = parseReleaseIdentity(document);
  if (!parsed.ok) {
    fail('E_RELEASE_CLIENT_IDENTITY_INVALID: ' + parsed.error + ' (' + path.relative(root, releasePath) + ')');
  }
  if (parsed.version !== packageVersion) {
    console.warn(
      '[build:client] release.json version ' +
        parsed.version +
        ' is stale for package.json version ' +
        packageVersion +
        '; embedding buildCommit=none (previous-release identity ignored)'
    );
    return { version: packageVersion, buildCommit: null, source: 'package.json(stale release.json)', stale: true };
  }
  return { version: parsed.version, buildCommit: parsed.clientBuildCommit, source: path.relative(root, releasePath), stale: false };
}

if (!fs.existsSync(entry)) {
  fail('missing entry: ' + path.relative(root, entry));
}

const args = parseArgs(process.argv.slice(2));
const packageVersion = readPackageVersion();
const releasePath = args.release;
const identity = resolveBuildIdentity(packageVersion, releasePath);
const identityJson = serializeBuildIdentity(identity.version, identity.buildCommit);

const code = bundleModuleLoader({ entry, id: BUNDLE_ID, root });
const matches = code.match(new RegExp(IDENTITY_LINE_RE.source, 'gm'));
if (!matches || matches.length !== 1) {
  fail('expected exactly one build-identity placeholder in the bundle, found ' + (matches ? matches.length : 0));
}
const embeddedCode = code.replace(IDENTITY_LINE_RE, function replace(_match, indent) {
  return indent + 'const RAW_IDENTITY = ' + JSON.stringify(identityJson) + ';';
});

const header = [
  '// dsh-game-market — browser Client bundle.',
  `// Generated by scripts/build-client.mjs from packages/client/src/main.js.`,
  `// runtimeVersion=${RUNTIME_VERSION} sdkVersion=${SDK_VERSION}. Do not edit by hand.`,
  `// release-identity: version=${identity.version} buildCommit=${identity.buildCommit === null ? 'none' : identity.buildCommit}`,
  '',
].join('\n');

const outFile = args.out;
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, header + embeddedCode, 'utf8');

const check = spawnSync(process.execPath, ['--check', outFile], { encoding: 'utf8' });
if (check.status !== 0) {
  console.error('[build:client] generated bundle has a syntax error');
  console.error(check.stderr || check.stdout);
  process.exit(1);
}

const bytes = fs.statSync(outFile).size;
console.log(
  `[build:client] wrote ${path.relative(root, outFile)} (${bytes} bytes, ${embeddedCode.split('\n').length} lines, ` +
    `version=${identity.version} buildCommit=${identity.buildCommit === null ? 'none' : identity.buildCommit}, identity from ${identity.source}` +
    (identity.stale ? ', stale release.json ignored' : '') +
    `)`
);
