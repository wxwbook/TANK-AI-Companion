## TANK-AI-Companion V2.1 · 视觉重构

把 Office 从「自适应卡片仪表盘」改成指挥中心布局：左侧分区导航、顶部状态栏、CSS 等距办公室场景、团队 KPI、任务/Agent 工作区、右侧大肥鱼总监栏。后端接口、权限流程、环境变量均未改动。

### 镜像

```bash
docker pull ghcr.io/wxwbook/tank-ai-companion:2.1.0
```

### 部署

```bash
docker run -d --name Tank-AI-Companion --restart unless-stopped \
  -p 8787:8787 \
  -v /mnt/user/appdata/tank-ai-companion/data:/data \
  -e OWNER_TELEGRAM_ID=你的TG数字ID \
  -e OWNER_API_TOKEN=$(openssl rand -hex 16) \
  ghcr.io/wxwbook/tank-ai-companion:2.1.0
```

Unraid 模板：`unraid/tank-ai-companion.xml`　|　Compose：`docker compose up -d`

### 变更

- 重构 `apps/office/index.html`：左导航、状态栏、办公室场景、KPI 条、右侧信息栏
- 移动端横向导航
- 任务 / 审批 / 集成 / NAS / 插件 / 工坊 / 人格 / 记忆 / 日记 / 语音 / 聊天统一进工作区
- 修复镜像缺 `themes/`、`plugins/` 导致 `/api/prefs` 返回 500（Mini App 报「服务器内部错误」）
- `Dockerfile` 增加 OCI 标签，包与仓库关联

### 已知边界

办公室场景是 CSS 2.5D，不是 Three.js/WebGL 真 3D；角色仍为 Emoji。测试 49 项全通过。
