import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../packages/core/config.js';
import { createServices } from '../packages/core/app.js';

test('好友聊天：未配置独立 Profile 时被拒绝并留审计，且不会调用 Owner 的 Hermes', async () => {
  let ownerCalled = false;
  const owner = { enabled: true, chat: async () => { ownerCalled = true; return { text: 'x', usage: null }; } };
  const svc = createServices(loadConfig({ OWNER_TELEGRAM_ID: '1', FRIEND_TELEGRAM_IDS: '2', DATA_DIR: mkdtempSync(join(tmpdir(), 'fc-')) }), { hermes: owner });
  await assert.rejects(() => svc.chat.send({ id: '2', role: 'friend' }, '你好'), /好友聊天尚未开放/);
  assert.equal(ownerCalled, false);
  await svc.chat.send({ id: '1', role: 'owner' }, '你好');
  assert.equal(ownerCalled, true);
});
