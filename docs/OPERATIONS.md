# 运维手册

## 部署
`docker compose up -d --build`。数据在挂载的 `/data`；根文件系统只读、不挂 docker.sock、不 privileged、仅监听本机（经 NPM 反代 HTTPS）。

## 备份 / 恢复
- 备份：`sh scripts/backup.sh ./data ./backups`（含记忆、人格版本、插件状态、生成的插件、审计日志）。`.env` 里的密钥请另存。
- 恢复：`sh scripts/restore.sh <备份文件> ./data`，旧数据会先改名保留。恢复后重启。
- 插件状态文件每次保存前会生成 `plugin-hub/state.json.bak`。

## 升级
1. 先备份。2. 拉取新代码并 `docker compose up -d --build`。
3. 内置插件清单若有变化，启动时会**自动停用并要求重新审核授权**（这是有意的安全设计）。
4. 升级后检查：Office → 集成状态、插件中心健康检查。

## 回滚
- 应用：切回上一个镜像/代码版本并恢复备份。
- 生成的插件：插件中心“回滚上一版”（保留最近归档版本；回滚后需重新审核）。
- 人格：人格工坊里“激活”旧版本即回滚。
- 运维操作：审计日志 `ops.executed` 记录了回滚动作（stop↔start）；restart 无需回滚。

## 审计日志
`data/logs/audit.jsonl`（JSON Lines）。记录登录拒绝、审批申请/决定/执行、插件变更/调用、创造工坊发布/回滚、语音调用次数。**不记录聊天内容、参数明文、密钥。**

## 用户数据删除
用户发送 `/erase confirm` 清空自己的记忆/日记/会话/偏好。
