/** Locale-aware formatting helpers (no host DOM reads). */

/** Browser locale for `Intl`; zh-first fallback keeps V0 copy consistent. */
export function preferredLocale() {
  try {
    const nav = globalThis.navigator;
    if (nav && typeof nav.language === 'string' && nav.language.length > 0) {
      return nav.language.toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
    }
  } catch (_error) {
    // Optional browser global.
  }
  return 'zh';
}

/** Grouped score text; invalid values render as an empty string. */
export function formatScore(value, locale) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  try {
    return new Intl.NumberFormat(locale || preferredLocale(), { maximumFractionDigits: 0 }).format(value);
  } catch (_error) {
    return String(Math.round(value));
  }
}

/** Relative time used by cards and the resume menu subtitle. */
export function formatRelativeTime(iso, now, locale) {
  if (typeof iso !== 'string' || iso.length === 0) return '';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const clock = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  const diffSeconds = Math.round((then - clock) / 1000);
  const abs = Math.abs(diffSeconds);
  let value = diffSeconds;
  let unit = 'second';
  if (abs >= 86400 * 30) {
    value = Math.round(diffSeconds / (86400 * 30));
    unit = 'month';
  } else if (abs >= 86400) {
    value = Math.round(diffSeconds / 86400);
    unit = 'day';
  } else if (abs >= 3600) {
    value = Math.round(diffSeconds / 3600);
    unit = 'hour';
  } else if (abs >= 60) {
    value = Math.round(diffSeconds / 60);
    unit = 'minute';
  }
  try {
    return new Intl.RelativeTimeFormat(locale || preferredLocale(), { numeric: 'auto' }).format(value, unit);
  } catch (_error) {
    return '';
  }
}

/** First manifest category, title-cased for the compact card metadata line. */
export function formatCategory(categories) {
  if (!Array.isArray(categories) || categories.length === 0) return '';
  const first = categories.find(function text(value) {
    return typeof value === 'string' && value.length > 0;
  });
  if (!first) return '';
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/** Locale-normalized category id: lowercase, validated against the enum. */
export function normalizeCategory(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : '';
}

/** Human byte size for the detail metadata row (1.4 MB / 482 KB / 912 B). */
export function formatBytes(value, locale) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const maximumFractionDigits = index === 0 ? 0 : size >= 100 ? 0 : 1;
  try {
    return new Intl.NumberFormat(locale || preferredLocale(), {
      maximumFractionDigits: maximumFractionDigits,
      minimumFractionDigits: 0,
    }).format(size) + ' ' + units[index];
  } catch (_error) {
    return String(Math.round(size)) + ' ' + units[index];
  }
}

/** Absolute date used only in `title` tooltips (PRD 9.4.2). */
export function formatAbsoluteTime(iso, locale) {
  if (typeof iso !== 'string' || iso.length === 0) return '';
  const value = Date.parse(iso);
  if (!Number.isFinite(value)) return '';
  try {
    return new Intl.DateTimeFormat(locale || preferredLocale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch (_error) {
    try {
      return new Date(value).toISOString();
    } catch (_inner) {
      return '';
    }
  }
}

/** Integer count for result lines and metadata. */
export function formatCount(value, locale) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  try {
    return new Intl.NumberFormat(locale || preferredLocale(), { maximumFractionDigits: 0 }).format(value);
  } catch (_error) {
    return String(Math.round(value));
  }
}

/** Clamp a percentage into 0..100, or return null when unknown. */
export function clampPercent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value <= 0) return 0;
  if (value >= 100) return 100;
  return Math.round(value);
}
