import { can, LEVEL } from './permissions.js';
import { agentStatus } from '../agent-runtime/agents.js';

export const HELP = `大肥鱼可用指令：
/remember <内容>  记住一件事（只记你明确说的）
/memories  查看记忆
/forget <编号>  删除一条记忆
/fix <编号> <新内容>  更正一条记忆；/diary fix <编号> <新内容> 更正日记
/diary <内容>  写日记；/diary list 查看
/context  查看上下文用量
/compact  压缩上下文
/tasks  最近任务
/status  NAS 状态（仅 Owner，只读）
/plugins  已启用的插件
/voice [on|off|reply on|reply off|<音色>]  语音设置
/restart|/start_c|/stop_c <容器>  申请运维（Owner，需审批）
/persona  查看当前人格版本（Owner）
/create <需求>  创造工坊生成插件草稿（Owner）；/publish <草稿id> 确认发布
/erase confirm  清空我的全部记忆/日记/会话
直接发文字即可聊天。`;

const fmtList = (items) => (items.length ? items.map((i) => `${i.id}  ${i.text}`).join('\n') : '（空）');

// 解析并执行斜杠指令。返回字符串；非指令返回 null。
export async function handleCommand(svc, user, text) {
  const m = text.match(/^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/);
  if (!m) return null;
  const [, cmd, arg] = m;
  const a = arg.trim();
  switch (cmd) {
    case 'start': case 'help': return HELP;
    case 'remember': {
      if (!a) return '用法：/remember <内容>';
      const mem = svc.store.addMemory(user.id, a);
      return `已记住 [${mem.id}]`;
    }
    case 'fix': {
      const [id, ...rest] = a.split(/\s+/);
      if (!id || !rest.length) return '用法：/fix <编号> <新内容>';
      const m = svc.store.updateMemory(user.id, id, rest.join(' '));
      return m ? `已更正 [${m.id}]` : '没有找到这个编号';
    }
    case 'memories': return fmtList(svc.store.listMemories(user.id));
    case 'forget': return svc.store.removeMemory(user.id, a) ? '已删除' : '没有找到这个编号';
    case 'diary': {
      if (a === 'list' || !a) return fmtList(svc.store.listDiary(user.id));
      const fx = a.match(/^fix\s+(\S+)\s+([\s\S]+)$/);
      if (fx) { const e = svc.store.updateDiary(user.id, fx[1], fx[2]); return e ? `日记已更正 [${e.id}]` : '没有找到这个编号'; }
      const e = svc.store.addDiary(user.id, a);
      return `日记已保存 [${e.id}]`;
    }
    case 'context': {
      const u = svc.chat.usage(user.id);
      return `上下文 ${u.used}/${u.window} tokens（${u.source === 'measured' ? '模型实测' : '本地估算'}，${Math.round(u.ratio * 100)}%，${u.messages} 条消息）`;
    }
    case 'compact': {
      const r = await svc.chat.compact(user);
      return r.compacted ? `已压缩 ${r.compacted} 条旧消息` : '消息不多，无需压缩';
    }
    case 'tasks': {
      const list = svc.tasks.list(user).slice(0, 8);
      return list.length ? list.map((t) => `${t.id} [${t.status}] ${t.title}`).join('\n') : '暂无任务';
    }
    case 'status': {
      if (!can(user, LEVEL.P2)) return '只有 Owner 可以查看 NAS 状态。';
      const s = await svc.unraid.status();
      svc.audit.record({ type: 'unraid.status', userId: user.id, simulated: !!s.simulated });
      return (s.simulated ? '[模拟数据] ' : '') + JSON.stringify(s, null, 2);
    }
    case 'plugins': {
      const on = svc.registry.list().filter((p) => p.enabled && (user.role === 'owner' || p.level <= LEVEL.P1));
      return on.length ? on.map((p) => `${p.id} v${p.version} (P${p.level}) ${p.name}`).join('\n') : '暂无已启用的插件';
    }
    case 'agents': return agentStatus(svc.tasks.list(user), svc.agentSettings, user).map((x) => `${x.name}: ${x.status}`).join('\n');
    case 'restart': case 'start_c': case 'stop_c': {
      if (user.role !== 'owner') return '只有 Owner 可以申请运维操作。';
      if (!a) return `用法：/${cmd} <容器名>`;
      const action = cmd === 'restart' ? 'restart' : cmd === 'start_c' ? 'start' : 'stop';
      try {
        const r = await svc.pluginRuntime.invoke(user, 'unraid-ops', `docker.${action}`, { target: a });
        return { text: `申请 ${action} ${a}，请审批（10 分钟内有效）。`, approvalId: r.approval.id };
      } catch (e) { return `无法提交申请：${e.message}`; }
    }
    case 'voice': {
      const v = svc.voice;
      const [x, y] = a.split(/\s+/);
      try {
        if (x === 'on' || x === 'off') v.setSettings(user.id, { enabled: x === 'on' });
        else if (x === 'reply' && (y === 'on' || y === 'off')) v.setSettings(user.id, { replyWithVoice: y === 'on' });
        else if (x) v.setSettings(user.id, { voice: x });
      } catch (e) { return e.message; }
      const s = v.status(user.id);
      return `语音：${s.settings.enabled ? '开' : '关'}｜语音回复：${s.settings.replyWithVoice ? '开' : '关'}｜音色：${s.settings.voice}\n识别：${s.stt.configured ? '已配置' : '未配置'}｜合成：${s.tts.configured ? '已配置' : '未配置'}\n${s.privacy}`;
    }
    case 'create': {
      if (user.role !== 'owner') return '只有 Owner 可以使用创造工坊。';
      if (!a) return '用法：/create <需求>，例如：/create NAS 状态卡片';
      try {
        const d = await svc.workshop.create(user, a);
        if (d.stage === 'failed') return '草稿未通过检查：' + d.checks.errors.join('；');
        return `草稿 ${d.id}：${d.spec.name}（${d.spec.kind}，来源：${d.via}）\n权限：${d.review.permissions.join(', ') || '无'}\n试运行：${d.trial.ok ? '通过' : '未通过'} ${d.trial.warnings.join('；')}\n确认发布请发送 /publish ${d.id}（发布后默认停用，需在插件中心授权启用）`;
      } catch (e) { return '无法生成：' + e.message; }
    }
    case 'publish': {
      if (user.role !== 'owner') return '只有 Owner 可以发布。';
      try { const p = svc.workshop.publish(user, a); return `已登记插件 ${p.id} v${p.version}（停用中）。请到插件中心授权并启用。`; }
      catch (e) { return '发布失败：' + e.message; }
    }
    case 'persona': {
      if (user.role !== 'owner') return '只有 Owner 可以管理人格。';
      const l = svc.personaStore.list();
      return `当前人格版本 v${l.active}\n` + l.versions.map((v) => `v${v.v} ${v.name}${v.v === l.active ? '（生效）' : ''} ${v.note || ''}`).join('\n');
    }
    case 'erase': {
      if (a !== 'confirm') return '这会清空你的全部记忆、日记和会话。确认请发送：/erase confirm';
      svc.store.eraseAll(user.id);
      svc.audit.record({ type: 'user.erase', userId: user.id });
      return '已清空。';
    }
    default: return '未知指令，发送 /help 查看可用指令。';
  }
}
