import { randomUUID } from 'node:crypto';

// 审批绑定：用户 ID + 任务 ID + 动作 + 目标 + 参数摘要 + 有效期。
// MVP 仅提供数据结构与校验；第二阶段（PHASE 11）才接入真实写操作。
export function createApprovals({ audit, ttlMs = 10 * 60 * 1000 } = {}) {
  const items = new Map();
  return {
    request({ userId, taskId, action, target, paramsSummary }) {
      const a = { id: randomUUID(), userId, taskId, action, target, paramsSummary,
        status: 'pending', expiresAt: Date.now() + ttlMs };
      items.set(a.id, a);
      audit?.record({ type: 'approval.requested', approvalId: a.id, userId, action, target });
      return a;
    },
    decide(id, approverId, approve, ownerId) {
      const a = items.get(id);
      if (!a) throw new Error('审批不存在');
      if (String(approverId) !== String(ownerId)) throw new Error('仅 Owner 可审批');
      if (a.status !== 'pending') throw new Error('审批已处理');
      if (Date.now() > a.expiresAt) { a.status = 'expired'; throw new Error('审批已过期'); }
      a.status = approve ? 'approved' : 'rejected';
      a.decidedBy = approverId;
      audit?.record({ type: 'approval.decided', approvalId: id, approverId, status: a.status });
      return a;
    },
    get: (id) => items.get(id),
    // 审批只能使用一次：执行前 consume，防止重放
    consume(id, result) {
      const a = items.get(id);
      if (!a || a.status !== 'approved') throw new Error('审批不可用');
      a.status = result === 'failed' ? 'failed' : 'executed';
      return a;
    },
    // 执行前必须再次校验：动作、目标、参数摘要与审批一致且未过期
    verifyForExecution(id, { userId, action, target, paramsSummary }) {
      const a = items.get(id);
      return !!a && a.status === 'approved' && Date.now() <= a.expiresAt &&
        a.userId === userId && a.action === action && a.target === target &&
        a.paramsSummary === paramsSummary;
    },
    list: () => [...items.values()].map((a) => (a.status === 'pending' && Date.now() > a.expiresAt ? { ...a, status: 'expired' } : a)),
  };
}
