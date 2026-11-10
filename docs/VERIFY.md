# 接口核验记录（2026-11-09）

核验方式：阅读官方文档与项目 README，**未连接你的真实服务器实测**。标“已实测”的只有本地单元/集成测试（用模拟服务）。

## Hermes Agent API Server —— 文档已核对

| 项 | 结论 | 来源 |
|---|---|---|
| 地址/路径 | `http://host:8642/v1/chat/completions`，OpenAI 兼容 | Hermes 官方文档 API Server 页 |
| 认证 | `Authorization: Bearer <API_SERVER_KEY>`；**所有部署都必须设置密钥** | 同上 |
| 模型名 | 默认 profile 为 `hermes-agent`（`/v1/models` 可查） | 同上 |
| 用量 | 响应含 `usage.prompt_tokens/completion_tokens`（→ 标注“模型实测”） | 同上 |
| 结束原因 | `cancelled`/`error` 表示中断/失败；`length`+`iteration_budget_exhausted` 仍是可用答案 | 同上 |
| 健康/能力 | `GET /health`（公开）、`GET /v1/capabilities`（需密钥） | 同上 |
| 并发/错误 | 并发上限默认 10，超出 429；`admission_conflict` 为 409；重启中 503 | 同上 |

### ⚠️ 对本项目影响最大的两点
1. **Hermes API 默认拥有完整工具集，包括终端命令**。我们发送的 system 消息只是“叠加”在它自己的提示词之上，**不能收缩工具权限**。
   → 因此 **好友聊天不能走 Owner 的 Hermes**。代码已实现：好友只能使用独立的受限 Profile（`HERMES_FRIEND_*`，独立端口与密钥，并在该 Profile 里关闭终端/文件等工具）；未配置则好友聊天关闭，且有测试保证不会回退。
   → Owner 的聊天也等同于“能让 Hermes 执行终端命令”，请保证 `API_SERVER_KEY` 强随机、Hermes 不暴露公网。
2. **会话推导**：未带 `X-Hermes-Session-Id` 时，Hermes 用“system 提示词 + 首条用户消息”推导会话。我们让每个用户的 system 提示词带唯一标识（`tank-<id>`）以避免不同用户落入同一会话，并由 Companion 自己持有历史、每次发送完整 messages。
   **未实测**：请上线后用两个用户发送相同的首条消息，确认彼此看不到对方内容。

### 仍需实测
- 用户记忆是否会被 Hermes 自身的长期记忆（如 Honcho）混入——建议为 Companion 单独建一个 Hermes Profile。
- 长任务（工具多）下 120 秒超时是否够用（`HERMES_TIMEOUT_MS` 可调）。

## UnraidClaw —— README 已核对

| 项 | 结论 |
|---|---|
| 协议/端口 | HTTPS，默认 9876；自签证书自动生成（10 年） |
| 认证 | `x-api-key: <UnraidClaw 密钥>`（服务端存 SHA-256） |
| 响应 | 统一信封 `{ "ok": true, "data": ... }` |
| 权限 | `resource:action` 矩阵，WebGUI 有 **Read Only** 预设；403 时到 Permissions 页启用对应 `:read` |
| 要求 | Unraid 7.0.0+（本项目目标 7.3.2 ✔） |
| 读取端点 | `/api/health`、`/api/system/{info,metrics,services}`、`/api/docker/containers[/:id]`、`/api/array/{status,parity/status}`、`/api/disks[/:id]`、`/api/shares`、`/api/network`、`/api/users/me`、`/api/notifications[/overview]` |

适配器策略：**只发 GET + 只允许上述读取路径**；刻意排除 `/api/logs/syslog` 与容器日志（可能含敏感信息）；所有写端点（重启/停止/关机等）代码层不可达。

### 仍需实测
- 各端点 `data` 的**字段名**文档未给出。聚合状态里容器名/状态按 `name|names[0]|id` 与 `state|status` 容错提取；系统/阵列/磁盘数据原样透传。拿到真实返回后请核对 `packages/adapters/unraid.js` 的提取逻辑。
- 项目近期更新很快（新版增加了 `/mcp` 端点与更多工具），升级前先看发布说明。
- 自签证书：用 `scripts/fetch-unraid-cert.sh` 抓取并通过 `UNRAID_CA_FILE` 固定；默认不关闭校验。
- 供应链：`unraidclaw` 为第三方社区项目，且拥有服务器管理能力。请锁定版本、核对校验和，并只发放 Read Only 的专用密钥。

## 审批式运维（PHASE 11）—— 路径已核对，权限模型有重要保留

- **写接口路径已核对**：`POST /api/docker/containers/:id/:action`，action ∈ start/stop/restart/pause/unpause，需要 `docker:update`。我们只开放 restart/start/stop。
- ⚠️ **权限矩阵看起来是全局的**：README 描述的是“在 Permissions 页配置矩阵”，没有说明按密钥区分权限，设置流程里也只生成一把 UnraidClaw 密钥。
  - 这意味着：要让重启能执行，矩阵里必须开启 `docker:update`；此时**任何持有该密钥的人**都能调用全部已开启的写接口。我们的“白名单 + Owner 审批 + 一次性审批 + 审计”都在 **Companion 这一层**，UnraidClaw 本身不会替你拦。
  - 建议：只开启 `docker:update`（不要开 `docker:create/delete`、`os:update`、`array:update`）；密钥只放在 Companion 的 `.env`；平时可把 `docker:update` 关掉，需要时再临时开启；Unraid 7.3.2 上 UnraidClaw 自己还持有一把 ADMIN 级 Unraid API 密钥，务必保护好 Unraid 主机。
  - 如果 UnraidClaw 实际只有一把密钥，请把 `UNRAID_WRITE_API_KEY` 设成同一把。
- **未实测**：`:id` 是否接受容器名（实现基于 docker CLI，很可能接受，但 README 没明说）；若只接受容器 ID，需要先用读接口把名字映射成 ID。
- 项目为社区维护、版本更新快；锁定版本并关注发布说明。

## 语音中心 —— 按 OpenAI 兼容接口实现，未对任何具体服务实测
`/audio/speech`、`/audio/transcriptions` 是通用约定。设计文档里提到的火山引擎 TTS（APP ID / Access Token / 音色 ID）**没有实现**，其接口不同；可先用兼容网关或本地服务（如 faster-whisper-server、openedai-speech）。Telegram 语音回复请求 opus 格式，部分服务可能不支持，失败时只发文字。

## 其余待核验（未变化）
ai-companion-kit 源码与许可证；MoviePilot V3 API/MCP；Telegram Mini App 在 HTTPS 域名下的实测；插件沙盒隔离技术；语音服务；QQ/B站接口与条款。
