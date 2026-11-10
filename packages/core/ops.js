import { ACTIONS } from '../adapters/unraid-ops.js';

// 审批式运维：申请 → Owner 审批 → 再次校验 → 执行 → 审计（含回滚信息）。
// 审批绑定 用户 / 任务 / 动作 / 目标 / 参数摘要 / 有效期，且只能使用一次。
export function createOps({ approvals, audit, unraidOps, tasks, character, ownerId }) {
  const summary = (action, target) => `${action} ${target}`;

  return {
    enabled: () => unraidOps.enabled,

    async request(user, { action, target }) {
      if (user.role !== 'owner') { const e = new Error('只有 Owner 可以申请运维操作'); e.status = 403; throw e; }
      unraidOps.validate(action, target);
      await unraidOps.inspect(target); // 目标必须真实存在
      const task = tasks.create({ userId: user.id, agent: 'nas-operator', title: `申请 ${action} ${target}` });
      task.status = 'awaiting_approval';
      tasks.step(task, '已提交审批，等待 Owner 确认');
      const a = approvals.request({ userId: user.id, taskId: task.id, action: `docker.${action}`, target, paramsSummary: summary(action, target) });
      character.set('awaiting_approval');
      return { ...a, taskId: task.id };
    },

    pending: () => approvals.list().filter((a) => a.status === 'pending'),
    list: () => approvals.list().slice(-30).reverse(),

    async decide(user, approvalId, approve) {
      if (user.role !== 'owner') { const e = new Error('只有 Owner 可以审批'); e.status = 403; throw e; }
      const a = approvals.decide(approvalId, user.id, approve, ownerId);
      const task = tasks.list(user).find((t) => t.id === a.taskId);
      if (!approve) { if (task) tasks.finish(task, 'rejected'); character.set('idle'); return a; }
      return this.execute(a, task, user);
    },

    async execute(a, task, approver) {
      const action = a.action.replace(/^docker\./, '');
      character.set('working');
      try {
        // 执行前再次校验：审批仍有效且与当前请求完全一致
        if (!approvals.verifyForExecution(a.id, { userId: a.userId, action: a.action, target: a.target, paramsSummary: summary(action, a.target) }))
          throw new Error('审批校验失败（已过期或参数变化）');
        unraidOps.validate(action, a.target);
        await unraidOps.inspect(a.target); // 再次确认目标仍存在
        const r = await unraidOps.execute(action, a.target);
        approvals.consume(a.id, 'ok');
        audit.record({ type: 'ops.executed', approvalId: a.id, requesterId: a.userId, approverId: approver.id, action: a.action, target: a.target, rollback: r.rollback ? `docker.${r.rollback}` : null });
        if (task) { tasks.step(task, '已执行'); tasks.finish(task, 'done'); }
        character.set('done');
        return { ...approvals.get(a.id), rollback: r.rollback ? `docker.${r.rollback}` : null };
      } catch (e) {
        try { approvals.consume(a.id, 'failed'); } catch { /* 已消费 */ }
        audit.record({ type: 'ops.failed', approvalId: a.id, action: a.action, target: a.target, message: String(e.message).slice(0, 160) });
        if (task) tasks.finish(task, 'error');
        character.set('error');
        throw e;
      } finally { setTimeout(() => character.set('idle'), 3000).unref?.(); }
    },
  };
}
export { ACTIONS };
