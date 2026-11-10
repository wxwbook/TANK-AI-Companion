const BAD_SEG = new Set(['__proto__', 'constructor', 'prototype']);

export function getPath(obj, path) {
  const parts = path.match(/[A-Za-z0-9_]+|\[\d+\]/g) || [];
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    const key = p.startsWith('[') ? Number(p.slice(1, -1)) : p;
    if (typeof key === 'string' && BAD_SEG.has(key)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(Object(cur), key)) return undefined;
    cur = cur[key];
  }
  return cur;
}
const fmt = (v, n = 120) => (v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v).slice(0, n) : String(v).slice(0, n));

// 解释执行：所有工具调用都经过插件运行时，所以仍受“插件已授权 + 用户角色”限制。
export async function runSpec(spec, { user, runtime, timeoutMs = 15000 }) {
  const withTimeout = (p) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('步骤超时')), timeoutMs).unref?.())]);
  if (spec.kind === 'card') {
    const data = await withTimeout(runtime.invoke(user, spec.source.plugin, spec.source.tool));
    return { kind: 'card', title: spec.name, fields: spec.fields.map((f) => ({ label: f.label, value: fmt(getPath(data, f.path)) })) };
  }
  const steps = [];
  for (const s of spec.steps) {
    try { const out = await withTimeout(runtime.invoke(user, s.plugin, s.tool)); steps.push({ plugin: s.plugin, tool: s.tool, ok: true, summary: fmt(out, 200) }); }
    catch (e) { steps.push({ plugin: s.plugin, tool: s.tool, ok: false, error: e.message }); break; }
  }
  return { kind: 'workflow', title: spec.name, steps, ok: steps.every((x) => x.ok) };
}
