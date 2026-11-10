import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// 追加式审计日志（JSON Lines）。不记录密钥、不记录原始聊天内容。
export function createAudit(dataDir) {
  mkdirSync(join(dataDir, 'logs'), { recursive: true });
  const file = join(dataDir, 'logs', 'audit.jsonl');
  return {
    record(event) {
      const row = { ts: new Date().toISOString(), ...event };
      appendFileSync(file, JSON.stringify(row) + '\n');
      return row;
    },
    file,
  };
}
