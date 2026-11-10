import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHermesClient, createHermesRouter, buildSystemPrompt, loadPersona } from '../packages/agent-runtime/hermes.js';
import { loadConfig } from '../packages/core/config.js';

const mk = (status, body) => async () => ({ ok: status < 300, status, json: async () => body });
const cfg = { baseUrl: 'http://h:8642/v1', apiKey: 'k', model: 'hermes-agent', timeoutMs: 1000 };

test('配置：自动补 /v1，model 默认 hermes-agent，兼容旧变量名', () => {
  const c = loadConfig({ HERMES_BASE_URL: 'http://h:8642/', UNRAID_API_TOKEN: 'old' });
  assert.equal(c.hermes.baseUrl, 'http://h:8642/v1');
  assert.equal(c.hermes.model, 'hermes-agent');
  assert.equal(c.unraid.apiKey, 'old');
  assert.equal(c.hermesFriend.baseUrl, '');
});

test('Hermes：请求格式、认证头与 usage 解析', async () => {
  let captured;
  const f = async (url, init) => { captured = { url, init }; return mk(200, { choices: [{ message: { content: '嗨' }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 5 } })(); };
  const r = await createHermesClient(cfg, f).chat([{ role: 'user', content: 'hi' }]);
  assert.equal(captured.url, 'http://h:8642/v1/chat/completions');
  assert.equal(captured.init.headers.authorization, 'Bearer k');
  assert.deepEqual(JSON.parse(captured.init.body).model, 'hermes-agent');
  assert.equal(r.text, '嗨'); assert.equal(r.usage.source, 'measured'); assert.equal(r.usage.promptTokens, 50);
});

test('Hermes：finish_reason=error/cancelled 抛错，length 视为可用的截断答案', async () => {
  const run = (finish) => createHermesClient(cfg, mk(200, { choices: [{ message: { content: 'x' }, finish_reason: finish }] })).chat([]);
  await assert.rejects(() => run('error'), /失败/);
  await assert.rejects(() => run('cancelled'), /中断/);
  assert.equal((await run('length')).truncated, true);
});

test('Hermes：HTTP 错误映射为明确提示', async () => {
  for (const [st, re] of [[401, /认证失败/], [409, /会话冲突/], [429, /并发/], [503, /重启/]])
    await assert.rejects(() => createHermesClient(cfg, mk(st, { error: { code: 'x' } })).chat([]), re);
});

test('Hermes：未配置为离线模式；探测不抛错', async () => {
  const off = createHermesClient({ baseUrl: '' });
  assert.equal((await off.chat([])).offline, true);
  assert.deepEqual(await off.probe(), { configured: false });
  const f = async (url) => url.endsWith('/health') ? { ok: true, status: 200 }
    : { ok: true, status: 200, json: async () => ({ features: { chat_completions: true } }) };
  const p = await createHermesClient(cfg, f).probe();
  assert.equal(p.reachable, true); assert.equal(p.authenticated, true); assert.equal(p.features.chat_completions, true);
});

test('路由：好友绝不回退到 Owner 的 Hermes', () => {
  const owner = createHermesClient(cfg), none = createHermesClient({ baseUrl: '' });
  const r = createHermesRouter(owner, none);
  assert.equal(r.forUser({ role: 'owner' }), owner);
  assert.equal(r.forUser({ role: 'friend' }), null);
  const friend = createHermesClient({ ...cfg, baseUrl: 'http://h:8643/v1' });
  assert.equal(createHermesRouter(owner, friend).forUser({ role: 'friend' }), friend);
});

test('系统提示词：不同用户标识使会话推导互不相同', () => {
  const p = loadPersona();
  assert.notEqual(buildSystemPrompt(p, [], '', 'tank-1'), buildSystemPrompt(p, [], '', 'tank-2'));
});
