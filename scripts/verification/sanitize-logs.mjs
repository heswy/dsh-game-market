#!/usr/bin/env node
/**
 * Sanitize tracked verification logs (CR-07).
 *
 * Replaces machine-specific absolute paths with stable placeholders and
 * reports any remaining secret-like patterns, so logs can live in Git.
 * Run before committing new evidence.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const LOG_DIR = path.join(ROOT, 'docs/verification/v1/logs');
const replacements = [
  [ROOT, '<repo>'],
  [os.homedir(), '~'],
  [/\/private\/var\/folders\/[^\s"']+/g, '<tmp>'],
  [/\/var\/folders\/[^\s"']+/g, '<tmp>'],
  [/\/tmp\/[A-Za-z0-9._-]+/g, '<tmp>'],
];
const secretPatterns = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /Bearer\s+[A-Za-z0-9._-]{16,}/gi,
  /api[_-]?key["'\s:=]+[A-Za-z0-9_-]{12,}/gi,
  /token=[A-Za-z0-9._-]{20,}/gi,
];
let changed = 0;
let warnings = 0;
for (const name of fs.existsSync(LOG_DIR) ? fs.readdirSync(LOG_DIR) : []) {
  if (!name.endsWith('.log')) continue;
  const file = path.join(LOG_DIR, name);
  let text = fs.readFileSync(file, 'utf8');
  const before = text;
  for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
  for (const pattern of secretPatterns) {
    if (pattern.test(text)) {
      console.warn(`[sanitize] possible secret pattern in ${name}`);
      warnings += 1;
    }
  }
  if (text !== before) {
    fs.writeFileSync(file, text);
    changed += 1;
  }
}
console.log(`[sanitize] logs=${fs.existsSync(LOG_DIR) ? fs.readdirSync(LOG_DIR).filter((n) => n.endsWith('.log')).length : 0} changed=${changed} warnings=${warnings}`);
