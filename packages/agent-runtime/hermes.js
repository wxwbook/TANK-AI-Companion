import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../core/config.js';

export function loadPersona() {
  return JSON.parse(readFileSync(join(ROOT, 'roles', 'da-fei-yu', 'persona.json'), 'utf8'));
}

// 注意：Hermes 会把我们的 system 消息“叠加”在它自己的核心提示词之上，
// 因此这里的人格只能影响语气，不能（也不应）改变 Hermes 的工具权限。
// userTag 让不同用户的 system 提示词互不相同，避免 Hermes 按“system+首条消息”推导出同一会话。
export function buildSystemPrompt(persona, memories = [], summary = '', userTag = '', extra = '') {
  const parts = [persona.core, persona.tone, '规则：\n' + persona.rules.map((r) => `- ${r}`).join('\n')];
  if (persona.address) parts.push(`对用户的称呼：${persona.address}`);
  const scenes = Object.entries(persona.scenes || {});
  if (scenes.length) parts.push('场景风格：\n' + scenes.map(([k, v]) => `- ${k}：${v}`).join('\n'));
  if (userTag) parts.push(`当前对话用户标识：${userTag}（仅用于隔离，不要向用户复述）`);
  if (memories.length) parts.push('用户已确认的记忆：\n' + memories.map((m) => `- ${m.text}`).join('\n'));
  if (summary) parts.push('此前对话摘要：\n' + summary);
  if (extra) parts.push(extra);
  return parts.join('\n\n');
}

export class HermesError extends Error {
  constructor(message, { status, code } = {}) { super(message); this.status = status; this.code = code; }
}

const origin = (baseUrl) => baseUrl.replace(/\/v1$/, '');

// Hermes API Server 客户端（已按官方文档核对）：
//   POST {base}/chat/completions   Authorization: Bearer API_SERVER_KEY   model 默认 "hermes-agent"
//   GET  {origin}/health           无需认证
//   GET  {base}/capabilities       需认证，返回 features
export function createHermesClient(cfg, fetchImpl = fetch) {
  const enabled = !!cfg.baseUrl;
  const auth = cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {};

  return {
    enabled,
    async chat(messages, { timeoutMs = cfg.timeoutMs || 120000 } = {}) {
      if (!enabled) {
        return { text: '（离线模式：尚未配置 HERMES_BASE_URL，无法调用模型。）', usage: null, offline: true };
      }
      let res;
      try {
        res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...auth },
          body: JSON.stringify({ model: cfg.model, messages, stream: false }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        throw new HermesError(e.name === 'TimeoutError' ? 'Hermes 响应超时' : 'Hermes 连接失败', { code: 'unreachable' });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = data?.error?.code || data?.error?.type || '';
        const msg = res.status === 401 ? 'Hermes 认证失败（检查 API_SERVER_KEY）'
          : res.status === 409 ? 'Hermes 会话冲突（admission_conflict）'
          : res.status === 429 ? 'Hermes 并发已满，请稍后再试'
          : res.status === 503 ? 'Hermes 正在重启或存储繁忙，请稍后再试'
          : `Hermes 返回 ${res.status}`;
        throw new HermesError(msg, { status: res.status, code });
      }
      const choice = data?.choices?.[0];
      const finish = choice?.finish_reason;
      // 官方语义：中断为 cancelled，失败为 error；迭代预算用尽时 finish_reason=length 但内容仍可用。
      if (finish === 'error' || finish === 'cancelled') {
        throw new HermesError(finish === 'cancelled' ? 'Hermes 任务被中断' : 'Hermes 执行失败', { code: finish });
      }
      const u = data?.usage;
      return {
        text: choice?.message?.content ?? '',
        offline: false,
        truncated: finish === 'length',
        usage: u ? { promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens, source: 'measured' } : null,
      };
    },

    // 探测：/health（公开）+ /v1/capabilities（带密钥）。不暴露密钥，不抛错。
    async probe() {
      if (!enabled) return { configured: false };
      const out = { configured: true, reachable: false, authenticated: null, features: null };
      try {
        const h = await fetchImpl(`${origin(cfg.baseUrl)}/health`, { signal: AbortSignal.timeout(5000) });
        out.reachable = h.ok;
      } catch { return out; }
      try {
        const c = await fetchImpl(`${cfg.baseUrl}/capabilities`, { headers: auth, signal: AbortSignal.timeout(5000) });
        out.authenticated = c.status !== 401 && c.status !== 403;
        if (c.ok) out.features = (await c.json())?.features ?? null;
      } catch { /* 旧版本可能没有 capabilities */ }
      return out;
    },
  };
}

// 按角色选择 Hermes：好友只能使用独立的受限 Profile，未配置则不开放，绝不回退到 Owner 的 Hermes。
export function createHermesRouter(ownerClient, friendClient) {
  return {
    forUser(user) {
      if (user.role === 'owner') return ownerClient;
      return friendClient?.enabled ? friendClient : null;
    },
    owner: ownerClient,
    friend: friendClient,
  };
}
