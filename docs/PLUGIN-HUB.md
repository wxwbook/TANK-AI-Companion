# Tank Plugin Hub（MVP）

## 目录与清单
每个插件一个目录：`plugins/<id>/plugin.json`。字段：`id name version type author source level permissions tools[]`。
类型：ui / tool / skill / mcp / workflow / agent-pack / theme。来源：`builtin`（随项目发布）或 `external`。

## 安全模型
1. **安装 ≠ 授权**：安装后默认停用且零授权；Owner 逐项授予清单声明的权限，才能启用。
2. **P3 受控写**：只有内置插件可声明 P3 工具，且必须绑定写类权限；调用 P3 工具**只会生成审批申请**，Owner 批准后才由 ops 模块执行（白名单、一次性审批、执行前复核、审计与回滚信息）。P4 不予登记。
3. **完整性**：登记时记录清单（及 spec.json）的 SHA-256；变化后自动停用、清空授权、标记“需重新审核”，历史保留。
4. **外部插件不运行**：沙盒实现前，`source: external` 只能登记查看。
5. **依赖**：`requires` 中的插件必须先启用，否则不能启用。
6. **调用链**：已启用 → 清单有效 → 工具存在 → 角色等级足够（P3 仅 Owner）→ 插件已获该权限；任一失败即拒绝并写审计（不记录参数与返回内容）。
7. 好友只能看到并调用已启用且 ≤P1 的插件。

## 创造工坊（生成声明式插件）
流水线：需求 → 草稿（Hermes 或模板）→ 静态检查 → 试运行 → 权限审阅 → **Owner 确认发布** → 登记（默认停用、零授权）→ 在插件中心授权启用。
- 生成物只是 JSON 规格（`card` 卡片 / `workflow` 只读工作流），由解释器执行：**没有可执行代码、没有网络地址、没有自定义参数**；只能引用 ≤P2 的只读工具，不能引用其它生成插件。
- 校验：拒绝 `<>`、链接、疑似密钥、原型污染路径、未知/越权工具。每次运行前**重新校验**，且所有工具调用仍经过插件运行时（受授权与角色限制）。
- 版本：同 id 重新发布会归档旧版并递增版本；“回滚上一版”恢复归档并要求重新审核；可删除。
- 局限：只支持卡片与只读工作流；不能生成任意代码，这是有意的安全取舍。需要任意代码类插件，须等沙盒方案确定。

## API
插件：`GET /api/plugins` · `GET /api/plugins/:id` · `POST /api/plugins/:id/{install|enable|disable|grant|revoke}` · `GET /api/plugins/:id/health` · `DELETE /api/plugins/:id` · `POST /api/plugins/:id/tools/:tool`
工坊：`POST|GET /api/workshop/drafts` · `POST /api/workshop/drafts/:id/{publish|reject}` · `POST /api/workshop/{rollback|remove}/:pluginId`

## 内置插件
`unraid`（P2 只读）· `unraid-ops`（P3，需审批，依赖 unraid）· `session-stats`（P1）。

## 暂未实现
外部插件沙盒、市场/远程安装、插件签名。
