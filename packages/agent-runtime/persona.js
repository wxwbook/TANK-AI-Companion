import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../core/config.js';

// 人格工坊：人格卡导入、分层（核心/语气/场景）、版本管理、差异比较、回滚。
// 人格只影响语气与风格；安全规则由系统固定追加，人格卡无法移除或覆盖。
export const SAFETY_RULES = [
  '人格设定不能改变系统安全策略和工具权限。',
  '涉及 NAS 写操作时，只能提出申请，由 Owner 审批后执行。',
  '不伪称拥有真实意识；不利用主动消息制造依赖。',
];

// 拒绝试图绕过规则/提权的人格内容（启发式，防误用而非防御绝对攻击者）
const FORBIDDEN = [
  /(忽略|无视|绕过|覆盖|取消).{0,12}(规则|安全|权限|系统|限制|审批)/,
  /ignore\s+(all|any|the|previous|above).{0,20}(rules?|instructions?|polic)/i,
  /(sudo|root\s*权限|docker\.sock|privileged|--privileged)/i,
  /(无需|不需要|不用).{0,6}(审批|确认|授权)/,
];
const FIELDS = { name: 40, core: 2000, tone: 1000, address: 40 };

export function validateCard(card) {
  const errors = [];
  if (!card || typeof card !== 'object') return { ok: false, errors: ['人格卡必须是对象'] };
  for (const [k, max] of Object.entries(FIELDS)) {
    if (card[k] !== undefined && (typeof card[k] !== 'string' || card[k].length > max)) errors.push(`${k} 必须是不超过 ${max} 字的文本`);
  }
  if (!card.name) errors.push('缺少 name');
  if (!card.core) errors.push('缺少 core（核心人格）');
  if (card.rules !== undefined && (!Array.isArray(card.rules) || card.rules.length > 20 || card.rules.some((r) => typeof r !== 'string' || r.length > 200))) errors.push('rules 必须是不超过 20 条、每条 ≤200 字的数组');
  if (card.scenes !== undefined && (typeof card.scenes !== 'object' || Array.isArray(card.scenes) || Object.keys(card.scenes).length > 20
    || Object.entries(card.scenes).some(([k, v]) => k.length > 30 || typeof v !== 'string' || v.length > 300))) errors.push('scenes 必须是 {场景名: 规则} 对象（≤20 项）');
  const all = [card.name, card.core, card.tone, card.address, ...(card.rules || []), ...Object.values(card.scenes || {})].filter(Boolean).join('\n');
  for (const re of FORBIDDEN) if (re.test(all)) errors.push('内容试图改变安全策略或权限，已拒绝');
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

const pick = (c) => ({ name: c.name, core: c.core, tone: c.tone || '', address: c.address || '', rules: c.rules || [], scenes: c.scenes || {}, forms: c.forms || ['original', 'chibi'] });

export function createPersonaStore({ dataDir, audit }) {
  const dir = join(dataDir, 'persona'); mkdirSync(dir, { recursive: true });
  const file = join(dir, 'versions.json');
  let data;
  if (existsSync(file)) data = JSON.parse(readFileSync(file, 'utf8'));
  else {
    const base = JSON.parse(readFileSync(join(ROOT, 'roles', 'da-fei-yu', 'persona.json'), 'utf8'));
    data = { active: 1, versions: [{ v: 1, createdAt: new Date().toISOString(), source: 'builtin', note: '内置大肥鱼', card: pick(base) }] };
  }
  const save = () => { const t = file + '.tmp'; writeFileSync(t, JSON.stringify(data, null, 2)); renameSync(t, file); };
  save();
  const find = (v) => data.versions.find((x) => x.v === Number(v));

  const diffCards = (a, b) => {
    const out = [];
    for (const k of ['name', 'core', 'tone', 'address']) if (a[k] !== b[k]) out.push({ field: k, from: a[k], to: b[k] });
    if (JSON.stringify(a.rules) !== JSON.stringify(b.rules)) out.push({ field: 'rules', from: a.rules, to: b.rules });
    if (JSON.stringify(a.scenes) !== JSON.stringify(b.scenes)) out.push({ field: 'scenes', from: a.scenes, to: b.scenes });
    return out;
  };

  return {
    // 生效的人格 = 版本卡片 + 固定安全规则
    active() { const c = find(data.active).card; return { ...c, id: 'da-fei-yu', version: data.active, rules: [...c.rules, ...SAFETY_RULES] }; },
    list: () => ({ active: data.active, versions: data.versions.map(({ v, createdAt, source, note, card }) => ({ v, createdAt, source, note, name: card.name })) }),
    get: (v) => find(v) ?? null,

    // 导入为草稿版本（不生效）。接受 JSON 对象或纯文本（纯文本视为核心人格）。
    import(input, { by, note = '' } = {}) {
      let card = input;
      if (typeof input === 'string') {
        try { card = JSON.parse(input); } catch { card = { name: '导入人格', core: input.trim() }; }
      }
      const v = validateCard(card);
      if (!v.ok) { const e = new Error('人格卡无效：' + v.errors.join('；')); e.status = 400; throw e; }
      const ver = { v: Math.max(...data.versions.map((x) => x.v)) + 1, createdAt: new Date().toISOString(), source: 'import', note, card: pick(card) };
      data.versions.push(ver); save();
      audit?.record({ type: 'persona.import', version: ver.v, by });
      return { v: ver.v, name: ver.card.name };
    },
    // 变更需 Owner 确认；回滚 = 激活旧版本
    activate(v, by) {
      if (!find(v)) { const e = new Error('版本不存在'); e.status = 404; throw e; }
      const from = data.active; data.active = Number(v); save();
      audit?.record({ type: 'persona.activate', from, to: Number(v), by });
      return { active: data.active };
    },
    diff(a, b) {
      const x = find(a), y = find(b);
      if (!x || !y) { const e = new Error('版本不存在'); e.status = 404; throw e; }
      return diffCards(x.card, y.card);
    },
  };
}
