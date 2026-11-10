import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join, extname, normalize } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { loadConfig, redact, ROOT } from '../../packages/core/config.js';
import { createServices } from '../../packages/core/app.js';
import { resolveUser, requireLevel, LEVEL } from '../../packages/core/permissions.js';
import { verifyInitData } from '../../packages/core/telegram-auth.js';
import { agentStatus } from '../../packages/agent-runtime/agents.js';
import { createBot } from '../bot/bot.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const MAX_BODY = 64 * 1024;

const SEC_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; script-src 'self' https://telegram.org 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; media-src 'self' blob:",
};

const safeEq = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

export function createHandler(svc) {
  const { cfg } = svc;
  const hits = new Map(); // 简易限流：每用户每分钟 60 次

  function authenticate(req) {
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (bearer && cfg.ownerApiToken && safeEq(bearer, cfg.ownerApiToken)) {
      return cfg.ownerId ? { id: cfg.ownerId, role: 'owner' } : null;
    }
    const init = req.headers['x-telegram-init-data'];
    if (init) {
      const v = verifyInitData(init, cfg.telegram.token);
      if (v.ok) return resolveUser(cfg, v.user?.id);
    }
    return null;
  }

  function rateLimit(user) {
    const now = Date.now();
    const row = (hits.get(user.id) || []).filter((t) => now - t < 60000);
    row.push(now); hits.set(user.id, row);
    if (row.length > 60) { const e = new Error('请求过于频繁'); e.status = 429; throw e; }
  }

  async function body(req) {
    let size = 0; const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) { const e = new Error('请求体过大'); e.status = 413; throw e; }
      chunks.push(c);
    }
    if (!chunks.length) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { const e = new Error('JSON 格式错误'); e.status = 400; throw e; }
  }

  async function rawBody(req, max) {
    let size = 0; const chunks = [];
    for await (const c of req) { size += c.length; if (size > max) { const e = new Error('请求体过大'); e.status = 413; throw e; } chunks.push(c); }
    return Buffer.concat(chunks);
  }

  async function api(req, url) {
    const path = url.pathname;
    if (path === '/api/health') return { ok: true, hermes: svc.hermes.enabled ? 'configured' : 'offline', time: new Date().toISOString() };

    const user = authenticate(req);
    requireLevel(user, LEVEL.P1);
    rateLimit(user);
    const m = req.method;

    if (path === '/api/me' && m === 'GET') return user;
    if (path === '/api/state' && m === 'GET') return svc.character.get();
    if (path === '/api/tasks' && m === 'GET') return svc.tasks.list(user);
    const tm = path.match(/^\/api\/tasks\/([0-9a-f]{8})$/);
    if (tm && m === 'GET') { const t = svc.tasks.get(user, tm[1]); if (!t) { const e = new Error('任务不存在'); e.status = 404; throw e; } return t; }
    if (path === '/api/agents' && m === 'GET') return agentStatus(svc.tasks.list(user), svc.agentSettings, user);
    const am = path.match(/^\/api\/agents\/([a-z-]+)$/);
    if (am && m === 'POST') { requireLevel(user, LEVEL.P2); const { enabled } = await body(req); return svc.agentSettings.set(am[1], !!enabled); }

    // ---- 审批式运维（Owner）----
    if (path === '/api/approvals' && m === 'GET') { requireLevel(user, LEVEL.P2); return { opsEnabled: svc.ops.enabled(), allowlist: svc.unraidOps.allowlist, items: svc.ops.list() }; }
    if (path === '/api/ops/docker' && m === 'POST') {
      requireLevel(user, LEVEL.P2);
      const { action, target } = await body(req);
      try { return await svc.ops.request(user, { action, target }); } catch (e) { e.status ||= 400; throw e; }
    }
    const dm = path.match(/^\/api\/approvals\/([0-9a-f-]{36})\/decide$/);
    if (dm && m === 'POST') {
      requireLevel(user, LEVEL.P2);
      const { approve } = await body(req);
      try { return await svc.ops.decide(user, dm[1], approve === true); } catch (e) { e.status ||= 400; throw e; }
    }

    // ---- 主题 / 偏好 ----
    if (path === '/api/themes' && m === 'GET') return svc.themes.list();
    if (path === '/api/themes/import' && m === 'POST') { requireLevel(user, LEVEL.P2); return svc.themes.import((await body(req)).theme, user.id); }
    if (path === '/api/prefs' && m === 'GET') {
      const p = svc.store.getPrefs(user.id); const t = svc.themes.get(p.theme);
      return { theme: t.id, form: p.form === 'original' ? 'original' : 'chibi', animations: p.animations !== false, splash: p.splash !== false, pet: p.pet !== false, themeData: t };
    }
    if (path === '/api/prefs' && m === 'POST') {
      const b = await body(req); const p = svc.store.getPrefs(user.id);
      if (b.theme !== undefined) { if (!svc.themes.has(b.theme)) { const e = new Error('主题不存在'); e.status = 400; throw e; } p.theme = b.theme; }
      if (b.form !== undefined) { if (!['chibi', 'original'].includes(b.form)) { const e = new Error('形象必须是 chibi 或 original'); e.status = 400; throw e; } p.form = b.form; }
      for (const k of ['animations', 'splash', 'pet']) if (typeof b[k] === 'boolean') p[k] = b[k];
      svc.store.setPrefs(user.id, p); return { ok: true };
    }

    // ---- 语音中心 ----
    if (path === '/api/voice' && m === 'GET') return svc.voice.status(user.id);
    if (path === '/api/voice/settings' && m === 'POST') return svc.voice.setSettings(user.id, await body(req));
    if (path === '/api/voice/health' && m === 'GET') { requireLevel(user, LEVEL.P2); return svc.voice.health(); }
    if (path === '/api/voice/tts' && m === 'POST') {
      const { text, voice } = await body(req);
      const out = await svc.voice.tts(text, { voice: voice || svc.voice.settings(user.id).voice });
      svc.audit.record({ type: 'voice.tts', userId: user.id, chars: String(text).length });
      return { __binary: out };
    }
    if (path === '/api/voice/stt' && m === 'POST') {
      const buf = await rawBody(req, svc.voice.MAX_AUDIO);
      const text = await svc.voice.stt(buf, req.headers['content-type'] || 'audio/ogg');
      svc.audit.record({ type: 'voice.stt', userId: user.id, bytes: buf.length });
      return { text };
    }

    // ---- 创造工坊（Owner）----
    if (path === '/api/workshop/drafts' && m === 'GET') return svc.workshop.list(user);
    if (path === '/api/workshop/drafts' && m === 'POST') return svc.workshop.create(user, (await body(req)).request);
    const wd = path.match(/^\/api\/workshop\/drafts\/([0-9a-f]{8})(?:\/(publish|reject))?$/);
    if (wd && m === 'GET' && !wd[2]) return svc.workshop.get(user, wd[1]);
    if (wd && wd[2] === 'publish' && m === 'POST') return svc.workshop.publish(user, wd[1]);
    if (wd && wd[2] === 'reject' && m === 'POST') return svc.workshop.reject(user, wd[1]);
    const wr = path.match(/^\/api\/workshop\/(rollback|remove)\/(gen-[a-z0-9-]+)$/);
    if (wr && m === 'POST') return svc.workshop[wr[1]](user, wr[2]);

    // ---- 人格工坊（Owner）----
    if (path === '/api/persona' && m === 'GET') { requireLevel(user, LEVEL.P2); return svc.personaStore.list(); }
    if (path === '/api/persona/import' && m === 'POST') { requireLevel(user, LEVEL.P2); const { card, note } = await body(req); return svc.personaStore.import(card, { by: user.id, note }); }
    if (path === '/api/persona/diff' && m === 'GET') { requireLevel(user, LEVEL.P2); return svc.personaStore.diff(url.searchParams.get('from'), url.searchParams.get('to')); }
    const pv = path.match(/^\/api\/persona\/(\d+)(?:\/(activate))?$/);
    if (pv && m === 'GET' && !pv[2]) { requireLevel(user, LEVEL.P2); const v = svc.personaStore.get(pv[1]); if (!v) { const e = new Error('版本不存在'); e.status = 404; throw e; } return v; }
    if (pv && pv[2] === 'activate' && m === 'POST') { requireLevel(user, LEVEL.P2); return svc.personaStore.activate(pv[1], user.id); }
    if (path === '/api/context' && m === 'GET') return svc.chat.usage(user.id);
    if (path === '/api/context/compact' && m === 'POST') return svc.chat.compact(user);

    if (path === '/api/memories') {
      if (m === 'GET') return svc.store.listMemories(user.id);
      if (m === 'POST') return svc.store.addMemory(user.id, (await body(req)).text);
    }
    if (path.startsWith('/api/memories/') && m === 'PUT') { const x = svc.store.updateMemory(user.id, path.split('/').pop(), (await body(req)).text); if (!x) { const e = new Error('不存在'); e.status = 404; throw e; } return x; }
    if (path.startsWith('/api/diary/') && m === 'PUT') { const x = svc.store.updateDiary(user.id, path.split('/').pop(), (await body(req)).text); if (!x) { const e = new Error('不存在'); e.status = 404; throw e; } return x; }
    if (path.startsWith('/api/memories/') && m === 'DELETE') return { removed: svc.store.removeMemory(user.id, path.split('/').pop()) };
    if (path === '/api/diary') {
      if (m === 'GET') return svc.store.listDiary(user.id);
      if (m === 'POST') return svc.store.addDiary(user.id, (await body(req)).text);
    }
    if (path.startsWith('/api/diary/') && m === 'DELETE') return { removed: svc.store.removeDiary(user.id, path.split('/').pop()) };

    if (path === '/api/chat' && m === 'POST') {
      const { text } = await body(req);
      if (!text || typeof text !== 'string' || text.length > 4000) { const e = new Error('text 必填且不超过 4000 字'); e.status = 400; throw e; }
      return svc.chat.send(user, text);
    }

    if (path === '/api/unraid/status' && m === 'GET') {
      requireLevel(user, LEVEL.P2);
      const s = await svc.unraid.status();
      svc.audit.record({ type: 'unraid.status', userId: user.id, simulated: !!s.simulated });
      return s;
    }

    // ---- 集成状态（Owner）：探测 Hermes / UnraidClaw，不返回任何密钥 ----
    if (path === '/api/integrations' && m === 'GET') {
      requireLevel(user, LEVEL.P2);
      let unraid = { configured: false };
      if (svc.unraid.configured) {
        try { await svc.unraid.health(); unraid = { configured: true, reachable: true }; }
        catch (e) { unraid = { configured: true, reachable: false, error: e.message }; }
      }
      return { hermes: { owner: await svc.hermes.probe(), friend: await svc.hermesFriend.probe() }, unraid };
    }

    // ---- 插件中心 ----
    if (path === '/api/plugins' && m === 'GET') {
      const all = svc.registry.list();
      return user.role === 'owner' ? all : all.filter((p) => p.enabled && p.level <= LEVEL.P1)
        .map(({ id, name, version, type, description, level }) => ({ id, name, version, type, description, level }));
    }
    const pm = path.match(/^\/api\/plugins\/([a-z0-9-]+)(?:\/(install|enable|disable|grant|revoke|rollback-state|health|tools\/[a-z0-9._-]+))?$/);
    if (pm) {
      const [, pid, act] = pm;
      const reg = svc.registry;
      const asBadRequest = (fn) => { try { return fn(); } catch (e) { e.status ||= 400; throw e; } };
      if (!act && m === 'GET') {
        requireLevel(user, LEVEL.P2);
        const p = reg.get(pid); if (!p) { const e = new Error('插件不存在'); e.status = 404; throw e; } return p;
      }
      if (act === 'health' && m === 'GET') {
        requireLevel(user, LEVEL.P2);
        const p = reg.get(pid); if (!p) { const e = new Error('插件不存在'); e.status = 404; throw e; }
        const out = { id: pid, installed: p.installed, enabled: p.enabled, valid: p.valid, integrity: !p.needsReview,
          requiresOk: p.requires.every((d) => reg.isEnabled(d)), tools: p.tools.length };
        if (pid === 'unraid' && p.enabled) { try { await svc.unraid.health(); out.backend = 'ok'; } catch (e) { out.backend = e.message; } }
        return out;
      }
      if (act?.startsWith('tools/') && m === 'POST') {
        const { args } = await body(req);
        return svc.pluginRuntime.invoke(user, pid, act.slice(6), args ?? {});
      }
      // 以下为管理操作，仅 Owner
      requireLevel(user, LEVEL.P2);
      if (act === 'install' && m === 'POST') return asBadRequest(() => reg.install(pid, user.id));
      if (act === 'enable' && m === 'POST') return asBadRequest(() => reg.enable(pid, user.id));
      if (act === 'disable' && m === 'POST') return asBadRequest(() => reg.disable(pid, user.id));
      if (act === 'rollback-state' && m === 'POST') return asBadRequest(() => reg.rollbackState(pid, user.id));
      if (act === 'grant' && m === 'POST') { const { permissions } = await body(req); return asBadRequest(() => reg.grant(pid, permissions ?? [], user.id)); }
      if (act === 'revoke' && m === 'POST') { const { permissions } = await body(req); return asBadRequest(() => reg.revoke(pid, permissions ?? [], user.id)); }
      if (!act && m === 'DELETE') return asBadRequest(() => reg.uninstall(pid, user.id));
    }

    if (path === '/api/overview' && m === 'GET') {
      const tasks = svc.tasks.list(user);
      return {
        character: svc.character.get(),
        agents: agentStatus(tasks),
        tasks: tasks.slice(0, 20),
        context: svc.chat.usage(user.id),
        kpi: { tasksTotal: tasks.length, running: tasks.filter((t) => t.status === 'running').length,
          done: tasks.filter((t) => t.status === 'done').length, errors: tasks.filter((t) => t.status === 'error').length },
        hermes: svc.hermes.enabled ? 'configured' : 'offline',
      };
    }
    const e = new Error('Not found'); e.status = 404; throw e;
  }

  async function serveStatic(res, urlPath) {
    const map = { '/office': 'apps/office', '/miniapp': 'apps/miniapp', '/shared': 'apps/shared' };
    const prefix = Object.keys(map).find((p) => urlPath === p || urlPath.startsWith(p + '/'));
    if (!prefix) { res.writeHead(404, SEC_HEADERS); return res.end('Not found'); }
    let rel = urlPath.slice(prefix.length) || '/';
    if (rel.endsWith('/')) rel += 'index.html';
    const base = resolve(ROOT, map[prefix]);
    const file = resolve(join(base, normalize(rel)));
    if (!file.startsWith(base)) { res.writeHead(403, SEC_HEADERS); return res.end('Forbidden'); }
    try {
      const data = await readFile(file);
      res.writeHead(200, { ...SEC_HEADERS, 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch { res.writeHead(404, SEC_HEADERS); res.end('Not found'); }
  }

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        const out = await api(req, url);
        if (out?.__binary) { res.writeHead(200, { ...SEC_HEADERS, 'content-type': out.__binary.mime, 'cache-control': 'no-store' }); return res.end(out.__binary.data); }
        res.writeHead(200, { ...SEC_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(JSON.stringify(out));
      }
      if (url.pathname === '/') { res.writeHead(302, { location: '/office/' }); return res.end(); }
      return await serveStatic(res, url.pathname);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) svc.audit.record({ type: 'server.error', path: url.pathname, message: String(e.message).slice(0, 200) });
      res.writeHead(status, { ...SEC_HEADERS, 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: status === 500 ? '服务器内部错误' : e.message }));
    }
  };
}

// 直接运行时启动服务
if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig();
  if (!cfg.ownerId) console.warn('警告：未设置 OWNER_TELEGRAM_ID，所有请求都会被拒绝。');
  if (!cfg.ownerApiToken || cfg.ownerApiToken.startsWith('change-me')) console.warn('警告：OWNER_API_TOKEN 未设置或仍为默认值。');
  const svc = createServices(cfg);
  // 同进程运行 Bot，使 Telegram / Web 共享同一份任务与角色状态
  if (cfg.telegram.token) { createBot(svc).poll(); console.log('Telegram Bot 已启动（长轮询）'); }
  else console.warn('未设置 TELEGRAM_BOT_TOKEN，仅启动 API / Web。');
  createServer(createHandler(svc)).listen(cfg.port, cfg.host, () => {
    console.log(`大肥鱼 API 已启动 http://${cfg.host}:${cfg.port}  Office: /office/  Mini App: /miniapp/`);
    console.log('配置（已脱敏）:', JSON.stringify(redact({ ...cfg, ownerId: cfg.ownerId ? '(set)' : '' })));
  });
}
