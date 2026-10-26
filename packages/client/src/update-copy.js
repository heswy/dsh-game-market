import { formatRelativeTime } from './format.js';
import { errorTextKey, updateActionErrorKey } from './errors-text.js';

/**
 * Copy model for the platform-update confirmation dialog.
 *
 * Kept pure and separate from React so tests can assert the binding copy:
 * the update affects ALL sessions in the current profile, may require a DSH
 * restart, and names the exact target version + full 40-hex commit.
 */

function text(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * @param {object} dialog store dialog (`kind: 'platform-update'`)
 * @param {Function} t translator
 * @returns {{title:string, body:string, meta:Array<{label:string,value:string,mono:boolean}>,
 *   warnings:string[], primary:string, busyLabel:string}}
 */
export function platformUpdateDialogCopy(dialog, t) {
  const input = dialog && typeof dialog === 'object' ? dialog : {};
  const version = text(input.targetVersion) || t('update.identity.unknown');
  const targetCommit = text(input.targetCommit);
  const currentVersion = text(input.currentVersion);
  const channel = text(input.channel);
  const meta = [];
  meta.push({ label: t('update.confirm.current'), value: currentVersion || t('update.identity.unknown'), mono: false });
  meta.push({ label: t('update.confirm.target'), value: version, mono: false });
  meta.push({
    label: t('update.confirm.targetCommit'),
    value: targetCommit || t('update.identity.commitMissing'),
    mono: targetCommit !== null,
  });
  if (channel !== null) {
    meta.push({ label: t('update.confirm.channel'), value: channelLabel(channel, t), mono: false });
  }
  const warnings = [t('update.confirm.allSessions'), t('update.confirm.mayRestart')];
  if (input.restartPossible === true) warnings.push(t('update.confirm.restartNote'));
  return {
    title: t('update.confirm.title', { version: version }),
    body: t('update.confirm.body'),
    meta: meta,
    warnings: warnings,
    primary: t('update.confirm.primary'),
    busyLabel: t('update.confirm.busy'),
  };
}

/** Localized channel label; unknown channels are shown verbatim. */
export function channelLabel(channel, t) {
  if (channel === 'stable') return t('update.channel.stable');
  if (channel === 'test') return t('update.channel.test');
  if (typeof channel === 'string' && channel.length > 0) return channel;
  return t('update.channel.unknown');
}

/** Short commit for compact rows (full value still available in title/data). */
export function shortCommit(commit) {
  if (typeof commit !== 'string' || commit.length === 0) return null;
  return commit.length > 12 ? commit.slice(0, 12) : commit;
}

/**
 * Pure discovery summary used by the section and its tests.
 * @returns {{key:string, params:object, tone:'neutral'|'info'|'positive'|'warn', meta:string|null}}
 */
export function describeDiscovery(view, t, locale, now) {
  const lastSuccessAt = view.discovery && view.discovery.lastSuccessAt;
  const lastSuccess = lastSuccessAt
    ? t('update.discovery.lastSuccess', { time: formatRelativeTime(lastSuccessAt, now, locale) })
    : null;
  if (!view.inspection) {
    if (view.status === 'error') {
      const code = view.error ? view.error.code : null;
      return {
        key: code ? updateActionErrorKey(code) : 'update.discovery.error',
        params: {},
        tone: 'warn',
        meta: null,
      };
    }
    return { key: 'update.discovery.checking', params: {}, tone: 'neutral', meta: null };
  }
  const discovery = view.discovery;
  const comparison = discovery.comparison;
  if (discovery.state === 'checking') return { key: 'update.discovery.checking', params: {}, tone: 'neutral', meta: null };
  if (discovery.state === 'never') return { key: 'update.discovery.never', params: {}, tone: 'neutral', meta: null };
  if (discovery.state === 'offline') {
    return { key: 'update.discovery.offline', params: {}, tone: 'warn', meta: lastSuccess };
  }
  if (discovery.state === 'stale') {
    return { key: 'update.discovery.stale', params: {}, tone: 'warn', meta: lastSuccess };
  }
  if (discovery.state === 'invalid') {
    return { key: 'update.discovery.invalid', params: {}, tone: 'warn', meta: lastSuccess };
  }
  if (discovery.state === 'error') {
    const code = discovery.error ? discovery.error.code : null;
    return {
      key: code ? updateActionErrorKey(code) : 'update.discovery.error',
      params: {},
      tone: 'warn',
      meta: lastSuccess,
    };
  }
  if (comparison === 'available') {
    const target = view.update.target;
    if (view.update.currentVersion) {
      return {
        key: 'update.discovery.available',
        params: { fromVersion: view.update.currentVersion, toVersion: target ? target.version : '' },
        tone: 'info',
        meta: lastSuccess,
      };
    }
    return {
      key: 'update.discovery.availableUnknownFrom',
      params: { toVersion: target ? target.version : '' },
      tone: 'info',
      meta: lastSuccess,
    };
  }
  if (comparison === 'up-to-date') return { key: 'update.discovery.ready', params: {}, tone: 'positive', meta: lastSuccess };
  if (comparison === 'no-target') return { key: 'update.discovery.noTarget', params: {}, tone: 'neutral', meta: lastSuccess };
  return { key: 'update.discovery.unknown', params: {}, tone: 'neutral', meta: lastSuccess };
}
