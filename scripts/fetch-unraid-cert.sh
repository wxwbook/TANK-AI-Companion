#!/bin/sh
# 抓取 UnraidClaw 的自签证书用于固定（pin）。用法：
#   sh scripts/fetch-unraid-cert.sh 192.168.1.100 9876 > data/unraid-ca.pem
# 然后在 .env 设置 UNRAID_CA_FILE=./data/unraid-ca.pem
# 重要：首次抓取默认信任了网络上的证书，请在可信内网执行，并与 Unraid 上
# /boot/config/plugins/unraidclaw/tls 下的证书指纹核对。证书更新后需重新抓取。
HOST="${1:?用法: $0 <host> [port]}"; PORT="${2:-9876}"
echo | openssl s_client -connect "$HOST:$PORT" -servername "$HOST" 2>/dev/null | openssl x509
