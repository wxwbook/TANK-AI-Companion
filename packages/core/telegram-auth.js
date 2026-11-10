import { createHmac, timingSafeEqual } from 'node:crypto';

// 校验 Telegram Mini App initData（官方算法）。
// 返回 { ok, user, reason }。maxAgeSec 之外的数据视为过期。
export function verifyInitData(initData, botToken, maxAgeSec = 3600, now = Date.now()) {
  if (!initData || !botToken) return { ok: false, reason: 'missing' };
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'no-hash' };
  params.delete('hash');
  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = createHmac('sha256', secret).update(dcs).digest('hex');
  const a = Buffer.from(calc, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad-hash' };
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || now / 1000 - authDate > maxAgeSec) return { ok: false, reason: 'expired' };
  try { return { ok: true, user: JSON.parse(params.get('user') || '{}') }; }
  catch { return { ok: false, reason: 'bad-user' }; }
}
