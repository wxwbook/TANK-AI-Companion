// 上下文管家：用量估算、阈值提醒、摘要压缩。
// Token 数值始终标注来源：'measured'（模型返回）或 'estimated'（本地估算）。

export function estimateTokens(text = '') {
  let cjk = 0, other = 0;
  for (const ch of text) (/[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? cjk++ : other++);
  return Math.ceil(cjk * 1.0 + other / 4);
}

export function contextUsage(session, windowTokens) {
  const lastMeasured = [...(session.usage || [])].reverse().find((u) => u.source === 'measured');
  const text = (session.summary || '') + session.messages.map((m) => m.content).join('\n');
  const estimated = estimateTokens(text);
  const used = lastMeasured?.promptTokens ?? estimated;
  return {
    used,
    source: lastMeasured ? 'measured' : 'estimated',
    window: windowTokens,
    ratio: Number((used / windowTokens).toFixed(3)),
    messages: session.messages.length,
    level: used / windowTokens >= 0.9 ? 'critical' : used / windowTokens >= 0.7 ? 'warn' : 'ok',
  };
}

// 压缩：保留最近 keepLast 条原文，更早的合并进摘要。
// summarize 可注入（用 Hermes 生成摘要）；缺省使用本地提取式摘要。
export async function compact(session, { keepLast = 6, summarize } = {}) {
  if (session.messages.length <= keepLast) return { compacted: 0, session };
  const old = session.messages.slice(0, -keepLast);
  const recent = session.messages.slice(-keepLast);
  const pinned = old.filter((m) => m.pinned).map((m) => m.content); // 重要决策原文保留
  const body = old.filter((m) => !m.pinned);
  let summary;
  try { summary = summarize ? await summarize(session.summary, body) : null; } catch { summary = null; }
  if (!summary) summary = localSummary(session.summary, body);
  const next = {
    ...session,
    summary: [summary, ...pinned.map((p) => `【保留】${p}`)].join('\n').trim(),
    messages: recent,
    usage: session.usage || [],
  };
  return { compacted: old.length, session: next };
}

function localSummary(prev, msgs) {
  const lines = msgs.map((m) => `${m.role === 'user' ? '用户' : '大肥鱼'}：${m.content.replace(/\s+/g, ' ').slice(0, 80)}`);
  return [prev, ...lines].filter(Boolean).join('\n').slice(-2000);
}
