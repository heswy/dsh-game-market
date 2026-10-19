/** Theme-token CSS for every plugin surface. Rendered inside the components. */
import React from 'react';

const h = React.createElement;

export const CSS = `
.dgm-root,
.dgm-entry-view {
  --dgm-bg: var(--dsw-alias-bg-base, #ffffff);
  --dgm-fg: var(--dsw-alias-label-primary, #1f2328);
  --dgm-fg-secondary: var(--dsw-alias-label-secondary, #5c6470);
  --dgm-fg-tertiary: var(--dsw-alias-label-tertiary, #7a828e);
  --dgm-border: var(--dsw-alias-border-l1, rgba(31, 35, 40, 0.12));
  --dgm-border-strong: var(--dsw-alias-border-l2, rgba(31, 35, 40, 0.2));
  --dgm-surface: var(--dsw-alias-bg-layer-1, #f6f7f9);
  --dgm-overlay: var(--dsw-alias-bg-overlay, #ffffff);
  --dgm-hover: var(--dsw-alias-interactive-bg-hover, rgba(31, 35, 40, 0.06));
  --dgm-active: var(--dsw-alias-interactive-bg-active, rgba(31, 35, 40, 0.1));
  --dgm-brand: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary, #4d6bfe));
  --dgm-danger: var(--dsw-alias-state-error-primary, #c93c37);
  --dgm-success: var(--dsw-alias-state-success-primary, #1a7f37);
  --dgm-radius-sm: 6px;
  --dgm-radius-md: 10px;
  --dgm-radius-lg: 14px;
  --dgm-radius-xl: 20px;
  --dgm-font: var(--dsw-font-family-base, var(--dsw-font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif));
  --dgm-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
  --dgm-shadow-soft: 0 1px 2px rgba(15, 18, 24, 0.06), 0 10px 28px rgba(15, 18, 24, 0.08);
  --dgm-shadow-pop: 0 2px 8px rgba(15, 18, 24, 0.12), 0 18px 44px rgba(15, 18, 24, 0.18);
  --dgm-shadow: var(--dgm-shadow-pop);
  --dgm-focus: var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4d6bfe));
  --dgm-focus-width: var(--dsw-focus-ring-width, 2px);
  --dgm-ease-out: cubic-bezier(0.2, 0, 0, 1);
}

.dgm-entry-view {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  min-height: 180px;
  color: var(--dgm-fg-tertiary);
  font: inherit;
  font-size: 13px;
}

.dgm-entry-view p { margin: 0; }

.dgm-root {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background:
    radial-gradient(120% 52% at 50% -12%, color-mix(in srgb, var(--dgm-brand) 6%, transparent), transparent 62%),
    var(--dgm-bg);
  color: var(--dgm-fg);
  font-family: var(--dgm-font);
  font-size: 13px;
  line-height: 1.5;
  container-type: inline-size;
  -webkit-font-smoothing: antialiased;
}

.dgm-root *,
.dgm-root *::before,
.dgm-root *::after,
.dgm-entry-view *,
.dgm-entry-view *::before,
.dgm-entry-view *::after { box-sizing: border-box; }

.dgm-root :focus-visible,
.dgm-entry-view :focus-visible {
  outline: var(--dgm-focus-width) solid var(--dgm-focus);
  outline-offset: 2px;
}

.dgm-root button {
  appearance: none;
  -webkit-appearance: none;
  font-family: inherit;
}

.dgm-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

/* ---------- Header (control layer) ---------- */

.dgm-header {
  position: relative;
  z-index: 12;
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
  min-height: calc(var(--dsh-frame-top-clearance, 0px) + 54px);
  padding: var(--dsh-frame-top-clearance, 0px) 20px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--dgm-fg) 8%, transparent);
  background: color-mix(in srgb, var(--dgm-bg) 92%, transparent);
  backdrop-filter: blur(14px) saturate(1.1);
}

.dgm-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.01em;
  white-space: nowrap;
  outline: none;
}

.dgm-title:focus { outline: none; }

.dgm-spacer { flex: 1 1 auto; }

.dgm-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: none;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--dgm-fg-secondary);
  cursor: pointer;
  transition: background-color 140ms ease-out, color 140ms ease-out;
}
.dgm-icon-btn:hover { background: var(--dgm-hover); color: var(--dgm-fg); }
.dgm-icon-btn:active { background: var(--dgm-active); }
.dgm-icon-btn:focus-visible { outline: var(--dgm-focus-width) solid var(--dgm-focus); outline-offset: 1px; }
.dgm-icon-btn:disabled { opacity: 0.45; cursor: default; }

.dgm-tabs {
  display: inline-flex;
  align-items: stretch;
  gap: 24px;
  height: 54px;
  margin-left: 4px;
}

.dgm-tab {
  position: relative;
  height: 100%;
  padding: 0 2px;
  border: 0;
  background: transparent;
  color: var(--dgm-fg-tertiary);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition: color 140ms ease-out;
}
.dgm-tab:hover { color: var(--dgm-fg); }
.dgm-tab[data-active='true'] { color: var(--dgm-brand); }
.dgm-tab[data-active='true']::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2.5px;
  border-radius: 999px;
  background: var(--dgm-brand);
}
.dgm-tab:focus-visible { outline: var(--dgm-focus-width) solid var(--dgm-focus); outline-offset: 1px; }

.dgm-header-search {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dgm-search {
  position: relative;
  display: flex;
  align-items: center;
  width: 200px;
  height: 32px;
  padding: 0 8px 0 9px;
  border: 1px solid var(--dgm-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--dgm-surface) 72%, transparent);
  color: var(--dgm-fg-tertiary);
  transition: border-color 140ms ease-out, background-color 140ms ease-out;
}
.dgm-search:hover { border-color: var(--dgm-border-strong); }
.dgm-search:focus-within {
  border-color: transparent;
  outline: var(--dgm-focus-width) solid var(--dgm-focus);
  outline-offset: 1px;
  background: var(--dgm-bg);
}
.dgm-search-icon { display: inline-flex; flex: none; }
.dgm-search-input {
  width: 100%;
  min-width: 0;
  height: 100%;
  padding: 0 6px;
  border: 0;
  background: transparent;
  color: var(--dgm-fg);
  font: inherit;
  font-size: 12px;
  outline: none;
}
.dgm-search-input::placeholder { color: var(--dgm-fg-tertiary); }
.dgm-search-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--dgm-hover);
  color: var(--dgm-fg-secondary);
  cursor: pointer;
}
.dgm-search-clear:hover { background: var(--dgm-active); color: var(--dgm-fg); }

.dgm-search-toggle { display: none; }

.dgm-upload {
  height: 32px;
  padding: 0 12px;
  gap: 6px;
  flex: none;
  border-color: color-mix(in srgb, var(--dgm-brand) 30%, transparent);
  background: color-mix(in srgb, var(--dgm-brand) 9%, transparent);
  color: color-mix(in srgb, var(--dgm-brand) 88%, var(--dgm-fg));
  font-size: 12px;
  font-weight: 600;
}
.dgm-upload:hover {
  background: color-mix(in srgb, var(--dgm-brand) 15%, transparent);
  border-color: color-mix(in srgb, var(--dgm-brand) 44%, transparent);
  color: var(--dgm-brand);
}
.dgm-upload svg { flex: none; }
.dgm-upload-label { white-space: nowrap; }

.dgm-header-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
  background: var(--dgm-fg-tertiary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dgm-fg-tertiary) 16%, transparent);
}

.dgm-crumbs {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 12px;
  color: var(--dgm-fg-tertiary);
}
.dgm-crumb-btn {
  border: 0;
  padding: 2px 0;
  background: transparent;
  color: var(--dgm-fg-tertiary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.dgm-crumb-btn:hover { color: var(--dgm-fg); }
.dgm-crumb-sep { opacity: 0.7; }
.dgm-crumb-current {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dgm-fg);
  font-weight: 600;
}

.dgm-header-menu-wrap { position: relative; }

/* ---------- Content shell ---------- */

.dgm-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  min-height: 32px;
  padding: 0 20px;
  border-bottom: 1px solid color-mix(in srgb, var(--dgm-fg) 7%, transparent);
  background: color-mix(in srgb, var(--dgm-brand) 7%, var(--dgm-surface));
  color: var(--dgm-fg);
  font-size: 12px;
  animation: dgm-fade 120ms ease-out;
}
.dgm-banner-icon { display: inline-flex; color: var(--dgm-brand); }
.dgm-banner-text { flex: 1 1 auto; }
.dgm-banner-action {
  border: 0;
  background: transparent;
  color: var(--dgm-brand);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
}
.dgm-banner-action:hover { background: color-mix(in srgb, var(--dgm-brand) 12%, transparent); }
.dgm-banner-action:focus-visible { outline: var(--dgm-focus-width) solid var(--dgm-focus); outline-offset: 1px; }

.dgm-content {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
.dgm-content::-webkit-scrollbar { width: 10px; }
.dgm-content::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--dgm-fg) 18%, transparent);
  border-radius: 8px;
  border: 3px solid transparent;
  background-clip: padding-box;
}
.dgm-content::-webkit-scrollbar-track { background: transparent; }

.dgm-page {
  width: 100%;
  max-width: 1120px;
  margin: 0 auto;
  padding: 24px 20px 48px;
}

/* ---------- Market home ---------- */

.dgm-home { display: flex; flex-direction: column; }

.dgm-hero {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 300px) minmax(0, 1fr);
  align-items: center;
  gap: 26px;
  min-height: 224px;
  padding: 18px;
  border-radius: var(--dgm-radius-xl);
  background:
    radial-gradient(120% 120% at 0% 0%, hsl(var(--dgm-tone-h, 220) var(--dgm-tone-s, 50%) 50% / 0.12), transparent 58%),
    color-mix(in srgb, var(--dgm-surface) 70%, transparent);
  overflow: hidden;
}

.dgm-hero-art {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: var(--dgm-radius-lg);
  overflow: hidden;
  box-shadow: var(--dgm-shadow-soft);
}
.dgm-hero-art-fade {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 62%, color-mix(in srgb, var(--dgm-bg) 26%, transparent));
  pointer-events: none;
}

.dgm-hero-copy {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
  padding-right: 20px;
}

.dgm-hero-kicker {
  margin: 0;
  color: var(--dgm-fg-secondary);
  font-family: var(--dgm-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.dgm-hero-title {
  margin: 0;
  max-width: 18ch;
  font-size: clamp(25px, 3.2cqw, 36px);
  font-weight: 600;
  line-height: 1.04;
  letter-spacing: -0.025em;
  text-wrap: balance;
}

.dgm-hero-title-btn {
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  text-align: left;
  cursor: pointer;
}
.dgm-hero-title-btn:hover { color: color-mix(in srgb, var(--dgm-fg) 82%, var(--dgm-brand)); }

.dgm-hero-meta {
  margin: 0;
  color: var(--dgm-fg-secondary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.dgm-hero-sep { margin: 0 7px; opacity: 0.6; }

.dgm-hero-status {
  margin: 0;
  color: var(--dgm-fg-tertiary);
  font-size: 12px;
}

.dgm-hero-cta {
  min-width: 128px;
  height: 38px;
  margin-top: 6px;
  font-size: 13px;
}

.dgm-hero-intro { grid-template-columns: minmax(0, 1fr) minmax(0, 320px); }
.dgm-hero-intro-copy { display: flex; flex-direction: column; gap: 10px; padding: 12px 8px 12px 12px; }
.dgm-hero-intro .dgm-hero-title { max-width: 22ch; }
.dgm-hero-body { margin: 0; color: var(--dgm-fg-secondary); font-size: 13px; max-width: 46ch; }
.dgm-hero-intro-art {
  position: relative;
  width: 100%;
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dgm-hero-intro-ring {
  position: absolute;
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--dgm-brand) 28%, transparent);
}
.dgm-hero-intro-ring-a { width: 200px; height: 200px; }
.dgm-hero-intro-ring-b { width: 138px; height: 138px; border-color: color-mix(in srgb, var(--dgm-brand) 18%, transparent); }
.dgm-hero-intro-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 74px;
  height: 74px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--dgm-brand) 12%, var(--dgm-bg));
  color: var(--dgm-brand);
  box-shadow: var(--dgm-shadow-soft);
}

.dgm-section { margin-top: 38px; }
.dgm-section:first-child { margin-top: 0; }

.dgm-section-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.dgm-section-titles { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.dgm-section-kicker {
  margin: 0;
  color: var(--dgm-fg-tertiary);
  font-family: var(--dgm-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
}
.dgm-section-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.dgm-section-meta { color: var(--dgm-fg-tertiary); font-size: 11px; }

.dgm-section-all .dgm-section-head { align-items: center; }

.dgm-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 18px;
}

/* ---------- Game card ---------- */

.dgm-card {
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 0;
  border-radius: var(--dgm-radius-lg);
  cursor: pointer;
  outline: none;
}
.dgm-card:focus-visible { outline: var(--dgm-focus-width) solid var(--dgm-focus); outline-offset: 3px; }

.dgm-card-cover {
  position: relative;
  aspect-ratio: 16 / 9;
  border-radius: var(--dgm-radius-lg);
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--dgm-fg) 8%, transparent);
  background: var(--dgm-surface);
  transition: transform 160ms var(--dgm-ease-out), box-shadow 160ms var(--dgm-ease-out);
  isolation: isolate;
}
.dgm-card:hover .dgm-card-cover,
.dgm-card:focus-visible .dgm-card-cover {
  transform: translateY(-2px);
  box-shadow: var(--dgm-shadow-soft);
}
.dgm-card:active .dgm-card-cover { transform: translateY(0) scale(0.995); }

.dgm-card-installed {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  color: #101418;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.22);
}

.dgm-card-update {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 6px;
}
.dgm-card-update-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--dgm-brand);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dgm-brand) 30%, transparent);
}
.dgm-card-update-pill {
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(16, 20, 24, 0.62);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  opacity: 0;
  transform: translateX(-2px);
  transition: opacity 140ms ease-out, transform 140ms ease-out;
  backdrop-filter: blur(6px);
  white-space: nowrap;
}
.dgm-card:hover .dgm-card-update-pill,
.dgm-card:focus-visible .dgm-card-update-pill { opacity: 1; transform: translateX(0); }

.dgm-card-play {
  position: absolute;
  right: 8px;
  bottom: 8px;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 50%;
  background: rgba(16, 20, 24, 0.52);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transform: translateY(3px);
  transition: opacity 140ms ease-out, transform 140ms ease-out, background-color 140ms ease-out;
  backdrop-filter: blur(8px);
}
.dgm-card:hover .dgm-card-play,
.dgm-card:focus-within .dgm-card-play { opacity: 1; transform: translateY(0); }
.dgm-card-play:hover { background: rgba(16, 20, 24, 0.72); }
.dgm-card-play:focus-visible { outline: 2px solid #fff; outline-offset: 1px; opacity: 1; transform: none; }

.dgm-card-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dgm-card-title {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.005em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dgm-card-builtin {
  color: var(--dgm-fg-tertiary);
  font-family: var(--dgm-mono);
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  flex: none;
}
.dgm-card-meta {
  margin: 0;
  color: var(--dgm-fg-secondary);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---------- Procedural cover ---------- */

.dgm-cover {
  position: absolute;
  inset: 0;
  display: block;
  overflow: hidden;
  background:
    radial-gradient(85% 95% at 16% 10%, hsl(var(--dgm-tone-h, 220) var(--dgm-tone-s, 50%) 62% / 0.95), transparent 62%),
    radial-gradient(95% 85% at 88% 92%, hsl(var(--dgm-tone-h2, 260) var(--dgm-tone-s, 50%) 42% / 0.95), transparent 66%),
    linear-gradient(155deg, hsl(var(--dgm-tone-h, 220) 36% 28%), hsl(var(--dgm-tone-h2, 260) 42% 14%));
}
.dgm-cover-art {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dgm-cover-initial {
  color: rgba(255, 255, 255, 0.9);
  font-family: var(--dgm-font);
  font-size: clamp(30px, 7cqw, 64px);
  font-weight: 600;
  letter-spacing: -0.04em;
  text-shadow: 0 2px 18px rgba(0, 0, 0, 0.28);
  user-select: none;
}
.dgm-cover-grain {
  position: absolute;
  inset: 0;
  opacity: 0.16;
  mix-blend-mode: overlay;
  background-image: repeating-linear-gradient(115deg, rgba(255, 255, 255, 0.5) 0 1px, transparent 1px 5px);
  pointer-events: none;
}
.dgm-cover-glyph {
  position: absolute;
  left: 10px;
  bottom: 10px;
  display: inline-flex;
  color: rgba(255, 255, 255, 0.55);
}
.dgm-cover-img {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 180ms ease-out;
}
.dgm-cover[data-loaded='true'] .dgm-cover-img { opacity: 1; }
.dgm-cover-row { position: absolute; }
.dgm-cover-row .dgm-cover-initial { font-size: 18px; }
.dgm-cover-row .dgm-cover-glyph { display: none; }
.dgm-cover-detail .dgm-cover-initial { font-size: clamp(56px, 12cqw, 132px); }

.dgm-game-icon {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  overflow: hidden;
  border-radius: var(--dgm-radius-md);
  background:
    radial-gradient(90% 90% at 20% 12%, hsl(var(--dgm-tone-h, 220) var(--dgm-tone-s, 50%) 58%), transparent 70%),
    linear-gradient(150deg, hsl(var(--dgm-tone-h, 220) 36% 30%), hsl(var(--dgm-tone-h2, 260) 42% 18%));
  color: rgba(255, 255, 255, 0.92);
  font-size: 12px;
  font-weight: 600;
}
.dgm-game-icon img { width: 100%; height: 100%; object-fit: cover; }

/* ---------- Chips ---------- */

.dgm-chips {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}
.dgm-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 11px 0 13px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--dgm-fg-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background-color 140ms ease-out, color 140ms ease-out;
}
.dgm-chip:hover { background: var(--dgm-hover); color: var(--dgm-fg); }
.dgm-chip[data-active='true'] {
  background: color-mix(in srgb, var(--dgm-brand) 12%, transparent);
  color: var(--dgm-fg);
  font-weight: 600;
}
.dgm-chip-mark {
  position: absolute;
  left: 3px;
  top: 50%;
  width: 4px;
  height: 14px;
  border-radius: 2px;
  transform: translateY(-50%);
  background: var(--dgm-brand);
}
.dgm-chip:focus-visible { outline: var(--dgm-focus-width) solid var(--dgm-focus); outline-offset: 1px; }

/* ---------- Banners, state blocks, footer ---------- */

.dgm-inline-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  margin-bottom: 16px;
  padding: 0 12px;
  border-radius: var(--dgm-radius-md);
  background: color-mix(in srgb, var(--dgm-brand) 7%, var(--dgm-surface));
  color: var(--dgm-fg-secondary);
  font-size: 12px;
}
.dgm-inline-banner-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
  background: var(--dgm-fg-tertiary);
}
.dgm-inline-banner-text { flex: 1 1 auto; }
.dgm-inline-banner-action {
  border: 0;
  background: transparent;
  padding: 3px 6px;
  border-radius: 6px;
  color: var(--dgm-fg);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.dgm-inline-banner-action:hover { background: var(--dgm-hover); }

.dgm-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 9px;
  min-height: 260px;
  padding: 28px 24px;
  text-align: center;
  color: var(--dgm-fg-secondary);
}
.dgm-state-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  margin-bottom: 4px;
  border-radius: 50%;
  background: var(--dgm-surface);
  color: var(--dgm-fg-secondary);
}
.dgm-state-title { margin: 0; color: var(--dgm-fg); font-size: 15px; font-weight: 600; outline: none; }
.dgm-state-body { margin: 0; font-size: 12px; max-width: 44ch; }
.dgm-state-code {
  margin: 0;
  color: var(--dgm-fg-tertiary);
  font-family: var(--dgm-mono);
  font-size: 10px;
  letter-spacing: 0.04em;
}
.dgm-state-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 6px; }

.dgm-spinner {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid var(--dgm-border);
  border-top-color: var(--dgm-brand);
  animation: dgm-spin 900ms linear infinite;
  flex: none;
}

.dgm-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 44px;
  padding-top: 14px;
  border-top: 1px solid color-mix(in srgb, var(--dgm-fg) 8%, transparent);
  color: var(--dgm-fg-tertiary);
  font-size: 11px;
}
.dgm-footer-text { font-variant-numeric: tabular-nums; }
.dgm-footer-offline { display: inline-flex; align-items: center; gap: 6px; }
.dgm-footer-action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  background: transparent;
  padding: 2px 4px;
  border-radius: 6px;
  color: var(--dgm-fg-tertiary);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.dgm-footer-action:hover { color: var(--dgm-fg); background: var(--dgm-hover); }

.dgm-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: currentColor;
}
.dgm-dot-waiting { background: var(--dgm-brand); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dgm-brand) 22%, transparent); }

.dgm-sep { margin: 0 6px; opacity: 0.55; }

.dgm-results-count {
  margin: 0 0 16px;
  color: var(--dgm-fg-secondary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

/* ---------- Buttons ---------- */

.dgm-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 76px;
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid var(--dgm-border-strong);
  background: transparent;
  color: var(--dgm-fg);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 130ms ease-out, border-color 130ms ease-out, filter 130ms ease-out, opacity 130ms ease-out;
}
.dgm-btn:hover { background: var(--dgm-hover); }
.dgm-btn:active { transform: translateY(0.5px); }
.dgm-btn:focus-visible { outline: var(--dgm-focus-width) solid var(--dgm-focus); outline-offset: 2px; }
.dgm-btn:disabled { opacity: 0.48; cursor: default; }
.dgm-btn-primary { border-color: transparent; background: var(--dgm-brand); color: var(--dsw-alias-label-primary-foreground, #ffffff); }
.dgm-btn-primary:hover { background: var(--dgm-brand); filter: brightness(1.06); }
.dgm-btn-primary:active { filter: brightness(0.96); }
.dgm-btn-danger { border-color: transparent; background: var(--dgm-danger); color: var(--dsw-alias-label-primary-foreground, #ffffff); }
.dgm-btn-danger:hover { background: var(--dgm-danger); filter: brightness(1.06); }
.dgm-btn-quiet { border-color: transparent; color: var(--dgm-fg-secondary); }
.dgm-btn-quiet:hover { color: var(--dgm-fg); background: var(--dgm-hover); }
.dgm-btn-ghost { border-color: transparent; background: transparent; color: var(--dgm-brand); min-width: 0; height: 28px; padding: 0 8px; }
.dgm-btn-ghost:hover { background: color-mix(in srgb, var(--dgm-brand) 10%, transparent); }
.dgm-danger-text { color: var(--dgm-danger); }
.dgm-link-btn {
  align-self: flex-start;
  border: 0;
  background: transparent;
  padding: 2px 0;
  color: var(--dgm-fg-secondary);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-color: color-mix(in srgb, var(--dgm-fg-secondary) 40%, transparent);
}
.dgm-link-btn:hover { color: var(--dgm-fg); }

/* ---------- Skeletons ---------- */

.dgm-skeleton-card { display: flex; flex-direction: column; gap: 9px; }
.dgm-skeleton-cover {
  aspect-ratio: 16 / 9;
  border-radius: var(--dgm-radius-lg);
  background: var(--dgm-surface);
  animation: dgm-shimmer 1400ms ease-in-out infinite;
}
.dgm-skeleton-line {
  display: block;
  height: 10px;
  border-radius: 6px;
  background: var(--dgm-surface);
  animation: dgm-shimmer 1400ms ease-in-out infinite;
}
.dgm-skeleton-list { display: flex; flex-direction: column; gap: 4px; }
.dgm-skeleton-row {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 72px;
  padding: 12px;
}
.dgm-skeleton-thumb { width: 64px; height: 48px; flex: none; border-radius: 10px; background: var(--dgm-surface); animation: dgm-shimmer 1400ms ease-in-out infinite; }
.dgm-skeleton-col { display: flex; flex-direction: column; gap: 8px; flex: 1 1 auto; }
.dgm-skeleton-pill { width: 76px; height: 30px; border-radius: 8px; background: var(--dgm-surface); animation: dgm-shimmer 1400ms ease-in-out infinite; }
.dgm-skeleton-hero {
  display: block;
  width: 100%;
  height: 260px;
  border-radius: var(--dgm-radius-xl);
  background: var(--dgm-surface);
  animation: dgm-shimmer 1400ms ease-in-out infinite;
}
.dgm-skeleton-detail-body { display: flex; gap: 48px; margin-top: 28px; }
.dgm-skeleton-detail-body .dgm-skeleton-col { gap: 12px; }
.dgm-skeleton-rail { width: 320px; flex: none; height: 320px; border-radius: var(--dgm-radius-lg); background: var(--dgm-surface); animation: dgm-shimmer 1400ms ease-in-out infinite; }
.dgm-skeleton-button { display: block; width: 100%; height: 40px; border-radius: 8px; background: var(--dgm-surface); animation: dgm-shimmer 1400ms ease-in-out infinite; }

/* ---------- My Games ---------- */

.dgm-mygames { max-width: 940px; margin: 0 auto; }
.dgm-list { display: flex; flex-direction: column; gap: 2px; }
.dgm-row {
  position: relative;
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  min-height: 72px;
  padding: 12px;
  border-radius: var(--dgm-radius-md);
  background: transparent;
  transition: background-color 140ms ease-out;
}
.dgm-row:hover, .dgm-row:focus-within { background: var(--dgm-hover); }
.dgm-row-cover {
  position: relative;
  width: 64px;
  height: 48px;
  padding: 0;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--dgm-fg) 8%, transparent);
  border-radius: 10px;
  background: var(--dgm-surface);
  cursor: pointer;
}
.dgm-row-cover:disabled { cursor: default; }
.dgm-row-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.dgm-row-title-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dgm-row-title-btn {
  max-width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dgm-fg);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.dgm-row-title-btn:hover { color: color-mix(in srgb, var(--dgm-fg) 78%, var(--dgm-brand)); }
.dgm-row-title-btn:disabled { cursor: default; color: var(--dgm-fg-secondary); }
.dgm-row-badge {
  flex: none;
  padding: 1px 6px;
  border: 1px solid var(--dgm-border);
  border-radius: 999px;
  color: var(--dgm-fg-tertiary);
  font-family: var(--dgm-mono);
  font-size: 9px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.dgm-row-update {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  color: var(--dgm-brand);
  font-size: 11px;
  font-weight: 600;
}
.dgm-row-update .dgm-dot { background: var(--dgm-brand); }
.dgm-row-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  margin: 0;
  color: var(--dgm-fg-secondary);
  font-size: 12px;
  min-width: 0;
}
.dgm-row-meta > span { min-width: 0; }
.dgm-row-best { color: var(--dgm-fg-tertiary); }
.dgm-row-controls { display: flex; align-items: center; gap: 8px; flex: none; }
.dgm-row-play { height: 32px; min-width: 76px; }
.dgm-row-update-btn { flex: none; }
.dgm-row-update-failed { color: var(--dgm-danger); font-size: 11px; font-weight: 600; }
.dgm-row-menu-btn { width: 28px; height: 28px; }
.dgm-row-progress { display: flex; flex-direction: column; gap: 5px; max-width: 340px; }
.dgm-row-progress-text { color: var(--dgm-fg-secondary); font-size: 11px; font-variant-numeric: tabular-nums; }

.dgm-progress-track {
  position: relative;
  width: 100%;
  height: 3px;
  overflow: hidden;
  border-radius: 3px;
  background: color-mix(in srgb, var(--dgm-fg) 12%, transparent);
}
.dgm-progress-fill {
  position: absolute;
  inset: 0;
  transform-origin: 0 50%;
  border-radius: 3px;
  background: var(--dgm-brand);
  transition: transform 200ms linear;
}
.dgm-progress-indeterminate {
  width: 42%;
  animation: dgm-indeterminate 1200ms var(--dgm-ease-out) infinite;
}

/* ---------- Menus and dialogs ---------- */

.dgm-menu {
  position: absolute;
  z-index: 30;
  top: calc(100% + 6px);
  right: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 224px;
  padding: 6px;
  border: 1px solid var(--dgm-border);
  border-radius: 12px;
  background: var(--dgm-overlay);
  box-shadow: var(--dgm-shadow-pop);
  animation: dgm-menu-in 140ms var(--dgm-ease-out);
}
.dgm-menu-header { top: calc(100% + 8px); }
.dgm-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 0 9px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dgm-fg);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.dgm-menu-item:hover { background: var(--dgm-hover); }
.dgm-menu-item[data-danger='true'] { color: var(--dgm-danger); }
.dgm-menu-item:disabled { opacity: 0.45; cursor: default; }
.dgm-menu-item:focus-visible { outline: var(--dgm-focus-width) solid var(--dgm-focus); outline-offset: -2px; }
.dgm-menu-label { flex: 1 1 auto; }
.dgm-menu-note { color: var(--dgm-fg-tertiary); font-size: 10px; }

.dgm-overlay {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(8, 10, 14, 0.34);
  animation: dgm-fade 160ms ease-out;
}
.dgm-dialog {
  width: min(380px, 100%);
  padding: 20px;
  border: 1px solid var(--dgm-border);
  border-radius: 16px;
  background: var(--dgm-overlay);
  color: var(--dgm-fg);
  box-shadow: var(--dgm-shadow-pop);
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: dgm-dialog-in 160ms var(--dgm-ease-out);
}
.dgm-dialog-title { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
.dgm-dialog-body { margin: 0; color: var(--dgm-fg-secondary); font-size: 13px; line-height: 1.55; }
.dgm-dialog-note { margin: 0; color: var(--dgm-fg-tertiary); font-size: 12px; }
.dgm-dialog-warning { margin: 0; color: var(--dgm-danger); font-size: 12px; font-weight: 600; }
.dgm-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.dgm-dialog-actions .dgm-btn { min-width: 0; }
.dgm-checkbox {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: var(--dgm-fg);
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}
.dgm-checkbox input { margin: 2px 0 0; accent-color: var(--dgm-danger); }

/* ---------- Detail ---------- */

.dgm-detail { display: flex; flex-direction: column; }
.dgm-detail-head {
  display: flex;
  align-items: center;
  gap: 20px;
  min-width: 0;
}
.dgm-detail-head-copy { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.dgm-detail-hero {
  position: relative;
  width: 224px;
  aspect-ratio: 16 / 9;
  flex: none;
  border-radius: var(--dgm-radius-lg);
  overflow: hidden;
  box-shadow: var(--dgm-shadow-soft);
}
.dgm-detail-cols {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(0, 680px) 320px;
  justify-content: space-between;
  gap: 48px;
  padding: 0 4px;
  margin-top: 20px;
}
.dgm-detail-main { display: flex; flex-direction: column; gap: 14px; min-width: 0; padding-top: 4px; }
.dgm-detail-title-line { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.dgm-detail-title {
  margin: 0;
  font-size: clamp(26px, 3cqw, 34px);
  font-weight: 600;
  letter-spacing: -0.025em;
  line-height: 1.08;
  outline: none;
  text-wrap: balance;
}
.dgm-detail-title:focus { outline: none; }
.dgm-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid var(--dgm-border);
  color: var(--dgm-fg-secondary);
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}
.dgm-pill-installed { color: var(--dgm-success); border-color: color-mix(in srgb, var(--dgm-success) 46%, transparent); }
.dgm-pill-update { color: var(--dgm-brand); border-color: color-mix(in srgb, var(--dgm-brand) 42%, transparent); }
.dgm-detail-subtitle { margin: 0; color: var(--dgm-fg-secondary); font-size: 12px; }
.dgm-detail-description {
  position: relative;
  color: var(--dgm-fg);
  font-size: 15px;
  line-height: 1.7;
  max-width: 66ch;
}
.dgm-detail-description p { margin: 0; white-space: pre-line; }
.dgm-detail-description.is-collapsed { max-height: calc(1.7em * 6); overflow: hidden; }
.dgm-detail-description.is-collapsed::after {
  content: "";
  position: absolute;
  inset: auto 0 0 0;
  height: 2.4em;
  background: linear-gradient(180deg, transparent, var(--dgm-bg));
  pointer-events: none;
}
.dgm-detail-previews { display: flex; flex-direction: column; gap: 10px; margin-top: 4px; }
.dgm-preview-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.dgm-preview-btn {
  padding: 0;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--dgm-fg) 8%, transparent);
  border-radius: 12px;
  background: var(--dgm-surface);
  cursor: zoom-in;
  transition: transform 160ms var(--dgm-ease-out), box-shadow 160ms var(--dgm-ease-out);
}
.dgm-preview-btn:hover { transform: translateY(-1px); box-shadow: var(--dgm-shadow-soft); }
.dgm-preview-btn img { width: 100%; height: 100%; object-fit: cover; display: block; }
.dgm-preview-fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 100%;
  background: var(--dgm-surface);
  color: var(--dgm-fg-tertiary);
}
.dgm-preview-fallback-initial { font-size: 24px; font-weight: 600; letter-spacing: -0.03em; }
.dgm-preview-fallback-text { font-size: 11px; }
.dgm-detail-taxonomy { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
.dgm-taxonomy-row { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.dgm-taxonomy-label {
  color: var(--dgm-fg-tertiary);
  font-family: var(--dgm-mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-right: 4px;
}
.dgm-tag {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--dgm-surface);
  color: var(--dgm-fg-secondary);
  font-size: 11px;
}

.dgm-detail-rail {
  position: sticky;
  top: 12px;
  align-self: start;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px;
  border: 1px solid color-mix(in srgb, var(--dgm-fg) 8%, transparent);
  border-radius: 16px;
  background: color-mix(in srgb, var(--dgm-surface) 58%, transparent);
}
.dgm-primary { display: flex; flex-direction: column; gap: 8px; }
.dgm-primary-btn { width: 100%; height: 40px; font-size: 14px; }
.dgm-primary-btn[data-action='cancel-install'] { background: transparent; border-color: var(--dgm-border-strong); color: var(--dgm-fg); }
.dgm-primary-btn[data-action='cancel-install']:hover { background: var(--dgm-hover); }
.dgm-secondary-btn { width: 100%; height: 32px; }
.dgm-install-progress { display: flex; flex-direction: column; gap: 6px; }
.dgm-install-stage { margin: 0; color: var(--dgm-fg-secondary); font-size: 11px; font-variant-numeric: tabular-nums; }
.dgm-install-failure {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--dgm-danger) 9%, transparent);
}
.dgm-install-failure-reason { margin: 0; color: var(--dgm-danger); font-size: 12px; font-weight: 600; }
.dgm-install-failure-code { margin: 0; color: var(--dgm-fg-tertiary); font-family: var(--dgm-mono); font-size: 10px; }
.dgm-primary-reason { margin: 0; color: var(--dgm-fg-secondary); font-size: 12px; line-height: 1.5; }

.dgm-detail-meta {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 6px 12px;
  margin: 0;
  font-size: 12px;
}
.dgm-detail-meta dt { color: var(--dgm-fg-tertiary); }
.dgm-detail-meta dd { margin: 0; text-align: right; color: var(--dgm-fg-secondary); font-variant-numeric: tabular-nums; }

.dgm-rail-block { display: flex; flex-direction: column; gap: 6px; padding-top: 14px; border-top: 1px solid color-mix(in srgb, var(--dgm-fg) 8%, transparent); }
.dgm-rail-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--dgm-fg-tertiary);
  font-family: var(--dgm-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.dgm-rail-body { margin: 0; color: var(--dgm-fg); font-size: 12px; }
.dgm-rail-note { margin: 0; color: var(--dgm-fg-tertiary); font-size: 11px; line-height: 1.5; }
.dgm-leaderboard-best { margin: 0; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
.dgm-leaderboard-list { display: flex; flex-direction: column; gap: 4px; }
.dgm-leaderboard-row { display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-variant-numeric: tabular-nums; }
.dgm-leaderboard-value { color: var(--dgm-fg); }
.dgm-leaderboard-time { color: var(--dgm-fg-tertiary); font-size: 11px; }
.dgm-rail-actions { display: flex; flex-direction: column; gap: 2px; padding-top: 6px; }
.dgm-rail-actions .dgm-btn { justify-content: flex-start; padding-left: 0; }
.dgm-detail-error { min-height: 320px; justify-content: center; }

/* ---------- Lightbox ---------- */

.dgm-lightbox {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 56px 72px;
  background: rgba(8, 9, 11, 0.88);
  animation: dgm-fade 160ms ease-out;
}
.dgm-lightbox-bar {
  position: absolute;
  top: 14px;
  left: 18px;
  right: 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: rgba(255, 255, 255, 0.72);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.dgm-lightbox-close { color: rgba(255, 255, 255, 0.82); }
.dgm-lightbox-close:hover { background: rgba(255, 255, 255, 0.12); color: #fff; }
.dgm-lightbox-img {
  max-width: min(92vw, 1280px);
  max-height: 82vh;
  border-radius: 14px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5);
  object-fit: contain;
  background: #0b0c0e;
}
.dgm-lightbox-fallback {
  padding: 40px 56px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.72);
  font-size: 13px;
}
.dgm-lightbox-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 50%;
  background: rgba(18, 21, 26, 0.6);
  color: #fff;
  cursor: pointer;
  backdrop-filter: blur(8px);
}
.dgm-lightbox-prev { left: 18px; }
.dgm-lightbox-next { right: 18px; }
.dgm-lightbox-nav:hover { background: rgba(18, 21, 26, 0.82); }

/* ---------- Toasts ---------- */

.dgm-toasts {
  position: absolute;
  right: 20px;
  bottom: 20px;
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  pointer-events: none;
}
.dgm-toast {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  max-width: min(420px, calc(100vw - 40px));
  padding: 7px 10px 7px 12px;
  border: 1px solid var(--dgm-border);
  border-left: 3px solid var(--dgm-fg-tertiary);
  border-radius: 10px;
  background: var(--dgm-overlay);
  color: var(--dgm-fg);
  box-shadow: var(--dgm-shadow-pop);
  font-size: 12px;
  pointer-events: auto;
  animation: dgm-toast-in 180ms var(--dgm-ease-out);
}
.dgm-toast[data-kind='success'] { border-left-color: var(--dgm-success); }
.dgm-toast[data-kind='error'] { border-left-color: var(--dgm-danger); }
.dgm-toast[data-kind='info'] { border-left-color: var(--dgm-brand); }
.dgm-toast-text { flex: 1 1 auto; }
.dgm-toast-action {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  border-radius: 6px;
  padding: 3px 8px;
  background: color-mix(in srgb, var(--dgm-brand) 12%, transparent);
  color: var(--dgm-brand);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.dgm-toast-action:hover { background: color-mix(in srgb, var(--dgm-brand) 20%, transparent); }
.dgm-toast-close {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--dgm-fg-tertiary);
  cursor: pointer;
}
.dgm-toast-close:hover { background: var(--dgm-hover); color: var(--dgm-fg); }

/* ---------- Runtime (kept from V0) ---------- */

.dgm-runtime { position: relative; display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; background: #0b0c0e; }
.dgm-runtime-stage-wrap {
  flex: 1 1 auto;
  min-height: 0;
  padding: calc(var(--dsh-frame-top-clearance, 0px) + 8px) 16px 16px;
}
.dgm-stage {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 240px;
  overflow: hidden;
  border-radius: 14px;
  background: #0b0c0e;
  outline: none;
}
.dgm-stage:focus-visible { outline: var(--dgm-focus-width) solid var(--dgm-focus); outline-offset: 2px; }
.dgm-stage-canvas { position: absolute; inset: 0; }
.dgm-stage-canvas > iframe { display: block; width: 100%; height: 100%; border: 0; background: #0b0c0e; }

.dgm-runtime-controls {
  position: absolute;
  z-index: 6;
  top: calc(var(--dsh-frame-top-clearance, 0px) + 12px);
  left: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}
.dgm-runtime-controls > * { pointer-events: auto; }
.dgm-control-group {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dgm-overlay) 78%, transparent);
  border: 1px solid var(--dgm-border);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
  backdrop-filter: blur(10px);
}
.dgm-control-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--dgm-fg-secondary);
  cursor: pointer;
  transition: background-color 120ms ease-out, color 120ms ease-out;
}
.dgm-control-btn:hover { background: var(--dgm-hover); color: var(--dgm-fg); }
.dgm-control-btn:focus-visible { outline: var(--dgm-focus-width) solid var(--dgm-focus); outline-offset: 1px; }
.dgm-control-btn:disabled { opacity: 0.5; cursor: default; }

.dgm-save-pill {
  position: absolute;
  left: 50%;
  top: 0;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dgm-overlay) 86%, transparent);
  border: 1px solid var(--dgm-border);
  color: var(--dgm-fg-secondary);
  font-size: 11px;
  white-space: nowrap;
  cursor: default;
}
.dgm-save-pill[data-status='failed'] { color: var(--dgm-danger); border-color: currentColor; cursor: pointer; }
.dgm-save-pill[data-status='saving'] .dgm-save-dot { animation: dgm-pulse 900ms ease-in-out infinite; }
.dgm-save-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.dgm-save-pill[data-status='saved'] .dgm-save-dot { background: var(--dgm-success); }

.dgm-runtime-loading {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(11, 12, 14, 0.72);
  color: #f4f5f7;
  text-align: center;
  padding: 24px;
}
.dgm-runtime-loading .dgm-spinner { border-color: rgba(255, 255, 255, 0.22); border-top-color: #ffffff; }
.dgm-runtime-loading-title { margin: 0; font-size: 14px; font-weight: 500; }
.dgm-runtime-loading-body { margin: 0; font-size: 12px; color: rgba(255, 255, 255, 0.72); }
.dgm-runtime-loading-actions { display: flex; gap: 8px; }

.dgm-error-card {
  position: absolute;
  inset: 0;
  z-index: 8;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(11, 12, 14, 0.85);
}
.dgm-error-inner {
  width: min(420px, 100%);
  padding: 20px;
  border-radius: 14px;
  border: 1px solid var(--dgm-border);
  background: var(--dgm-bg);
  color: var(--dgm-fg);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dgm-error-title { margin: 0; font-size: 15px; font-weight: 600; outline: none; }
.dgm-error-body { margin: 0; color: var(--dgm-fg-secondary); font-size: 12px; }
.dgm-error-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
.dgm-diagnostic { display: flex; align-items: center; gap: 8px; margin-top: 4px; color: var(--dgm-fg-tertiary); font-size: 11px; }
.dgm-diagnostic-copy { border: 0; background: transparent; color: var(--dgm-fg-secondary); font: inherit; cursor: pointer; text-decoration: underline; }

.dgm-modal {
  width: min(340px, 100%);
  padding: 18px;
  border-radius: 14px;
  border: 1px solid var(--dgm-border);
  background: var(--dgm-overlay);
  box-shadow: var(--dgm-shadow);
  display: flex;
  flex-direction: column;
  gap: 8px;
  animation: dgm-menu-in 140ms ease-out;
}
.dgm-modal-title { margin: 0; font-size: 15px; font-weight: 600; }
.dgm-modal-body { margin: 0; color: var(--dgm-fg-secondary); font-size: 12px; }
.dgm-modal-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; margin-top: 6px; }
.dgm-modal-actions .dgm-btn { min-width: 0; }

/* ---------- Agent Presence (kept from V0) ---------- */

.dgm-presence {
  position: absolute;
  z-index: 10;
  right: 24px;
  bottom: 24px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}
.dgm-whale-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: color-mix(in srgb, var(--dgm-overlay) 76%, transparent);
  border: 1px solid var(--dgm-border);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
  cursor: pointer;
  color: var(--dgm-fg-secondary);
  transition: box-shadow 120ms ease-out, color 240ms ease-out;
}
.dgm-whale-btn:hover { box-shadow: 0 4px 18px rgba(0, 0, 0, 0.28); }
.dgm-whale-btn:focus-visible { outline: var(--dgm-focus-width) solid var(--dgm-focus); outline-offset: 2px; }
.dgm-whale-btn[data-state='waiting-user'] { color: var(--dgm-brand); animation: dgm-whale-wake 600ms ease-out; }
.dgm-whale-btn[data-state='completed'] { color: var(--dgm-success); animation: dgm-whale-rise 240ms ease-out; }
.dgm-whale-btn[data-state='error'] { color: var(--dgm-danger); animation: dgm-whale-sink 240ms ease-out; }
.dgm-whale-btn[data-state='running'] .dgm-whale { animation: dgm-breathe 4s ease-in-out infinite; transform-origin: 50% 70%; }
.dgm-whale-btn .dgm-whale-halo { opacity: 0; transition: opacity 200ms ease-out; }
.dgm-whale-btn[data-state='waiting-user'] .dgm-whale-halo { opacity: 1; animation: dgm-halo 2400ms ease-in-out infinite; }
.dgm-whale-btn[data-state='idle'] .dgm-whale,
.dgm-whale-btn[data-state='completed'] .dgm-whale,
.dgm-whale-btn[data-state='error'] .dgm-whale { animation: none; }
.dgm-whale-spout { opacity: 0; transition: opacity 200ms ease-out; }
.dgm-whale-btn[data-state='waiting-user'] .dgm-whale-spout { opacity: 1; }
.dgm-whale-btn[data-state='completed'] .dgm-whale-spout { opacity: 0.7; }

.dgm-whale-bubble {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 230px;
  max-height: 96px;
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid var(--dgm-border);
  background: color-mix(in srgb, var(--dgm-overlay) 90%, transparent);
  box-shadow: var(--dgm-shadow);
  backdrop-filter: blur(12px);
  animation: dgm-menu-in 220ms ease-out;
}
.dgm-bubble-text { margin: 0; color: var(--dgm-fg); font-size: 12px; line-height: 1.45; }
.dgm-bubble-action {
  align-self: flex-start;
  min-height: 24px;
  padding: 2px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dgm-brand);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.dgm-bubble-action:hover { background: var(--dgm-hover); }
.dgm-bubble-action:focus-visible { outline: var(--dgm-focus-width) solid var(--dgm-focus); outline-offset: 1px; }
.dgm-bubble-action:disabled { opacity: 0.55; cursor: default; }

.dgm-whale-pill {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--dgm-border);
  background: color-mix(in srgb, var(--dgm-overlay) 90%, transparent);
  color: var(--dgm-fg-secondary);
  font-size: 11px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.16);
}
.dgm-whale-pill:hover { color: var(--dgm-fg); }
.dgm-whale-pill:focus-visible { outline: var(--dgm-focus-width) solid var(--dgm-focus); outline-offset: 2px; }

.dgm-sidebar-status { pointer-events: none; }
.dgm-sidebar-dot { stroke: var(--dgm-bg, var(--dsw-alias-bg-base, #ffffff)); }

/* ---------- Keyframes ---------- */

@keyframes dgm-menu-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes dgm-dialog-in {
  from { opacity: 0; transform: translateY(6px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes dgm-toast-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes dgm-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes dgm-spin {
  to { transform: rotate(360deg); }
}
@keyframes dgm-shimmer {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
@keyframes dgm-indeterminate {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(240%); }
}
@keyframes dgm-breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.012); }
}
@keyframes dgm-halo {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}
@keyframes dgm-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
@keyframes dgm-whale-wake {
  from { transform: translateY(4px); }
  to { transform: translateY(0); }
}
@keyframes dgm-whale-rise {
  from { transform: translateY(3px); }
  to { transform: translateY(0); }
}
@keyframes dgm-whale-sink {
  from { transform: translateY(-3px); }
  to { transform: translateY(0); }
}

/* ---------- Responsive (container width, PRD 9.3.2) ---------- */

@container (max-width: 1079px) {
  .dgm-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .dgm-detail-cols { grid-template-columns: minmax(0, 1fr) 300px; gap: 32px; }
}

@container (max-width: 899px) {
  .dgm-detail-cols { grid-template-columns: minmax(0, 1fr); gap: 20px; margin-top: -18px; }
  .dgm-detail-rail { position: static; order: -1; backdrop-filter: none; background: transparent; border: 0; border-bottom: 1px solid color-mix(in srgb, var(--dgm-fg) 8%, transparent); border-radius: 0; padding: 0 0 18px; }
  .dgm-detail-main { padding-top: 0; }
  .dgm-primary-btn { max-width: 480px; }
  .dgm-rail-block { padding-top: 0; border-top: 0; }
  .dgm-detail-rail .dgm-detail-meta,
  .dgm-detail-rail .dgm-leaderboard,
  .dgm-detail-rail .dgm-rail-actions { display: none; }
}

@container (max-width: 839px) {
  .dgm-header { padding-left: 12px; padding-right: 12px; gap: 8px; }
  .dgm-upload-label { display: none; }
  .dgm-upload { width: 32px; padding: 0; justify-content: center; }
  .dgm-search { display: none; }
  .dgm-search-toggle { display: inline-flex; }
  .dgm-root[data-search-open='true'] .dgm-search {
    display: flex;
    position: absolute;
    left: 12px;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    z-index: 6;
    width: auto;
    background: var(--dgm-bg);
    border-color: transparent;
    box-shadow: var(--dgm-shadow-soft);
  }
  .dgm-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .dgm-hero { grid-template-columns: minmax(0, 1fr); gap: 16px; padding: 16px; }
  .dgm-hero-art { aspect-ratio: 16 / 9; }
  .dgm-hero-copy { padding-right: 0; }
  .dgm-hero-intro-art { display: none; }
  .dgm-hero-intro { grid-template-columns: minmax(0, 1fr); }
  .dgm-section { margin-top: 34px; }
  .dgm-section-head { align-items: flex-start; }
  .dgm-page { padding: 20px 16px 40px; }
  .dgm-detail-head { align-items: flex-start; gap: 14px; }
  .dgm-detail-hero { width: 152px; }
  .dgm-preview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dgm-toasts { right: 12px; bottom: 12px; }
  .dgm-lightbox { padding: 52px 12px; }
  .dgm-lightbox-nav { width: 38px; height: 38px; }
}

@container (max-width: 599px) {
  .dgm-header { gap: 6px; min-height: calc(var(--dsh-frame-top-clearance, 0px) + 48px); }
  .dgm-title { font-size: 14px; }
  .dgm-tabs { gap: 12px; margin-left: 0; height: 48px; }
  .dgm-tab { font-size: 11px; }
  .dgm-page { padding: 14px 12px 32px; }
  .dgm-grid { grid-template-columns: minmax(0, 1fr); }
  .dgm-card-cover { aspect-ratio: 16 / 9; }
  .dgm-hero { border-radius: 16px; }
  .dgm-hero-title { font-size: 26px; }
  .dgm-section { margin-top: 28px; }
  .dgm-section-title { font-size: 16px; }
  .dgm-row { grid-template-columns: 56px minmax(0, 1fr) auto; gap: 10px; min-height: 80px; padding: 10px 8px; }
  .dgm-row-cover { width: 56px; height: 42px; }
  .dgm-row-update { display: none; }
  .dgm-row-update-btn { display: none; }
  .dgm-row-meta { font-size: 11px; }
  .dgm-detail-title { font-size: 26px; }
  .dgm-preview-grid { grid-template-columns: minmax(0, 1fr); }
  .dgm-detail-cols { padding: 0; }
  .dgm-detail-description { font-size: 14px; }
  .dgm-toast { max-width: calc(100vw - 24px); }
  .dgm-dialog { padding: 16px; }
  .dgm-runtime-controls { left: 12px; right: 12px; }
  .dgm-presence { right: 16px; bottom: 16px; }
  .dgm-detail-meta,
  .dgm-detail-rail .dgm-permissions { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .dgm-root *,
  .dgm-root *::before,
  .dgm-root *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
  .dgm-whale-btn[data-state='running'] .dgm-whale,
  .dgm-whale-btn[data-state='waiting-user'] .dgm-whale-halo { animation: none !important; }
  .dgm-whale-btn[data-state='waiting-user'] .dgm-whale-halo { opacity: 1; }
  .dgm-whale-bubble { animation: none !important; }
  .dgm-skeleton-cover,
  .dgm-skeleton-line,
  .dgm-skeleton-thumb,
  .dgm-skeleton-pill,
  .dgm-skeleton-hero,
  .dgm-skeleton-rail,
  .dgm-skeleton-button,
  .dgm-progress-indeterminate { animation: none !important; }
  .dgm-progress-indeterminate { width: 100%; opacity: 0.55; transform: none; }
  .dgm-card:hover .dgm-card-cover,
  .dgm-card:focus-visible .dgm-card-cover,
  .dgm-preview-btn:hover { transform: none !important; }
}
`;

/** Inline style tag; removed with the component subtree. */
export function StyleTag() {
  return h('style', { 'data-dsh-game-market': 'styles' }, CSS);
}
