import { buildSystemPrompt } from './hermes.js';
import { contextUsage, compact } from '../memory-engine/context.js';

// 一次对话：读取该用户的记忆与会话 -> 调 Hermes -> 写回会话 -> 记录任务与审计。
export function createChatService({ store, router, personaStore, team, tasks, character, audit, contextWindow }) {
  const summarizerFor = (user) => async (prev, msgs) => {
    const hermes = router.forUser(user);
    if (!hermes?.enabled) return null;
    const text = msgs.map((m) => `${m.role}: ${m.content}`).join('\n');
    const r = await hermes.chat([
      { role: 'system', content: '把以下对话压缩成简洁摘要，保留事实、决定与待办，不添加推断。' },
      { role: 'user', content: (prev ? `已有摘要：${prev}\n\n` : '') + text },
    ]);
    return r.text || null;
  };

  async function runCompact(user) {
    const userId = user.id;
    const session = store.getSession(userId);
    const { compacted, session: next } = await compact(session, { summarize: summarizerFor(user) });
    if (compacted) store.saveSession(userId, next);
    audit.record({ type: 'context.compact', userId, compacted });
    return { compacted, usage: contextUsage(next, contextWindow) };
  }

  return {
    async send(user, text) {
      const hermes = router.forUser(user);
      if (!hermes) {
        audit.record({ type: 'chat.denied', userId: user.id, reason: 'no-hermes-profile-for-role' });
        const e = new Error('好友聊天尚未开放：需要先配置独立的受限 Hermes Profile（HERMES_FRIEND_*）。');
        e.status = 403; throw e;
      }
      // 团队调度：NAS 管家的只读报告作为上下文；运维类请求只生成审批申请，不直接执行
      const routed = team ? await team.dispatch(user, text) : {};
      if (routed.direct) {
        const s = store.getSession(user.id);
        s.messages.push({ role: 'user', content: text, at: new Date().toISOString() }, { role: 'assistant', content: routed.direct.reply, at: new Date().toISOString() });
        store.saveSession(user.id, s);
        return { reply: routed.direct.reply, approval: routed.direct.approval, usage: contextUsage(s, contextWindow), offline: false };
      }
      const task = tasks.create({ userId: user.id, agent: routed.agent || 'manager', title: routed.agent ? `对话（${routed.agent}）` : '对话' });
      character.set('thinking');
      try {
        const session = store.getSession(user.id);
        const mems = store.listMemories(user.id);
        tasks.step(task, `读取个人记忆 ${mems.length} 条${session.summary ? '、已有对话摘要' : ''}`);
        if (routed.agent) tasks.step(task, `由内置角色「${routed.agent}」处理`);
        const sys = buildSystemPrompt(personaStore.active(), mems, session.summary, `tank-${user.id}`, routed.context || '');
        const msgs = [{ role: 'system', content: sys }, ...session.messages.map(({ role, content }) => ({ role, content })),
          { role: 'user', content: text }];
        tasks.step(task, hermes.enabled ? '调用 Hermes' : 'Hermes 未配置，使用离线回复');
        const r = await hermes.chat(msgs);
        session.messages.push({ role: 'user', content: text, at: new Date().toISOString() });
        session.messages.push({ role: 'assistant', content: r.text, at: new Date().toISOString() });
        if (r.usage) session.usage.push({ ...r.usage, at: new Date().toISOString() });
        session.usage = session.usage.slice(-50);
        store.saveSession(user.id, session);
        tasks.step(task, `收到回复（${(r.text || '').length} 字${r.usage ? `，实测 ${r.usage.promptTokens} 个输入 token` : ''}）并写回会话`);
        tasks.finish(task, 'done'); character.set('done');
        audit.record({ type: 'chat', userId: user.id, taskId: task.id, offline: !!r.offline });
        let usage = contextUsage(session, contextWindow);
        if (usage.level === 'critical') ({ usage } = await runCompact(user));
        return { reply: r.text, usage, offline: !!r.offline, taskId: task.id };
      } catch (e) {
        tasks.finish(task, 'error'); character.set('error');
        audit.record({ type: 'chat.error', userId: user.id, taskId: task.id, message: String(e.message).slice(0, 200) });
        throw e;
      } finally {
        setTimeout(() => character.set('idle'), 3000).unref?.();
      }
    },
    usage: (userId) => contextUsage(store.getSession(userId), contextWindow),
    compact: (userOrId) => runCompact(typeof userOrId === 'object' ? userOrId : { id: userOrId, role: 'owner' }),
  };
}
