import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateManifest } from '../packages/plugin-hub/manifest.js';
import { createRegistry } from '../packages/plugin-hub/registry.js';
import { createPluginRuntime } from '../packages/plugin-hub/runtime.js';

const audit = { events: [], record(e) { this.events.push(e); } };
const base = { id: 'demo', name: 'Demo', version: '1.0.0', type: 'tool', author: 'x', source: 'builtin', level: 1,
  permissions: ['user:session'], tools: [{ name: 'ping', level: 1, permission: 'user:session' }] };

function setup(manifest = base) {
  const root = mkdtempSync(join(tmpdir(), 'hub-'));
  const pluginsDir = join(root, 'plugins'); const dataDir = join(root, 'data');
  mkdirSync(join(pluginsDir, manifest.id), { recursive: true });
  const file = join(pluginsDir, manifest.id, 'plugin.json');
  writeFileSync(file, JSON.stringify(manifest));
  const reg = createRegistry({ pluginsDir, dataDir, audit });
  return { reg, file, pluginsDir, dataDir };
}

test('清单校验：拒绝 P4、未知权限、未声明权限、P3 工具', () => {
  assert.ok(validateManifest(base).ok);
  assert.ok(!validateManifest({ ...base, level: 4 }).ok);
  assert.ok(!validateManifest({ ...base, permissions: ['root:all'] }).ok);
  assert.ok(!validateManifest({ ...base, tools: [{ name: 'x', level: 1, permission: 'docker:read' }] }).ok);
  assert.ok(!validateManifest({ ...base, tools: [{ name: 'x', level: 3 }] }).ok);
  assert.ok(!validateManifest({ ...base, source: 'external', permissions: ['docker:update'], tools: [{ name: 'xy', level: 3, permission: 'docker:update' }] }).ok);
  assert.ok(validateManifest({ ...base, level: 3, permissions: ['docker:update'], tools: [{ name: 'xy', level: 3, permission: 'docker:update' }] }).ok);
  assert.ok(!validateManifest({ ...base, id: '../evil' }).ok);
});

test('安装不等于授权：未授权不能启用，授权后才能启用', () => {
  const { reg } = setup();
  reg.install('demo', '1');
  assert.throws(() => reg.enable('demo', '1'), /尚未授予权限/);
  reg.grant('demo', ['user:session'], '1');
  assert.equal(reg.enable('demo', '1').enabled, true);
  reg.revoke('demo', ['user:session'], '1');
  assert.equal(reg.get('demo').enabled, false); // 撤销全部授权后自动停用
});

test('写类权限仅内置插件可授予；外部插件不可启用', () => {
  const w = setup({ ...base, id: 'writer', source: 'external', permissions: ['docker:update'], tools: [] });
  w.reg.install('writer', '1');
  assert.throws(() => w.reg.grant('writer', ['docker:update'], '1'), /仅内置插件/);
  const b = setup({ ...base, id: 'bw', level: 3, permissions: ['docker:update'], tools: [{ name: 'docker.restart', level: 3, permission: 'docker:update' }] });
  b.reg.install('bw', '1');
  assert.deepEqual(b.reg.grant('bw', ['docker:update'], '1').grants, ['docker:update']);
  const e = setup({ ...base, id: 'ext', source: 'external' });
  e.reg.install('ext', '1'); e.reg.grant('ext', ['user:session'], '1');
  assert.throws(() => e.reg.enable('ext', '1'), /沙盒/);
});

test('完整性：清单被改动后自动停用并清空授权', () => {
  const { reg, file, pluginsDir, dataDir } = setup();
  reg.install('demo', '1'); reg.grant('demo', ['user:session'], '1'); reg.enable('demo', '1');
  const m = JSON.parse(readFileSync(file, 'utf8')); m.permissions.push('docker:read');
  writeFileSync(file, JSON.stringify(m));
  const reg2 = createRegistry({ pluginsDir, dataDir, audit });
  const v = reg2.get('demo');
  assert.equal(v.enabled, false); assert.deepEqual(v.grants, []); assert.equal(v.needsReview, true);
  assert.throws(() => reg2.enable('demo', '1'), /重新审核/);
});

test('运行时：逐层检查并审计；好友不能调用 P2 工具', async () => {
  const { reg } = setup({ ...base, id: 'nas', level: 2, permissions: ['info:read'], tools: [{ name: 'status', level: 2, permission: 'info:read' }] });
  const rt = createPluginRuntime({ registry: reg, handlers: { nas: { status: () => ({ up: true }) } }, audit });
  const owner = { id: '1', role: 'owner' }, friend = { id: '2', role: 'friend' };
  await assert.rejects(() => rt.invoke(owner, 'nas', 'status'), /未启用/);
  reg.install('nas', '1'); reg.grant('nas', ['info:read'], '1'); reg.enable('nas', '1');
  assert.deepEqual(await rt.invoke(owner, 'nas', 'status'), { up: true });
  await assert.rejects(() => rt.invoke(friend, 'nas', 'status'), /权限不足/);
  await assert.rejects(() => rt.invoke(owner, 'nas', 'nope'), /工具不存在/);
  assert.ok(audit.events.some((e) => e.type === 'plugin.invoke.denied' && e.userId === '2'));
});
