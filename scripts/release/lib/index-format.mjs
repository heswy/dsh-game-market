/**
 * DSH plugin market index **format 1** — strict local generator + validator.
 *
 * The format is defined by the public DSH plugin market index format (the
 * format Agent Note referenced from the public `@deepseek-ai/dsh-plugin-market-index`
 * README) and consumed by DSH's market through `parseMarketIndex` /
 * `marketInstallTarget`. This project must not vendor DSH private code, so this
 * module is an independent implementation of the *documented rules* needed by
 * the release tooling, with attribution:
 *
 *   - `@deepseek-ai/dsh-plugin-market-index` README (public package, version
 *     0.2.1-rc.2) documents: `parseMarketIndex(value, indexUrl)` throws a
 *     `MarketIndexError` carrying a JSON path for the first violated rule;
 *     `marketInstallTarget(name, version)` returns the exact install spec.
 *   - The validator below re-implements the public constraints (format 1,
 *     localized text, exact SemVer, git source with a lowercase 40-hex commit,
 *     UUID-free HTTPS canonical git URL, engines.dsh SemVer range, integer
 *     publishTimestamp) for the fixed official index this repository owns.
 *     It is intentionally narrower than the public reader: it accepts the
 *     documented shape this generator emits and rejects anything else, so a
 *     malformed index fails here instead of in a user's DSH.
 *
 * Self-reference rule (decisions §5): the index is a mutable discovery entry
 * committed in a *separate* commit I referencing the immutable release commit R.
 * R must never contain an index that points at R — a commit cannot contain its
 * own hash, and mixing discovery metadata into the install target would make
 * "same version" mutable.
 */
import {
  INDEX_FORMAT,
  PLUGIN_AUTHOR,
  PLUGIN_DESCRIPTION,
  PLUGIN_NAME,
  PLUGIN_TITLE,
  REPO_URL,
  sourceUrl,
} from './constants.mjs';
import { fail } from './errors.mjs';
import { isValidComparatorRange, isValidVersion } from './semver.mjs';

const LANGUAGE_ID = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/u;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u;
const PACKAGE_NAME_MAX_LENGTH = 214;
const COMMIT = /^[0-9a-f]{40}$/u;
const PATH_SEGMENT = /^[A-Za-z0-9._@+-]+$/u;
const MAX_PUBLISH_TIMESTAMP = 1e11;
const MAX_INLINE_ICON_BYTES = 32 * 1024;
const DATA_ICON = /^data:(?:image\/svg\+xml|image\/png|image\/jpeg|image\/webp);base64,([A-Za-z0-9+/]*={0,2})$/u;

/** Build the complete format-1 index document for the fixed official index. */
export function buildPluginIndex({ version, commit, publishTimestamp, engineDsh }) {
  if (!isValidVersion(version)) fail('E_RELEASE_INDEX_INVALID', `cannot emit index for invalid version ${JSON.stringify(version)}`);
  if (typeof commit !== 'string' || !COMMIT.test(commit)) {
    fail('E_RELEASE_INDEX_INVALID', 'cannot emit index without a full 40-hex commit');
  }
  if (!Number.isInteger(publishTimestamp) || publishTimestamp < 0 || publishTimestamp >= MAX_PUBLISH_TIMESTAMP) {
    fail('E_RELEASE_INDEX_INVALID', 'publishTimestamp must be an integer number of Unix seconds');
  }
  return {
    format: INDEX_FORMAT,
    title: PLUGIN_TITLE,
    description: PLUGIN_DESCRIPTION,
    plugins: [
      {
        name: PLUGIN_NAME,
        title: PLUGIN_TITLE,
        description: PLUGIN_DESCRIPTION,
        author: PLUGIN_AUTHOR,
        homepage: REPO_URL,
        repository: { url: REPO_URL },
        versions: [
          {
            version,
            publishTimestamp,
            source: { type: 'git', url: sourceUrl(), commit },
            engines: { dsh: engineDsh },
          },
        ],
      },
    ],
  };
}

/** Deterministic index serialisation (two-space JSON, trailing newline). */
export function serializePluginIndex(index) {
  return `${JSON.stringify(index, null, 2)}\n`;
}

/**
 * Strict validation of a parsed format-1 index document.
 *
 * @param {unknown} value
 * @param {{expect?: {commit?: string, version?: string}}} [options]
 * @returns {{ok: boolean, errors: Array<{code: string, message: string, path: string}>}}
 */
export function validatePluginIndex(value, options = {}) {
  const errors = [];
  const add = (code, message, path = '$') => errors.push({ code, message, path });
  const object = (candidate, path) => {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      add('E_RELEASE_INDEX_INVALID', 'must be a JSON object', path);
      return false;
    }
    return true;
  };
  const onlyKeys = (candidate, allowed, path) => {
    for (const key of Object.keys(candidate)) {
      if (!allowed.has(key)) add('E_RELEASE_INDEX_INVALID', `unexpected member ${JSON.stringify(key)}`, `${path}.${key}`);
    }
  };

  if (!object(value, '$')) return { ok: false, errors };
  onlyKeys(value, new Set(['format', 'title', 'description', 'plugins', 'metadata']), '$');
  if (value.format !== INDEX_FORMAT) add('E_RELEASE_INDEX_INVALID', `format must be ${String(INDEX_FORMAT)}`, '$.format');
  if (!localized(value.title, '$.title', add)) { /* reported */ }
  if (value.description !== undefined) localized(value.description, '$.description', add);
  if (value.metadata !== undefined && !object(value.metadata, '$.metadata')) { /* reported */ }
  if (!Array.isArray(value.plugins)) {
    add('E_RELEASE_INDEX_INVALID', 'plugins must be an array', '$.plugins');
    return { ok: false, errors };
  }
  const names = new Set();
  value.plugins.forEach((plugin, position) => {
    const path = `$.plugins[${String(position)}]`;
    if (!object(plugin, path)) return;
    onlyKeys(plugin, new Set(['name', 'title', 'description', 'icon', 'author', 'homepage', 'repository', 'metadata', 'versions']), path);
    if (typeof plugin.name !== 'string' || plugin.name.length > PACKAGE_NAME_MAX_LENGTH || !PACKAGE_NAME.test(plugin.name)) {
      add('E_RELEASE_INDEX_INVALID', 'name must be a valid npm package name', `${path}.name`);
    } else if (names.has(plugin.name)) {
      add('E_RELEASE_INDEX_INVALID', `duplicates ${plugin.name}`, `${path}.name`);
    } else {
      names.add(plugin.name);
    }
    if (plugin.title !== undefined) localized(plugin.title, `${path}.title`, add);
    if (plugin.description !== undefined) localized(plugin.description, `${path}.description`, add);
    if (plugin.author !== undefined && (typeof plugin.author !== 'string' || plugin.author.trim() === '')) {
      add('E_RELEASE_INDEX_INVALID', 'author must be a non-empty string', `${path}.author`);
    }
    if (plugin.homepage !== undefined) absoluteHttpUrl(plugin.homepage, `${path}.homepage`, add, true);
    if (plugin.icon !== undefined) icon(plugin.icon, `${path}.icon`, add);
    if (plugin.repository !== undefined) {
      if (object(plugin.repository, `${path}.repository`)) {
        absoluteHttpUrl(plugin.repository.url, `${path}.repository.url`, add, true);
        if (plugin.repository.directory !== undefined) packagePath(plugin.repository.directory, `${path}.repository.directory`, add);
        onlyKeys(plugin.repository, new Set(['url', 'directory']), `${path}.repository`);
      }
    }
    if (plugin.metadata !== undefined && !object(plugin.metadata, `${path}.metadata`)) { /* reported */ }
    if (!Array.isArray(plugin.versions) || plugin.versions.length === 0) {
      add('E_RELEASE_INDEX_INVALID', 'versions must be a non-empty array', `${path}.versions`);
      return;
    }
    const seen = new Set();
    plugin.versions.forEach((version, index) => {
      const at = `${path}.versions[${String(index)}]`;
      if (!object(version, at)) return;
      onlyKeys(version, new Set(['version', 'publishTimestamp', 'source', 'engines']), at);
      if (!isValidVersion(version.version)) {
        add('E_RELEASE_INDEX_INVALID', 'version must be an exact SemVer version', `${at}.version`);
      } else if (seen.has(version.version)) {
        add('E_RELEASE_INDEX_INVALID', `duplicates ${version.version}`, `${at}.version`);
      } else {
        seen.add(version.version);
      }
      if (!Number.isInteger(version.publishTimestamp) || version.publishTimestamp < 0 || version.publishTimestamp >= MAX_PUBLISH_TIMESTAMP) {
        add('E_RELEASE_INDEX_INVALID', 'publishTimestamp must be an integer number of Unix seconds in [0, 10^11)', `${at}.publishTimestamp`);
      }
      if (object(version.source, `${at}.source`)) source(version.source, `${at}.source`, add);
      if (version.engines !== undefined) {
        if (object(version.engines, `${at}.engines`)) {
          onlyKeys(version.engines, new Set(['dsh']), `${at}.engines`);
          if (version.engines.dsh !== undefined) {
            if (typeof version.engines.dsh !== 'string' || version.engines.dsh.trim().startsWith('workspace:') || !isValidComparatorRange(version.engines.dsh)) {
              add('E_RELEASE_INDEX_INVALID', 'engines.dsh must be a SemVer range', `${at}.engines.dsh`);
            }
          }
        }
      }
    });
  });

  const expect = options.expect || {};
  if (expect.commit !== undefined) {
    const commits = collectIndexCommits(value);
    if (!commits.includes(expect.commit)) {
      add('E_RELEASE_INDEX_INVALID', `index does not pin the expected commit ${expect.commit}`, '$.plugins');
    }
  }
  if (expect.version !== undefined) {
    const versions = collectIndexVersions(value);
    if (!versions.includes(expect.version)) {
      add('E_RELEASE_INDEX_INVALID', `index does not pin the expected version ${expect.version}`, '$.plugins');
    }
  }
  return { ok: errors.length === 0, errors };

  function localized(candidate, path, report) {
    if (typeof candidate === 'string') {
      if (candidate.trim() === '') report('E_RELEASE_INDEX_INVALID', 'must be a non-empty string', path);
      return true;
    }
    if (!object(candidate, path)) return false;
    let hasEnglish = false;
    for (const [language, text] of Object.entries(candidate)) {
      if (!LANGUAGE_ID.test(language)) report('E_RELEASE_INDEX_INVALID', 'keys must be lowercase language ids', `${path}.${language}`);
      if (typeof text !== 'string' || text.trim() === '') report('E_RELEASE_INDEX_INVALID', 'must be a non-empty string', `${path}.${language}`);
      if (language === 'en') hasEnglish = true;
    }
    if (!hasEnglish) report('E_RELEASE_INDEX_INVALID', 'localized text must contain en', path);
    return true;
  }

  function absoluteHttpUrl(candidate, path, report, allowHttp) {
    if (typeof candidate !== 'string' || candidate.trim() === '') {
      report('E_RELEASE_INDEX_INVALID', 'must be an absolute URL string', path);
      return;
    }
    let url;
    try {
      url = new URL(candidate);
    } catch {
      report('E_RELEASE_INDEX_INVALID', 'must be an absolute URL', path);
      return;
    }
    const protocols = allowHttp ? ['https:', 'http:'] : ['https:'];
    if (!protocols.includes(url.protocol)) report('E_RELEASE_INDEX_INVALID', `must use ${protocols.join(' or ')}`, path);
    if (url.username !== '' || url.password !== '') report('E_RELEASE_INDEX_INVALID', 'must not contain credentials', path);
  }

  function packagePath(candidate, path, report) {
    if (typeof candidate !== 'string' || candidate.trim() === '') {
      report('E_RELEASE_INDEX_INVALID', 'must be a relative directory string', path);
      return;
    }
    if (candidate.split('/').some((segment) => segment === '.' || segment === '..' || !PATH_SEGMENT.test(segment))) {
      report('E_RELEASE_INDEX_INVALID', 'must be a relative directory of safe segments', path);
    }
  }

  function icon(candidate, path, report) {
    if (typeof candidate !== 'string' || candidate.trim() === '') {
      report('E_RELEASE_INDEX_INVALID', 'icon must be a URL or data URL', path);
      return;
    }
    if (candidate.startsWith('data:')) {
      const payload = DATA_ICON.exec(candidate)?.[1];
      if (payload === undefined || payload === '') {
        report('E_RELEASE_INDEX_INVALID', 'icon data URL must be base64 SVG, PNG, JPEG or WebP', path);
        return;
      }
      const decoded = Math.floor((payload.length / 4) * 3)
        - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0);
      if (decoded > MAX_INLINE_ICON_BYTES) report('E_RELEASE_INDEX_INVALID', 'icon data URL exceeds 32 KiB decoded', path);
      return;
    }
    absoluteHttpUrl(candidate, path, report, false);
  }

  function source(candidate, path, report) {
    if (candidate.type === 'npm') {
      onlyKeys(candidate, new Set(['type', 'registry']), path);
      if (candidate.registry !== undefined) absoluteHttpUrl(candidate.registry, `${path}.registry`, report, true);
      return;
    }
    if (candidate.type !== 'git') {
      report('E_RELEASE_INDEX_INVALID', 'source.type must be "npm" or "git"', `${path}.type`);
      return;
    }
    onlyKeys(candidate, new Set(['type', 'url', 'commit', 'path']), path);
    if (typeof candidate.url !== 'string') {
      report('E_RELEASE_INDEX_INVALID', 'source.url must be a string', `${path}.url`);
    } else {
      let url;
      try {
        url = new URL(candidate.url);
      } catch {
        report('E_RELEASE_INDEX_INVALID', 'source.url must be an absolute URL', `${path}.url`);
        url = null;
      }
      if (url) {
        if (url.protocol !== 'https:') report('E_RELEASE_INDEX_INVALID', 'source.url must use https:', `${path}.url`);
        if (url.username !== '' || url.password !== '') report('E_RELEASE_INDEX_INVALID', 'source.url must not contain credentials', `${path}.url`);
        if (url.href.includes('?') || url.href.includes('#')) report('E_RELEASE_INDEX_INVALID', 'source.url must not contain a query or fragment', `${path}.url`);
        if (url.href !== candidate.url) report('E_RELEASE_INDEX_INVALID', 'source.url must be a canonical URL', `${path}.url`);
        if (!/^(?:\/[^/]+){2,}$/u.test(url.pathname)) report('E_RELEASE_INDEX_INVALID', 'source.url must name a repository', `${path}.url`);
        if (/\.(?:tgz|tar\.gz)$/iu.test(url.pathname)) report('E_RELEASE_INDEX_INVALID', 'source.url must name a repository, not a tarball', `${path}.url`);
      }
    }
    if (typeof candidate.commit !== 'string' || !COMMIT.test(candidate.commit)) {
      report('E_RELEASE_INDEX_INVALID', 'source.commit must be a lowercase 40-hex commit SHA', `${path}.commit`);
    }
    if (candidate.path !== undefined) packagePath(candidate.path, `${path}.path`, report);
  }
}

/** Validate and return the index, throwing the first error as a `ReleaseError`. */
export function assertPluginIndex(value, options = {}) {
  const result = validatePluginIndex(value, options);
  if (result.ok) return value;
  const first = result.errors[0];
  fail('E_RELEASE_INDEX_INVALID', `${first.path}: ${first.message}`, {
    guidance: 'the index is generated by release:promote; never hand-edit the emitted document',
    details: { errors: result.errors },
  });
}

/** Collect every git source commit pinned by an index (tolerant of malformed input). */
export function collectIndexCommits(index) {
  const commits = [];
  try {
    for (const plugin of index.plugins || []) {
      for (const version of plugin.versions || []) {
        if (version && version.source && version.source.type === 'git' && typeof version.source.commit === 'string') {
          commits.push(version.source.commit);
        }
      }
    }
  } catch {
    // malformed input: callers validate first when they need structured errors
  }
  return commits;
}

/** Collect every version string in an index (tolerant of malformed input). */
export function collectIndexVersions(index) {
  const versions = [];
  try {
    for (const plugin of index.plugins || []) {
      for (const version of plugin.versions || []) {
        if (version && typeof version.version === 'string') versions.push(version.version);
      }
    }
  } catch {
    // malformed input: callers validate first
  }
  return versions;
}

/**
 * True when the index document pins `commit` — used to reject an index that a
 * commit would have to contain together with its own hash (self-reference).
 */
export function indexReferencesCommit(index, commit) {
  return collectIndexCommits(index).includes(commit);
}

/**
 * Install spec for a validated version, mirroring the public
 * `marketInstallTarget` contract (git: `git+<url>.git#<commit>`).
 */
export function installTargetFor(name, version) {
  const from = version.source;
  if (from.type === 'npm') {
    return {
      spec: `${name}@${version.version}`,
      ...(from.registry === undefined ? {} : { registry: from.registry }),
    };
  }
  const url = from.url.endsWith('.git') ? from.url : `${from.url}.git`;
  return { spec: `git+${url}#${from.commit}${from.path === undefined ? '' : `&path:/${from.path}`}` };
}
