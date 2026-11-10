import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../packages/core/config.js';
import { createServices } from '../packages/core/app.js';
import { validateSpec } from '../packages/workshop/spec.js';
import { getPath } from '../packages/workshop/interpreter.js';

const owner = { id: '1', role: 'owner' }, friend = { id: '2', role: 'friend' };
const mk = () => {
  const cfg = loadConfig({ OWNER_TELEGRAM_ID: '1', FRIEND_TELEGRAM_IDS: '2', DATA_DIR: mkdtempSync(join(tmpdir(), 'ws-')) });
  const svc = createServices(cfg);
  for (const id of ['unraid', 'session-stats']) { svc.registry.install(id, '1'); svc.registry.grant(id, svc.registry.get(id).permissions, '1'); svc.registry.enable(id, '1'); }
  return svc;
};

test('规格校验：拒绝链接/标签/密钥、P3 工具、未知工具、原型污染路径、自定义参数', () => {
  const svc = mk(); const r = svc.registry;
  const ok = { kind: 'card', id: 'gen-abc', name: '测试', source: { plugin: 'unraid', tool: 'status' }, fields: [{ label: '容器', path: 'docker.total' }] };
  assert.ok(validateSpec(ok, r).ok);
  assert.ok(!validateSpec({ ...ok, name: '<script>x</script>' }, r).ok);
  assert.ok(!validateSpec({ ...ok, description: 'see https://evil.example' }, r).ok);
  assert.ok(!validateSpec({ ...ok, description: 'k'.repeat(40) }, r).ok);
  assert.ok(!validateSpec({ ...ok, id: 'unraid' }, r).ok);
  assert.ok(!validateSpec({ ...ok, source: { plugin: 'unraid-ops', tool: 'docker.restart' } }, r).ok);
  assert.ok(!validateSpec({ ...ok, source: { plugin: 'unraid', tool: 'nope' } }, r).ok);
  assert.ok(!validateSpec({ ...ok, fields: [{ label: 'x', path: '__proto__.polluted' }] }, r).ok);
  assert.ok(!validateSpec({ kind: 'workflow', id: 'gen-w', name: 'w', steps: [{ plugin: 'unraid', tool: 'status', args: { a: 1 } }] }, r).ok);
  assert.equal(getPath({ a: { b: [1, 2] } }, 'a.b[1]'), 2);
  assert.equal(getPath({}, 'constructor.name'), undefined);
});

test('创造工坊：生成→检查→试运行→发布（默认停用零授权）→授权启用→运行→回滚', async () => {
  const svc = mk();
  const d = await svc.workshop.create(owner, '做一个 NAS 状态卡片');
  assert.equal(d.stage, 'awaiting_confirm'); assert.equal(d.via, 'template');
  assert.ok(d.trial.ok); // 未配置 Unraid 时返回模拟数据，卡片仍可渲染
  const p = svc.workshop.publish(owner, d.id);
  assert.equal(p.enabled, false); assert.deepEqual(p.grants, []); assert.equal(p.source, 'generated');
  await assert.rejects(() => svc.pluginRuntime.invoke(owner, p.id, 'run'), /未启用/);
  svc.registry.grant(p.id, p.permissions, '1'); svc.registry.enable(p.id, '1');
  const out = await svc.pluginRuntime.invoke(owner, p.id, 'run');
  assert.equal(out.kind, 'card'); assert.equal(out.fields[0].label, '容器总数');

  // 再次发布同 id → 新版本；回滚恢复旧版本并要求重新审核
  const d2 = await svc.workshop.create(owner, '做一个 NAS 状态卡片');
  d2.spec.id = p.id; d2.spec.name = '改名后的卡片';
  const p2 = svc.workshop.publish(owner, d2.id);
  assert.equal(p2.version, '1.0.1');
  const back = svc.workshop.rollback(owner, p.id);
  assert.equal(back.version, '1.0.0'); assert.equal(back.enabled, false); assert.equal(back.needsReview, true);
  assert.equal(svc.workshop.remove(owner, p.id).removed, p.id);
  assert.equal(svc.registry.get(p.id), null);
});

test('工坊：好友不可用；无法理解的需求给出提示；篡改规格后自动停用', async () => {
  const svc = mk();
  await assert.rejects(() => svc.workshop.create(friend, 'NAS 状态卡片'), /Owner/);
  await assert.rejects(() => svc.workshop.create(owner, '帮我写一首诗给女朋友'), /没能理解/);
  const d = await svc.workshop.create(owner, 'NAS 巡检');
  assert.equal(d.spec.kind, 'workflow');
  const p = svc.workshop.publish(owner, d.id);
  svc.registry.grant(p.id, p.permissions, '1'); svc.registry.enable(p.id, '1');
  const out = await svc.pluginRuntime.invoke(owner, p.id, 'run');
  // 未配置 UnraidClaw：status 为模拟数据成功，docker.list 失败后工作流在第一个错误处停止
  assert.equal(out.steps.length, 2); assert.equal(out.steps[0].ok, true); assert.match(out.steps[1].error, /未配置/); assert.equal(out.ok, false);
  // 篡改 spec.json（加入 P3 工具）→ 哈希变化 → 重新扫描后停用
  const f = join(svc.cfg.dataDir, 'generated-plugins', p.id, 'spec.json');
  const spec = JSON.parse(readFileSync(f, 'utf8')); spec.steps.push({ plugin: 'unraid-ops', tool: 'docker.restart' });
  writeFileSync(f, JSON.stringify(spec));
  svc.registry.scan();
  assert.equal(svc.registry.get(p.id).enabled, false);
  await assert.rejects(() => svc.pluginRuntime.invoke(owner, p.id, 'run'), /未启用/);
});
