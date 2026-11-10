import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.js';

// 主题只允许“白名单变量名 + 6 位十六进制颜色”，不允许 url()/表达式，防止通过主题注入样式或外链。
const VARS = ['--bg', '--bg2', '--panel', '--line', '--text', '--mute', '--accent', '--ok', '--warn', '--bad', '--fish-body', '--fish-fin'];
const HEX = /^#[0-9a-fA-F]{6}$/;

export function validateTheme(t) {
  const errors = [];
  if (!t || typeof t !== 'object') return { ok: false, errors: ['主题必须是对象'] };
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(t.id || '')) errors.push('id 需为小写字母/数字/连字符');
  if (typeof t.name !== 'string' || !t.name || t.name.length > 30) errors.push('name 必填且不超过 30 字');
  if (!['static', 'gradient'].includes(t.background)) errors.push('background 必须是 static 或 gradient');
  if (!t.vars || typeof t.vars !== 'object') errors.push('缺少 vars');
  else for (const [k, v] of Object.entries(t.vars)) {
    if (!VARS.includes(k)) errors.push(`不允许的变量：${k}`);
    else if (!HEX.test(v)) errors.push(`${k} 必须是 #RRGGBB`);
  }
  for (const k of VARS) if (t.vars && !(k in t.vars)) errors.push(`缺少变量 ${k}`);
  return { ok: errors.length === 0, errors };
}

export function createThemes({ dataDir, audit }) {
  const builtinDir = join(ROOT, 'themes'); const customDir = join(dataDir, 'themes-custom');
  mkdirSync(customDir, { recursive: true });
  const load = (dir, source) => !existsSync(dir) ? [] : readdirSync(dir).filter((f) => f.endsWith('.json')).flatMap((f) => {
    try { const t = JSON.parse(readFileSync(join(dir, f), 'utf8')); return validateTheme(t).ok ? [{ ...t, source }] : []; } catch { return []; }
  });
  const all = () => { const m = new Map(); for (const t of [...load(builtinDir, 'builtin'), ...load(customDir, 'custom')]) if (!m.has(t.id)) m.set(t.id, t); return m; };
  return {
    list: () => [...all().values()],
    get: (id) => all().get(id) ?? all().get('dark-tech'),
    has: (id) => all().has(id),
    import(theme, by) {
      const v = validateTheme(theme);
      if (!v.ok) { const e = new Error('主题无效：' + v.errors.join('；')); e.status = 400; throw e; }
      if (load(builtinDir, 'builtin').some((t) => t.id === theme.id)) { const e = new Error('不能覆盖内置主题'); e.status = 400; throw e; }
      writeFileSync(join(customDir, `${theme.id}.json`), JSON.stringify(theme, null, 2));
      audit?.record({ type: 'theme.import', themeId: theme.id, by });
      return { id: theme.id };
    },
  };
}
