# TANK-AI-Companion V2.0 · 大肥鱼 AI 个人操作系统（MVP）

按《V2.0 创新架构设计文档》第 16 节“首批 MVP”实现。零依赖，Node ≥ 20。

## 快速开始
```bash
cp .env.example .env      # 填写 OWNER_TELEGRAM_ID、OWNER_API_TOKEN 等
npm test                  # 全部测试
npm start                 # API + Web Office + Bot（配置了 TELEGRAM_BOT_TOKEN 时）
```
- Web Office：`http://localhost:8787/office/`（用 OWNER_API_TOKEN 登录）
- Mini App：`/miniapp/`（需 HTTPS 公网地址，在 BotFather 配置）
- 未配置 `HERMES_BASE_URL` 时进入**离线模式**，界面和回复会明确标注。

## Telegram 指令
`/remember /memories /forget /diary /context /compact /tasks /status /plugins /agents /restart /persona /create /publish /voice /erase confirm /help`；也可直接说“记住…”“重启 emby”“NAS 状态怎么样”

## 部署（Unraid）
见 `docker-compose.yml`：不挂 docker.sock、不 privileged、只读根文件系统、仅监听本机，经 NPM 反代 HTTPS。

## 功能一览
- **内置 Agent 团队**：总经理 / NAS 管家 / 记忆管理员 / 研究员 / 创意设计师（媒体、网络管家标注“未接入”）
- **审批式运维**：重启/启动/停止白名单容器，Owner 审批、一次性、可审计（默认关闭）
- **创造工坊**：自然语言 → 声明式卡片/工作流插件 → 检查 → 试运行 → 确认发布 → 可回滚
- **人格工坊**：导入人格卡、版本、差异、回滚，安全规则不可覆盖
- **语音中心**：Telegram 语音消息 → 文字；可选语音回复（OpenAI 兼容服务）
- **主题中心**：深色科技 / 明亮清爽 / 樱花 Q 版，动画、启动页、桌面宠物可开关
- 运维：`docs/OPERATIONS.md`（备份、恢复、升级、回滚）

## 插件中心
安装不等于授权；外部插件在沙盒实现前不可运行。详见 `docs/PLUGIN-HUB.md`。

## 对照与验收
`docs/ACCEPTANCE.md`：第 16 节每一项和第 17 节每条验收标准的完成状态与验证方式。

## 必读（上线前）
- `docs/VERIFY.md`：Hermes / UnraidClaw 的接口核验结论。**最重要的一条：Hermes API 默认带终端权限，好友聊天必须使用独立的受限 Hermes Profile，否则保持关闭。**
- 核验只基于官方文档/README，尚未在你的真实服务器上实测，清单里列了需要你上线后确认的点。
