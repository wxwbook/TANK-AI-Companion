// 创造工坊的“声明式规格”：生成物只能是 JSON（卡片/工作流），由我们的解释器执行，
// 不包含任何可执行代码、网络地址或自定义参数，因此无需沙盒也不能越权。
const GEN_ID = /^gen-[a-z0-9-]{2,36}$/;
const PATH = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+|\[\d+\])*$/;
const BAD_SEG = new Set(['__proto__', 'constructor', 'prototype']);
const SECRETISH = /[A-Za-z0-9_-]{32,}/;
const BAD_TEXT = /[<>]|https?:\/\/|javascript:/i;

const textErr = (label, v, max) => {
  if (typeof v !== 'string' || !v.trim()) return `${label} 必须是非空文本`;
  if (v.length > max) return `${label} 超过 ${max} 字`;
  if (BAD_TEXT.test(v)) return `${label} 含有不允许的内容（标签/链接）`;
  if (SECRETISH.test(v)) return `${label} 疑似包含密钥或令牌`;
  return null;
};

export function validateSpec(spec, registry) {
  const errors = [];
  const add = (e) => e && errors.push(e);
  if (!spec || typeof spec !== 'object') return { ok: false, errors: ['规格必须是对象'] };
  if (!['card', 'workflow'].includes(spec.kind)) add('kind 必须是 card 或 workflow');
  if (!GEN_ID.test(spec.id || '')) add('id 需形如 gen-xxx（小写字母/数字/连字符）');
  add(textErr('name', spec.name, 40));
  if (spec.description !== undefined) add(textErr('description', spec.description, 200));
  const refs = [];

  if (spec.kind === 'card') {
    if (!spec.source || typeof spec.source !== 'object') add('card 需要 source {plugin, tool}');
    else refs.push(spec.source);
    const f = spec.fields;
    if (!Array.isArray(f) || f.length < 1 || f.length > 12) add('fields 需为 1–12 项');
    else for (const x of f) {
      add(textErr('字段标签', x?.label, 30));
      if (!PATH.test(x?.path || '') || x.path.length > 80 || x.path.split(/[.[\]]+/).some((s) => BAD_SEG.has(s))) add(`字段路径非法：${x?.path}`);
    }
  } else if (spec.kind === 'workflow') {
    const st = spec.steps;
    if (!Array.isArray(st) || st.length < 1 || st.length > 10) add('steps 需为 1–10 步');
    else for (const s of st) { refs.push(s); if (s && Object.keys(s).some((k) => !['plugin', 'tool'].includes(k))) add('步骤只能包含 plugin 与 tool（本版本不支持自定义参数）'); }
  }

  const permissions = new Set(); const requires = new Set(); let level = 0;
  for (const r of refs) {
    const p = registry.get(r?.plugin);
    if (!p || !p.valid) { add(`引用的插件不存在：${r?.plugin}`); continue; }
    if (p.id.startsWith('gen-')) { add('生成的插件不能引用其它生成的插件'); continue; }
    const t = p.tools.find((x) => x.name === r.tool);
    if (!t) { add(`插件 ${p.id} 没有工具 ${r.tool}`); continue; }
    if (t.level > 2) { add(`工具 ${p.id}.${t.name} 为 P${t.level}，生成物只能使用 P2 及以下的只读工具`); continue; }
    if (t.permission) permissions.add(t.permission);
    requires.add(p.id); level = Math.max(level, t.level);
  }
  if (errors.length) return { ok: false, errors };

  const manifest = {
    id: spec.id, name: spec.name, version: spec.version || '1.0.0', type: spec.kind === 'card' ? 'ui' : 'workflow',
    author: '大肥鱼创造工坊', source: 'generated', description: spec.description || '', level,
    requires: [...requires], permissions: [...permissions],
    tools: [{ name: 'run', level, description: spec.kind === 'card' ? '读取并展示卡片数据' : '依次执行只读步骤' }],
  };
  const risks = [...permissions].map((p) => `需要权限 ${p}`).concat([...requires].map((d) => `依赖插件 ${d} 需先启用`));
  return { ok: true, errors: [], manifest, risks };
}
