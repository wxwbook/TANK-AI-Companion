import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

// 内置 Agent 团队。mode：
//   core        总经理，负责理解需求、分派、汇总
//   tool        通过插件运行时调用工具（受“插件授权 + 用户角色”双重限制）
//   builtin     直接使用 Companion 自身能力（如记忆库），不经过模型
//   hermes-role 以角色提示词叠加到 Hermes 对话上（专长风格，不额外获得任何工具）
//   planned     依赖的外部系统尚未接入，明确标注而不假装可用
export const AGENT_DEFS = [
  { id: 'manager', name: '大肥鱼总经理', mode: 'core', level: 1, desc: '理解需求、分派给专业角色并汇总结果' },
  { id: 'nas-operator', name: 'NAS 管家', mode: 'tool', level: 3, ownerOnly: true,
    desc: '只读查询 Unraid 状态；运维动作只生成审批申请', tools: ['unraid.*', 'unraid-ops.docker.*(需审批)'] },
  { id: 'memory-manager', name: '记忆管理员', mode: 'builtin', level: 1,
    desc: '用自然语言记录/查看/删除你明确说出的记忆（“记住…”“我的记忆”“忘记 <编号>”）' },
  { id: 'researcher', name: '研究员', mode: 'hermes-role', level: 1,
    desc: '调研、对比、总结类问题，输出结构化结论并标注不确定之处',
    trigger: /(调研|研究一下|对比|比较|总结一下|分析一下|优缺点|方案)/,
    rolePrompt: '当前由“研究员”角色处理：先给结论，再列依据；区分事实与推测，不确定就明说；不编造来源。' },
  { id: 'designer', name: '创意设计师', mode: 'hermes-role', level: 0,
    desc: '文案、取名、海报/形象创意',
    trigger: /(文案|取名|起名|海报|设计一个|创意|slogan|logo)/i,
    rolePrompt: '当前由“创意设计师”角色处理：给 3 个风格不同的方案，每个一句话说明思路；语气活泼但简洁。' },
  { id: 'media-manager', name: '媒体管家', mode: 'planned', level: 2, ownerOnly: true,
    desc: 'MoviePilot / Emby / Plex', needs: '需先核验 MoviePilot V3 API/MCP（PHASE 10）' },
  { id: 'network-operator', name: '网络管家', mode: 'planned', level: 2, ownerOnly: true,
    desc: '路由器 / OpenClash / 网络诊断', needs: '需先确定可用的只读接口' },
];
export const AGENTS = AGENT_DEFS; // 向后兼容

// 启停设置持久化（Owner 可关闭任意内置角色；manager 不可关闭）
export function createAgentSettings(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, 'agents.json');
  const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { disabled: [] };
  const save = () => { const t = file + '.tmp'; writeFileSync(t, JSON.stringify(data)); renameSync(t, file); };
  return {
    isEnabled: (id) => !data.disabled.includes(id),
    set(id, enabled) {
      const d = AGENT_DEFS.find((a) => a.id === id);
      if (!d) { const e = new Error('角色不存在'); e.status = 404; throw e; }
      if (d.mode === 'core' && !enabled) { const e = new Error('总经理不可关闭'); e.status = 400; throw e; }
      if (d.mode === 'planned' && enabled) { const e = new Error('该角色依赖的系统尚未接入，暂不可启用'); e.status = 400; throw e; }
      data.disabled = enabled ? data.disabled.filter((x) => x !== id) : [...new Set([...data.disabled, id])];
      save(); return { id, enabled };
    },
  };
}

export function agentStatus(tasks, settings, user) {
  return AGENT_DEFS.filter((a) => !a.ownerOnly || !user || user.role === 'owner').map((a) => {
    const running = tasks.filter((t) => t.agent === a.id && ['running', 'awaiting_approval'].includes(t.status)).length;
    const enabled = a.mode !== 'planned' && (settings ? settings.isEnabled(a.id) : true);
    return { id: a.id, name: a.name, mode: a.mode, desc: a.desc, tools: a.tools || [], needs: a.needs || null, enabled,
      running, status: a.mode === 'planned' ? 'planned' : !enabled ? 'disabled' : running ? 'working' : 'idle' };
  });
}
