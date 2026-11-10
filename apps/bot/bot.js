import { loadConfig } from '../../packages/core/config.js';
import { createServices } from '../../packages/core/app.js';
import { resolveUser } from '../../packages/core/permissions.js';
import { handleCommand } from '../../packages/core/commands.js';

// Telegram Bot（长轮询）。未登记用户一律不响应，只写审计。
export function createBot(svc, fetchImpl = fetch) {
  const { cfg } = svc;
  const api = (method, payload) =>
    fetchImpl(`https://api.telegram.org/bot${cfg.telegram.token}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    }).then((r) => r.json());

  const send = (chatId, text, extra = {}) =>
    api('sendMessage', { chat_id: chatId, text: text.slice(0, 4000), ...extra });

  async function handleCallback(cb) {
    const user = resolveUser(cfg, cb.from?.id);
    const m = /^ap:([0-9a-f-]{36}):([01])$/.exec(cb.data || '');
    if (!user || !m || user.role !== 'owner') {
      svc.audit.record({ type: 'auth.denied', telegramId: String(cb.from?.id ?? ''), via: 'callback' });
      return api('answerCallbackQuery', { callback_query_id: cb.id, text: '无权限' });
    }
    try {
      const r = await svc.ops.decide(user, m[1], m[2] === '1');
      const text = m[2] === '1' ? `已批准并执行：${r.action} ${r.target}${r.rollback ? `（回滚：${r.rollback}）` : ''}` : '已拒绝';
      await api('answerCallbackQuery', { callback_query_id: cb.id, text: text.slice(0, 190) });
      if (cb.message) await api('editMessageText', { chat_id: cb.message.chat.id, message_id: cb.message.message_id, text });
    } catch (e) {
      await api('answerCallbackQuery', { callback_query_id: cb.id, text: String(e.message).slice(0, 190), show_alert: true });
    }
  }

  const approvalButtons = (id) => ({ reply_markup: { inline_keyboard: [[{ text: '✅ 批准执行', callback_data: `ap:${id}:1` }, { text: '❌ 拒绝', callback_data: `ap:${id}:0` }]] } });

  async function sendVoice(chatId, audio) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('voice', new Blob([audio.data], { type: audio.mime }), 'reply.ogg');
    return fetchImpl(`https://api.telegram.org/bot${cfg.telegram.token}/sendVoice`, { method: 'POST', body: form });
  }

  // 语音消息 → STT → 文本。需要用户已 /voice on 且服务端已配置 STT。
  async function transcribe(msg, user) {
    const prefs = svc.voice.settings(user.id);
    if (!prefs.enabled) { await send(msg.chat.id, '语音功能未开启，发送 /voice on 开启。'); return null; }
    if (!svc.voice.sttConfigured) { await send(msg.chat.id, '语音识别尚未配置。'); return null; }
    const info = await api('getFile', { file_id: msg.voice.file_id });
    const res = await fetchImpl(`https://api.telegram.org/file/bot${cfg.telegram.token}/${info.result.file_path}`);
    const text = await svc.voice.stt(Buffer.from(await res.arrayBuffer()), 'audio/ogg', 'voice.ogg');
    if (!text) { await send(msg.chat.id, '没听清，再说一次？'); return null; }
    await send(msg.chat.id, `🎤 ${text}`);
    return text;
  }

  async function handleUpdate(u) {
    if (u.callback_query) return handleCallback(u.callback_query);
    const msg = u.message;
    if (!msg || msg.chat?.type !== 'private' || (!msg.text && !msg.voice)) return; // 仅私聊
    const user = resolveUser(cfg, msg.from?.id);
    if (!user) {
      svc.audit.record({ type: 'auth.denied', telegramId: String(msg.from?.id ?? '') });
      return;
    }
    try {
      if (msg.voice) { const t = await transcribe(msg, user); if (!t) return; msg.text = t; }
      const cmdReply = await handleCommand(svc, user, msg.text);
      if (cmdReply !== null && typeof cmdReply === 'object') return send(msg.chat.id, cmdReply.text, cmdReply.approvalId ? approvalButtons(cmdReply.approvalId) : {});
      if (cmdReply !== null) {
        const extra = /^\/(start|help)/.test(msg.text) && cfg.telegram.miniAppUrl
          ? { reply_markup: { inline_keyboard: [[{ text: '打开工作台', web_app: { url: cfg.telegram.miniAppUrl } }]] } } : {};
        return send(msg.chat.id, cmdReply, extra);
      }
      await api('sendChatAction', { chat_id: msg.chat.id, action: 'typing' });
      const r = await svc.chat.send(user, msg.text);
      await send(msg.chat.id, r.reply || '（空回复）', r.approval ? approvalButtons(r.approval.id) : {});
      const vp = svc.voice.settings(user.id);
      if (vp.enabled && vp.replyWithVoice && svc.voice.ttsConfigured && r.reply && r.reply.length <= 600 && !r.offline) {
        try { await sendVoice(msg.chat.id, await svc.voice.tts(r.reply, { voice: vp.voice, format: 'opus' })); } catch { /* 语音失败不影响文字回复 */ }
      }
    } catch (e) {
      await send(msg.chat.id, '出了点问题，稍后再试。');
    }
  }

  async function poll(signal) {
    let offset = 0;
    while (!signal?.aborted) {
      try {
        const res = await api('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
        for (const u of res.result || []) { offset = u.update_id + 1; await handleUpdate(u); }
      } catch { await new Promise((r) => setTimeout(r, 3000)); }
    }
  }
  return { handleUpdate, poll };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig();
  if (!cfg.telegram.token) { console.error('缺少 TELEGRAM_BOT_TOKEN'); process.exit(1); }
  createBot(createServices(cfg)).poll();
  console.log('大肥鱼 Bot 已启动（长轮询）');
}
