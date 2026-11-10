// 插件清单校验。严格白名单：未知类型/权限一律拒绝，写类权限在本版本不可授予。
export const TYPES = ['ui', 'tool', 'skill', 'mcp', 'workflow', 'agent-pack', 'theme'];

// 已知权限键。UnraidClaw 的 *:read 与插件自身的 user:* 为读类；其余写类在 PHASE 11 之前不开放。
export const READ_PERMISSIONS = [
  'docker:read', 'vms:read', 'array:read', 'disk:read', 'share:read', 'info:read', 'services:read',
  'notification:read', 'network:read', 'me:read', 'user:session', 'user:memory:read',
];
export const WRITE_PERMISSIONS = [
  'docker:create', 'docker:update', 'docker:delete', 'vms:update', 'vms:delete', 'array:update',
  'share:update', 'os:update', 'notification:create', 'notification:update', 'notification:delete',
];
export const isWritePermission = (p) => WRITE_PERMISSIONS.includes(p);

const ID = /^[a-z][a-z0-9-]{1,40}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

export function validateManifest(m) {
  const errors = [];
  const bad = (msg) => errors.push(msg);
  if (!m || typeof m !== 'object') return { ok: false, errors: ['清单不是对象'] };
  if (!ID.test(m.id || '')) bad('id 需为小写字母/数字/连字符，2–41 位');
  if (!m.name || typeof m.name !== 'string') bad('缺少 name');
  if (!SEMVER.test(m.version || '')) bad('version 需为 x.y.z');
  if (!TYPES.includes(m.type)) bad(`type 必须是 ${TYPES.join('/')}`);
  if (!m.author || typeof m.author !== 'string') bad('缺少 author');
  if (!['builtin', 'external', 'generated'].includes(m.source)) bad('source 必须是 builtin / external / generated');
  if (m.requires !== undefined && (!Array.isArray(m.requires) || m.requires.some((r) => !ID.test(r)))) bad('requires 必须是插件 id 数组');
  if (!Array.isArray(m.permissions)) bad('permissions 必须是数组');
  else for (const p of m.permissions) {
    if (!READ_PERMISSIONS.includes(p) && !WRITE_PERMISSIONS.includes(p)) bad(`未知权限：${p}`);
  }
  if (!Number.isInteger(m.level) || m.level < 0 || m.level > 4) bad('level 需为 0–4');
  if (m.level === 4) bad('P4 高危插件不予登记');
  const tools = m.tools ?? [];
  if (!Array.isArray(tools)) bad('tools 必须是数组');
  else for (const t of tools) {
    if (!/^[a-z][a-z0-9._-]{1,60}$/.test(t?.name || '')) bad(`工具名非法：${t?.name}`);
    if (!Number.isInteger(t?.level) || t.level < 0 || t.level > 3) bad(`工具 ${t?.name} 的 level 非法`);
    if (t?.permission && !(m.permissions || []).includes(t.permission)) bad(`工具 ${t.name} 使用了未声明的权限 ${t.permission}`);
    if (t?.level === 3) {
      // P3 受控写：仅内置插件可声明，必须绑定写类权限；调用时只会生成审批申请，不会直接执行
      if (m.source !== 'builtin') bad(`工具 ${t.name}：只有内置插件可声明 P3 工具`);
      if (!isWritePermission(t.permission)) bad(`工具 ${t.name}：P3 工具必须绑定写类权限`);
    }
  }
  return { ok: errors.length === 0, errors };
}
