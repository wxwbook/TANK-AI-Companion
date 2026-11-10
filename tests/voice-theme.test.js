import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../packages/core/config.js';
import { createServices } from '../packages/core/app.js';
import { createVoice } from '../packages/voice/voice.js';
import { createMemoryStore } from '../packages/memory-engine/store.js';
import { validateTheme } from '../packages/core/themes.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'vt-'));
const vcfg = (over = {}) => ({ tts: { baseUrl: 'https://api.example.com/v1', apiKey: 'SECRETKEY', model: 'tts-1', voices: ['alloy', 'nova'] },
  stt: { baseUrl: 'http://192.168.1.5:9000/v1', apiKey: '', model: 'whisper-1' }, ...over });

test('语音：TTS 请求格式、音色校验、状态不泄露密钥并提示云端', async () => {
  let cap;
  const f = async (url, init) => { cap = { url, init }; return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }; };
  const v = createVoice(vcfg(), createMemoryStore(tmp()), f);
  const out = await v.tts('你好', { voice: 'nova' });
  assert.equal(cap.url, 'https://api.example.com/v1/audio/speech');
  assert.equal(cap.init.headers.authorization, 'Bearer SECRETKEY');
  assert.equal(JSON.parse(cap.init.body).voice, 'nova'); assert.equal(out.data.length, 3);
  await assert.rejects(() => v.tts('hi', { voice: 'evil' }), /音色/);
  await assert.rejects(() => v.tts('x'.repeat(601)), /文本/);
  const st = v.status('1');
  assert.equal(st.tts.cloud, true); assert.equal(st.stt.cloud, false); assert.match(st.privacy, /第三方/);
  assert.equal(JSON.stringify(st).includes('SECRETKEY'), false);
});

test('语音：STT 使用 multipart；设置按用户保存；未配置给出明确提示', async () => {
  let cap;
  const f = async (url, init) => { cap = { url, init }; return { ok: true, status: 200, json: async () => ({ text: ' 你好世界 ' }) }; };
  const store = createMemoryStore(tmp());
  const v = createVoice(vcfg(), store, f);
  assert.equal(await v.stt(Buffer.from('abc')), '你好世界');
  assert.equal(cap.url, 'http://192.168.1.5:9000/v1/audio/transcriptions'); assert.ok(cap.init.body instanceof FormData);
  await assert.rejects(() => v.stt(Buffer.alloc(0)), /为空/);
  v.setSettings('1', { enabled: true, voice: 'nova' });
  assert.equal(v.settings('1').voice, 'nova'); assert.equal(v.settings('2').enabled, false);
  assert.throws(() => v.setSettings('1', { voice: 'nope' }), /音色/);
  const off = createVoice({ tts: { baseUrl: '', voices: ['a'] }, stt: { baseUrl: '' } }, store);
  await assert.rejects(() => off.tts('hi'), /未配置/); await assert.rejects(() => off.stt(Buffer.from('a')), /未配置/);
});

test('主题：白名单变量与颜色；内置主题可用；导入不能覆盖内置或夹带 url()', () => {
  const svc = createServices(loadConfig({ OWNER_TELEGRAM_ID: '1', DATA_DIR: tmp() }));
  assert.ok(['dark-tech', 'light', 'sakura'].every((id) => svc.themes.has(id)));
  const t = JSON.parse(JSON.stringify(svc.themes.get('light')));
  assert.ok(validateTheme(t).ok);
  assert.ok(!validateTheme({ ...t, vars: { ...t.vars, '--bg': 'url(http://evil/x.png)' } }).ok);
  assert.ok(!validateTheme({ ...t, vars: { ...t.vars, '--evil': '#000000' } }).ok);
  assert.throws(() => svc.themes.import({ ...t, id: 'light' }, '1'), /覆盖内置/);
  assert.equal(svc.themes.import({ ...t, id: 'my-theme', name: '我的' }, '1').id, 'my-theme');
  assert.equal(svc.themes.get('不存在').id, 'dark-tech'); // 回退默认
});
