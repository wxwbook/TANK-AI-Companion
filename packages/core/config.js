import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// 轻量 .env 读取（零依赖）。已存在的环境变量优先。
function loadDotEnv() {
  const p = resolve(ROOT, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv();

// Hermes API Server 的地址形如 http://host:8642/v1，缺少 /v1 时自动补上。
function hermesCfg(baseUrl, apiKey, model, timeout) {
  let u = (baseUrl || '').trim().replace(/\/+$/, '');
  if (u && !/\/v1$/.test(u)) u += '/v1';
  return { baseUrl: u, apiKey: apiKey || '', model: model || 'hermes-agent', timeoutMs: Number(timeout || 120000) };
}

const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 8787),
    host: env.HOST || '0.0.0.0',
    dataDir: resolve(ROOT, env.DATA_DIR || './data'),
    ownerId: env.OWNER_TELEGRAM_ID || '',
    friendIds: list(env.FRIEND_TELEGRAM_IDS),
    ownerApiToken: env.OWNER_API_TOKEN || '',
    telegram: { token: env.TELEGRAM_BOT_TOKEN || '', miniAppUrl: env.MINIAPP_URL || '' },
    // Owner 使用的 Hermes（可含终端等完整工具集）。好友必须使用独立的受限 Profile。
    hermes: hermesCfg(env.HERMES_BASE_URL, env.HERMES_API_KEY, env.HERMES_MODEL, env.HERMES_TIMEOUT_MS),
    hermesFriend: hermesCfg(env.HERMES_FRIEND_BASE_URL, env.HERMES_FRIEND_API_KEY, env.HERMES_FRIEND_MODEL, env.HERMES_TIMEOUT_MS),
    contextWindow: Number(env.CONTEXT_WINDOW_TOKENS || 32000),
    unraid: {
      url: (env.UNRAID_API_URL || '').replace(/\/$/, ''),
      apiKey: env.UNRAID_API_KEY || env.UNRAID_API_TOKEN || '',
      caFile: env.UNRAID_CA_FILE || '',          // 固定（pin）自签证书，推荐
      tlsInsecure: env.UNRAID_TLS_INSECURE === 'true', // 显式跳过证书校验（不推荐）
      // 审批式写操作（默认关闭）：使用独立的、仅含 docker:update 的密钥，并限定可操作的容器白名单
      writeEnabled: env.UNRAID_WRITE_ENABLED === 'true',
      writeApiKey: env.UNRAID_WRITE_API_KEY || '',
      writeAllowlist: list(env.UNRAID_WRITE_ALLOWLIST),
    },
    voice: {
      tts: { baseUrl: (env.VOICE_TTS_BASE_URL || '').replace(/\/$/, ''), apiKey: env.VOICE_TTS_API_KEY || '',
        model: env.VOICE_TTS_MODEL || 'tts-1', voices: list(env.VOICE_TTS_VOICES || 'alloy'), },
      stt: { baseUrl: (env.VOICE_STT_BASE_URL || '').replace(/\/$/, ''), apiKey: env.VOICE_STT_API_KEY || '',
        model: env.VOICE_STT_MODEL || 'whisper-1' },
    },
  };
}

// 日志中永不输出密钥
export function redact(cfg) {
  const mask = (s) => (s ? '***' + String(s).slice(-3) : '');
  return {
    ...cfg,
    ownerApiToken: mask(cfg.ownerApiToken),
    telegram: { ...cfg.telegram, token: mask(cfg.telegram.token) },
    hermes: { ...cfg.hermes, apiKey: mask(cfg.hermes.apiKey) },
    hermesFriend: { ...cfg.hermesFriend, apiKey: mask(cfg.hermesFriend.apiKey) },
    unraid: { ...cfg.unraid, apiKey: mask(cfg.unraid.apiKey), writeApiKey: mask(cfg.unraid.writeApiKey) },
    voice: { tts: { ...cfg.voice.tts, apiKey: mask(cfg.voice.tts.apiKey) }, stt: { ...cfg.voice.stt, apiKey: mask(cfg.voice.stt.apiKey) } },
  };
}
