#!/usr/bin/env node
/**
 * Shared isolated DSH runtime for verification scripts.
 *
 * Extracts the installed desktop app.asar into /tmp/dsh-verify-asar on first
 * use (the same runtime version the user runs) and returns the `dsh` CLI path.
 */
import fs from 'node:fs';
import path from 'node:path';

const ASAR = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';
const ROOT = '/tmp/dsh-verify-asar';
const BIN = `${ROOT}/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js`;

function extract() {
  if (fs.existsSync(BIN)) return;
  if (!fs.existsSync(ASAR)) throw new Error(`DSH app.asar not found: ${ASAR}`);
  fs.rmSync(ROOT, { recursive: true, force: true });
  const archive = fs.readFileSync(ASAR);
  const headerSize = archive.readUInt32LE(4);
  const jsonLen = archive.readUInt32LE(12);
  const json = JSON.parse(archive.subarray(16, 16 + jsonLen).toString('utf8'));
  const base = 8 + headerSize;
  const wanted = (rel) => ['dsh', 'node_modules', 'package.json', 'lib'].some((p) => rel === p || rel.startsWith(`${p}/`));
  function walk(node, rel) {
    if (!node) return;
    if (node.files) {
      for (const [name, child] of Object.entries(node.files)) walk(child, rel ? `${rel}/${name}` : name);
      return;
    }
    if (!wanted(rel) || node.link) return;
    const target = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (node.unpacked) {
      const from = `${ASAR}.unpacked/${rel}`;
      if (fs.existsSync(from)) fs.copyFileSync(from, target);
    } else {
      const offset = base + Number(node.offset);
      fs.writeFileSync(target, archive.subarray(offset, offset + Number(node.size)));
    }
  }
  for (const prefix of ['dsh', 'node_modules', 'package.json', 'lib']) {
    if (json.files[prefix]) walk(json.files[prefix], prefix);
  }
}

export async function ensureDshRuntime() {
  extract();
  return BIN;
}
