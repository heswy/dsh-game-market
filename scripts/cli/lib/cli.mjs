/**
 * `dsh-game` command implementations (PRD §8.2.8).
 *
 * Zero third-party dependencies; Node >= 20. Every command is offline.
 * Exit codes: 0 success, 1 validation/compat, 2 usage/config, 3 internal.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { EXIT_CODES, CliError, ValidationFailure, usageError } from './cli-error.mjs';
import { createProject, TEMPLATE_NAMES } from './create.mjs';
import { startDevServer } from '../dev-server.mjs';
import { formatReport } from './issues.mjs';
import { packProject } from './pack.mjs';
import { buildProject, loadConfig } from './project.mjs';
import { packPackageV2 } from './package-v2.mjs';
import { publishProject } from './publish.mjs';
import { validatePath } from './validator.mjs';
import { ASSET_ZIP_V2, DEFAULT_FORMAT, PACKAGE_ZIP_EXTENSION, formatChoices, isZipFormat, normalizeFormat } from './formats.mjs';

const CLI_VERSION = '0.1.0';

const HELP = `dsh-game ${CLI_VERSION} — DSH Game Market developer CLI (zero dependencies, offline)

Usage:
  dsh-game <command> [options]

Commands:
  create <id>            Scaffold a project from templates/ (alias: init)
  build [project]        Build project -> dist/index.html (deterministic single file)
  validate <path>        Validate a package or a project directory
  pack [project]         Copy dist/index.html -> dist/<id>-<version>.html + .sha256
  publish [project]      Emit a registry entry, upload plan and review checklist
  dev [project]          Start the Local Runtime Simulator (fake bridge)

Common options:
  --json                 Machine-readable JSON output (no ANSI, no timing fields)
  --help                 Show help for a command
  --quiet                Suppress non-error human output

Create options:
  --template <name>      ${TEMPLATE_NAMES.join(' | ')} (default: vanilla)
  --dir <parent>         Parent directory (default: current directory)
  --name <display name>  Display name (default derived from the id)
  --description <text>   Manifest description
  --author <name>        Author name
  --force                Allow a non-empty target directory
  --dry-run              Print the files that would be created

Format (all of create/build/validate/pack/publish/dev):
  --format <fmt>         ${formatChoices()} (default: ${DEFAULT_FORMAT}; also read from dsh-game.config.json)
                         html-v1 stays byte-identical when the flag is omitted.

Build options:
  [project]              Project directory (default: current directory)
  --out <file>           html-v1: output file; asset-zip-v2: output directory
  --no-sdk               Do not inject the bundled SDK (advanced)
  --no-build-command     asset-zip-v2 prebuilt projects: finalise dist without re-running buildCommand

Validate options:
  <path>                 dist/index.html, a packed <id>-<version>.html, a
                         .dshgame.zip, dist/ or a project dir

Pack options:
  [project]              Project directory, built dist/, packed .html, or .dshgame.zip
  --out <dir>            Output directory (default: directory of the input/build)

Publish options:
  [project]              Project directory or packed .html
  --url <url>            Required. https package URL (or relative with --file-registry),
                         must end with <id>-<version>.html
  --cover <https url>    Required. Registry cover image URL
  --registry-dir <dir>   Merge the entry into <dir>/registry/games.json
  --file-registry        Use a relative package URL inside a local file Registry
  --allowed-host <host>  Additional allowed package host (repeatable; default GitHub)
  --repository <url>     Accepted for convenience (manifest.repository is used)
  --homepage <url>       Accepted for convenience (manifest.homepage is used)
  --license <id>         Accepted for convenience (manifest.license is used)
  --changelog <text>     Registry changelog
  --dry-run              Preview only: write no entry/plan files, no remote calls
  --featured             Set featured:true
  --quick-play           Set quickPlay:true
  --released-at <iso>    package.releasedAt (default: now)
  --published-at <iso>   publishedAt (default: releasedAt)
  --updated-at <iso>     updatedAt (default: publishedAt)
  --generated-at <iso>   Registry generatedAt when --registry-dir is used
  --rehash               Recompute a missing/stale .sha256 sidecar

Dev options:
  [project]              Project directory (default: current directory)
  --port <number>        Port (default: 4321)
  --host <address>       Bind address (default: 127.0.0.1)
  --no-build             Serve an existing dist/ output instead of rebuilding
  --seed-save <file>     Dev only: seed fake storage from a save JSON (upgrade testing)
  --save-out <file>      Dev only: persist the latest fake save to a file
  (run dsh-game dev --help for endpoints, save import/export and the two-iframe note)

Exit codes: 0 ok · 1 validation/compat · 2 usage/config · 3 internal · 4 network (unused)
`;

const DEV_HELP = `dsh-game dev ${CLI_VERSION} — Local Runtime Simulator (development only)

Usage:
  dsh-game dev [project] [options]

Options:
  [project]              Project directory (default: current directory)
  --port <number>        Port (default: 4321; 0 picks a free port)
  --host <address>       Bind address (default: 127.0.0.1)
  --format <fmt>         ${formatChoices()} (default: ${DEFAULT_FORMAT}; also read from dsh-game.config.json)
  --no-build             Serve the existing dist/ output instead of rebuilding it
  --seed-save <file>     Dev only: seed the fake save with a previously exported save JSON
                         (upgrade-path testing; accepts {"save": ...} or a raw save)
  --save-out <file>      Dev only: persist the latest fake save to this file after each save/remove
  --help                 Show this dev-specific help

Endpoints:
  /                      Simulator UI (controls, bridge log, fake Host state)
  /game                  html-v1 only: the built single-file document. In asset-zip-v2
                         mode this endpoint intentionally returns 404.
  /wrapper?src=<url>     asset-zip-v2: platform wrapper served from the resource origin
                         (outer iframe is NOT sandboxed; it embeds the sandboxed game)
  /res/<instance>/<token>/<path>
                         asset-zip-v2 package files through the resource-origin route
  /health                JSON status: format, build mode, fileCount (zip)
  /dev/save/export       GET latest fake save as JSON (dev only)
  /dev/save/import       POST {"save": {...}} to import a save (dev only)

Upgrade path (1.0.0 -> 1.0.1):
  1. run \`dsh-game dev --save-out /tmp/game.save.json\` on 1.0.0, play and trigger before-save;
  2. switch to 1.0.1, run \`dsh-game dev --seed-save /tmp/game.save.json\`;
  3. the fake storage starts with the old save, so Continue/deserialize can be verified.
  The UI also exposes "Export save" / "Import save" buttons with the same effect.

Stop: press Ctrl+C (SIGINT/SIGTERM shuts the server down cleanly).

Note: asset-zip-v2 packages load through TWO iframes (outer platform wrapper on the
resource origin, not sandboxed; inner game document sandbox="allow-scripts"). html-v1
loads a single iframe directly.
`;

function write(text) {
  process.stdout.write(text);
}
function writeError(text) {
  process.stderr.write(text);
}

function printJson(value) {
  write(`${JSON.stringify(value, null, 2)}\n`);
}

function parse(command, argv, options) {
  try {
    return parseArgs({ args: argv, options, allowPositionals: true, strict: true });
  } catch (error) {
    throw usageError(`${command}: ${error.message}`, 'Run `dsh-game ' + command + ' --help`.');
  }
}

function requestedJson(argv) {
  return argv.includes('--json');
}

function handleError(error, jsonMode) {
  if (error instanceof ValidationFailure) {
    if (jsonMode) printJson(error.report);
    else write(formatReport(error.report));
    return EXIT_CODES.INVALID;
  }
  if (error instanceof CliError) {
    if (jsonMode) {
      printJson({ ok: false, error: { message: error.message, hint: error.hint || null, code: error.code || null } });
    } else {
      writeError(`error: ${error.message}\n`);
      if (error.hint) writeError(`  hint: ${error.hint}\n`);
    }
    return error.exitCode;
  }
  const message = error && error.message ? error.message : String(error);
  if (jsonMode) printJson({ ok: false, error: { message, code: 'E_CLI_INTERNAL' } });
  else {
    writeError(`internal error: ${message}\n`);
    if (error && error.stack) writeError(`${error.stack}\n`);
  }
  return EXIT_CODES.INTERNAL;
}

function requirePath(positionals, fallback) {
  return path.resolve(positionals[0] || fallback || process.cwd());
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

function commandCreate(argv) {
  const { values, positionals } = parse('create', argv, {
    template: { type: 'string' },
    dir: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    author: { type: 'string' },
    format: { type: 'string' },
    force: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  });
  if (values.help) {
    write(HELP);
    return EXIT_CODES.OK;
  }
  const name = positionals[0];
  if (!name) throw usageError('create requires a game id', 'Example: node scripts/cli/create-dsh-game.mjs my-game --template vanilla');
  const result = createProject({
    name,
    template: values.template,
    parentDir: values.dir,
    displayName: values.name,
    description: values.description,
    author: values.author,
    format: values.format,
    force: values.force,
    dryRun: values['dry-run'],
  });
  if (values.json) {
    printJson(result);
    return EXIT_CODES.OK;
  }
  if (result.dryRun) {
    if (!values.quiet) {
      write(`Would create ${result.id} (${result.template}, ${result.format || 'html-v1'}) at ${result.targetDir}\n`);
      for (const file of result.files) write(`  ${file}\n`);
      write('\n(dry run: no files were written)\n');
    }
    return EXIT_CODES.OK;
  }
  if (!values.quiet) {
    write(`Created ${result.id} (${result.template}, ${result.format || 'html-v1'}) at ${result.targetDir}\n`);
    for (const file of result.files) write(`  ${file}\n`);
    write('\nNext steps:\n');
    for (const step of result.nextSteps) write(`  ${step}\n`);
  }
  return EXIT_CODES.OK;
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

async function commandBuild(argv) {
  const { values, positionals } = parse('build', argv, {
    out: { type: 'string' },
    format: { type: 'string' },
    'no-sdk': { type: 'boolean', default: false },
    'no-build-command': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  });
  if (values.help) {
    write(HELP);
    return EXIT_CODES.OK;
  }
  const projectDir = requirePath(positionals);
  const result = await buildProject(projectDir, {
    out: values.out ? path.resolve(values.out) : undefined,
    format: values.format,
    sdk: values['no-sdk'] ? false : undefined,
    runBuildCommand: values['no-build-command'] ? false : undefined,
  });
  const manifest = { id: result.manifest.id, version: result.manifest.version, name: result.manifest.name };
  if (isZipFormat(result.format)) {
    if (values.json) {
      printJson({
        ok: true,
        format: result.format,
        out: result.outDir,
        entry: result.entry,
        bytes: result.bytes,
        fileCount: result.fileCount,
        filesDigest: result.filesDigest,
        manifest,
        warnings: result.warnings,
      });
      return EXIT_CODES.OK;
    }
    if (!values.quiet) {
      write(`built ${result.outDir} (${result.fileCount} files, ${result.bytes} bytes)\n`);
      write(`  format:   ${result.format}\n`);
      write(`  entry:    ${result.entry}\n`);
      write(`  digest:   ${result.filesDigest}\n`);
      write(`  manifest: ${manifest.id}@${manifest.version}\n`);
      for (const warning of result.warnings) write(`  warning ${warning.code}: ${warning.message}\n`);
    }
    return EXIT_CODES.OK;
  }
  if (values.json) {
    printJson({
      ok: true,
      format: 'html-v1',
      out: result.outFile,
      bytes: result.bytes,
      sha256: result.sha256,
      manifest,
      warnings: result.warnings,
    });
    return EXIT_CODES.OK;
  }
  if (!values.quiet) {
    write(`built ${result.outFile} (${result.bytes} bytes)\n`);
    write(`  sha256: ${result.sha256}\n`);
    write(`  manifest: ${manifest.id}@${manifest.version}\n`);
    for (const warning of result.warnings) write(`  warning ${warning.code}: ${warning.message}\n`);
  }
  return EXIT_CODES.OK;
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

async function commandValidate(argv) {
  const { values, positionals } = parse('validate', argv, {
    format: { type: 'string' },
    json: { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  });
  if (values.help) {
    write(HELP);
    return EXIT_CODES.OK;
  }
  if (positionals.length === 0) {
    throw usageError('validate requires a path', 'Example: dsh-game validate dist/index.html');
  }
  const { report } = await validatePath(path.resolve(positionals[0]), { format: values.format });
  if (values.json) printJson(report);
  else if (!values.quiet || !report.ok) write(formatReport(report));
  return report.ok ? EXIT_CODES.OK : EXIT_CODES.INVALID;
}

// ---------------------------------------------------------------------------
// pack
// ---------------------------------------------------------------------------

async function commandPack(argv) {
  const { values, positionals } = parse('pack', argv, {
    out: { type: 'string' },
    input: { type: 'string' },
    format: { type: 'string' },
    json: { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  });
  if (values.help) {
    write(HELP);
    return EXIT_CODES.OK;
  }
  const target = positionals[0] ? path.resolve(positionals[0]) : null;
  const isHtmlFile = target && /\.html$/i.test(target);
  const isZipFile = target && target.toLowerCase().endsWith(PACKAGE_ZIP_EXTENSION);
  const projectDir = isHtmlFile || isZipFile ? process.cwd() : target || process.cwd();
  const input = values.input ? path.resolve(values.input) : isHtmlFile || isZipFile ? target : null;
  const explicitFormat = normalizeFormat(values.format);
  let format = explicitFormat;
  if (format === null) {
    if (isZipFile) format = ASSET_ZIP_V2;
    else if (isHtmlFile) format = 'html-v1';
    else {
      try {
        const config = loadConfig(projectDir);
        format = normalizeFormat(config.format) || 'html-v1';
      } catch (_error) {
        format = 'html-v1';
      }
      if (format === 'html-v1') {
        try {
          if (fs.existsSync(path.join(projectDir, 'dsh-package.json'))) format = ASSET_ZIP_V2;
        } catch (_error) {
          // keep the default
        }
      }
    }
  }
  if (isZipFormat(format)) {
    const result = await packPackageV2(projectDir, {
      input,
      format,
      outDir: values.out ? path.resolve(values.out) : undefined,
    });
    if (values.json) {
      printJson({
        ok: true,
        format: result.format,
        id: result.id,
        version: result.version,
        file: result.outFile,
        digestFile: result.digestFile,
        sha256: result.sha256,
        bytes: result.bytes,
        fileCount: result.fileCount,
        filesDigest: result.filesDigest,
        permissions: result.permissions,
        selfTest: result.selfTest,
        warnings: result.warnings,
      });
      return EXIT_CODES.OK;
    }
    if (!values.quiet) {
      write(`packed ${result.outFile} (${result.bytes} bytes, ${result.fileCount} files)\n`);
      write(`  format:    ${result.format}\n`);
      write(`  sha256:    ${result.sha256}\n`);
      write(`  fileCount: ${result.fileCount}\n`);
      write(`  filesDigest: ${result.filesDigest}\n`);
      write(`  digest:    ${result.digestFile}\n`);
      write(`  self-test: ${result.selfTest.ok ? 'extracted OK' : 'FAILED'} (${result.permissions.length} entries @0444)\n`);
    }
    return EXIT_CODES.OK;
  }
  const result = packProject(projectDir, {
    input,
    outDir: values.out ? path.resolve(values.out) : undefined,
  });
  if (values.json) {
    printJson({
      ok: true,
      format: 'html-v1',
      id: result.id,
      version: result.version,
      file: result.outFile,
      digestFile: result.digestFile,
      sha256: result.sha256,
      bytes: result.bytes,
      warnings: result.warnings,
    });
    return EXIT_CODES.OK;
  }
  if (!values.quiet) {
    write(`packed ${result.outFile} (${result.bytes} bytes)\n`);
    write(`  sha256: ${result.sha256}\n`);
    write(`  digest: ${result.digestFile}\n`);
  }
  return EXIT_CODES.OK;
}

// ---------------------------------------------------------------------------
// publish
// ---------------------------------------------------------------------------

async function commandPublish(argv) {
  const { values, positionals } = parse('publish', argv, {
    input: { type: 'string' },
    out: { type: 'string' },
    format: { type: 'string' },
    url: { type: 'string' },
    cover: { type: 'string' },
    'registry-dir': { type: 'string' },
    'file-registry': { type: 'boolean', default: false },
    'allowed-host': { type: 'string', multiple: true, default: [] },
    repository: { type: 'string' },
    homepage: { type: 'string' },
    license: { type: 'string' },
    changelog: { type: 'string' },
    featured: { type: 'boolean', default: false },
    'quick-play': { type: 'boolean', default: false },
    'released-at': { type: 'string' },
    'published-at': { type: 'string' },
    'updated-at': { type: 'string' },
    'generated-at': { type: 'string' },
    rehash: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  });
  if (values.help) {
    write(HELP);
    return EXIT_CODES.OK;
  }
  const target = positionals[0] ? path.resolve(positionals[0]) : null;
  const isHtmlFile = target && /\.html$/i.test(target);
  const isZipFile = target && target.toLowerCase().endsWith(PACKAGE_ZIP_EXTENSION);
  const isFile = isHtmlFile || isZipFile;
  const projectDir = isFile ? process.cwd() : target || process.cwd();
  const input = values.input ? path.resolve(values.input) : isFile ? target : null;
  const result = await publishProject(projectDir, {
    input,
    format: values.format,
    outDir: values.out ? path.resolve(values.out) : undefined,
    url: values.url,
    cover: values.cover,
    registryDir: values['registry-dir'],
    fileRegistry: values['file-registry'],
    allowedHosts: values['allowed-host'],
    homepage: values.homepage,
    repository: values.repository,
    license: values.license,
    changelog: values.changelog,
    featured: values.featured,
    quickPlay: values['quick-play'],
    releasedAt: values['released-at'],
    publishedAt: values['published-at'],
    updatedAt: values['updated-at'],
    generatedAt: values['generated-at'],
    rehash: values.rehash,
    write: values['dry-run'] ? false : undefined,
  });
  if (values.json) {
    printJson({
      ok: true,
      id: result.id,
      version: result.version,
      entry: result.entry,
      files: result.files,
      registry: result.registryPath,
      sha256: result.info.sha256,
      bytes: result.info.bytes,
      dates: result.dates,
      warnings: result.warnings,
    });
    return EXIT_CODES.OK;
  }
  if (!values.quiet) {
    write(`published ${result.id}@${result.version}${values['dry-run'] ? ' (dry run: no files written)' : ''}\n`);
    write(`  entry:     ${result.files.entry}\n`);
    write(`  upload:    ${result.files.upload}\n`);
    write(`  checklist: ${result.files.checklist}\n`);
    if (result.registryPath) write(`  registry:  ${result.registryPath}\n`);
    write(`  sha256:    ${result.info.sha256}\n`);
    write(`  package:   ${result.entry.package.url}\n`);
  }
  return EXIT_CODES.OK;
}

// ---------------------------------------------------------------------------
// dev
// ---------------------------------------------------------------------------

async function commandDev(argv) {
  const { values, positionals } = parse('dev', argv, {
    port: { type: 'string' },
    host: { type: 'string' },
    format: { type: 'string' },
    'no-build': { type: 'boolean', default: false },
    'seed-save': { type: 'string' },
    'save-out': { type: 'string' },
    help: { type: 'boolean', default: false },
  });
  if (values.help) {
    write(DEV_HELP);
    return EXIT_CODES.OK;
  }
  const port = values.port === undefined ? undefined : Number(values.port);
  if (values.port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    throw usageError('--port must be an integer between 0 and 65535');
  }
  const projectDir = requirePath(positionals);
  const simulator = await startDevServer({
    projectDir,
    host: values.host,
    port,
    format: values.format,
    build: !values['no-build'],
    seedSave: values['seed-save'] ? path.resolve(values['seed-save']) : undefined,
    saveOut: values['save-out'] ? path.resolve(values['save-out']) : undefined,
    logger: {
      error: (message) => writeError(`${message}\n`),
    },
  });
  write(`Game Runtime Simulator: ${simulator.url}\n`);
  write(`  project: ${simulator.projectDir}\n`);
  write(`  format:  ${simulator.format || 'html-v1'}\n`);
  write('  controls: agent running/waiting-user/completed, pause/resume, before-save, save export/import, clear save, theme, locale\n');
  if (simulator.saveApi) write(`  save API: /dev/save/export (GET JSON), /dev/save/import (POST {save})\n`);
  if (simulator.saveOut) write(`  save out: ${simulator.saveOut}\n`);
  write(`  endpoints: / (UI), ${simulator.format === 'asset-zip-v2' ? '/wrapper?src=… + /res/… (zip), /game returns 404' : '/game (html-v1)'}, /health\n`);
  write('  every bridge message is logged in the page and in the browser console\n');
  write('Press Ctrl+C to stop.\n');

  await new Promise((resolve) => {
    let closing = false;
    async function stop() {
      if (closing) return;
      closing = true;
      try {
        await simulator.close();
      } finally {
        resolve();
      }
    }
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return EXIT_CODES.OK;
}

// ---------------------------------------------------------------------------

export async function runCli(argv) {
  const [command, ...rest] = argv;
  const jsonMode = requestedJson(rest);
  if (!command || command === '--help' || command === 'help' || command === '-h') {
    write(HELP);
    return EXIT_CODES.OK;
  }
  if (command === '--version' || command === '-v') {
    write(`${CLI_VERSION}\n`);
    return EXIT_CODES.OK;
  }
  try {
    switch (command) {
      case 'create':
      case 'init':
        return commandCreate(rest);
      case 'build':
        return await commandBuild(rest);
      case 'validate':
        return await commandValidate(rest);
      case 'pack':
        return await commandPack(rest);
      case 'publish':
        return await commandPublish(rest);
      case 'dev':
        return await commandDev(rest);
      default:
        throw usageError(`Unknown command: ${command}`, 'Run `dsh-game --help`.');
    }
  } catch (error) {
    return handleError(error, jsonMode);
  }
}

export { CLI_VERSION, HELP };
