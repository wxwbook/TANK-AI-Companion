// 大肥鱼角色状态机：Telegram / Mini App / Web Office 共享同一状态。
export const STATES = ['idle', 'chatting', 'thinking', 'working', 'awaiting_approval', 'done', 'error', 'resting'];

export function createCharacterState() {
  let state = 'idle';
  let since = Date.now();
  const listeners = new Set();
  return {
    get: () => ({ state, since, form: 'chibi' }),
    set(next) {
      if (!STATES.includes(next)) throw new Error(`未知状态: ${next}`);
      state = next; since = Date.now();
      for (const l of listeners) l(state);
    },
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
