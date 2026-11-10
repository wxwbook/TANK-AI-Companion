import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateSpec } from './spec.js';
import { runSpec } from './interpreter.js';

// 创造工坊流水线：需求 → 生成草稿 → 静态检查 → 试运行 → 权限审阅 → Owner 确认发布 → 登记（默认停用）→ 可回滚。
// 生成器没有批准权：发布只“登记”插件，授权与启用仍要 Owner 在插件中心逐项完成。
const TEMPLATES = [
  { re: /(nas|unraid|服务器).{0,10}(状态|卡片|面板)|(容器).{0,6}(数量|卡片)/i, spec: (id) => ({ kind: 'card', id, name: 'NAS 状态卡片', description: '容器数量与模拟标记',
      source: { plugin: 'unraid', tool: 'status' }, fields: [{ label: '容器总数', path: 'docker.total' }, { label: '运行中', path: 'docker.running' }, { label: '模拟数据', path: 'simulated' }] }) },
  { re: /(巡检|检查|体检).{0,10}(nas|unraid|服务器)?|(nas|unraid).{0,10}(巡检|体检)/i, spec: (id) => ({ kind: 'workflow', id, name: 'NAS 巡检', description: '依次读取状态、容器与阵列',
      steps: [{ plugin: 'unraid', tool: 'status' }, { plugin: 'unraid', tool: 'docker.list' }, { plugin: 'unraid', tool: 'array.status' }] }) },
  { re: /(会话|上下文|token|用量)/i, spec: (id) => ({ kind: 'card', id, name: '上下文用量卡片', description: '当前会话用量',
      source: { plugin: 'session-stats', tool: 'usage' }, fields: [{ label: '已用', path: 'used' }, { label: '窗口', path: 'window' }, { label: '来源', path: 'source' }, { label: '消息数', path: 'messages' }] }) },
];
const slug = () => 'gen-' + randomUUID().slice(0, 6);
const bump = (v) => { const [a, b, c] = v.split('.').map(Number); return `${a}.${b}.${c + 1}`; };

export function createWorkshop({ registry, pluginRuntime, router, audit, dataDir }) {
  const dir = join(dataDir, 'workshop'); mkdirSync(dir, { recursive: true });
  const genDir = join(dataDir, 'generated-plugins'); mkdirSync(genDir, { recursive: true });
  const archive = join(dir, 'archive'); mkdirSync(archive, { recursive: true });
  const file = join(dir, 'drafts.json');
  let drafts = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  const save = () => { drafts = drafts.slice(-50); const t = file + '.tmp'; writeFileSync(t, JSON.stringify(drafts, null, 2)); renameSync(t, file); };
  const ownerOnly = (u) => { if (u.role !== 'owner') { const e = new Error('只有 Owner 可以使用创造工坊'); e.status = 403; throw e; } };
  const find = (id) => { const d = drafts.find((x) => x.id === id); if (!d) { const e = new Error('草稿不存在'); e.status = 404; throw e; } return d; };

  async function generate(request) {
    const hermes = router.forUser({ role: 'owner' });
    if (hermes?.enabled) {
      const catalog = registry.list().filter((p) => p.valid && p.source === 'builtin').map((p) => ({ plugin: p.id, tools: p.tools.filter((t) => t.level <= 2).map((t) => `${t.name}: ${t.description}`) }));
      try {
        const r = await hermes.chat([
          { role: 'system', content: '你是创造工坊。把用户需求转成一个 JSON 对象，只输出 JSON，不要解释。格式：card -> {"kind":"card","id":"gen-xxx","name","description","source":{"plugin","tool"},"fields":[{"label","path"}]}；workflow -> {"kind":"workflow","id":"gen-xxx","name","description","steps":[{"plugin","tool"}]}。只能使用以下只读工具：' + JSON.stringify(catalog) },
          { role: 'user', content: request }]);
        const m = r.text.match(/\{[\s\S]*\}/);
        if (m) { const spec = JSON.parse(m[0]); spec.id = /^gen-[a-z0-9-]{2,36}$/.test(spec.id || '') ? spec.id : slug(); return { spec, via: 'hermes' }; }
      } catch { /* 回退到模板 */ }
    }
    const t = TEMPLATES.find((x) => x.re.test(request));
    if (!t) { const e = new Error('没能理解这个需求。可以换个说法（如“NAS 状态卡片”“NAS 巡检”“上下文用量卡片”），或配置 Hermes 后再试。'); e.status = 400; throw e; }
    return { spec: t.spec(slug()), via: 'template' };
  }

  // 试运行：声明式解释器 + 只读工具 + 超时。依赖插件未启用只给出警告。
  async function trial(user, spec) {
    try { const out = await runSpec(spec, { user, runtime: pluginRuntime, timeoutMs: 10000 }); return { ok: out.ok !== false, warnings: [], result: out }; }
    catch (e) { return { ok: false, warnings: [/未启用|未被授予/.test(e.message) ? `依赖插件尚未启用/授权：${e.message}` : e.message], result: null }; }
  }

  const writeFiles = (id, manifest, spec) => {
    const d = join(genDir, id); mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'plugin.json'), JSON.stringify(manifest, null, 2));
    writeFileSync(join(d, 'spec.json'), JSON.stringify(spec, null, 2));
  };

  return {
    list: (user) => { ownerOnly(user); return drafts.slice().reverse(); },
    get: (user, id) => { ownerOnly(user); return find(id); },

    async create(user, request) {
      ownerOnly(user);
      if (typeof request !== 'string' || request.trim().length < 4 || request.length > 500) { const e = new Error('请用 4–500 字描述你想要的插件'); e.status = 400; throw e; }
      const { spec, via } = await generate(request.trim());
      const check = validateSpec(spec, registry);
      const draft = { id: randomUUID().slice(0, 8), request: request.trim(), via, stage: check.ok ? 'checked' : 'failed', spec, checks: check, createdAt: new Date().toISOString() };
      if (check.ok) {
        draft.trial = await trial(user, spec);
        draft.stage = 'awaiting_confirm';
        draft.review = { manifest: check.manifest, permissions: check.manifest.permissions, risks: check.risks,
          note: '发布只会登记插件（默认停用、零授权）；启用需在插件中心逐项授权。' };
      }
      drafts.push(draft); save();
      audit.record({ type: 'workshop.draft', draftId: draft.id, userId: user.id, stage: draft.stage, via });
      return draft;
    },

    publish(user, id) {
      ownerOnly(user);
      const d = find(id);
      if (d.stage !== 'awaiting_confirm') { const e = new Error('草稿未通过检查或已处理'); e.status = 400; throw e; }
      const check = validateSpec(d.spec, registry); // 发布前再次检查
      if (!check.ok) { const e = new Error('再次检查未通过：' + check.errors.join('；')); e.status = 400; throw e; }
      const existing = registry.get(check.manifest.id);
      if (existing && existing.source !== 'generated') { const e = new Error('不能覆盖非生成的插件'); e.status = 400; throw e; }
      if (existing) { // 归档旧版本以便回滚，并递增版本号
        const a = join(archive, existing.id, existing.version); mkdirSync(a, { recursive: true });
        cpSync(join(genDir, existing.id), a, { recursive: true });
        check.manifest.version = bump(existing.version);
      }
      writeFiles(check.manifest.id, check.manifest, d.spec);
      registry.scan();
      registry.install(check.manifest.id, user.id);
      d.stage = 'published'; d.publishedAs = { id: check.manifest.id, version: check.manifest.version }; save();
      audit.record({ type: 'workshop.publish', draftId: d.id, pluginId: check.manifest.id, version: check.manifest.version, userId: user.id });
      return registry.get(check.manifest.id);
    },

    reject(user, id) { ownerOnly(user); const d = find(id); d.stage = 'rejected'; save(); audit.record({ type: 'workshop.reject', draftId: id, userId: user.id }); return d; },

    // 回滚到上一个归档版本；回滚后清单哈希变化，插件自动停用并要求重新审核
    rollback(user, pluginId) {
      ownerOnly(user);
      const base = join(archive, pluginId);
      const versions = existsSync(base) ? readdirSync(base).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : [];
      if (!versions.length) { const e = new Error('没有可回滚的历史版本'); e.status = 400; throw e; }
      const v = versions[versions.length - 1];
      rmSync(join(genDir, pluginId), { recursive: true, force: true });
      cpSync(join(base, v), join(genDir, pluginId), { recursive: true });
      rmSync(join(base, v), { recursive: true, force: true });
      registry.scan();
      audit.record({ type: 'workshop.rollback', pluginId, to: v, userId: user.id });
      return registry.get(pluginId);
    },

    // 彻底删除一个生成的插件（先卸载登记）
    remove(user, pluginId) {
      ownerOnly(user);
      const p = registry.get(pluginId);
      if (!p || p.source !== 'generated') { const e = new Error('只能删除生成的插件'); e.status = 400; throw e; }
      if (p.installed) registry.uninstall(pluginId, user.id);
      rmSync(join(genDir, pluginId), { recursive: true, force: true });
      registry.scan();
      audit.record({ type: 'workshop.remove', pluginId, userId: user.id });
      return { removed: pluginId };
    },
  };
}
