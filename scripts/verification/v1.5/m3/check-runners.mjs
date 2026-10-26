#!/usr/bin/env node
/**
 * Static harness self-check (fast, no DSH boot):
 *  1) `node --check` every runner script;
 *  2) every named import from ./v1-common.mjs / ./lib.mjs / ./fixture.mjs
 *     resolves to an actual export;
 *  3) every export of those modules that is used as a bare identifier in a
 *     runner is imported (or declared locally) — catches the "missing import
 *     after mid-run edit" class of bugs from the audit;
 *  4) no `while (true)` unbounded loops in runner scripts;
 *  5) no broad cleanup patterns (pkill -f, rm -rf with wildcard home-/chrome-).
 * Writes machine-readable checks (and optional evidence JSON) and exits non-zero
 * on any failure.
 *
 * Usage: node scripts/verification/v1.5/m3/check-runners.mjs [--write-evidence]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const RAW_ROOT = path.join(REPO_ROOT, 'docs/verification/v1.5/raw/m3');
const writeEvidence = process.argv.includes('--write-evidence');
const checks = [];
const add = (name, ok, detail = null) => { checks.push({ name, ok: Boolean(ok), required: true, detail }); return Boolean(ok); };

const runnerFiles = fs.readdirSync(HERE).filter((name) => /^run-.*\.mjs$/.test(name)).sort();
const supportModules = ['v1-common.mjs', 'lib.mjs', 'fixture.mjs', 'network-env.mjs'];

const supportExports = {};
for (const moduleName of supportModules) {
  const mod = await import(path.join(HERE, moduleName));
  supportExports[moduleName] = new Set(Object.keys(mod));
}
const supportByName = new Map();
for (const [moduleName, names] of Object.entries(supportExports)) {
  for (const name of names) {
    if (!supportByName.has(name)) supportByName.set(name, []);
    supportByName.get(name).push(moduleName);
  }
}

for (const file of runnerFiles) {
  const full = path.join(HERE, file);
  const syntax = spawnSync(process.execPath, ['--check', full], { encoding: 'utf8', timeout: 60000 });
  add(`syntax-${file}`, syntax.status === 0, syntax.status === 0 ? null : (syntax.stderr || '').slice(0, 400));
  const text = fs.readFileSync(full, 'utf8');

  const imported = new Set();
  // Any import statement (node builtins, alternate modules) counts as imported;
  // the support-module check below additionally verifies the named export
  // actually exists on ./v1-common.mjs / ./lib.mjs / ./fixture.mjs.
  for (const match of text.matchAll(/import\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/g)) imported.add(match[1]);
  for (const match of text.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from/g)) imported.add(match[1]);
  for (const match of text.matchAll(/import \{([^}]*)\} from ['"][^'"]+['"]/g)) {
    for (const raw of match[1].split(',')) {
      const name = raw.trim().replace(/\s+as\s+.*/, '');
      if (name.length > 0) imported.add(name);
    }
  }
  for (const moduleName of supportModules) {
    const escaped = moduleName.replace('.', '\\.');
    const re = new RegExp(`import \\{([^}]*)\\} from '\\./${escaped}'`, 'g');
    for (const match of text.matchAll(re)) {
      for (const raw of match[1].split(',')) {
        const name = raw.trim().replace(/\s+as\s+.*/, '');
        if (name.length === 0) continue;
        imported.add(name);
        const exists = supportExports[moduleName].has(name);
        add(`import-${file}-${name}`, exists, exists ? { from: moduleName } : { from: moduleName, missing: true });
      }
    }
  }
  // dynamic import usage: `await import('./v1-common.mjs')).then((module) => module.NAME`
  for (const match of text.matchAll(/\.then\(\(module\) => module\.([A-Za-z_$][\w$]*)\)/g)) imported.add(match[1]);
  for (const match of text.matchAll(/const \{ ([^}]*) \} = await import\('\.\/v1-common\.mjs'\)/g)) {
    for (const raw of match[1].split(',')) {
      const name = raw.trim().replace(/\s+as\s+.*/, '');
      if (name.length > 0) imported.add(name);
    }
  }

  const declared = new Set([...text.matchAll(/^(?:const|let|function|async function)\s+([A-Za-z_$][\w$]*)/gm)].map((match) => match[1]));
  // Strip comments and string/template literals before the bare-identifier scan.
  const codeOnly = text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
  // Legacy V0 runners are frozen historical evidence generators; they keep
  // syntax/import checks but are exempt from the bare-identifier scan.
  // `sha256` is a benign local/helper name that also exists as a lib re-export.
  const BEHAVIOUR_SCAN_EXEMPT_NAMES = new Set(['sha256']);
  let missing = 0;
  if (file.startsWith('run-v0-')) {
    add(`identifiers-${file}`, true, { note: 'legacy V0 runner: syntax/import checks only' });
    // still run bounded/cleanup checks below
  }
  for (const [name, modules] of (file.startsWith('run-v0-') ? [] : supportByName)) {
    if (imported.has(name) || declared.has(name) || BEHAVIOUR_SCAN_EXEMPT_NAMES.has(name)) continue;
    const used = new RegExp(`(?<![\\w$.])${name}(?![\\w$])`).test(codeOnly);
    if (!used) continue;
    missing += 1;
    add(`used-but-not-imported-${file}-${name}`, false, { from: modules });
  }
  if (!file.startsWith('run-v0-')) add(`identifiers-${file}`, missing === 0, missing === 0 ? null : { missing });

  add(`no-unbounded-while-${file}`, !/while\s*\(\s*true\s*\)/.test(text), null);
  add(`no-broad-cleanup-${file}`, !/pkill\s+-f|rmSync\([^)]*home-\*|rmSync\([^)]*chrome-\*/.test(text), null);
}

for (const moduleName of supportModules) {
  add(`support-syntax-${moduleName}`, spawnSync(process.execPath, ['--check', path.join(HERE, moduleName)], { encoding: 'utf8', timeout: 60000 }).status === 0, null);
}

const failed = checks.filter((check) => !check.ok);
const payload = {
  id: 'M3-harness-selfcheck',
  title: 'Static harness self-check (syntax, imports, identifiers, bounded loops, run-scoped cleanup)',
  checkedAt: new Date().toISOString(),
  runnerFiles,
  supportModules,
  checks,
  failed: failed.map((check) => check.name),
  passed: failed.length === 0,
};
if (writeEvidence) {
  fs.mkdirSync(RAW_ROOT, { recursive: true });
  const file = path.join(RAW_ROOT, `M3-harness-selfcheck-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  payload.evidence = path.relative(REPO_ROOT, file);
}
process.stdout.write(`${JSON.stringify({ id: payload.id, passed: payload.passed, checks: checks.length, failed: payload.failed, evidence: payload.evidence ?? null })}\n`);
process.exitCode = payload.passed ? 0 : 1;
