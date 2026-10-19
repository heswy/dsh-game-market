#!/usr/bin/env node
/**
 * Build a deterministic, versioned developer-Skill archive.
 *
 *   node scripts/registry/pack-skill.mjs [--out dist]
 *
 * Emits `dsh-game-developer-<version>.tar.gz` and `manifest.json` (file hashes,
 * platform version/commit, compatibility note). No external tools required.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SKILL_DIR = path.join(ROOT, 'skills', 'dsh-game-developer');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function writeOctal(header, offset, length, value) {
  const text = value.toString(8).padStart(length - 1, '0').slice(-(length - 1));
  header.write(`${text}\0`, offset, length, 'ascii');
}

function tarHeader(name, size, mode) {
  const header = Buffer.alloc(512, 0);
  const isDirectory = name.endsWith('/');
  const normalized = isDirectory ? name : name;
  header.write(normalized.slice(0, 100), 0, 'utf8');
  writeOctal(header, 100, 8, isDirectory ? 0o755 : mode);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.write('        ', 148, 'ascii');
  header.write(isDirectory ? '5' : '0', 156, 'ascii');
  header.write('ustar\0', 257, 'ascii');
  header.write('00', 263, 'ascii');
  writeOctal(header, 148, 8, [...header.subarray(0, 148), ...header.subarray(156)].reduce((sum, byte) => sum + byte, 0));
  return header;
}

function tarFile(relativePath, bytes, mode) {
  const blocks = [tarHeader(relativePath, bytes.length, mode), bytes];
  const padding = (512 - (bytes.length % 512)) % 512;
  if (padding > 0) blocks.push(Buffer.alloc(padding, 0));
  return Buffer.concat(blocks);
}

async function listFiles(directory, prefix = '') {
  const out = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(target, relative));
    else if (entry.isFile()) out.push({ relative, absolute: target });
  }
  return out;
}

async function buildSkillArchive() {
  const version = (await fs.readFile(path.join(SKILL_DIR, 'VERSION'), 'utf8')).trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('skills/dsh-game-developer/VERSION must be semver');
  const files = (await listFiles(SKILL_DIR)).sort((left, right) => left.relative.localeCompare(right.relative));
  const prefix = `dsh-game-developer-${version}`;
  const chunks = [];
  const manifestFiles = [];
  for (const file of files) {
    const bytes = await fs.readFile(file.absolute);
    const mode = file.relative.startsWith('scripts/') ? 0o755 : 0o644;
    chunks.push(tarFile(`${prefix}/${file.relative}`, bytes, mode));
    manifestFiles.push({ path: `${prefix}/${file.relative}`, sha256: sha256(bytes), size: bytes.length });
  }
  chunks.push(Buffer.alloc(1024, 0));
  const tar = Buffer.concat(chunks);
  const archive = gzipSync(tar, { level: 9, mtime: 0 });
  const platformPkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const manifest = {
    schemaVersion: 1,
    name: 'dsh-game-developer',
    version,
    skillPath: 'skills/dsh-game-developer',
    platform: { name: 'dsh-game-market', version: platformPkg.version, compatibility: '>=1.1.0' },
    files: manifestFiles,
    archive: { file: `${prefix}.tar.gz`, size: archive.length, sha256: sha256(archive) },
  };
  return { version, archive, manifest };
}

async function main(argv = process.argv.slice(2)) {
  let outDir = path.join(ROOT, 'dist');
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out') { outDir = path.resolve(argv[index + 1] || outDir); index += 1; }
    else if (argv[index] !== '--json') { console.error(`[skill] unknown argument: ${argv[index]}`); return 2; }
  }
  const result = await buildSkillArchive();
  await fs.mkdir(outDir, { recursive: true });
  const archivePath = path.join(outDir, result.manifest.archive.file);
  const manifestPath = path.join(outDir, 'manifest.json');
  await fs.writeFile(archivePath, result.archive);
  await fs.writeFile(manifestPath, JSON.stringify(result.manifest, null, 2) + '\n');
  console.log(`[skill] ${archivePath} (${result.archive.length} bytes, sha256 ${result.manifest.archive.sha256})`);
  console.log(`[skill] ${manifestPath}`);
  return 0;
}

const __isMain = typeof process.argv[1] === 'string' && pathToFileURL(process.argv[1]).href === import.meta.url;
if (__isMain) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(`[skill] ${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  });
}

export { buildSkillArchive };
