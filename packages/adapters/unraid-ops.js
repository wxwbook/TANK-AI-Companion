import { defaultTransport, UnraidError } from './unraid.js';

// 受控写操作：只支持 容器 restart/start/stop；使用独立的写密钥；目标必须在白名单内。
// 其它写接口（创建/删除容器、VM、阵列、重启/关机）代码层不存在。
export const ACTIONS = { restart: null, start: 'stop', stop: 'start' }; // 值为回滚动作
const NAME = /^[A-Za-z0-9_.-]{1,64}$/;

export function createUnraidOps(cfg, { transport, reader } = {}) {
  const enabled = !!(cfg.writeEnabled && cfg.writeApiKey && cfg.url && cfg.writeAllowlist?.length);
  const send = transport ?? (enabled ? defaultTransport({ ...cfg, apiKey: cfg.writeApiKey }) : null);

  function validate(action, target) {
    if (!enabled) throw new UnraidError('写操作未启用（需 UNRAID_WRITE_ENABLED、UNRAID_WRITE_API_KEY、UNRAID_WRITE_ALLOWLIST）');
    if (!(action in ACTIONS)) throw new UnraidError('不支持的动作');
    if (!NAME.test(target || '')) throw new UnraidError('容器名非法');
    if (!cfg.writeAllowlist.includes(target)) throw new UnraidError(`容器 ${target} 不在写操作白名单内`);
  }

  return {
    enabled,
    allowlist: cfg.writeAllowlist || [],
    validate,
    // 申请前检查目标存在（读接口）
    async inspect(target) { return reader.get(`/api/docker/containers/${target}`); },
    async execute(action, target) {
      validate(action, target);
      let res;
      try { res = await send('POST', `/api/docker/containers/${target}/${action}`); }
      catch { throw new UnraidError('UnraidClaw 连接失败'); }
      if (res.status === 401) throw new UnraidError('写密钥认证失败', 401);
      if (res.status === 403) throw new UnraidError('写密钥权限不足：需在 UnraidClaw 启用 docker:update', 403);
      if (res.status < 200 || res.status >= 300 || res.body?.ok !== true) throw new UnraidError(`UnraidClaw 返回 ${res.status}`, res.status);
      return { rollback: ACTIONS[action] };
    },
  };
}
