import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createUnraidAdapter, UnraidError } from '../packages/adapters/unraid.js';

// 本地模拟 UnraidClaw：校验 x-api-key，返回 { ok, data } 信封。
let server, url; const seen = [];
before(async () => {
  server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, key: req.headers['x-api-key'] });
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.headers['x-api-key'] !== 'good-key') return send(401, { ok: false });
    const routes = {
      '/api/health': { status: 'ok' },
      '/api/system/info': { hostname: 'tower' },
      '/api/system/metrics': { cpu: 12 },
      '/api/docker/containers': [{ id: 'a', names: ['/emby'], state: 'running' }, { id: 'b', name: 'plex', status: 'Exited (0)' }],
    };
    if (req.url === '/api/array/status') return send(403, { ok: false });
    if (req.url in routes) return send(200, { ok: true, data: routes[req.url] });
    send(404, { ok: false });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('Unraid：未配置返回模拟数据', async () => {
  const u = createUnraidAdapter({ url: '', apiKey: '' });
  assert.equal((await u.status()).simulated, true);
});

test('Unraid：发送 x-api-key，聚合状态，单项失败不影响其它', async () => {
  const u = createUnraidAdapter({ url, apiKey: 'good-key' });
  const s = await u.status();
  assert.equal(s.simulated, false);
  assert.equal(s.docker.total, 2);
  assert.equal(s.docker.running, 1);
  assert.deepEqual(s.docker.containers.map((c) => c.name), ['/emby', 'plex']);
  assert.ok(s.errors.some((e) => e.startsWith('array:') && /权限不足/.test(e)));
  assert.ok(seen.every((r) => r.method === 'GET' && r.key === 'good-key'));
});

test('Unraid：错误密钥给出明确提示；写操作与非白名单路径被拒绝', async () => {
  const bad = createUnraidAdapter({ url, apiKey: 'wrong' });
  await assert.rejects(() => bad.health(), /认证失败/);
  const u = createUnraidAdapter({ url, apiKey: 'good-key' });
  await assert.rejects(() => u.write(), /未启用/);
  for (const p of ['/api/logs/syslog', '/api/system/reboot', '/api/docker/containers/x/logs', '/api/docker/containers/../x'])
    await assert.rejects(() => u.get(p), (e) => e instanceof UnraidError && /白名单/.test(e.message));
});
