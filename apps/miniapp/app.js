const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tg = window.Telegram?.WebApp; tg?.ready(); tg?.expand();
const FISH = { idle: '🐟', chatting: '🐠', thinking: '🤔', working: '🛠️', awaiting_approval: '⏳', done: '✅', error: '⚠️', resting: '😴' };

// 身份只来自 Telegram initData，由服务端校验；前端不保存任何长期密钥。
const api = async (path, opts = {}) => {
  const res = await fetch('/api' + path, { ...opts, headers: { 'x-telegram-init-data': tg?.initData || '', 'content-type': 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.status);
  return data;
};

let themed = false, form = 'chibi';
async function refresh() {
  try {
    if (!themed) { const p = await api('/prefs'); window.applyTheme(p.themeData, p.animations); form = p.form; themed = true; }
    const [o, mem, dia] = await Promise.all([api('/overview'), api('/memories'), api('/diary')]);
    $('fish').innerHTML = window.renderFish(o.character.state, 96, form); $('st').textContent = o.character.state;
    $('tasks').innerHTML = o.tasks.slice(0, 5).map((t) => `<div class="row" data-task="${esc(t.id)}"><span>${esc(t.title)}</span><span class="sim">${t.status} ›</span></div>`).join('') || '<span class="sim">暂无任务</span>';
    $('agents').innerHTML = o.agents.filter((a) => a.status !== 'planned').map((a) => `<div class="row"><span>${esc(a.name)}</span><span class="sim">${a.status}</span></div>`).join('');
    $('mem').innerHTML = mem.map((m) => `<div class="row"><span>${esc(m.text)}</span><button data-id="${esc(m.id)}">删</button></div>`).join('') || '<span class="sim">暂无记忆</span>';
    $('diary').innerHTML = dia.slice().reverse().slice(0, 5).map((x) => `<div class="row"><span>${esc(x.text)}</span><button data-did="${esc(x.id)}">删</button></div>`).join('') || '<span class="sim">暂无日记</span>';
    $('ctx').textContent = `${o.context.used}/${o.context.window} tokens（${o.context.source === 'measured' ? '实测' : '估算'}）`;
  } catch (e) { $('st').textContent = '未授权或连接失败：' + e.message; }
}
$('add').onclick = async () => { const t = $('m').value.trim(); if (!t) return; await api('/memories', { method: 'POST', body: JSON.stringify({ text: t }) }); $('m').value = ''; refresh(); };
$('mem').onclick = async (e) => { const id = e.target.dataset?.id; if (id) { await api('/memories/' + id, { method: 'DELETE' }); refresh(); } };
$('tasks').onclick = async (e) => {
  const row = e.target.closest('[data-task]'); if (!row) return;
  const t = await api('/tasks/' + row.dataset.task);
  alert(`${t.title}（${t.agent}，${t.status}）\n` + (t.steps.map((s) => '· ' + s.text).join('\n') || '没有步骤记录'));
};
$('dadd').onclick = async () => { const t = $('d').value.trim(); if (!t) return; await api('/diary', { method: 'POST', body: JSON.stringify({ text: t }) }); $('d').value = ''; refresh(); };
$('diary').onclick = async (e) => { const id = e.target.dataset?.did; if (id) { await api('/diary/' + id, { method: 'DELETE' }); refresh(); } };
async function send() {
  const text = $('msg').value.trim(); if (!text) return; $('msg').value = '';
  $('chatlog').textContent += `我：${text}\n`;
  try { const r = await api('/chat', { method: 'POST', body: JSON.stringify({ text }) }); $('chatlog').textContent += `大肥鱼：${r.reply}\n`; }
  catch (e) { $('chatlog').textContent += `出错：${e.message}\n`; }
  $('chatlog').scrollTop = 1e9; refresh();
}
$('send').onclick = send; $('msg').onkeydown = (e) => { if (e.key === 'Enter') send(); };
refresh(); setInterval(refresh, 8000);
