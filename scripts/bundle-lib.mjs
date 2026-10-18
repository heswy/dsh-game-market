// Zero-dependency bundler for the restricted ESM style used in this repo.
//
// Supported syntax (one import per line, no cycles, no dynamic import):
//   import React from 'react';                      // Client bundle only
//   import { a, b as c } from './other.js';         // named imports
//   import * as ns from './other.js';               // namespace import
//   export function name(...) {}
//   export const name = ...; / export let / export class
//
// Unsupported (fails loudly so nobody debugs a silent mis-bundle):
//   export default, export { ... }, export * from, multi-line imports,
//   bare package imports other than `react`, circular imports.
//
// Two output formats:
//   - bundleModuleLoader(): window.__ModuleLoader__.load({ id, factory(require) })
//   - bundleExpression(): an IIFE expression that evaluates to the entry exports

import fs from 'node:fs';
import path from 'node:path';

const IMPORT_RE = /^import\s+(.+?)\s+from\s+["']([^"']+)["'];?\s*$/;
const NAME_RE = /^[A-Za-z_$][\w$]*$/;
const EXPORT_DECL_RE = /^export\s+(async\s+function|function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;
const FORBIDDEN_EXPORT_RE = /^export\s+(default|\{|\*)/;

/**
 * @param {{entry: string, root: string}} options
 */
export function collectModules({ entry, root }) {
  const rootAbs = path.resolve(root);
  const entryAbs = path.resolve(rootAbs, entry);
  const modules = new Map(); // abs path -> module record
  const order = [];
  const visiting = new Set();

  function resolveImport(importerAbs, specifier) {
    if (specifier === 'react') return { kind: 'external', specifier };
    if (!specifier.startsWith('.')) {
      throw new Error(`Unsupported bare import "${specifier}" in ${path.relative(rootAbs, importerAbs)}; only relative imports and "react" are allowed`);
    }
    if (!specifier.endsWith('.js')) {
      throw new Error(`Imports must include the .js extension: "${specifier}" in ${path.relative(rootAbs, importerAbs)}`);
    }
    const abs = path.resolve(path.dirname(importerAbs), specifier);
    if (!abs.startsWith(rootAbs + path.sep)) {
      throw new Error(`Import escapes the repo root: "${specifier}" in ${path.relative(rootAbs, importerAbs)}`);
    }
    return { kind: 'local', specifier, abs };
  }

  function visit(abs) {
    if (modules.has(abs)) return modules.get(abs);
    if (visiting.has(abs)) {
      throw new Error(`Circular import detected at ${path.relative(rootAbs, abs)}`);
    }
    visiting.add(abs);
    if (!fs.existsSync(abs)) throw new Error(`Module not found: ${path.relative(rootAbs, abs)}`);
    const source = fs.readFileSync(abs, 'utf8');
    const lines = source.split('\n');
    const imports = [];
    const body = [];
    const exportedNames = [];
    let inBlockComment = false;

    for (const rawLine of lines) {
      const line = rawLine;
      const trimmed = line.trim();
      // Preserve comments/blank lines; only line-start declarations matter.
      if (inBlockComment) {
        body.push(line);
        if (trimmed.includes('*/')) inBlockComment = false;
        continue;
      }
      if (trimmed.startsWith('/*')) {
        inBlockComment = !trimmed.includes('*/');
        body.push(line);
        continue;
      }
      if (trimmed.startsWith('//')) {
        body.push(line);
        continue;
      }
      if (trimmed.startsWith('import ')) {
        imports.push(parseImport(trimmed, abs, rootAbs, resolveImport));
        continue;
      }
      if (trimmed.startsWith('export ')) {
        if (FORBIDDEN_EXPORT_RE.test(trimmed)) {
          throw new Error(`Unsupported export form in ${path.relative(rootAbs, abs)}: ${trimmed}`);
        }
        const match = EXPORT_DECL_RE.exec(trimmed);
        if (!match) {
          throw new Error(`Unsupported export syntax in ${path.relative(rootAbs, abs)}: ${trimmed}`);
        }
        exportedNames.push(match[2]);
        body.push(line.replace(/^(\s*)export\s+/, '$1'));
        continue;
      }
      if (trimmed.includes('import(')) {
        throw new Error(`Dynamic import is not supported (${path.relative(rootAbs, abs)})`);
      }
      if (trimmed.startsWith('export')) {
        throw new Error(`Unsupported export syntax in ${path.relative(rootAbs, abs)}: ${trimmed}`);
      }
      body.push(line);
    }

    const record = {
      abs,
      id: toPosix(path.relative(rootAbs, abs)),
      imports,
      body: body.join('\n'),
      exportedNames: [...new Set(exportedNames)],
    };
    modules.set(abs, record);
    for (const imp of imports) {
      if (imp.target.kind === 'local') visit(imp.target.abs);
      else imp.target.moduleId = null;
    }
    visiting.delete(abs);
    order.push(record);
    return record;
  }

  const entryModule = visit(entryAbs);
  return { rootAbs, entry: entryModule, modules, order };
}

function parseImport(line, importerAbs, rootAbs, resolveImport) {
  const where = path.relative(rootAbs, importerAbs);
  const match = IMPORT_RE.exec(line);
  if (!match) throw new Error(`Unsupported import syntax in ${where}: ${line}`);
  const clause = match[1].trim();
  const specifier = match[2];
  const target = resolveImport(importerAbs, specifier);
  const result = { defaultName: null, named: [], namespaceName: null, specifier, target };

  if (clause.startsWith('* as ')) {
    const name = clause.slice(5).trim();
    if (!NAME_RE.test(name)) throw new Error(`Invalid namespace import in ${where}: ${line}`);
    result.namespaceName = name;
    return result;
  }

  const commaIndex = topLevelComma(clause);
  if (commaIndex === -1) {
    if (clause.startsWith('{')) {
      result.named = parseNamedList(clause, where);
    } else if (NAME_RE.test(clause)) {
      result.defaultName = clause;
    } else {
      throw new Error(`Unsupported import clause in ${where}: ${line}`);
    }
    return result;
  }

  const first = clause.slice(0, commaIndex).trim();
  const rest = clause.slice(commaIndex + 1).trim();
  if (!NAME_RE.test(first)) throw new Error(`Unsupported default import in ${where}: ${line}`);
  result.defaultName = first;
  if (!rest.startsWith('{')) throw new Error(`Unsupported import clause in ${where}: ${line}`);
  result.named = parseNamedList(rest, where);
  return result.isDefault === true ? result : result;
}

function topLevelComma(clause) {
  let depth = 0;
  for (let i = 0; i < clause.length; i += 1) {
    const ch = clause[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) return i;
  }
  return -1;
}

function parseNamedList(clause, where) {
  if (!clause.startsWith('{') || !clause.endsWith('}')) {
    throw new Error(`Invalid named import in ${where}: ${clause}`);
  }
  return clause.slice(1, -1).split(',').map((part) => part.trim()).filter(Boolean).map(parseNamed);
}

function parseNamed(part) {
  const [source, alias] = part.split(/\s+as\s+/);
  return { imported: source.trim(), local: (alias || source).trim() };
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function renderedImports(record, modules) {
  const lines = [];
  for (const imp of record.imports) {
    const target = imp.target;
    if (target.kind === 'external') {
      if (target.specifier !== 'react') throw new Error(`Unsupported external import: ${target.specifier}`);
      lines.push(`const __react = require('react');`);
      if (imp.defaultName) lines.push(`const ${imp.defaultName} = __react;`);
      if (imp.namespaceName) lines.push(`const ${imp.namespaceName} = __react;`);
      for (const named of imp.named) lines.push(`const ${named.local} = __react.${named.imported};`);
      continue;
    }
    const dep = modules.get(target.abs);
    if (!dep) throw new Error(`Internal bundler error: missing module ${target.abs}`);
    const ref = `__mods[${JSON.stringify(dep.id)}]`;
    if (imp.defaultName) throw new Error(`Default imports from local modules are not supported (${dep.id})`);
    if (imp.namespaceName) lines.push(`const ${imp.namespaceName} = ${ref};`);
    for (const named of imp.named) lines.push(`const ${named.local} = ${ref}.${named.imported};`);
  }
  return lines.join('\n');
}

function renderModuleBodies({ modules, order }) {
  const chunks = [];
  for (const record of order) {
    const bindings = renderedImports(record, modules);
    const exportsObject = record.exportedNames.length
      ? `{ ${record.exportedNames.join(', ')} }`
      : '{}';
    chunks.push(
      `// module: ${record.id}\n` +
      `__mods[${JSON.stringify(record.id)}] = (function () {\n` +
      `${bindings ? `${bindings}\n` : ''}` +
      `${record.body}\n` +
      `return ${exportsObject};\n` +
      `})();`
    );
  }
  return chunks.join('\n\n');
}

function prelude({ entry, modules, order }) {
  return `// Generated by scripts/bundle-lib.mjs — do not edit by hand.\n` +
    `const __mods = Object.create(null);\n\n` +
    `${renderModuleBodies({ modules, order })}\n\n` +
    `const __entry = __mods[${JSON.stringify(entry.id)}];\n`;
}

/**
 * Produce a `window.__ModuleLoader__.load(...)` bundle (DSH Client format).
 * @param {{entry: string, root: string, id: string}} options
 */
export function bundleModuleLoader({ entry, root, id }) {
  if (!id) throw new Error('bundleModuleLoader requires a module id');
  const collected = collectModules({ entry, root });
  const body = indent(prelude(collected), 4);
  return `// dsh-game-market client bundle\n` +
    `window.__ModuleLoader__.load({\n` +
    `  id: ${JSON.stringify(id)},\n` +
    `  factory: function (require) {\n` +
    `${body}\n` +
    `    return __entry;\n` +
    `  }\n` +
    `});\n`;
}

/**
 * Produce an IIFE expression that evaluates to the entry module exports.
 * Used to inline the SDK into single-file games.
 * @param {{entry: string, root: string}} options
 */
export function bundleExpression({ entry, root }) {
  const collected = collectModules({ entry, root });
  const usesReact = [...collected.modules.values()].some((m) => m.imports.some((i) => i.target.kind === 'external'));
  if (usesReact) throw new Error('bundleExpression cannot be used with external imports (react)');
  return `(function () {\n  'use strict';\n${indent(prelude(collected), 2)}\n  return __entry;\n})()`;
}

function indent(text, spaces) {
  const pad = ' '.repeat(spaces);
  return text.split('\n').map((line) => (line ? pad + line : line)).join('\n');
}
