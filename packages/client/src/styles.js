/** Theme-token CSS for every plugin surface. Rendered inside the components. */
import React from 'react';

const h = React.createElement;

export const CSS = `
.dgm-root,
.dgm-chip-anchor {
  --dgm-bg: var(--dsw-alias-bg-base, #ffffff);
  --dgm-fg: var(--dsw-alias-label-primary, #1f2328);
  --dgm-fg-secondary: var(--dsw-alias-label-secondary, #5c6470);
  --dgm-fg-tertiary: var(--dsw-alias-label-tertiary, #7a828e);
  --dgm-border: var(--dsw-alias-border-l1, rgba(31, 35, 40, 0.12));
  --dgm-border-strong: var(--dsw-alias-border-l2, rgba(31, 35, 40, 0.2));
  --dgm-surface: var(--dsw-alias-bg-layer-1, #f6f7f9);
  --dgm-overlay: var(--dsw-alias-bg-overlay, #ffffff);
  --dgm-hover: var(--dsw-alias-interactive-bg-hover, rgba(31, 35, 40, 0.06));
  --dgm-brand: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary, #4d6bfe));
  --dgm-danger: var(--dsw-alias-state-error-primary, #c93c37);
  --dgm-success: var(--dsw-alias-state-success-primary, #1a7f37);
  --dgm-radius: var(--dsw-radius-md, 8px);
  --dgm-radius-lg: var(--dsw-radius-lg, 12px);
  --dgm-font: var(--dsw-font-family-base, var(--dsw-font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif));
  --dgm-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  --dgm-focus: var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4d6bfe));
  --dgm-focus-width: var(--dsw-focus-ring-width, 2px);
}

.dgm-root {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--dgm-bg);
  color: var(--dgm-fg);
  font-family: var(--dgm-font);
  font-size: 13px;
  line-height: 1.5;
  container-type: inline-size;
}

.dgm-root *,
.dgm-root *::before,
.dgm-root *::after,
.dgm-chip-anchor *,
.dgm-chip-anchor *::before,
.dgm-chip-anchor *::after { box-sizing: border-box; }

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

.dgm-header {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  min-height: 52px;
  padding: calc(var(--dsh-frame-top-clearance, 0px) + 8px) 16px 8px;
  border-bottom: 1px solid var(--dgm-border);
  background: var(--dgm-bg);
}

.dgm-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.01em;
  outline: none;
}

.dgm-spacer { flex: 1 1 auto; }

.dgm-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: none;
  border: 1px solid var(--dgm-border);
  border-radius: var(--dgm-radius);
  background: transparent;
  color: var(--dgm-fg-secondary);
  cursor: pointer;
  transition: background-color 120ms ease-out, color 120ms ease-out;
}
.dgm-icon-btn:hover { background: var(--dgm-hover); color: var(--dgm-fg); }
.dgm-icon-btn:active { background: var(--dgm-hover); }
.dgm-icon-btn:focus-visible { outline: var(--dgm-focus-width) solid var(--dgm-focus); outline-offset: 2px; }

.dgm-tabs {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: var(--dgm-radius);
  background: var(--dgm-surface);
  border: 1px solid var(--dgm-border);
}

.dgm-tab {
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dgm-fg-secondary);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 120ms ease-out, color 120ms ease-out;
}
.dgm-tab:hover { color: var(--dgm-fg); }
.dgm-tab[data-active='true'] {
  background: var(--dgm-bg);
  color: var(--dgm-fg);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}
.dgm-tab:focus-visible { outline: var(--dgm-focus-width) solid var(--dgm-focus); outline-offset: 1px; }

.dgm-content {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 20px 20px 28px;
}

.dgm-content-narrow { max-width: 1120px; margin: 0 auto; }

.dgm-section-title {
  margin: 0 0 12px;
  font-size: 16px;
  font-weight: 600;
}

.dgm-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  min-height: 32px;
  padding: 0 20px;
  border-bottom: 1px solid var(--dgm-border);
  background: var(--dgm-surface);
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
.dgm-banner-action:hover { background: var(--dgm-hover); }
.dgm-banner-action:focus-visible { outline: var(--dgm-focus-width) solid var(--dgm-focus); outline-offset: 1px; }

.dgm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}

.dgm-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--dgm-border);
  border-radius: var(--dgm-radius-lg);
  background: var(--dgm-bg);
  transition: border-color 140ms ease-out, box-shadow 140ms ease-out;
}
.dgm-card:hover { border-color: var(--dgm-border-strong); box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08); }

.dgm-card-cover {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 3 / 2;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--dgm-surface), var(--dgm-hover));
  color: var(--dgm-fg-secondary);
}
.dgm-card-cover-mark { opacity: 0.8; }
.dgm-card-source {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--dgm-overlay);
  border: 1px solid var(--dgm-border);
  color: var(--dgm-fg-secondary);
  font-size: 10px;
  font-weight: 500;
}

.dgm-card-title { margin: 0; font-size: 14px; font-weight: 600; }
.dgm-card-meta { margin: 0; color: var(--dgm-fg-secondary); font-size: 12px; }
.dgm-card-foot { display: flex; align-items: center; gap: 8px; margin-top: auto; }
.dgm-card-stats { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1 1 auto; }
.dgm-card-stat { color: var(--dgm-fg-tertiary); font-size: 11px; }
.dgm-card-stat-strong { color: var(--dgm-fg-secondary); font-size: 12px; }

.dgm-badge {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  border: 1px solid var(--dgm-border);
  color: var(--dgm-fg-secondary);
  font-size: 10px;
  font-weight: 500;
  white-space: nowrap;
}
.dgm-badge-continue { border-color: transparent; background: var(--dgm-brand); color: var(--dsw-alias-label-primary-foreground, #ffffff); }
.dgm-badge-installed { color: var(--dgm-success); border-color: currentColor; }

.dgm-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 76px;
  height: 32px;
  padding: 0 14px;
  border-radius: var(--dgm-radius);
  border: 1px solid var(--dgm-border-strong);
  background: transparent;
  color: var(--dgm-fg);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 120ms ease-out, border-color 120ms ease-out;
}
.dgm-btn:hover { background: var(--dgm-hover); }
.dgm-btn:focus-visible { outline: var(--dgm-focus-width) solid var(--dgm-focus); outline-offset: 2px; }
.dgm-btn:disabled { opacity: 0.55; cursor: default; }
.dgm-btn-primary { border-color: transparent; background: var(--dgm-brand); color: var(--dsw-alias-label-primary-foreground, #ffffff); }
.dgm-btn-primary:hover { background: var(--dgm-brand); filter: brightness(1.06); }
.dgm-btn-danger { border-color: transparent; background: var(--dgm-danger); color: var(--dsw-alias-label-primary-foreground, #ffffff); }
.dgm-btn-quiet { border-color: transparent; color: var(--dgm-fg-secondary); }
.dgm-btn-quiet:hover { color: var(--dgm-fg); }

.dgm-list { display: flex; flex-direction: column; gap: 4px; }
.dgm-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 72px;
  padding: 10px 12px;
  border-radius: var(--dgm-radius);
  background: transparent;
  transition: background-color 120ms ease-out;
}
.dgm-row:hover { background: var(--dgm-hover); }
.dgm-row-cover {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 48px;
  flex: none;
  border-radius: 10px;
  background: var(--dgm-surface);
  color: var(--dgm-fg-secondary);
}
.dgm-row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.dgm-row-title { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dgm-row-meta { color: var(--dgm-fg-secondary); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dgm-row-actions { display: flex; align-items: center; gap: 8px; flex: none; }

.dgm-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 220px;
  padding: 24px;
  text-align: center;
  color: var(--dgm-fg-secondary);
}
.dgm-state-title { margin: 0; color: var(--dgm-fg); font-size: 14px; font-weight: 600; }
.dgm-state-body { margin: 0; font-size: 12px; }
.dgm-spinner {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid var(--dgm-border);
  border-top-color: var(--dgm-brand);
  animation: dgm-spin 900ms linear infinite;
}

.dgm-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  max-width: 280px;
  margin-inline-end: 8px;
  padding: 0 10px;
  border: 1px solid var(--dgm-border);
  border-radius: var(--dgm-radius);
  background: transparent;
  color: var(--dgm-fg-secondary);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  line-height: 16px;
  cursor: pointer;
  animation: dgm-chip-in 160ms ease-out;
  transition: background-color 120ms ease-out, color 120ms ease-out;
}
.dgm-chip::after { content: ''; position: absolute; inset: -2px; border-radius: 10px; }
.dgm-chip:hover { background: var(--dgm-hover); color: var(--dgm-fg); }
.dgm-chip:active { background: var(--dgm-hover); }
.dgm-chip:focus-visible { outline: var(--dgm-focus-width) solid var(--dgm-focus); outline-offset: 2px; }
.dgm-chip-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dgm-chip-dot {
  width: 5px;
  height: 5px;
  flex: none;
  border-radius: 50%;
  background: var(--dgm-fg-secondary);
}
.dgm-chip[data-status='waiting'] .dgm-chip-dot { background: var(--dgm-brand); box-shadow: 0 0 0 2px var(--dgm-bg), 0 0 0 3px var(--dgm-brand); }

.dgm-chip-anchor { position: relative; display: inline-flex; align-items: center; }

.dgm-menu,
.dgm-popover {
  position: fixed;
  z-index: 40;
  width: 248px;
  max-height: 320px;
  padding: 6px;
  border: 1px solid var(--dgm-border);
  border-radius: var(--dgm-radius-lg);
  background: var(--dgm-overlay);
  box-shadow: var(--dgm-shadow);
  backdrop-filter: blur(12px);
  animation: dgm-menu-in 140ms ease-out;
}
.dgm-popover { width: 236px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.dgm-popover-title { margin: 0; font-size: 13px; font-weight: 600; color: var(--dgm-fg); }
.dgm-popover-body { margin: 0; font-size: 12px; color: var(--dgm-fg-secondary); }
.dgm-popover-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }

.dgm-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  padding: 6px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dgm-fg);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dgm-menu-item:hover,
.dgm-menu-item:focus-visible { background: var(--dgm-hover); outline: none; }
.dgm-menu-item:focus-visible { box-shadow: inset 0 0 0 2px var(--dgm-focus); }
.dgm-menu-icon { display: inline-flex; color: var(--dgm-fg-secondary); flex: none; }
.dgm-menu-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.dgm-menu-label { font-size: 13px; }
.dgm-menu-meta { color: var(--dgm-fg-tertiary); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.dgm-toast {
  position: fixed;
  z-index: 50;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--dgm-overlay);
  border: 1px solid var(--dgm-border);
  box-shadow: var(--dgm-shadow);
  color: var(--dgm-fg-secondary);
  font-size: 12px;
  animation: dgm-fade 120ms ease-out;
}

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

.dgm-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.24);
  animation: dgm-fade 160ms ease-out;
}
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

@keyframes dgm-chip-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes dgm-menu-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes dgm-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes dgm-spin {
  to { transform: rotate(360deg); }
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

@container (max-width: 599px) {
  .dgm-header { padding-inline: 12px; gap: 6px; }
  .dgm-content { padding: 14px 12px 20px; }
  .dgm-grid { grid-template-columns: 1fr; }
  .dgm-runtime-controls { left: 12px; right: 12px; }
  .dgm-presence { right: 16px; bottom: 16px; }
  .dgm-chip { max-width: 220px; }
  .dgm-tab { padding: 0 8px; }
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
  .dgm-chip,
  .dgm-menu,
  .dgm-popover,
  .dgm-whale-bubble { animation: none !important; }
}
`;

/** Inline style tag; removed with the component subtree. */
export function StyleTag() {
  return h('style', { 'data-dsh-game-market': 'styles' }, CSS);
}
