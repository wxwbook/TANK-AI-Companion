// 权限等级：P0 展示 / P1 用户数据读取 / P2 服务只读 / P3 受控写（需 Owner 审批） / P4 高危（默认禁用）
export const LEVEL = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };

// 角色可直接使用的最高等级（P3 一律需审批，P4 一律禁用）
const ROLE_MAX = { owner: LEVEL.P2, friend: LEVEL.P1 };

export function resolveUser(cfg, telegramId) {
  const id = String(telegramId ?? '');
  if (!id) return null;
  if (cfg.ownerId && id === cfg.ownerId) return { id, role: 'owner' };
  if (cfg.friendIds.includes(id)) return { id, role: 'friend' };
  return null; // 未登记用户一律拒绝
}

export function can(user, level) {
  if (!user) return false;
  if (level >= LEVEL.P4) return false;
  if (level === LEVEL.P3) return false; // 需走 approvals，不能直接放行
  return level <= (ROLE_MAX[user.role] ?? -1);
}

export function requireLevel(user, level) {
  if (!can(user, level)) {
    const e = new Error(`权限不足：需要 P${level}`);
    e.status = user ? 403 : 401;
    throw e;
  }
}
