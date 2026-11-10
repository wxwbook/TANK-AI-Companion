import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../packages/core/config.js';
import { createServices } from '../packages/core/app.js';
import { planDispatch, planMemory } from '../packages/agent-runtime/team.js';
import { agentStatus } from '../packages/agent-runtime/agents.js';

const owner = { id: '1', role: 'owner' }, friend = { id: '2', role: 'friend' };
const mk = (hermes) => createServices(loadConfig({ OWNER_TELEGRAM_ID: '1', FRIEND_TELEGRAM_IDS: '2', DATA_DIR: mkdtempSync(join(tmpdir(), 'team-')) }), { hermes });

test('调度规划：运维只匹配整句指令，读取按关键词', () => {
  assert.deepEqual(planDispatch('重启 emby').ops, { action: 'restart', target: 'emby' });
  assert.equal(planDispatch('帮我分析为什么要重启 emby 容器很慢').ops, null);
  assert.deepEqual(planDispatch('NAS 状态怎么样').reads.map((r) => r.tool), ['status']);
  assert.deepEqual(planDispatch('看看磁盘和阵列').reads.map((r) => r.tool).sort(), ['array.status', 'disks.list']);
  assert.equal(planMemory('记住 我喜欢茶').op, 'add');
  assert.equal(planMemory('我的记忆').op, 'list');
});

test('记忆管理员：自然语言增删查，用户之间隔离，且不调用模型', async () => {
  let called = false;
  const svc = mk({ enabled: true, chat: async () => { called = true; return { text: 'x' }; } });
  assert.match((await svc.chat.send(owner, '记住 我喜欢茶')).reply, /已记住/);
  assert.match((await svc.chat.send(owner, '我的记忆')).reply, /喜欢茶/);
  assert.match((await svc.chat.send(friend, '我的记忆').catch((e) => ({ reply: e.message }))).reply, /好友聊天尚未开放|目前没有记忆/);
  assert.equal(called, false);
  const id = svc.store.listMemories('1')[0].id;
  assert.match((await svc.chat.send(owner, `忘记 ${id}`)).reply, /已忘记/);
  assert.ok(svc.tasks.list(owner).some((t) => t.agent === 'memory-manager'));
});

test('NAS 管家：Owner 触发只读报告并按角色记任务；好友不触发；可被关闭', async () => {
  let sys = '';
  const svc = mk({ enabled: true, chat: async (m) => { sys = m[0].content; return { text: 'ok' }; } });
  await svc.chat.send(owner, 'NAS 状态怎么样');
  assert.match(sys, /NAS 管家的只读报告/);
  assert.match(sys, /插件未启用|模拟数据|simulated/); // 插件未启用时如实告知错误
  assert.ok(svc.tasks.list(owner).some((t) => t.agent === 'nas-operator'));
  svc.agentSettings.set('nas-operator', false);
  sys = ''; await svc.chat.send(owner, 'NAS 状态怎么样');
  assert.doesNotMatch(sys, /NAS 管家的只读报告/);
});

test('研究员/设计师：叠加角色提示词；状态列表区分 planned 与 disabled', async () => {
  let sys = '';
  const svc = mk({ enabled: true, chat: async (m) => { sys = m[0].content; return { text: 'ok' }; } });
  await svc.chat.send(owner, '帮我对比一下两个方案');
  assert.match(sys, /研究员/);
  await svc.chat.send(owner, '帮我想个 slogan');
  assert.match(sys, /创意设计师/);
  svc.agentSettings.set('designer', false);
  const st = agentStatus(svc.tasks.list(owner), svc.agentSettings, owner);
  assert.equal(st.find((a) => a.id === 'designer').status, 'disabled');
  assert.equal(st.find((a) => a.id === 'media-manager').status, 'planned');
  assert.throws(() => svc.agentSettings.set('media-manager', true), /尚未接入/);
  assert.throws(() => svc.agentSettings.set('manager', false), /不可关闭/);
  assert.equal(agentStatus([], svc.agentSettings, friend).some((a) => a.id === 'nas-operator'), false);
});
