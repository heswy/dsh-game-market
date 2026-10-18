/**
 * `dsh-game publish`: offline registry publishing (PRD §8.2.8 / §8.8).
 *
 * Produces, without any network call:
 *   - `registry-entry.json`  a ready-to-paste `registry/games.json` entry
 *   - `upload-plan.md`       package upload target + commands
 *   - `review-checklist.md`  automatic + manual review checklist
 *   - optionally merges the entry into `<registry-dir>/registry/games.json`
 *
 * The generated entry is validated with the same Registry schema the Host uses
 * (`packages/shared/src/registry.js`), so "paste-able" really means valid.
 */

import fs from 'node:fs';
import path from 'node:path';

import { extractManifest, packageFileName } from '../../../packages/shared/src/manifest.js';
import { DEFAULT_ALLOWED_HOSTS, validateRegistry, validateRegistryGame } from '../../../packages/shared/src/registry.js';
import { ValidationFailure, usageError } from './cli-error.mjs';
import { fileExists, readText, sha256Hex, writeText } from './fs-utils.mjs';
import { makeReport } from './issues.mjs';
import { resolvePackInput } from './pack.mjs';
import { loadProjectManifest } from './project.mjs';
import { validateFile } from './validator.mjs';

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function readManifestFromPackage(html, source) {
  const extracted = extractManifest(html);
  if (!extracted.ok) {
    throw new ValidationFailure(
      makeReport({
        errors: [{ code: 'E_PKG_MANIFEST_MISSING', message: 'package has no inline manifest', field: 'manifest' }],
        source,
      }),
      source
    );
  }
  try {
    return JSON.parse(extracted.jsonText);
  } catch (error) {
    throw new ValidationFailure(
      makeReport({
        errors: [{ code: 'E_PKG_MANIFEST_JSON', message: `inline manifest is not JSON: ${error.message}`, field: 'manifest' }],
        source,
      }),
      source
    );
  }
}

function readDigest(digestFile, sha256, fileName) {
  const text = readText(digestFile);
  const match = /^([a-f0-9]{64})\s+\*?(.+?)\s*$/.exec(text.trim());
  if (!match) throw usageError(`Invalid .sha256 file: ${digestFile}`, 'Regenerate with `dsh-game pack`.');
  if (match[1] !== sha256) {
    throw new ValidationFailure(
      makeReport({
        errors: [
          {
            code: 'E_INSTALL_HASH_MISMATCH',
            message: `sha256 file ${match[1]} does not match package ${sha256}`,
            field: 'package.sha256',
          },
        ],
        source: digestFile,
      }),
      digestFile
    );
  }
  return { digest: match[1], fileName: match[2], fileNameMatches: match[2] === fileName };
}

function buildEntry(manifest, info, options) {
  const sourceType = options.fileRegistry ? 'file' : 'https';
  const entry = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    author: manifest.author,
    categories: manifest.categories,
    capabilities: manifest.capabilities,
    sdkVersion: manifest.sdkVersion,
    runtimeVersion: manifest.runtimeVersion,
    ...(manifest.tags === undefined ? {} : { tags: manifest.tags }),
    ...(manifest.preferredTheme === undefined ? {} : { preferredTheme: manifest.preferredTheme }),
    ...((options.homepage || manifest.homepage) === undefined ? {} : { homepage: options.homepage || manifest.homepage }),
    ...((options.repository || manifest.repository) === undefined
      ? {}
      : { repository: options.repository || manifest.repository }),
    ...((options.license || manifest.license) === undefined ? {} : { license: options.license || manifest.license }),
    package: {
      url: options.url,
      sha256: info.sha256,
      size: info.bytes,
      releasedAt: options.releasedAt,
    },
    cover: options.cover,
    publishedAt: options.publishedAt,
    updatedAt: options.updatedAt,
    ...(options.changelog ? { changelog: options.changelog } : {}),
    ...(options.featured ? { featured: true } : {}),
    ...(options.quickPlay ? { quickPlay: true } : {}),
  };
  return { entry, sourceType };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function uploadPlan({ manifest, info, entry, files }) {
  const tag = `v${manifest.version}`;
  return `# Upload plan — ${manifest.name} (${manifest.id}@${manifest.version})

Package file: \`${info.fileName}\`
Package size: ${info.bytes} bytes
SHA-256: \`${info.sha256}\`
Registry URL: ${entry.package.url}
Release tag: \`${tag}\`

## 1. Upload the package

\`\`\`bash
gh release create ${tag} \\
  ${shellQuote(info.outFile)} \\
  ${shellQuote(info.digestFile)} \\
  --title ${shellQuote(`${manifest.name} ${manifest.version}`)} \\
  --notes ${shellQuote(`Release ${manifest.version}`)}
\`\`\`

The package asset must keep the exact name \`${info.fileName}\`; the Registry
URL must end with that file name (PRD §8.8.2).

## 2. Update the registry index

Append \`${files.entry}\` to the \`games\` array of \`registry/games.json\`
(or run \`dsh-game publish --registry-dir <dir>\`), then open a pull request.

## 3. Verify

- \`sha256\` in the registry entry equals \`${info.sha256}\`.
- \`package.size\` equals \`${info.bytes}\`.
- The URL is https and its host is on the Registry allowlist.
- Install the package from the Market in a clean profile before announcing it.
`;
}

function reviewChecklist({ manifest, info, entry, digest, report }) {
  return `# Review checklist — ${manifest.name} (${manifest.id}@${manifest.version})

## Automated checks (run by \`dsh-game publish\`)

- [x] Package validates as a single-file, self-contained HTML package.
- [x] Inline manifest parses and matches manifest v1.
- [x] \`id\` / \`version\` are valid and match the package file name (\`${info.fileName}\`).
- [x] Runtime/SDK ranges are compatible with the current platform (1.0.0).
- [x] Size ${info.bytes} bytes is within the 20 MiB limit.
- [x] SHA-256 matches the \`.sha256\` sidecar: \`${info.sha256}\`.
- [x] Registry entry validates against the V1 Registry schema.
${report.warnings.length > 0 ? `- [x] ${report.warnings.length} warning(s) reviewed (see CLI output).` : '- [x] No manifest warnings.'}
${digest.fileNameMatches ? '- [x] SHA-256 sidecar file name matches the package.' : '- [ ] SHA-256 sidecar file name differs; confirm before upload.'}

## Manual review

- [ ] I have the rights to publish all code, art, audio and names in this package.
- [ ] Gameplay works with keyboard only and with a pointer where applicable.
- [ ] \`ready\` failure shows a visible error state (no white screen).
- [ ] Pause / resume / hidden / visible / before-save are handled and autosave restores state (Continue).
- [ ] Score submission handles \`GM-4006\` (out of range) visibly.
- [ ] Canvas focus, \`Tab\` leaving the canvas and window resize behave (min 320×240, DPR ≤ 2).
- [ ] No network access, external fonts, CDNs or remote images are used.
- [ ] Text is available in \`zh\` and \`en\`; \`src/i18n.js\` covers all visible strings.
- [ ] The description and categories are accurate; the cover image is licensed and https.
- [ ] Light and dark themes and reduced motion were checked inside DSH.
- [ ] The package was installed from the Market in a clean profile and played for 5 minutes.
- [ ] Uninstall keeps saves unless data deletion was explicitly requested.

## Entry under review

\`\`\`json
${JSON.stringify(entry, null, 2)}
\`\`\`
`;
}

function mergeRegistry(registryDir, entry, sourceType, generatedAt, allowedHosts) {
  const registryPath = path.join(registryDir, 'registry/games.json');
  let games = [];
  if (fileExists(registryPath)) {
    let existing;
    try {
      existing = JSON.parse(readText(registryPath));
    } catch (error) {
      throw usageError(`Existing registry is not valid JSON: ${registryPath}`, error.message);
    }
    const validated = validateRegistry(existing, { sourceType, allowedHosts });
    if (!validated.ok) {
      throw new ValidationFailure(
        makeReport({
          errors: validated.errors,
          warnings: validated.warnings,
          source: registryPath,
        }),
        registryPath
      );
    }
    games = existing.games;
  }
  const filtered = games.filter((game) => game && game.id !== entry.id);
  filtered.push(entry);
  filtered.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const registry = { registryVersion: 1, generatedAt, games: filtered };
  const validated = validateRegistry(registry, { sourceType, allowedHosts });
  if (!validated.ok) {
    throw new ValidationFailure(
      makeReport({ errors: validated.errors, warnings: validated.warnings, source: registryPath }),
      registryPath
    );
  }
  writeText(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  return registryPath;
}

/**
 * @param {string} projectDir
 * @param {{
 *   input?: string, outDir?: string, url: string, cover: string,
 *   fileRegistry?: boolean, allowedHosts?: string[],
 *   releasedAt?: string, publishedAt?: string, updatedAt?: string, generatedAt?: string,
 *   changelog?: string, featured?: boolean, quickPlay?: boolean,
 *   registryDir?: string, rehash?: boolean, write?: boolean
 * }} options
 */
export async function publishProject(projectDir, options = {}) {
  const root = path.resolve(projectDir);
  if (!options.url) throw usageError('publish requires --url <package URL>', 'The URL must end with <id>-<version>.html.');
  if (!options.cover) throw usageError('publish requires --cover <https cover image URL>', 'Registry entries require a cover preview URL.');
  if (options.fileRegistry && /^https?:/i.test(options.url)) {
    throw usageError('--file-registry expects a relative package URL inside the registry directory.');
  }
  if (!options.fileRegistry && !/^https:\/\//i.test(options.url)) {
    throw usageError('publish --url must be an absolute https URL (or pass --file-registry with a relative path).');
  }

  let input = options.input ? resolvePackInput(root, options.input) : null;
  if (!input) {
    let packed = null;
    try {
      const loaded = loadProjectManifest(root);
      packed = path.join(root, 'dist', packageFileName(loaded.manifest.id, loaded.manifest.version));
    } catch (_error) {
      packed = null;
    }
    input = packed && fileExists(packed) ? packed : resolvePackInput(root);
  }
  let report = validateFile(input);
  if (!report.ok) throw new ValidationFailure(report, input);
  let html = readText(input);
  let manifest = readManifestFromPackage(html, input);

  const expectedName = packageFileName(manifest.id, manifest.version);
  if (path.basename(input) !== expectedName) {
    const sibling = path.join(path.dirname(input), expectedName);
    if (fileExists(sibling)) {
      const siblingReport = validateFile(sibling);
      if (!siblingReport.ok) throw new ValidationFailure(siblingReport, sibling);
      input = sibling;
      report = siblingReport;
      html = readText(input);
      manifest = readManifestFromPackage(html, input);
    }
  }
  if (path.basename(input) !== expectedName) {
    throw usageError(
      `publish expects the packed package ${expectedName}, got ${path.basename(input)}`,
      'Run `dsh-game pack` first, then publish dist/<id>-<version>.html.'
    );
  }

  const info = {
    outFile: input,
    digestFile: `${input}.sha256`,
    fileName: expectedName,
    sha256: '',
    bytes: report.bytes,
  };
  // The report does not carry the digest; read it from the sidecar (or recompute).
  const computed = sha256Hex(fs.readFileSync(input));
  info.sha256 = computed;
  if (options.rehash === true || !fileExists(info.digestFile)) {
    if (!options.rehash) {
      throw usageError(`Missing sha256 sidecar: ${info.digestFile}`, 'Run `dsh-game pack` (or pass --rehash).');
    }
    writeText(info.digestFile, `${info.sha256}  ${expectedName}\n`);
    info.digest = { digest: info.sha256, fileName: expectedName, fileNameMatches: true };
  } else {
    info.digest = readDigest(info.digestFile, computed, expectedName);
  }

  const releasedAt = options.releasedAt || nowIso();
  const publishedAt = options.publishedAt || releasedAt;
  const updatedAt = options.updatedAt || publishedAt;
  const generatedAt = options.generatedAt || updatedAt;
  const dates = { releasedAt, publishedAt, updatedAt, generatedAt };
  for (const [name, value] of Object.entries(dates)) {
    if (Number.isNaN(Date.parse(value))) throw usageError(`--${name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)} must be an ISO timestamp`);
  }

  const allowedHosts = options.allowedHosts && options.allowedHosts.length > 0 ? options.allowedHosts : [...DEFAULT_ALLOWED_HOSTS];
  const { entry, sourceType } = buildEntry(manifest, info, {
    url: options.url,
    cover: options.cover,
    releasedAt,
    publishedAt,
    updatedAt,
    changelog: options.changelog,
    featured: options.featured,
    quickPlay: options.quickPlay,
    fileRegistry: options.fileRegistry,
    homepage: options.homepage,
    repository: options.repository,
    license: options.license,
  });
  const entryCheck = validateRegistryGame(entry, { sourceType, allowedHosts });
  if (!entryCheck.ok) {
    throw new ValidationFailure(
      makeReport({ errors: entryCheck.errors, warnings: entryCheck.warnings, source: 'registry entry' }),
      'registry entry'
    );
  }

  const outDir = options.outDir ? path.resolve(options.outDir) : path.dirname(input);
  const files = {
    entry: path.join(outDir, 'registry-entry.json'),
    upload: path.join(outDir, 'upload-plan.md'),
    checklist: path.join(outDir, 'review-checklist.md'),
  };

  if (options.write !== false) {
    const entryText = `${JSON.stringify(entry, null, 2)}\n`;
    writeText(files.entry, entryText);
    writeText(files.upload, uploadPlan({ manifest, info, entry, files }));
    writeText(
      files.checklist,
      reviewChecklist({ manifest, info, entry, digest: info.digest, report })
    );
  }

  let registryPath = null;
  if (options.registryDir) {
    const registryDir = path.resolve(options.registryDir);
    registryPath = mergeRegistry(registryDir, entry, sourceType, generatedAt, allowedHosts);
  }

  return {
    ok: true,
    id: manifest.id,
    version: manifest.version,
    entry,
    info,
    dates,
    sourceType,
    files,
    registryPath,
    warnings: report.warnings,
  };
}
