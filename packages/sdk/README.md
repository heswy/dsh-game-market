# `@dsh-game/sdk` v1

Browser-side, **zero-dependency** Game SDK for DSH Game Market games. It is a
thin postMessage client: it encodes `game.*` calls as bridge requests and turns
Runtime responses back into promises. It does not import DSH, Cordis, React or
Node built-ins, and is designed to be inlined into a single-file game.

```js
const game = DSH_GAME_SDK.createGameSDK();

game.lifecycle.on('pause', () => stopLoop());
game.lifecycle.on('resume', () => startLoop());
game.lifecycle.on('before-save', () => saveNow());

const info = await game.ready();                 // 10s handshake budget
const saved = await game.storage.load('current'); // null when missing
await game.storage.save('current', state);        // pure JSON, ≤256 KiB
await game.session.start();                       // idempotent / adopted
await game.score.submit(score);
await game.session.end({ outcome: 'completed', score });
```

## Public surface

`ready` · `runtime` · `storage.save/load/remove` · `session.start/end` ·
`score.submit/getBest` · `lifecycle.on` · `agent.getStatus/on` · V0-compatible
`onError` / `isGameError`.

V1.5 (`asset-zip-v2` only): `game.runtime.assetUrl(relativePath)` returns the
absolute URL of a package-relative asset (image/audio/level/JSON), e.g.
`game.runtime.assetUrl('levels/level-01.json')`. It is built from the instance
`resourceBase` injected by the Runtime and normalized with the shared archive
path rules: a path escaping the package throws `GM-4039`; an `html-v1` package
(or a legacy Runtime with no resource route) throws `GM-4043`.

- Types: [`src/index.d.ts`](src/index.d.ts) (PRD §8.3 / `docs/V1-CONTRACTS.md` §8).
- Every rejection is a `GameError` with a stable `GM-*` `code`, `retryable` and
  optional `details`. Internal `E_*` codes never cross the bridge (D-030).
- Before `ready()`, only `ready`, `runtime`, `lifecycle.on` and `agent.on` are
  allowed; other calls reject with `GM-4031` without queueing.
- Writes are serialized in call order (SDK + Runtime) and bounded at 32 queued
  requests (`GM-4291`); reads may run concurrently.
- `runtime` is a frozen live view: `theme`, `reducedMotion`, `viewport`,
  `resourceBase`/`packageFormat` (V1.5) and `ready` update as the Runtime
  reports changes.
- Version negotiation: `protocolVersion` must be 1 (`GM-5002`); a Runtime
  `supportedSdkRange` below this SDK rejects; an SDK ahead of the Runtime
  continues with the forward-compatible policy. V0 `0.1.x` games continue to
  work through the host's legacy window (V1-07).

## Implementation notes

- One `message` listener; accepts only `event.source === window.parent`;
  handshake starts lazily on the first `ready()` / `on()` call.
- `hello` is sent every 250ms (max 30); `init` must match `instance`/`nonce`
  from `location.search`; `targetOrigin` is `'*'` because sandboxed documents
  have an opaque origin (security relies on source + nonce + envelope checks).
- No `eval` / `new Function` / `document.write`; no network access.
- `export const game` is a lazy singleton that does not start the handshake
  until used.

## Tests

```bash
node --test packages/sdk/test/sdk.test.js
```

Covers handshake/timeout/no-runtime, version negotiation, pre-ready rejection,
storage validation/serialization, write ordering/backpressure, session/score,
agent buffering, lifecycle payloads, runtime live view and V0 compatibility.
