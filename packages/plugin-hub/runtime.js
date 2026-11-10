import { can } from '../core/permissions.js';

// 调用工具前依次检查：插件已启用 → 完整性有效 → 工具存在 → 角色等级足够 → 插件已被授予该权限。
// 任何一步失败都不会执行；所有调用（成功/失败）写审计，不记录参数与返回值内容。
export function createPluginRuntime({ registry, handlers, audit, generated }) {
  return {
    async invoke(user, pluginId, toolName, args = {}) {
      const deny = (status, msg, reason) => {
        audit.record({ type: 'plugin.invoke.denied', pluginId, tool: toolName, userId: user.id, reason });
        const e = new Error(msg); e.status = status; throw e;
      };
      const p = registry.get(pluginId);
      if (!p) deny(404, '插件不存在', 'not-found');
      if (!p.valid) deny(403, '插件清单无效', 'invalid');
      if (!registry.isEnabled(pluginId)) deny(403, '插件未启用', 'disabled');
      if (!p.runnable) deny(403, '外部插件暂不可运行', 'not-runnable');
      const tool = p.tools.find((t) => t.name === toolName);
      if (!tool) deny(404, '工具不存在', 'no-tool');
      if (tool.level === 3) { if (user.role !== 'owner') deny(403, '只有 Owner 可申请 P3 操作', 'role-level'); }
      else if (!can(user, tool.level)) deny(403, `权限不足：需要 P${tool.level}`, 'role-level');
      if (tool.permission && !registry.granted(pluginId).includes(tool.permission)) deny(403, `插件未被授予 ${tool.permission}`, 'not-granted');
      const fn = handlers[pluginId]?.[toolName] ?? (p.source === 'generated' ? generated?.(pluginId, toolName) : null);
      if (!fn) deny(501, '工具未实现', 'no-handler');
      try {
        const out = await fn(args, { user });
        audit.record({ type: 'plugin.invoke', pluginId, tool: toolName, userId: user.id, ok: true });
        return out;
      } catch (e) {
        audit.record({ type: 'plugin.invoke', pluginId, tool: toolName, userId: user.id, ok: false, message: String(e.message).slice(0, 120) });
        throw e;
      }
    },
  };
}
