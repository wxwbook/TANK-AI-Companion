import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';

// UnraidClaw 只读适配器（已按其 README 核对）：
//   HTTPS，默认端口 9876；认证头 x-api-key；响应信封 { ok, data }。
//   服务端按 resource:action 权限矩阵放行，建议使用“Read Only”预设的专用密钥。
// 本适配器额外做两层保护：只发 GET；只允许下面白名单里的读取路径。
// 刻意不包含 /api/logs/syslog 与容器日志（可能含敏感信息）。
const READ_ALLOWLIST = [
  /^\/api\/health$/,
  /^\/api\/system\/(info|metrics|services)$/,
  /^\/api\/docker\/containers$/,
  /^\/api\/docker\/containers\/[A-Za-z0-9_.-]{1,128}$/,
  /^\/api\/array\/(status|parity\/status)$/,
  /^\/api\/disks$/,
  /^\/api\/disks\/[A-Za-z0-9_.:-]{1,128}$/,
  /^\/api\/shares$/,
  /^\/api\/network$/,
  /^\/api\/users\/me$/,
  /^\/api\/notifications(\/overview)?$/,
];

export class UnraidError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

// 默认传输层：node:https（可固定自签证书）。可注入以便测试。
export function defaultTransport(cfg) {
  const u = new URL(cfg.url);
  const lib = u.protocol === 'http:' ? http : https;
  const tls = {};
  if (u.protocol === 'https:') {
    if (cfg.caFile) {
      tls.ca = readFileSync(cfg.caFile);
      tls.checkServerIdentity = () => undefined; // 固定证书：只信这一张，不校验主机名（常用 IP 访问）
    } else if (cfg.tlsInsecure) {
      tls.rejectUnauthorized = false;
    }
  }
  return (method, path) => new Promise((resolve, reject) => {
    const req = lib.request({
      protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path, method, timeout: 8000, ...tls,
      headers: { 'x-api-key': cfg.apiKey, accept: 'application/json' },
    }, (res) => {
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > 2_000_000) { req.destroy(new Error('响应过大')); } else chunks.push(c); });
      res.on('end', () => {
        let body = null;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* 非 JSON */ }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

const pickName = (c) => c?.name ?? (Array.isArray(c?.names) ? c.names[0] : undefined) ?? c?.id ?? '?';
const pickState = (c) => String(c?.state ?? c?.status ?? 'unknown');
const isRunning = (c) => /^(running|up)\b/i.test(pickState(c));

export function createUnraidAdapter(cfg, { transport } = {}) {
  const configured = !!(cfg.url && cfg.apiKey);
  const send = transport ?? (configured ? defaultTransport(cfg) : null);

  async function get(path) {
    if (!configured && !transport) throw new UnraidError('未配置 UNRAID_API_URL / UNRAID_API_KEY');
    if (!READ_ALLOWLIST.some((re) => re.test(path))) throw new UnraidError('路径不在只读白名单内');
    let res;
    try { res = await send('GET', path); }
    catch (e) {
      const hint = /self.signed|UNABLE_TO_VERIFY|certificate/i.test(String(e.code || e.message))
        ? '（自签证书：请设置 UNRAID_CA_FILE 固定证书）' : '';
      throw new UnraidError('UnraidClaw 连接失败' + hint);
    }
    if (res.status === 401) throw new UnraidError('UnraidClaw 认证失败（检查 UNRAID_API_KEY）', 401);
    if (res.status === 403) throw new UnraidError('UnraidClaw 权限不足：到 Permissions 页启用对应的 :read 权限', 403);
    if (res.status < 200 || res.status >= 300) throw new UnraidError(`UnraidClaw 返回 ${res.status}`, res.status);
    if (!res.body || res.body.ok !== true) throw new UnraidError('UnraidClaw 响应格式不符（缺少 ok:true 信封）');
    return res.body.data;
  }

  return {
    configured: configured || !!transport,
    get,
    health: () => get('/api/health'),
    systemInfo: () => get('/api/system/info'),
    systemMetrics: () => get('/api/system/metrics'),
    dockerList: () => get('/api/docker/containers'),
    arrayStatus: () => get('/api/array/status'),
    disks: () => get('/api/disks'),

    // 聚合状态。各接口独立容错：一个失败不影响其它，失败原因写入 errors。
    async status() {
      if (!configured && !transport) {
        return { simulated: true, note: '未配置 UNRAID_API_URL / UNRAID_API_KEY，以下为模拟数据',
          docker: { running: 0, total: 0, containers: [] }, system: null, array: null };
      }
      const names = ['health', 'system', 'metrics', 'docker', 'array'];
      const results = await Promise.allSettled([
        this.health(), this.systemInfo(), this.systemMetrics(), this.dockerList(), this.arrayStatus()]);
      const out = { simulated: false, errors: [] };
      results.forEach((r, i) => {
        if (r.status === 'rejected') out.errors.push(`${names[i]}: ${r.reason.message}`);
        else out[names[i]] = r.value;
      });
      const list = Array.isArray(out.docker) ? out.docker : out.docker?.containers;
      if (Array.isArray(list)) {
        out.docker = { total: list.length, running: list.filter(isRunning).length,
          containers: list.map((c) => ({ name: pickName(c), state: pickState(c) })) };
      }
      return out;
    },

    // 写操作一律不提供（PHASE 11 经 Owner 审批后才开放）
    async write() { throw new UnraidError('写操作未启用：需要 Owner 审批流程（PHASE 11）'); },
  };
}
