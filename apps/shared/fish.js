// 共享组件：Q 版大肥鱼（SVG，随状态变化）与主题应用。Office / Mini App / 桌面宠物共用。
(function () {
  const css = `
  @keyframes tank-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
  @keyframes tank-wobble{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}
  @keyframes tank-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}
  @keyframes tank-bg{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
  .tank-fish{display:inline-block}.tank-anim .st-idle,.tank-anim .st-chatting,.tank-anim .st-done,.tank-anim .st-resting{animation:tank-bob 3s ease-in-out infinite}
  .tank-anim .st-working,.tank-anim .st-thinking{animation:tank-wobble 1s ease-in-out infinite}.tank-anim .st-error{animation:tank-shake .4s linear 3}
  body.tank-bg-anim{background:linear-gradient(120deg,var(--bg),var(--bg2),var(--bg));background-size:300% 300%;animation:tank-bg 20s ease infinite}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  const BADGE = { thinking: '💭', working: '🔨', awaiting_approval: '❓', done: '✨', error: '💦', resting: '💤', chatting: '💬' };
  window.renderFish = function (state, size, form) {
    state = state || 'idle'; const w = size || 96;
    const eyeY = state === 'thinking' ? 40 : 43;
    const eye = state === 'resting'
      ? '<path d="M72 44 q6 5 12 0" stroke="#10243a" stroke-width="2.5" fill="none" stroke-linecap="round"/>'
      : `<circle cx="78" cy="43" r="7" fill="#fff"/><circle cx="80" cy="${eyeY}" r="3.5" fill="#10243a"/>`;
    const mouth = state === 'error' ? '<path d="M88 58 q-5 -4 -10 0" stroke="#10243a" stroke-width="2" fill="none" stroke-linecap="round"/>'
      : '<path d="M80 56 q5 5 10 0" stroke="#10243a" stroke-width="2" fill="none" stroke-linecap="round"/>';
    const badge = BADGE[state] ? `<text x="92" y="18" font-size="20">${BADGE[state]}</text>` : '';
    if (form === 'original') {
      // 原版：同一角色（同名、同配色、同状态徽标）的写实一些的形象——更修长、有鳞片与高光
      const oeye = state === 'resting' ? '<path d="M78 42 q5 4 10 0" stroke="#10243a" stroke-width="2" fill="none" stroke-linecap="round"/>'
        : `<circle cx="82" cy="41" r="5" fill="#fff"/><circle cx="83" cy="${state === 'thinking' ? 38 : 41}" r="2.6" fill="#10243a"/>`;
      return `<svg class="tank-fish st-${state}" width="${w}" height="${w * 0.75}" viewBox="0 0 120 90" role="img" aria-label="大肥鱼（原版）：${state}">
        <path d="M30 46 L4 24 Q14 46 4 68 Z" fill="var(--fish-fin)"/><path d="M46 30 Q66 6 92 26 Q70 28 46 30 Z" fill="var(--fish-fin)"/>
        <path d="M18 46 Q56 14 104 44 Q56 80 18 46 Z" fill="var(--fish-body)"/><path d="M34 52 Q64 70 98 48 Q66 82 34 52 Z" fill="#fff" opacity=".22"/>
        <g stroke="#fff" stroke-width="1.4" fill="none" opacity=".28"><path d="M44 40 q5 6 0 12"/><path d="M54 36 q5 8 0 16"/><path d="M64 36 q5 8 0 16"/><path d="M74 38 q4 7 0 14"/></g>
        ${oeye}<path d="M96 50 q-4 3 -9 1" stroke="#10243a" stroke-width="1.8" fill="none" stroke-linecap="round"/>${badge}</svg>`;
    }
    return `<svg class="tank-fish st-${state}" width="${w}" height="${w * 0.75}" viewBox="0 0 120 90" role="img" aria-label="大肥鱼：${state}">
      <polygon points="28,48 6,28 6,68" fill="var(--fish-fin)"/><path d="M50 24 q12 -16 28 -2 z" fill="var(--fish-fin)"/>
      <ellipse cx="62" cy="48" rx="38" ry="27" fill="var(--fish-body)"/><ellipse cx="62" cy="58" rx="26" ry="14" fill="#fff" opacity=".25"/>
      <circle cx="84" cy="54" r="5" fill="#ff8fb3" opacity=".55"/>${eye}${mouth}${badge}</svg>`;
  };

  window.applyTheme = function (theme, animations) {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(theme.vars || {})) if (/^--[a-z-]+$/.test(k) && /^#[0-9a-fA-F]{6}$/.test(v)) root.style.setProperty(k, v);
    document.body.classList.toggle('tank-anim', animations !== false);
    document.body.classList.toggle('tank-bg-anim', animations !== false && theme.background === 'gradient');
  };
})();
