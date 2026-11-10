# 架构（MVP 实现）

单进程、零依赖（Node ≥ 20），Bot 与 API 共享同一套服务，保证 Telegram / Web 状态一致。

```
Telegram ─┐                         ┌─ memory-engine（每用户独立目录：记忆/日记/会话）
Mini App ─┼─> apps/api ─> core ─────┼─ agent-runtime（Hermes 客户端/任务/角色状态/Agent）
Web Office┘   (认证+限流)  权限/审批 ├─ adapters/unraid（UnraidClaw 只读 GET）
                                    ├─ plugin-hub（清单/授权/运行时）
                                    └─ audit（JSONL 审计）
```

## 权限
P0 展示 / P1 用户数据 / P2 服务只读 / P3 受控写（需审批，代码层不直接放行）/ P4 禁用。
Owner 直接可用至 P2，好友至 P1，未登记用户一律拒绝。

## 认证
- Web Office：`Authorization: Bearer OWNER_API_TOKEN`（常量时间比较），映射为 Owner。
- Mini App：`X-Telegram-Init-Data`，服务端 HMAC 校验 + 有效期，再映射到已登记用户。

## 数据目录
`DATA_DIR/users/<id>/{memory,diary,session}.json`，`DATA_DIR/logs/audit.jsonl`。

## 内置 Agent 团队
| 角色 | 模式 | 说明 |
|---|---|---|
| 大肥鱼总经理 | core | 分派请求并汇总，不可关闭 |
| NAS 管家 | tool | 只读查询（unraid 插件）；“重启 xxx”类整句指令只生成审批申请；仅 Owner |
| 记忆管理员 | builtin | “记住…/我的记忆/忘记 <编号>”，不经过模型，只操作自己的记忆库 |
| 研究员 / 创意设计师 | hermes-role | 以角色提示词叠加到对话上，只改变风格，不增加任何工具 |
| 媒体管家 / 网络管家 | planned | 依赖的系统未接入，明确标注“未接入”，不可启用 |
每个角色的子任务在任务中心按角色归属；Owner 可在 Office 里开关（总经理除外）。

## 模块
core（权限/审批/运维/主题）· agent-runtime（Hermes/团队/人格/任务/状态）· memory-engine · plugin-hub · workshop · voice · adapters（unraid 读 / unraid-ops 写）· audit。

## 已实现
第一批 MVP 全部 8 项；第二批：Plugin Hub、审批式运维、创造工坊（声明式）、人格工坊、语音中心、主题中心；Office：Q 版角色、立体办公室、桌面宠物页、启动动画与动态背景。

## 未实现 / 有意取舍
- 外部（任意代码）插件沙盒；创造工坊只生成声明式规格。
- 3D 办公室为 CSS 伪 3D 的等距视图，不是真正的 3D/Three.js 场景；桌面端（Electron/Tauri）仅提供透明窗口可用的 `pet.html`。
- 火山引擎语音接口；媒体/网络管家；社交连接器（PHASE 12，设计文档要求最后做且默认关闭）。
- 外部接口均未在你的真实环境实测，见 `docs/VERIFY.md`。
