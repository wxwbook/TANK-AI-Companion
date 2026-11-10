import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../packages/core/config.js';
import { createServices } from '../packages/core/app.js';
import { handleCommand } from '../packages/core/commands.js';

const svc = createServices(loadConfig({ OWNER_TELEGRAM_ID: '1', FRIEND_TELEGRAM_IDS: '2', DATA_DIR: mkdtempSync(join(tmpdir(), 'tank-cmd-')) }));
const owner = { id: '1', role: 'owner' }, friend = { id: '2', role: 'friend' };

test('指令：记忆、日记、权限边界', async () => {
  assert.match(await handleCommand(svc, owner, '/remember 我住在上海'), /已记住/);
  assert.match(await handleCommand(svc, owner, '/memories'), /上海/);
  assert.doesNotMatch(await handleCommand(svc, friend, '/memories'), /上海/);
  assert.match(await handleCommand(svc, friend, '/status'), /只有 Owner/);
  assert.match(await handleCommand(svc, owner, '/status'), /模拟数据/);
  assert.equal(await handleCommand(svc, owner, '普通聊天'), null);
  assert.match(await handleCommand(svc, owner, '/erase'), /confirm/);
});
