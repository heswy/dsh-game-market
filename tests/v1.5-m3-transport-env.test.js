import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFixtureTls, createIndexTransport, removeFixtureTls } from '../scripts/verification/v1.5/m3/fixture.mjs';

test('real GitHub packages use the upstream proxy while Host discovery keeps the isolated index proxy', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgm-m3-proxy-'));
  const tls = createFixtureTls(dir);
  const oldMode = process.env.M3_NETWORK_MODE;
  process.env.M3_NETWORK_MODE = 'real-github';
  let transport;
  try {
    transport = await createIndexTransport({ tlsMaterial: tls, upstreamProxy: 'http://127.0.0.1:17897' });
    const env = transport.envForHost();
    assert.equal(env.HTTPS_PROXY, transport.origin);
    assert.equal(env.npm_config_https_proxy, 'http://127.0.0.1:17897');
    assert.equal(env.npm_config_proxy, 'http://127.0.0.1:17897');
  } finally {
    if (oldMode === undefined) delete process.env.M3_NETWORK_MODE;
    else process.env.M3_NETWORK_MODE = oldMode;
    if (transport) await transport.close();
    removeFixtureTls(tls);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
