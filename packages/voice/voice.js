// 语音中心：STT（语音转文字）与 TTS（文字转语音），按 OpenAI 兼容接口实现：
//   TTS  POST {base}/audio/speech          JSON { model, input, voice, response_format }
//   STT  POST {base}/audio/transcriptions  multipart { file, model }
// 密钥只在服务端环境变量中，前端与日志永远看不到。使用云端服务时会明确提示“语音将发送到第三方”。
const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|.*\.(local|lan|internal)$|[^.]+$)/;
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const isCloud = (u) => !!u && !PRIVATE.test(hostOf(u));
const MAX_TTS_CHARS = 600;
const MAX_AUDIO = 5 * 1024 * 1024;

export function createVoice(cfg, store, fetchImpl = fetch) {
  const ttsOn = !!cfg.tts.baseUrl, sttOn = !!cfg.stt.baseUrl;
  const auth = (k) => (k ? { authorization: `Bearer ${k}` } : {});
  const defaults = { enabled: false, replyWithVoice: false, voice: cfg.tts.voices[0] };

  const settings = (uid) => ({ ...defaults, ...(store.getPrefs(uid).voice || {}) });

  return {
    ttsConfigured: ttsOn, sttConfigured: sttOn,
    settings,
    setSettings(uid, patch) {
      const cur = settings(uid); const next = { ...cur };
      if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
      if (typeof patch.replyWithVoice === 'boolean') next.replyWithVoice = patch.replyWithVoice;
      if (patch.voice !== undefined) {
        if (!cfg.tts.voices.includes(patch.voice)) { const e = new Error('音色不在可选列表内'); e.status = 400; throw e; }
        next.voice = patch.voice;
      }
      const prefs = store.getPrefs(uid); store.setPrefs(uid, { ...prefs, voice: next });
      return next;
    },
    // 状态不含任何密钥
    status(uid) {
      return {
        tts: { configured: ttsOn, cloud: isCloud(cfg.tts.baseUrl), host: hostOf(cfg.tts.baseUrl), voices: cfg.tts.voices, model: cfg.tts.model },
        stt: { configured: sttOn, cloud: isCloud(cfg.stt.baseUrl), host: hostOf(cfg.stt.baseUrl), model: cfg.stt.model },
        settings: settings(uid),
        privacy: (isCloud(cfg.tts.baseUrl) || isCloud(cfg.stt.baseUrl)) ? '语音内容会发送到第三方云服务，请确认你接受。' : '语音服务在本地/内网。',
      };
    },
    async tts(text, { voice, format = 'mp3' } = {}) {
      if (!ttsOn) { const e = new Error('语音合成未配置（VOICE_TTS_BASE_URL）'); e.status = 400; throw e; }
      if (typeof text !== 'string' || !text.trim() || text.length > MAX_TTS_CHARS) { const e = new Error(`文本需为 1–${MAX_TTS_CHARS} 字`); e.status = 400; throw e; }
      if (voice && !cfg.tts.voices.includes(voice)) { const e = new Error('音色不在可选列表内'); e.status = 400; throw e; }
      let res;
      try {
        res = await fetchImpl(`${cfg.tts.baseUrl}/audio/speech`, {
          method: 'POST', headers: { 'content-type': 'application/json', ...auth(cfg.tts.apiKey) },
          body: JSON.stringify({ model: cfg.tts.model, input: text, voice: voice || cfg.tts.voices[0], response_format: format }),
          signal: AbortSignal.timeout(30000) });
      } catch { const e = new Error('语音合成服务连接失败'); e.status = 502; throw e; }
      if (!res.ok) { const e = new Error(`语音合成服务返回 ${res.status}`); e.status = 502; throw e; }
      return { mime: format === 'opus' ? 'audio/ogg' : 'audio/mpeg', data: Buffer.from(await res.arrayBuffer()) };
    },
    async stt(buffer, mime = 'audio/ogg', filename = 'audio.ogg') {
      if (!sttOn) { const e = new Error('语音识别未配置（VOICE_STT_BASE_URL）'); e.status = 400; throw e; }
      if (!buffer?.length || buffer.length > MAX_AUDIO) { const e = new Error('音频为空或超过 5MB'); e.status = 400; throw e; }
      const form = new FormData();
      form.append('file', new Blob([buffer], { type: mime }), filename);
      form.append('model', cfg.stt.model);
      let res;
      try { res = await fetchImpl(`${cfg.stt.baseUrl}/audio/transcriptions`, { method: 'POST', headers: auth(cfg.stt.apiKey), body: form, signal: AbortSignal.timeout(60000) }); }
      catch { const e = new Error('语音识别服务连接失败'); e.status = 502; throw e; }
      if (!res.ok) { const e = new Error(`语音识别服务返回 ${res.status}`); e.status = 502; throw e; }
      const j = await res.json().catch(() => ({}));
      return String(j.text || '').trim();
    },
    // 连通性检查：只测可达，不产生合成/识别费用
    async health() {
      const probe = async (u) => { if (!u) return 'unconfigured'; try { await fetchImpl(u, { method: 'GET', signal: AbortSignal.timeout(5000) }); return 'reachable'; } catch { return 'unreachable'; } };
      return { tts: await probe(cfg.tts.baseUrl), stt: await probe(cfg.stt.baseUrl) };
    },
    MAX_AUDIO,
  };
}
