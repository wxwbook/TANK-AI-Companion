#!/bin/sh
# 备份数据目录（记忆/日记/会话/人格版本/插件状态/生成的插件/审计日志/主题）。
# 用法：sh scripts/backup.sh [数据目录] [输出目录]
# 注意：备份包含用户私人数据，请妥善保管；.env（密钥）不在备份内，需单独安全保存。
DATA="${1:-./data}"; OUT="${2:-./backups}"
mkdir -p "$OUT"
F="$OUT/tank-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$F" -C "$DATA" . && echo "已备份：$F"
