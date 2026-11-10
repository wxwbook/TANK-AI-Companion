import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../packages/core/config.js';
import { createServices } from '../packages/core/app.js';
import { createUnraidOps } from '../packages/adapters/unraid-ops.js';
import { createUnraidAdapter } from '../packages/adapters/unraid.js';

const owner = { id: '1', role: 'owner' }, friend = { id: '2', role: 'friend' };

function setup({ writeEnabled = true, allow = ['emby'] } = {}) {
  const cfg = loadConfig({ OWNER_TELEGRAM_ID: '1', FRIEND_TELEGRAM_IDS: '2', DATA_DIR: mkdtempSync(join(tmpdir(), 'ops-')),
    UNRAID_API_URL: 'http://x', UNRAID_API_KEY: 'r', UNRAID_WRITE_ENABLED: String(writeEnabled), UNRAID_WRITE_API_KEY: 'w', UNRAID_WRITE_ALLOWLIST: allow.join(',') });
  const calls = [];
  const reader = createUnraidAdapter(cfg.unraid, { transport: async (m, p) => { calls.push(['read', m, p]); return { status: 200, body: { ok: true, data: { name: 'emby' } } }; } });
  const unraidOps = createUnraidOps(cfg.unraid, { reader, transport: async (m, p) => { calls.push(['write', m, p]); return { status: 200, body: { ok: true } }; } });
  const svc = createServices(cfg, { unraid: reader, unraidOps });
  return { svc, calls };
}

test('审批流：申请→批准→执行（仅一次）并写审计与回滚信息', async () => {
  const { svc, calls } = setup();
  const a = await svc.ops.request(owner, { action: 'stop', target: 'emby' });
  assert.equal(a.status, 'pending');
  assert.ok(!calls.some((c) => c[0] === 'write'), '申请阶段不得执行写操作');
  const done = await svc.ops.decide(owner, a.id, true);
  assert.equal(done.status, 'executed'); assert.equal(done.rollback, 'docker.start');
  assert.deepEqual(calls.filter((c) => c[0] === 'write'), [['write', 'POST', '/api/docker/containers/emby/stop']]);
  await assert.rejects(() => svc.ops.decide(owner, a.id, true), /已处理/); // 不可重放
  const log = (await import('node:fs')).readFileSync(svc.audit.file, 'utf8');
  assert.match(log, /ops\.executed/); assert.match(log, /docker\.start/);
});

test('审批流：拒绝则不执行；好友不能申请或审批；白名单外与未启用被拒', async () => {
  const { svc, calls } = setup();
  const a = await svc.ops.request(owner, { action: 'restart', target: 'emby' });
  await svc.ops.decide(owner, a.id, false);
  assert.ok(!calls.some((c) => c[0] === 'write'));
  await assert.rejects(() => svc.ops.request(friend, { action: 'restart', target: 'emby' }), /Owner/);
  const b = await svc.ops.request(owner, { action: 'restart', target: 'emby' });
  await assert.rejects(() => svc.ops.decide(friend, b.id, true), /Owner/);
  await assert.rejects(() => svc.ops.request(owner, { action: 'restart', target: 'plex' }), /白名单/);
  await assert.rejects(() => svc.ops.request(owner, { action: 'reboot', target: 'emby' }), /不支持/);
  const off = setup({ writeEnabled: false });
  await assert.rejects(() => off.svc.ops.request(owner, { action: 'restart', target: 'emby' }), /未启用/);
});

test('插件通道与团队调度：P3 工具只生成审批；自然语言“重启 emby”进入审批', async () => {
  const { svc, calls } = setup();
  svc.registry.install('unraid', '1'); svc.registry.grant('unraid', svc.registry.get('unraid').permissions, '1'); svc.registry.enable('unraid', '1');
  svc.registry.install('unraid-ops', '1'); svc.registry.grant('unraid-ops', ['docker:update'], '1'); svc.registry.enable('unraid-ops', '1');
  await assert.rejects(() => svc.pluginRuntime.invoke(friend, 'unraid-ops', 'docker.restart', { target: 'emby' }), /Owner/);
  const r = await svc.chat.send(owner, '重启 emby');
  assert.ok(r.approval?.id); assert.match(r.reply, /审批/);
  assert.ok(!calls.some((c) => c[0] === 'write'));
});
