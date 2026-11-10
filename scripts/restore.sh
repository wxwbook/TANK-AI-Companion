#!/bin/sh
# 从备份恢复。会先把现有数据目录改名为 *.before-restore.<时间>，不会直接覆盖。
# 用法：sh scripts/restore.sh <备份文件> [数据目录]
BK="${1:?用法: $0 <备份文件> [数据目录]}"; DATA="${2:-./data}"
[ -f "$BK" ] || { echo "备份文件不存在"; exit 1; }
if [ -d "$DATA" ] && [ -n "$(ls -A "$DATA" 2>/dev/null)" ]; then mv "$DATA" "$DATA.before-restore.$(date +%s)"; fi
mkdir -p "$DATA" && tar -xzf "$BK" -C "$DATA" && echo "已恢复到 $DATA（请重启服务）"
