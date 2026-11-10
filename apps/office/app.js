const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let token = sessionStorage.getItem('tank_token') || '';
let prefs = null, charState = 'idle';

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, { ...opts, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.status);
  return data;
}
const post = (p, b = {}) => api(p, { method: 'POST', body: JSON.stringify(b) });
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { alert(e.message); } };

// ---------- 外观 ----------
async function loadPrefs() {
  prefs = await api('/prefs');
  window.applyTheme(prefs.themeData, prefs.animations);
  $('pAnim').checked = prefs.animations; $('pSplash').checked = prefs.splash; $('pPet').checked = prefs.pet;
  $('pet').hidden = !prefs.pet; $('formSel').value = prefs.form;
  const themes = await api('/themes');
  $('themeSel').innerHTML = themes.map((t) => `<option value="${esc(t.id)}" ${t.id === prefs.theme ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
}
$('themeSel').onchange = guard(async () => { await post('/prefs', { theme: $('themeSel').value }); await loadPrefs(); });
$('formSel').onchange = guard(async () => { await post('/prefs', { form: $('formSel').value }); await loadPrefs(); setFish(charState); });
for (const [id, key] of [['pAnim', 'animations'], ['pSplash', 'splash'], ['pPet', 'pet']]) $(id).onchange = guard(async () => { await post('/prefs', { [key]: $(id).checked }); await loadPrefs(); });

function setFish(state) {
  charState = state; const form = prefs?.form || 'chibi';
  $('fish').innerHTML = window.renderFish(state, 110, form);
  $('pet').innerHTML = window.renderFish(state, 64, form);
  $('fishState').textContent = state;
}

// ---------- 总览 ----------
const ICON = { manager: '🐟', 'nas-operator': '🗄️', 'memory-manager': '🧠', researcher: '🔎', designer: '🎨', 'media-manager': '🎬', 'network-operator': '🌐' };
async function refresh() {
  try {
    const o = await api('/overview');
    $('login').hidden = true; $('app').hidden = false;
    setFish(o.character.state);
    $('st').textContent = '角色：' + o.character.state;
    $('hm').textContent = '模型：' + (o.hermes === 'configured' ? '已配置' : '离线模式');
    $('k1').textContent = o.kpi.tasksTotal; $('k2').textContent = o.kpi.running; $('k3').textContent = o.kpi.done; $('k4').textContent = o.kpi.errors;
    $('iso').innerHTML = o.agents.map((a) => `<div class="desk s-${a.status}"><span class="bot">${ICON[a.id] || '🤖'}</span><span class="nm">${esc(a.name)}</span></div>`).join('');
    $('agents').innerHTML = o.agents.map((a) => {
      const btn = a.mode === 'core' || a.mode === 'planned' ? '' : `<button class="ghost" data-agent="${esc(a.id)}" data-on="${a.enabled ? 0 : 1}">${a.enabled ? '关闭' : '开启'}</button>`;
      return `<div class="row"><span><i class="dot ${a.status}"></i>${esc(a.name)} <span class="sim">${esc(a.mode)}${a.needs ? ' · ' + esc(a.needs) : ''}</span><div class="sim">${esc(a.desc)}</div></span><span>${btn}</span></div>`;
    }).join('');
    $('tasks').innerHTML = o.tasks.length ? o.tasks.slice(0, 8).map((t) => `<div class="row" data-task="${esc(t.id)}" style="cursor:pointer"><span><i class="dot ${t.status}"></i>${esc(t.title)} <small class="sim">${esc(t.agent)} · ${esc(t.id)}</small></span><span class="sim">${t.status} ›</span></div>`).join('') : '<span class="sim">暂无任务</span>';
    const c = o.context;
    $('bar').className = 'bar ' + c.level; $('bar').firstElementChild.style.width = Math.min(100, c.ratio * 100) + '%';
    $('ctx').textContent = `${c.used}/${c.window} tokens（${c.source === 'measured' ? '模型实测' : '本地估算'}）· ${c.messages} 条消息`;
  } catch (e) {
    if (!$('app').hidden) return;
    $('err').textContent = '登录失败：' + e.message; sessionStorage.removeItem('tank_token');
  }
}
$('tasks').onclick = guard(async (e) => {
  const row = e.target.closest('[data-task]'); if (!row) return;
  const t = await api('/tasks/' + row.dataset.task);
  $('taskDetailCard').hidden = false;
  $('taskDetail').innerHTML = `<b>${esc(t.title)}</b> <span class="sim">${esc(t.agent)} · ${esc(t.status)} · ${esc(t.createdAt)}</span>` +
    (t.steps.length ? t.steps.map((s) => `<div class="row"><span>${esc(s.text)}</span><span class="sim">${esc(s.at.slice(11, 19))}</span></div>`).join('') : '<div class="sim">没有步骤记录</div>');
  $('taskDetailCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
$('agents').onclick = guard(async (e) => { const id = e.target.dataset?.agent; if (!id) return; await post('/agents/' + id, { enabled: e.target.dataset.on === '1' }); refresh(); });

async function integrations() {
  try {
    const i = await api('/integrations');
    const h = (p) => !p.configured ? '未配置' : !p.reachable ? '不可达' : p.authenticated === false ? '密钥无效' : '正常';
    $('integ').innerHTML = `Hermes（Owner）：${h(i.hermes.owner)}<br>Hermes（好友 Profile）：${h(i.hermes.friend)}<br>UnraidClaw：${!i.unraid.configured ? '未配置' : i.unraid.reachable ? '正常' : esc(i.unraid.error || '不可达')}`;
  } catch (e) { $('integ').textContent = '不可用：' + e.message; }
}
async function nas() {
  try { const s = await api('/unraid/status'); $('nas').textContent = (s.simulated ? '[模拟数据] ' : '') + JSON.stringify(s, null, 2); }
  catch (e) { $('nas').textContent = '不可用：' + e.message; }
}

// ---------- 审批 ----------
async function approvals() {
  try {
    const r = await api('/approvals');
    const rows = r.items.slice(0, 6).map((a) => `<div class="row"><span><i class="dot ${a.status}"></i>${esc(a.action)} <b>${esc(a.target)}</b> <span class="sim">${esc(a.status)}</span></span>${a.status === 'pending' ? `<span><button data-ap="${esc(a.id)}" data-ok="1">批准执行</button><button class="bad" data-ap="${esc(a.id)}" data-ok="0">拒绝</button></span>` : ''}</div>`).join('');
    $('appr').innerHTML = (r.opsEnabled ? `<div class="sim">写操作已启用 · 白名单：${esc(r.allowlist.join(', '))}</div>` : '<div class="sim">写操作未启用（需配置 UNRAID_WRITE_*）</div>') + (rows || '<span class="sim">暂无审批</span>');
  } catch (e) { $('appr').textContent = '不可用：' + e.message; }
}
$('appr').onclick = guard(async (e) => { const id = e.target.dataset?.ap; if (!id) return; await post(`/approvals/${id}/decide`, { approve: e.target.dataset.ok === '1' }); approvals(); refresh(); });
$('opGo').onclick = guard(async () => { await post('/ops/docker', { action: $('opAct').value, target: $('opTarget').value.trim() }); $('opTarget').value = ''; approvals(); });

// ---------- 插件中心 ----------
async function plugins() {
  try {
    const list = await api('/plugins');
    $('plugins').innerHTML = list.map((p) => {
      const perms = p.permissions.map((x) => `<span class="perm ${p.grants.includes(x) ? 'on' : ''}">${esc(x)}</span>`).join('');
      const b = (act, label) => `<button data-p="${esc(p.id)}" data-a="${act}">${label}</button>`;
      const actions = !p.installed ? b('install', '安装')
        : p.enabled ? b('health', '健康检查') + b('disable', '停用') + b('uninstall', '卸载')
        : b('grant', '授予全部声明权限') + b('enable', '启用') + b('uninstall', '卸载');
      const extra = (p.source === 'generated' ? b('rollback', '回滚上一版') : '') + (p.canRollbackState ? b('rollback-state', '撤销上次授权/启停') : '');
      return `<div class="pg"><b>${esc(p.name)}</b> <small class="sim">v${esc(p.version)} · ${esc(p.type)} · P${p.level} · ${esc(p.source)} · ${esc(p.id)}</small>
        <span class="sim"> ${p.enabled ? '已启用' : p.installed ? '已安装（停用）' : '未安装'}${p.needsReview ? ' · 需重新审核' : ''}${p.valid ? '' : ' · 清单无效'}${p.requires.length ? ' · 依赖 ' + esc(p.requires.join(',')) : ''}</span>
        <div class="mute">${esc(p.description || '')}</div><div>${perms}</div><div>${actions}${extra}</div></div>`;
    }).join('') || '<span class="sim">暂无插件</span>';
    // 已启用的 UI 类插件（含创造工坊生成的卡片）直接渲染
    const cards = [];
    for (const p of list.filter((x) => x.enabled && x.type === 'ui')) {
      try { const r = await post(`/plugins/${p.id}/tools/run`); cards.push(`<div class="card"><h2>${esc(r.title)}</h2>${r.fields.map((f) => `<div class="row"><span>${esc(f.label)}</span><b>${esc(f.value)}</b></div>`).join('')}</div>`); }
      catch (e) { cards.push(`<div class="card"><h2>${esc(p.name)}</h2><span class="sim">${esc(e.message)}</span></div>`); }
    }
    $('pcards').innerHTML = cards.join('');
  } catch (e) { $('plugins').textContent = '不可用：' + e.message; }
}
$('plugins').onclick = guard(async (e) => {
  const id = e.target.dataset?.p, act = e.target.dataset?.a; if (!id) return;
  if (act === 'grant') { const p = await api('/plugins/' + id); await post(`/plugins/${id}/grant`, { permissions: p.permissions }); }
  else if (act === 'uninstall') await api('/plugins/' + id, { method: 'DELETE' });
  else if (act === 'health') { alert(JSON.stringify(await api(`/plugins/${id}/health`), null, 2)); return; }
  else if (act === 'rollback') await post(`/workshop/rollback/${id}`);
  else await post(`/plugins/${id}/${act}`);
  plugins(); drafts();
});

// ---------- 创造工坊 ----------
async function drafts() {
  try {
    const list = await api('/workshop/drafts');
    $('drafts').innerHTML = list.slice(0, 5).map((d) => `<div class="pg"><b>${esc(d.spec?.name || '（未通过）')}</b> <span class="sim">${esc(d.spec?.kind || '')} · ${esc(d.stage)} · 来源 ${esc(d.via)} · ${esc(d.id)}</span>
      <div class="mute">${esc(d.request)}</div>${d.checks?.errors?.length ? `<div class="sim">${esc(d.checks.errors.join('；'))}</div>` : ''}
      ${d.review ? `<div>${d.review.permissions.map((p) => `<span class="perm">${esc(p)}</span>`).join('')}</div><div class="sim">试运行：${d.trial.ok ? '通过' : '未通过'} ${esc((d.trial.warnings || []).join('；'))}</div>` : ''}
      ${d.stage === 'awaiting_confirm' ? `<button data-d="${esc(d.id)}" data-a="publish">确认发布（默认停用）</button><button class="ghost" data-d="${esc(d.id)}" data-a="reject">放弃</button>` : ''}</div>`).join('') || '<span class="sim">暂无草稿</span>';
  } catch (e) { $('drafts').textContent = '不可用：' + e.message; }
}
$('wsGo').onclick = guard(async () => { await post('/workshop/drafts', { request: $('wsReq').value }); $('wsReq').value = ''; drafts(); });
$('drafts').onclick = guard(async (e) => { const id = e.target.dataset?.d; if (!id) return; await post(`/workshop/drafts/${id}/${e.target.dataset.a}`); drafts(); plugins(); });

// ---------- 人格工坊 ----------
async function personas() {
  try {
    const l = await api('/persona');
    $('personas').innerHTML = l.versions.map((v) => `<div class="row"><span>v${v.v} <b>${esc(v.name)}</b> <span class="sim">${esc(v.source)} ${esc(v.note || '')}${v.v === l.active ? ' · 生效中' : ''}</span></span><span>${v.v === l.active ? '' : `<button class="ghost" data-pdiff="${v.v}" data-active="${l.active}">差异</button><button data-pact="${v.v}">激活</button>`}</span></div>`).join('');
  } catch (e) { $('personas').textContent = '不可用：' + e.message; }
}
$('personas').onclick = guard(async (e) => {
  if (e.target.dataset?.pact) { if (confirm('确认切换人格？（安全规则不会改变）')) await post(`/persona/${e.target.dataset.pact}/activate`); personas(); }
  if (e.target.dataset?.pdiff) { const d = await api(`/persona/diff?from=${e.target.dataset.active}&to=${e.target.dataset.pdiff}`); alert(d.length ? d.map((x) => `${x.field}：\n  旧：${JSON.stringify(x.from)}\n  新：${JSON.stringify(x.to)}`).join('\n\n') : '没有差异'); }
});
$('pImp').onclick = guard(async () => { const t = $('pCard').value.trim(); let card = t; try { card = JSON.parse(t); } catch { /* 纯文本 */ } await post('/persona/import', { card, note: '网页导入' }); $('pCard').value = ''; personas(); });

// ---------- 记忆与日记：查看 / 纠正 / 删除 ----------
async function memories() {
  try {
    const [m, d] = await Promise.all([api('/memories'), api('/diary')]);
    const row = (kind, x) => `<div class="row"><span>${esc(x.text)} <span class="sim">${esc(x.id)}${x.updatedAt ? ' · 已更正' : ''}</span></span><span><button class="ghost" data-k="${kind}" data-id="${esc(x.id)}" data-a="edit">纠正</button><button class="bad" data-k="${kind}" data-id="${esc(x.id)}" data-a="del">删除</button></span></div>`;
    $('mems').innerHTML = m.map((x) => row('memories', x)).join('') || '<span class="sim">暂无记忆</span>';
    $('diary').innerHTML = d.slice().reverse().slice(0, 8).map((x) => row('diary', x)).join('') || '<span class="sim">暂无日记</span>';
  } catch (e) { $('mems').textContent = '不可用：' + e.message; }
}
async function memAction(e) {
  const { k, id, a } = e.target.dataset; if (!id) return;
  if (a === 'del') { if (confirm('确认删除？')) await api(`/${k}/${id}`, { method: 'DELETE' }); }
  if (a === 'edit') { const cur = e.target.closest('.row').querySelector('span').childNodes[0].textContent.trim(); const t = prompt('纠正为：', cur); if (t) await api(`/${k}/${id}`, { method: 'PUT', body: JSON.stringify({ text: t }) }); }
  memories();
}
$('mems').onclick = guard(memAction); $('diary').onclick = guard(memAction);
$('memAdd').onclick = guard(async () => { await post('/memories', { text: $('memNew').value }); $('memNew').value = ''; memories(); });
$('diaryAdd').onclick = guard(async () => { await post('/diary', { text: $('diaryNew').value }); $('diaryNew').value = ''; memories(); });

// ---------- 语音中心 ----------
async function voice() {
  try {
    const v = await api('/voice');
    const opts = v.tts.voices.map((x) => `<option ${x === v.settings.voice ? 'selected' : ''}>${esc(x)}</option>`).join('');
    $('voice').innerHTML = `识别：${v.stt.configured ? '已配置' : '未配置'}${v.stt.cloud ? '（云端）' : ''} · 合成：${v.tts.configured ? '已配置' : '未配置'}${v.tts.cloud ? '（云端）' : ''}<div class="sim">${esc(v.privacy)}</div>
      <div style="margin-top:6px"><label><input type="checkbox" id="vEn" ${v.settings.enabled ? 'checked' : ''}> 启用语音</label> <label><input type="checkbox" id="vRe" ${v.settings.replyWithVoice ? 'checked' : ''}> 语音回复</label></div>
      <div style="margin-top:6px"><select id="vVoice">${opts}</select> <input id="vText" value="你好，我是大肥鱼" style="width:60%"> <button id="vTest" ${v.tts.configured ? '' : 'disabled'}>试听</button></div>`;
  } catch (e) { $('voice').textContent = '不可用：' + e.message; }
}
$('voice').onchange = guard(async (e) => {
  if (e.target.id === 'vEn') await post('/voice/settings', { enabled: e.target.checked });
  if (e.target.id === 'vRe') await post('/voice/settings', { replyWithVoice: e.target.checked });
  if (e.target.id === 'vVoice') await post('/voice/settings', { voice: e.target.value });
});
$('voice').onclick = guard(async (e) => {
  if (e.target.id !== 'vTest') return;
  const res = await fetch('/api/voice/tts', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ text: $('vText').value, voice: $('vVoice').value }) });
  if (!res.ok) throw new Error((await res.json()).error);
  new Audio(URL.createObjectURL(await res.blob())).play();
});

// ---------- 聊天 / 登录 ----------
$('cmp').onclick = guard(async () => { await post('/context/compact'); refresh(); });
async function send() {
  const text = $('msg').value.trim(); if (!text) return; $('msg').value = '';
  $('chatlog').insertAdjacentHTML('beforeend', `<div class="u">我：${esc(text)}</div>`); setFish('thinking');
  try {
    const r = await post('/chat', { text });
    $('chatlog').insertAdjacentHTML('beforeend', `<div>大肥鱼：${esc(r.reply)}</div>`);
    if (r.approval) approvals();
    memories();
  } catch (e) { $('chatlog').insertAdjacentHTML('beforeend', `<div class="sim">出错：${esc(e.message)}</div>`); }
  $('chatlog').scrollTop = 1e9; refresh();
}
$('send').onclick = send; $('msg').onkeydown = (e) => { if (e.key === 'Enter') send(); };
$('pet').onclick = () => $('msg').scrollIntoView({ behavior: 'smooth', block: 'center' }) || $('msg').focus();

async function boot() {
  await refresh(); if ($('app').hidden) return;
  await loadPrefs().catch(() => {});
  setFish(charState);
  nas(); integrations(); approvals(); plugins(); drafts(); personas(); voice(); memories();
  if (prefs?.splash) { $('splashFish').innerHTML = window.renderFish('idle', 120); setTimeout(() => $('splash').classList.add('hide'), 1200); } else $('splash').classList.add('hide');
}
$('go').onclick = () => { token = $('tok').value.trim(); sessionStorage.setItem('tank_token', token); boot(); };
if (token) boot(); else $('splash').classList.add('hide');
setInterval(() => { if (!$('app').hidden) { refresh(); approvals(); } }, 5000);
