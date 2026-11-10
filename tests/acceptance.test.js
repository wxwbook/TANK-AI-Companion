// 对应设计文档第 17 节验收标准中可自动验证的部分
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { loadConfig } from '../packages/core/config.js';
import { createServices } from '../packages/core/app.js';
import { handleCommand } from '../packages/core/commands.js';
import { createHandler } from '../apps/api/server.js';

const owner = { id: '1', role: 'owner' }, friend = { id: '2', role: 'friend' };
const tmp = (p = 'acc-') => mkdtempSync(join(tmpdir(), p));
const mk = (env = {}, ov = {}) => createServices(loadConfig({ OWNER_TELEGRAM_ID: '1', FRIEND_TELEGRAM_IDS: '2', DATA_DIR: tmp(), ...env }), ov);

test('验收：Agent 工作过程可查看（步骤完整，且只有本人/Owner 能看）', async () => {
  const svc = mk(); svc.store.addMemory('1', '我喜欢茶');
  const r = await svc.chat.send(owner, '你好');
  const t = svc.tasks.get(owner, r.taskId);
  assert.ok(t.steps.length >= 3); assert.match(t.steps.map((s) => s.text).join('|'), /读取个人记忆 1 条.*Hermes 未配置.*写回会话/);
  assert.equal(svc.tasks.get(friend, r.taskId), null);
});

test('验收：记忆和日记可查看、纠正和管理（Telegram 指令 / 自然语言 / 隔离）', async () => {
  const svc = mk();
  const m = svc.store.addMemory('1', '住在上海');
  assert.equal(svc.store.updateMemory('1', m.id, '住在杭州').text, '住在杭州');
  assert.ok(svc.store.listMemories('1')[0].updatedAt);
  assert.equal(svc.store.updateMemory('2', m.id, '越权修改'), null); // 不能改别人的
  assert.match(await handleCommand(svc, owner, `/fix ${m.id} 住在苏州`), /已更正/);
  assert.match((await svc.chat.send(owner, `更正 ${m.id} 住在南京`)).reply, /已更正.*南京/);
  assert.equal(svc.store.listMemories('1')[0].text, '住在南京');
  const d = svc.store.addDiary('1', '今天很开心');
  assert.match(await handleCommand(svc, owner, `/diary fix ${d.id} 今天很充实`), /已更正/);
  assert.equal(svc.store.listDiary('1')[0].text, '今天很充实');
  assert.throws(() => svc.store.updateMemory('1', m.id, '  '), /为空/);
});

test('验收：插件可停用并回滚（撤销上一次授权/启停）', () => {
  const svc = mk(); const r = svc.registry; const perms = r.get('session-stats').permissions;
  r.install('session-stats', '1'); r.grant('session-stats', perms, '1'); r.enable('session-stats', '1');
  r.disable('session-stats', '1');
  assert.equal(r.rollbackState('session-stats', '1').enabled, true); // 撤销“停用”
  assert.throws(() => r.rollbackState('session-stats', '1'), /没有可撤销/);
  r.revoke('session-stats', perms, '1');
  const back = r.rollbackState('session-stats', '1');
  assert.deepEqual(back.grants, perms); assert.equal(back.enabled, true);
});

test('验收：原版与 Q 版为同一角色（形象偏好可切换，名称/人格不变）', async () => {
  const svc = mk();
  const h = createHandler({ ...svc, cfg: { ...svc.cfg, ownerApiToken: 'tok' } });
  const server = createServer(h); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (p, o = {}) => fetch(base + p, { ...o, headers: { authorization: 'Bearer tok', 'content-type': 'application/json' } });
  assert.equal((await (await call('/api/prefs')).json()).form, 'chibi');
  assert.equal((await call('/api/prefs', { method: 'POST', body: JSON.stringify({ form: 'original' }) })).status, 200);
  assert.equal((await (await call('/api/prefs')).json()).form, 'original');
  assert.equal((await call('/api/prefs', { method: 'POST', body: JSON.stringify({ form: 'weird' }) })).status, 400);
  const r = await svc.chat.send(owner, '你好'); const t = await (await call(`/api/tasks/${r.taskId}`)).json();
  assert.ok(t.steps.length >= 3);
  assert.equal((await call('/api/tasks/deadbeef')).status, 404);
  server.close();
  assert.equal(svc.personaStore.active().name, '大肥鱼'); // 形象不影响人格
  const fish = readFileSync(new URL('../apps/shared/fish.js', import.meta.url), 'utf8');
  assert.ok(/form === 'original'/.test(fish) && /大肥鱼（原版）/.test(fish));
});

test('验收：不泄漏密钥——响应、审计日志、配置输出中都不出现密钥', async () => {
  const S = { H: 'HERMES-SECRET-AAA', U: 'UNRAID-SECRET-BBB', W: 'WRITE-SECRET-CCC', V: 'VOICE-SECRET-DDD', T: 'tok-OWNER-EEE' };
  const svc = mk({ HERMES_BASE_URL: 'http://h:8642/v1', HERMES_API_KEY: S.H, UNRAID_API_URL: 'http://127.0.0.1:1', UNRAID_API_KEY: S.U,
    UNRAID_WRITE_ENABLED: 'true', UNRAID_WRITE_API_KEY: S.W, UNRAID_WRITE_ALLOWLIST: 'emby', VOICE_TTS_BASE_URL: 'https://tts.example.com/v1', VOICE_TTS_API_KEY: S.V, OWNER_API_TOKEN: S.T },
    { hermes: { enabled: true, chat: async () => { throw new Error('boom'); }, probe: async () => ({ configured: true }) } });
  const { redact } = await import('../packages/core/config.js');
  const h = createHandler(svc); const server = createServer(h); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const bodies = [];
  for (const [p, o] of [['/api/integrations'], ['/api/voice'], ['/api/prefs'], ['/api/plugins'], ['/api/approvals'], ['/api/chat', { method: 'POST', body: JSON.stringify({ text: '你好' }) }], ['/api/overview']])
    bodies.push(await (await fetch(base + p, { ...(o || {}), headers: { authorization: 'Bearer ' + S.T, 'content-type': 'application/json' } })).text());
  server.close();
  const all = bodies.join('\n') + JSON.stringify(redact(svc.cfg)) + (existsSync(svc.audit.file) ? readFileSync(svc.audit.file, 'utf8') : '');
  for (const v of Object.values(S)) assert.equal(all.includes(v), false, `泄漏了 ${v}`);
});

test('验收：有备份与恢复脚本，且可往返（备份→改动→恢复）', () => {
  const data = tmp('bk-data-'); mkdirSync(join(data, 'users', '1'), { recursive: true });
  writeFileSync(join(data, 'users', '1', 'memory.json'), '[{"id":"a","text":"原始"}]');
  const out = tmp('bk-out-');
  execFileSync('sh', [new URL('../scripts/backup.sh', import.meta.url).pathname, data, out]);
  const file = execFileSync('sh', ['-c', `ls ${out}/*.tar.gz`]).toString().trim();
  writeFileSync(join(data, 'users', '1', 'memory.json'), '[]'); // 模拟数据损坏
  const restored = join(tmp('bk-res-'), 'data');
  execFileSync('sh', [new URL('../scripts/restore.sh', import.meta.url).pathname, file, restored]);
  assert.equal(readFileSync(join(restored, 'users', '1', 'memory.json'), 'utf8'), '[{"id":"a","text":"原始"}]');
});
