import { randomUUID } from 'node:crypto';

// 任务中心：记录任务、步骤与状态。MVP 为内存 + 有上限的环形缓存。
export function createTaskCenter({ max = 200 } = {}) {
  const tasks = [];
  return {
    create({ userId, agent, title }) {
      const t = { id: randomUUID().slice(0, 8), userId, agent, title, status: 'running',
        steps: [], createdAt: new Date().toISOString(), finishedAt: null };
      tasks.unshift(t);
      if (tasks.length > max) tasks.pop();
      return t;
    },
    step(t, text) { t.steps.push({ at: new Date().toISOString(), text }); },
    finish(t, status = 'done') { t.status = status; t.finishedAt = new Date().toISOString(); },
    // 用户只能看到自己的任务；Owner 看全部
    // 单个任务详情（含步骤）；普通用户只能看自己的
    get(user, id) { const t = tasks.find((x) => x.id === id); return t && (user.role === 'owner' || t.userId === user.id) ? t : null; },
    list(user) { return tasks.filter((t) => user.role === 'owner' || t.userId === user.id); },
  };
}
