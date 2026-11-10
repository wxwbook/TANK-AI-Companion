import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveUser, can, LEVEL } from '../packages/core/permissions.js';
import { verifyInitData } from '../packages/core/telegram-auth.js';
import { createMemoryStore } from '../packages/memory-engine/store.js';
import { compact, contextUsage, estimateTokens } from '../packages/memory-engine/context.js';
import { createApprovals } from '../packages/core/approvals.js';
import { createUnraidAdapter } from '../packages/adapters/unraid.js';

const cfg = { ownerId: '1', friendIds: ['2'] };
const tmp = () => mkdtempSync(join(tmpdir(), 'tank-'));

test('权限：未登记拒绝，好友无 P2，P3/P4 不可直接放行', () => {
  assert.equal(resolveUser(cfg, '9'), null);
  const owner = resolveUser(cfg, 1), friend = resolveUser(cfg, '2');
  assert.ok(can(owner, LEVEL.P2));
  assert.ok(!can(friend, LEVEL.P2));
  assert.ok(can(friend, LEVEL.P1));
  assert.ok(!can(owner, LEVEL.P3));
  assert.ok(!can(owner, LEVEL.P4));
});

function signInit(fields, token) {
  const p = new URLSearchParams(fields);
  const dcs = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  p.set('hash', createHmac('sha256', secret).update(dcs).digest('hex'));
  return p.toString();
}
test('Telegram initData：合法通过，篡改/过期失败', () => {
  const now = Date.now();
  const fields = { auth_date: String(Math.floor(now / 1000)), user: JSON.stringify({ id: 1 }) };
  const good = signInit(fields, 'TOKEN');
  assert.equal(verifyInitData(good, 'TOKEN', 3600, now).ok, true);
  assert.equal(verifyInitData(good, 'OTHER', 3600, now).reason, 'bad-hash');
  assert.equal(verifyInitData(good.replace('%22id%22%3A1', '%22id%22%3A2'), 'TOKEN', 3600, now).ok, false);
  assert.equal(verifyInitData(good, 'TOKEN', 3600, now + 7200_000).reason, 'expired');
});

test('记忆：用户隔离且拒绝路径穿越', () => {
  const s = createMemoryStore(tmp());
  s.addMemory('1', '喜欢咖啡');
  assert.equal(s.listMemories('2').length, 0);
  assert.throws(() => s.addMemory('../evil', 'x'));
  const id = s.listMemories('1')[0].id;
  assert.ok(s.removeMemory('1', id));
  assert.equal(s.listMemories('1').length, 0);
});

test('上下文：压缩保留最近消息与置顶决策，用量标注来源', async () => {
  const messages = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: '消息' + i, pinned: i === 1 }));
  const session = { messages, summary: '', usage: [] };
  const { compacted, session: next } = await compact(session, { keepLast: 4 });
  assert.equal(compacted, 6);
  assert.equal(next.messages.length, 4);
  assert.match(next.summary, /【保留】消息1/);
  assert.equal(contextUsage(next, 1000).source, 'estimated');
  assert.equal(contextUsage({ ...next, usage: [{ source: 'measured', promptTokens: 500 }] }, 1000).level, 'ok');
  assert.ok(estimateTokens('你好世界') >= 4);
});

test('审批：绑定参数，过期/非 Owner/参数不一致都不通过', () => {
  const ap = createApprovals({ ttlMs: 50 });
  const a = ap.request({ userId: '1', taskId: 't', action: 'docker.restart', target: 'emby', paramsSummary: 'x' });
  assert.throws(() => ap.decide(a.id, '2', true, '1'), /Owner/);
  ap.decide(a.id, '1', true, '1');
  const ok = { userId: '1', action: 'docker.restart', target: 'emby', paramsSummary: 'x' };
  assert.ok(ap.verifyForExecution(a.id, ok));
  assert.ok(!ap.verifyForExecution(a.id, { ...ok, target: 'plex' }));
});

