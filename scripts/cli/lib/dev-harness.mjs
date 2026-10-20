/**
 * Local Runtime Simulator page (PRD §4.5 / DEV-02).
 *
 * The page plays the role of the trusted Runtime: it loads the built
 * `dist/index.html` in a sandboxed iframe, runs the documented bridge
 * handshake and exposes Agent/Runtime state switches. It deliberately contains
 * no framework and no external resources so it can be served by the
 * zero-dependency dev server.
 */

function escapeJsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * Simulator wrapper document (V1.5-CONTRACTS §7.5.1).
 *
 * The Host loads asset-zip-v2 games through a platform-served wrapper on the
 * resource origin: the wrapper is NOT sandboxed (a sandboxed ancestor fails the
 * game document's frame-ancestors chain check) and it relays bridge messages
 * point-to-point between the trusted parent and its sandboxed game iframe.
 * The simulator mirrors that shape so authors exercise the real path.
 */
export function renderWrapper(options) {
  const source = options && typeof options === 'object' ? options : {};
  const gameUrl = escapeJsonForScript(String(source.src || ''));
  const csp = "default-src 'none'; frame-src 'self'; child-src 'self'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>DSH Game Runtime Simulator — wrapper</title>
    <style>
      html, body { margin: 0; height: 100%; background: #000; }
      iframe { width: 100%; height: 100%; border: 0; display: block; background: #000; }
    </style>
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
  </head>
  <body>
    <iframe id="game" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>
    <script>
      "use strict";
      var gameUrl = ${gameUrl};
      var frame = document.getElementById("game");
      // Point-to-point relay only: a game message goes up once, a Runtime
      // message goes down once. No payload is inspected or rewritten.
      window.addEventListener("message", function (event) {
        if (event.source !== parent) return;
        if (!frame.contentWindow) return;
        frame.contentWindow.postMessage(event.data, "*");
      });
      window.addEventListener("message", function (event) {
        if (event.source !== frame.contentWindow) return;
        parent.postMessage(event.data, "*");
      });
      frame.addEventListener("load", function () { parent.postMessage({ v: 1, kind: "evt", event: "__simulator-wrapper-load" }, "*"); });
      frame.src = gameUrl + (gameUrl.indexOf("?") === -1 ? "?" : "&") + "instance=" + encodeURIComponent(${escapeJsonForScript(
        String(source.instanceId || '')
      )}) + "&nonce=" + encodeURIComponent(${escapeJsonForScript(String(source.nonce || ''))});
    </script>
  </body>
</html>`;
}

export function renderHarness(config) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>DSH Game Runtime Simulator</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0a0b0d;
        --panel: #121417;
        --panel-2: #171a1f;
        --border: rgba(255, 255, 255, 0.09);
        --text: #e8edf2;
        --muted: #8b95a1;
        --accent: #34d399;
        --accent-2: #60a5fa;
        --warn: #fbbf24;
        --danger: #fb7185;
        --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; height: 100%; }
      body {
        background: var(--bg);
        color: var(--text);
        font: 13px/1.5 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 10px 16px;
        border-bottom: 1px solid var(--border);
        background: #0d0f12;
      }
      header h1 { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: 0.01em; }
      header .meta { color: var(--muted); font-family: var(--mono); font-size: 11px; }
      .status {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 3px 9px;
        border: 1px solid var(--border);
        border-radius: 999px;
        font-family: var(--mono);
        font-size: 11px;
        color: var(--muted);
      }
      .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); }
      .dot.ready { background: var(--accent); }
      .dot.warn { background: var(--warn); }
      .dot.danger { background: var(--danger); }
      main { flex: 1; display: flex; min-height: 0; }
      .stage {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 20px;
        min-width: 0;
        background:
          radial-gradient(80% 60% at 50% 0%, rgba(52, 211, 153, 0.07), transparent 60%),
          radial-gradient(70% 60% at 50% 100%, rgba(96, 165, 250, 0.06), transparent 60%),
          var(--bg);
      }
      .frame {
        width: 960px;
        height: 540px;
        max-width: 100%;
        border: 1px solid var(--border);
        border-radius: 12px;
        overflow: hidden;
        background: #000;
        box-shadow: 0 24px 70px rgba(0, 0, 0, 0.45);
      }
      .frame iframe { width: 100%; height: 100%; border: 0; display: block; background: #000; }
      .stage-hint { color: var(--muted); font-size: 11px; font-family: var(--mono); }
      aside {
        width: 380px;
        flex: 0 0 380px;
        border-left: 1px solid var(--border);
        background: var(--panel);
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      .panel-scroll { overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
      section {
        border: 1px solid var(--border);
        border-radius: 10px;
        background: var(--panel-2);
        padding: 10px;
      }
      section h2 {
        margin: 0 0 8px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }
      .row { display: flex; flex-wrap: wrap; gap: 6px; }
      button {
        appearance: none;
        border: 1px solid var(--border);
        background: #1c2026;
        color: var(--text);
        border-radius: 7px;
        padding: 5px 9px;
        font-size: 12px;
        cursor: pointer;
      }
      button:hover { border-color: rgba(52, 211, 153, 0.5); }
      button:active { transform: translateY(1px); }
      button.primary { background: rgba(52, 211, 153, 0.14); border-color: rgba(52, 211, 153, 0.4); color: #a7f3d0; }
      button.warn { background: rgba(251, 191, 36, 0.12); border-color: rgba(251, 191, 36, 0.35); color: #fde68a; }
      button.danger { background: rgba(251, 113, 133, 0.12); border-color: rgba(251, 113, 133, 0.35); color: #fecdd3; }
      .kv { display: grid; grid-template-columns: 96px 1fr; gap: 3px 8px; font-family: var(--mono); font-size: 11px; }
      .kv dt { color: var(--muted); }
      .kv dd { margin: 0; overflow-wrap: anywhere; }
      .save-list { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; font-family: var(--mono); font-size: 11px; }
      .save-row { border: 1px solid var(--border); border-radius: 6px; padding: 4px 6px; color: var(--muted); }
      .save-row b { color: var(--text); font-weight: 600; }
      .log {
        flex: 1;
        min-height: 180px;
        max-height: 40vh;
        overflow: auto;
        margin: 0;
        padding: 8px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: #0c0e11;
        font-family: var(--mono);
        font-size: 11px;
        line-height: 1.45;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .log .dir-in { color: var(--accent-2); }
      .log .dir-out { color: var(--accent); }
      .log .err { color: var(--danger); }
      .log .sys { color: var(--muted); }
      .log-wrap { display: flex; flex-direction: column; gap: 6px; min-height: 0; flex: 1; padding: 0 12px 12px; }
      .small { color: var(--muted); font-size: 11px; }
    </style>
  </head>
  <body>
    <header>
      <div>
        <h1>Game Runtime Simulator <span class="small">— fake bridge, no DSH Agent required</span></h1>
        <div class="meta" id="game-meta"></div>
      </div>
      <div class="status"><span class="dot" id="status-dot"></span><span id="status-text">waiting for hello</span></div>
    </header>
    <main>
      <div class="stage">
        <div class="frame" id="frame"><iframe id="game" title="Game under development" sandbox="allow-scripts"></iframe></div>
        <div class="stage-hint" id="stage-hint"></div>
      </div>
      <aside>
        <div class="panel-scroll">
          <section>
            <h2>Agent</h2>
            <div class="row">
              <button data-command="agent-running">Running</button>
              <button data-command="agent-waiting" class="warn">Waiting user</button>
              <button data-command="agent-completed">Completed</button>
              <button data-command="agent-error" class="danger">Error</button>
              <button data-command="agent-idle">Idle</button>
            </div>
          </section>
          <section>
            <h2>Runtime</h2>
            <div class="row">
              <button data-command="pause">Pause</button>
              <button data-command="resume" class="primary">Resume</button>
              <button data-command="before-save">before-save</button>
              <button data-command="export-save">Export save</button>
              <button data-command="import-save">Import save</button>
              <button data-command="clear-save" class="danger">Clear save</button>
              <input id="import-save-file" type="file" accept="application/json,.json" hidden />
            </div>
            <div class="row" style="margin-top:6px">
              <button data-command="reload">Reload game</button>
              <button data-command="theme">Toggle theme</button>
              <button data-command="locale">Toggle locale</button>
              <button data-command="viewport">Resize stage</button>
              <button data-command="reduced-motion">Reduced motion</button>
              <button data-command="ping">Ping</button>
            </div>
          </section>
          <section>
            <h2>Session / scores</h2>
            <dl class="kv">
              <dt>play session</dt><dd id="kv-session">—</dd>
              <dt>best</dt><dd id="kv-best">—</dd>
              <dt>agent</dt><dd id="kv-agent">idle</dd>
              <dt>theme</dt><dd id="kv-theme">dark</dd>
              <dt>locale</dt><dd id="kv-locale">zh-CN</dd>
              <dt>save rev</dt><dd id="kv-revision">0</dd>
              <dt>save bytes</dt><dd id="kv-bytes">0</dd>
            </dl>
          </section>
          <section>
            <h2>Save keys</h2>
            <div class="save-list" id="save-list"><div class="save-row">(empty)</div></div>
          </section>
        </div>
        <div class="log-wrap">
          <h2 style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">Bridge messages</h2>
          <pre class="log" id="log"></pre>
        </div>
      </aside>
    </main>
    <script>
      "use strict";
      var CONFIG = ${escapeJsonForScript(config)};
      var SDK_VERSION = "1.0.0";
      var RUNTIME_VERSION = "1.0.0";
      var iframe = document.getElementById("game");
      var frame = document.getElementById("frame");
      var logEl = document.getElementById("log");
      var saveListEl = document.getElementById("save-list");
      var state = {
        instanceId: randomHex(32),
        nonce: randomHex(32),
        initSent: false,
        ready: false,
        paused: false,
        theme: CONFIG.theme || "dark",
        locale: CONFIG.locale || "zh-CN",
        reducedMotion: false,
        viewportIndex: 0,
        save: Object.create(null),
        ignoreSavesUntil: 0,
        revision: 0,
        session: null,
        scoreHistory: [],
        best: null,
        agent: idleAgent(),
        pingSeq: 0
      };
      // Dev-only seed: "dsh-game dev --seed-save <file>" (or a prior --save-out
      // file) starts the fake storage with an existing save so upgrade paths
      // (1.0.0 -> 1.0.1) can be exercised without a production-side import.
      (function seedInitialSave() {
        var seed = CONFIG.initialSave;
        if (!seed || typeof seed !== "object") return;
        Object.keys(seed).forEach(function (key) { state.save[key] = seed[key]; });
        appendLog("·", "seeded save from CONFIG.initialSave", Object.keys(seed).length + " key(s)");
      })();
      var viewports = [
        { width: 960, height: 540 },
        { width: 640, height: 360 },
        { width: 1280, height: 720 },
        { width: 375, height: 667 }
      ];

      function randomHex(length) {
        var bytes = new Uint8Array(length / 2);
        crypto.getRandomValues(bytes);
        var out = "";
        for (var i = 0; i < bytes.length; i += 1) out += bytes[i].toString(16).padStart(2, "0");
        return out;
      }
      function nowIso() { return new Date().toISOString(); }
      function escapeHtml(value) {
        return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      }
      function jsonText(value, limit) {
        var text;
        try { text = JSON.stringify(value); } catch (error) { text = String(value); }
        if (text === undefined) text = "undefined";
        return text.length > (limit || 240) ? text.slice(0, limit || 240) + "…" : text;
      }

      function appendLog(direction, label, detail, payload, isError) {
        var time = new Date().toLocaleTimeString();
        var prefix = direction === "→" ? "→ game  " : direction === "←" ? "← game  " : "·       ";
        var line = document.createElement("div");
        line.className = isError ? "err" : direction === "→" ? "dir-out" : direction === "←" ? "dir-in" : "sys";
        line.textContent = "[" + time + "] " + prefix + label + (detail ? "  " + detail : "") + (payload === undefined ? "" : "\\n          " + jsonText(payload));
        logEl.appendChild(line);
        while (logEl.childNodes.length > 300) logEl.removeChild(logEl.firstChild);
        logEl.scrollTop = logEl.scrollHeight;
        if (isError) console.error("[simulator]", label, detail || "", payload || "");
        else console.log("[simulator]", direction, label, detail || "", payload || "");
      }

      function post(message) {
        if (!iframe.contentWindow) return;
        iframe.contentWindow.postMessage(message, "*");
        var kind = message.kind;
        var label = kind === "evt" ? message.event : kind === "req" ? message.method : "res";
        appendLog("→", label, kind === "res" ? (message.ok ? "ok" : "error") : "", message.data || message.params || message.error || message.result);
      }
      function sendEvent(event, data) { post({ v: 1, kind: "evt", event: event, data: data }); }
      function respond(id, result) { post({ v: 1, id: id, kind: "res", ok: true, result: result === undefined ? null : result }); }
      function respondError(id, code, message, retryable) {
        post({ v: 1, id: id, kind: "res", ok: false, error: { code: code, message: message, retryable: retryable === true } });
      }
      function runtimeInfo() {
        return {
          sdkVersion: SDK_VERSION,
          protocolVersion: 1,
          runtimeVersion: RUNTIME_VERSION,
          gameId: CONFIG.game.id,
          gameVersion: CONFIG.game.version,
          locale: state.locale,
          theme: state.theme,
          reducedMotion: state.reducedMotion,
          capabilities: CONFIG.game.capabilities || [],
          viewport: currentViewport(),
          ready: true
        };
      }
      function currentViewport() {
        var width = frame.clientWidth || 960;
        var height = frame.clientHeight || 540;
        return { width: width, height: height, dpr: Math.min(2, window.devicePixelRatio || 1) };
      }
      function initData() {
        var info = runtimeInfo();
        info.instanceId = state.instanceId;
        info.nonce = state.nonce;
        info.supportedSdkRange = ">=1.0.0 <2.0.0";
        info.limits = { saveBytes: 1048576, saveKeys: 32, scoreMetaBytes: 2048 };
        return info;
      }
      function idleAgent() {
        var at = nowIso();
        return { state: "idle", label: "Agent 空闲", labelKey: "agent.state.idle", sessionId: null, updatedAt: at, source: "lifecycle", seq: 0, since: at, turnId: null };
      }
      function setAgent(nextState, label, labelKey, source) {
        var previous = state.agent;
        state.agent = {
          state: nextState,
          label: label,
          labelKey: labelKey,
          sessionId: "dev-session",
          updatedAt: nowIso(),
          source: source || "lifecycle",
          seq: (previous.seq || 0) + 1,
          since: nowIso(),
          turnId: null
        };
        sendEvent("agent-status", state.agent);
        render();
      }

      function setStatus(text, kind) {
        document.getElementById("status-text").textContent = text;
        var dot = document.getElementById("status-dot");
        dot.className = "dot" + (kind ? " " + kind : "");
      }

      function render() {
        document.getElementById("kv-session").textContent = state.session ? state.session.playSessionId + (state.session.endedAt ? " (ended)" : " (active)") : "—";
        document.getElementById("kv-best").textContent = state.best ? state.best.score + " @ " + state.best.achievedAt : "—";
        document.getElementById("kv-agent").textContent = state.agent.state + (state.agent.label ? " · " + state.agent.label : "");
        document.getElementById("kv-theme").textContent = state.theme;
        document.getElementById("kv-locale").textContent = state.locale;
        document.getElementById("kv-revision").textContent = String(state.revision);
        var bytes = 0;
        var keys = Object.keys(state.save);
        for (var i = 0; i < keys.length; i += 1) bytes += new TextEncoder().encode(JSON.stringify(state.save[keys[i]])).length;
        document.getElementById("kv-bytes").textContent = String(bytes);
        saveListEl.innerHTML = "";
        if (keys.length === 0) {
          var empty = document.createElement("div");
          empty.className = "save-row";
          empty.textContent = "(empty — the game writes on before-save)";
          saveListEl.appendChild(empty);
        } else {
          keys.sort().forEach(function (key) {
            var row = document.createElement("div");
            row.className = "save-row";
            row.innerHTML = "<b>" + escapeHtml(key) + "</b> " + escapeHtml(jsonText(state.save[key], 160));
            saveListEl.appendChild(row);
          });
        }
        document.getElementById("stage-hint").textContent =
          "iframe sandbox=allow-scripts · viewport " + currentViewport().width + "×" + currentViewport().height +
          " · " + (state.paused ? "paused" : "running") + " · bridge " + (state.ready ? "ready" : state.initSent ? "initialized" : "waiting");
        document.getElementById("game-meta").textContent =
          CONFIG.game.id + "@" + CONFIG.game.version + " · " + CONFIG.game.name + " · instance " + state.instanceId.slice(0, 8) + "…";
      }

      function safeByteLength(text) { return new TextEncoder().encode(text).length; }
      function checkKey(key) {
        return typeof key === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(key);
      }

      function handleRequest(message) {
        var method = message.method;
        var params = message.params && typeof message.params === "object" ? message.params : {};
        appendLog("←", method, "", params);
        if (!state.initSent) return respondError(message.id, "GM-4031", "Handshake has not started", false);
        if (!state.ready && method !== "ready") return respondError(message.id, "GM-4031", "Game is not ready", false);
        try {
          if (method === "ready") {
            state.ready = true;
            setStatus("ready", "ready");
            render();
            return respond(message.id, runtimeInfo());
          }
          if (method === "storage.save") {
            var key = params.key;
            if (!checkKey(key)) return respondError(message.id, "GM-4133", "Invalid storage key", false);
            if (performance.now() < state.ignoreSavesUntil) {
              appendLog("·", "storage.save ignored after Clear save", key);
              return respond(message.id, { key: key, bytes: 0, revision: state.revision, updatedAt: nowIso() });
            }
            var data = params.data;
            var bytes = safeByteLength(JSON.stringify(data));
            if (data === undefined || bytes > 256 * 1024) return respondError(message.id, "GM-4131", "Value exceeds 256 KiB", false);
            if (!(key in state.save) && Object.keys(state.save).length >= 32) return respondError(message.id, "GM-4132", "Save has more than 32 keys", false);
            state.save[key] = data;
            postSaveSnapshot();
            state.revision += 1;
            render();
            return respond(message.id, { key: key, bytes: bytes, revision: state.revision, updatedAt: nowIso() });
          }
          if (method === "storage.load") {
            var loadKey = params.key;
            if (!checkKey(loadKey)) return respondError(message.id, "GM-4133", "Invalid storage key", false);
            if (!(loadKey in state.save)) return respond(message.id, null);
            return respond(message.id, {
              key: loadKey,
              data: state.save[loadKey],
              revision: state.revision,
              updatedAt: nowIso()
            });
          }
          if (method === "storage.remove") {
            var removeKey = params.key;
            if (!checkKey(removeKey)) return respondError(message.id, "GM-4133", "Invalid storage key", false);
            delete state.save[removeKey];
            postSaveSnapshot();
            state.revision += 1;
            render();
            return respond(message.id, { key: removeKey, removed: true, revision: state.revision });
          }
          if (method === "session.start") {
            if (state.session && !state.session.endedAt) {
              return respond(message.id, { playSessionId: state.session.playSessionId, startedAt: state.session.startedAt, adopted: true });
            }
            state.session = { playSessionId: "ps_" + randomHex(24), startedAt: nowIso(), endedAt: null };
            render();
            return respond(message.id, { playSessionId: state.session.playSessionId, startedAt: state.session.startedAt, adopted: false });
          }
          if (method === "session.end") {
            if (!state.session || state.session.endedAt) {
              if (!state.session) return respond(message.id, null);
              return respond(message.id, {
                playSessionId: state.session.playSessionId,
                startedAt: state.session.startedAt,
                endedAt: state.session.endedAt,
                outcome: state.session.outcome,
                score: state.session.score === undefined ? null : state.session.score,
                ignored: true
              });
            }
            state.session.endedAt = nowIso();
            state.session.outcome = params.outcome || "completed";
            state.session.score = params.score === undefined ? null : params.score;
            render();
            return respond(message.id, {
              playSessionId: state.session.playSessionId,
              startedAt: state.session.startedAt,
              endedAt: state.session.endedAt,
              outcome: state.session.outcome,
              score: state.session.score,
              ignored: false
            });
          }
          if (method === "score.submit") {
            var score = params.score;
            if (typeof score !== "number" || !isFinite(score)) return respondError(message.id, "GM-4002", "Invalid score", false);
            var isBest = !state.best || score > state.best.score;
            if (isBest) state.best = { score: score, achievedAt: nowIso(), meta: params.meta === undefined ? null : params.meta };
            state.scoreHistory.push({ score: score, achievedAt: nowIso() });
            render();
            return respond(message.id, { best: state.best.score, isBest: isBest, submittedAt: nowIso() });
          }
          if (method === "score.getBest") {
            if (!state.best) return respond(message.id, null);
            return respond(message.id, { score: state.best.score, achievedAt: state.best.achievedAt, meta: state.best.meta });
          }
          if (method === "agent.getStatus") return respond(message.id, state.agent);
          return respondError(message.id, "GM-4004", "Unknown game method: " + method, false);
        } catch (error) {
          appendLog("·", "bridge error", error && error.message ? error.message : String(error), undefined, true);
          return respondError(message.id, "GM-5000", "Simulator failed to handle " + method, false);
        }
      }

      window.addEventListener("message", function (event) {
        if (event.source !== iframe.contentWindow) return;
        var message = event.data;
        if (!message || message.v !== 1) return;
        if (message.kind === "evt" && message.event === "__simulator-wrapper-load") {
          appendLog("·", "wrapper loaded", "relaying bridge traffic");
          return;
        }
        if (message.kind === "evt" && message.event === "hello") {
          appendLog("←", "hello", "", message.data);
          if (!message.data || message.data.instanceId !== state.instanceId || message.data.nonce !== state.nonce) {
            appendLog("·", "hello identity mismatch", "", message.data, true);
            return;
          }
          if (state.initSent) return;
          state.initSent = true;
          post({ v: 1, kind: "evt", event: "init", data: initData() });
          sendEvent("agent-status", state.agent);
          sendEvent("theme", { theme: state.theme, reducedMotion: state.reducedMotion });
          sendEvent("viewport", currentViewport());
          setStatus("initialized", "warn");
          render();
          return;
        }
        if (message.kind === "req") return handleRequest(message);
        if (message.kind === "res") {
          appendLog("←", "response", message.id + (message.ok ? " ok" : " error"), message.error || message.result, message.ok !== true);
        }
      });

      function command(name) {
        if (name === "agent-running") {
          setAgent("running", "正在工作…", "agent.state.running", "turn");
          appendLog("·", "agent → running");
        } else if (name === "agent-waiting") {
          setAgent("waiting-user", "需要你确认一项操作", "agent.state.waiting.approval", "approval");
          state.paused = true;
          sendEvent("pause", { reason: "waiting-user", at: Date.now() });
          appendLog("·", "agent → waiting-user (pause reason waiting-user)");
        } else if (name === "agent-completed") {
          setAgent("completed", "任务完成啦", "agent.state.completed", "turn");
          appendLog("·", "agent → completed (must NOT pause the game)");
        } else if (name === "agent-error") {
          setAgent("error", "遇到了一点问题", "agent.state.error", "turn");
        } else if (name === "agent-idle") {
          setAgent("idle", "Agent 空闲", "agent.state.idle", "lifecycle");
        } else if (name === "pause") {
          state.paused = true;
          sendEvent("pause", { reason: "user", at: Date.now() });
        } else if (name === "resume") {
          state.paused = false;
          sendEvent("resume", { reason: "user", at: Date.now() });
        } else if (name === "before-save") {
          sendEvent("before-save", { reason: "interval", deadlineMs: 800 });
        } else if (name === "export-save") {
          exportSave();
        } else if (name === "import-save") {
          importSaveClick();
        } else if (name === "clear-save") {
          state.save = Object.create(null);
          postSaveSnapshot();
          state.revision += 1;
          state.scoreHistory = [];
          state.best = null;
          // Clicking the parent window blurs the iframe, which triggers the
          // game's own blur->pause->save. Ignore those in-flight saves so the
          // cleared state is what the next reload observes.
          state.ignoreSavesUntil = performance.now() + 750;
          appendLog("·", "save cleared", "reload the game to verify Continue");
          render();
        } else if (name === "reload") {
          loadGame();
        } else if (name === "theme") {
          state.theme = state.theme === "dark" ? "light" : "dark";
          sendEvent("theme", { theme: state.theme, reducedMotion: state.reducedMotion });
          render();
        } else if (name === "locale") {
          state.locale = state.locale === "zh-CN" ? "en-US" : "zh-CN";
          appendLog("·", "locale → " + state.locale + " (reloading with a new instance)");
          loadGame();
        } else if (name === "reduced-motion") {
          state.reducedMotion = !state.reducedMotion;
          sendEvent("theme", { theme: state.theme, reducedMotion: state.reducedMotion });
          appendLog("·", "reducedMotion → " + state.reducedMotion);
        } else if (name === "viewport") {
          state.viewportIndex = (state.viewportIndex + 1) % viewports.length;
          var viewport = viewports[state.viewportIndex];
          frame.style.width = viewport.width + "px";
          frame.style.height = viewport.height + "px";
          sendEvent("viewport", currentViewport());
          render();
        } else if (name === "ping") {
          state.pingSeq += 1;
          post({ v: 1, id: "rt-ping-" + state.pingSeq, kind: "req", method: "ping", params: { at: Date.now() } });
        }
        render();
      }

      function postSaveSnapshot() {
        if (!CONFIG.saveApi) return;
        try {
          fetch("/dev/save", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ save: state.save }),
          }).catch(function () { /* simulator-only; never blocks the game */ });
        } catch (error) {
          appendLog("·", "save snapshot failed", String(error), null, true);
        }
      }

      function exportSave() {
        fetch("/dev/save/export", { cache: "no-store" })
          .then(function (response) { return response.json(); })
          .then(function (payload) {
            if (!payload || !payload.ok) {
              appendLog("·", "export save failed", (payload && payload.hint) || "no save yet", payload, true);
              return;
            }
            var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
            var link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = CONFIG.game.id + "-" + CONFIG.game.version + ".save.json";
            document.body.appendChild(link);
            link.click();
            link.remove();
            appendLog("·", "exported save", Object.keys(payload.save || {}).length + " key(s)");
          })
          .catch(function (error) { appendLog("·", "export save failed", String(error), null, true); });
      }

      function importSaveClick() {
        var input = document.getElementById("import-save-file");
        if (input) input.click();
      }

      function importSaveFile(file) {
        file.text()
          .then(function (text) { return JSON.parse(text); })
          .then(function (payload) {
            var save = payload && typeof payload === "object" && "save" in payload ? payload.save : payload;
            if (!save || typeof save !== "object") throw new Error("file has no save object");
            return fetch("/dev/save/import", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ save: save }),
            }).then(function (response) {
              if (!response.ok) throw new Error("HTTP " + response.status);
              CONFIG.initialSave = save;
              state.save = Object.create(null);
              Object.keys(save).forEach(function (key) { state.save[key] = save[key]; });
              appendLog("·", "imported save", Object.keys(save).length + " key(s); reloading game");
              loadGame();
            });
          })
          .catch(function (error) { appendLog("·", "import save failed", String(error), null, true); });
      }

      function loadGame() {
        if (CONFIG.format === "asset-zip-v2" && CONFIG.wrapperUrl) {
          // Trusted platform wrapper on the resource origin: no sandbox on the
          // outer iframe; the wrapper embeds the sandboxed game iframe.
          state.instanceId = CONFIG.instanceId;
          state.nonce = CONFIG.nonce;
          iframe.removeAttribute("sandbox");
          iframe.src = CONFIG.wrapperUrl;
        } else {
          state.instanceId = randomHex(32);
          state.nonce = randomHex(32);
          iframe.setAttribute("sandbox", "allow-scripts");
          iframe.src = "/game?instance=" + state.instanceId + "&nonce=" + state.nonce;
        }
        state.initSent = false;
        state.ready = false;
        state.paused = false;
        setStatus("waiting for hello", "");
        appendLog("·", "iframe loading", iframe.src);
        // Refresh header metadata from the server so an in-place update is
        // visible without restarting the simulator.
        fetch("/health", { cache: "no-store" }).then(function (response) { return response.json(); }).then(function (health) {
          if (health && health.ok && health.game) {
            CONFIG.game.id = health.game.id;
            CONFIG.game.version = health.game.version;
            if (typeof health.game.name === "string") CONFIG.game.name = health.game.name;
            render();
          }
        }).catch(function () { /* keep the initial metadata */ });
        render();
      }

      document.querySelectorAll("[data-command]").forEach(function (button) {
        button.addEventListener("click", function () { command(button.getAttribute("data-command")); });
      });
      var importSaveInput = document.getElementById("import-save-file");
      if (importSaveInput) {
        importSaveInput.addEventListener("change", function () {
          var file = importSaveInput.files && importSaveInput.files[0];
          importSaveInput.value = "";
          if (file) importSaveFile(file);
        });
      }
      iframe.addEventListener("load", function () {
        appendLog("·", "iframe loaded");
        render();
      });
      appendLog("·", "simulator ready", "select states on the right; every bridge message also appears in the console");
      render();
      loadGame();
    </script>
  </body>
</html>
`;
}
