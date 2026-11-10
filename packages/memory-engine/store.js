import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// 每个用户一个独立目录，互不可见。用户 ID 仅允许字母数字，防止路径穿越。
const safeId = (id) => {
  const s = String(id);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) throw new Error('非法用户 ID');
  return s;
};

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file); // 原子替换，避免写一半崩溃
}

export function createMemoryStore(dataDir) {
  const dir = (uid) => {
    const d = join(dataDir, 'users', safeId(uid));
    mkdirSync(d, { recursive: true });
    return d;
  };
  const f = (uid, name) => join(dir(uid), name);

  return {
    // ---- 个人记忆：只存用户明确说出/确认的内容，不存推断 ----
    addMemory(uid, text) {
      const items = readJson(f(uid, 'memory.json'), []);
      const m = { id: randomUUID().slice(0, 8), text: String(text).trim(), createdAt: new Date().toISOString() };
      if (!m.text) throw new Error('内容为空');
      items.push(m);
      writeJson(f(uid, 'memory.json'), items);
      return m;
    },
    // 纠正：只改文本，保留编号与创建时间，记录修改时间
    updateMemory(uid, id, text) {
      const items = readJson(f(uid, 'memory.json'), []);
      const m = items.find((x) => x.id === id); const t = String(text ?? '').trim();
      if (!m) return null; if (!t) throw new Error('内容为空');
      m.text = t; m.updatedAt = new Date().toISOString();
      writeJson(f(uid, 'memory.json'), items); return m;
    },
    updateDiary(uid, id, text) {
      const items = readJson(f(uid, 'diary.json'), []);
      const e = items.find((x) => x.id === id); const t = String(text ?? '').trim();
      if (!e) return null; if (!t) throw new Error('内容为空');
      e.text = t; e.updatedAt = new Date().toISOString();
      writeJson(f(uid, 'diary.json'), items); return e;
    },
    listMemories: (uid) => readJson(f(uid, 'memory.json'), []),
    removeMemory(uid, id) {
      const items = readJson(f(uid, 'memory.json'), []);
      const next = items.filter((m) => m.id !== id);
      writeJson(f(uid, 'memory.json'), next);
      return items.length !== next.length;
    },
    // ---- 日记 ----
    addDiary(uid, text) {
      const items = readJson(f(uid, 'diary.json'), []);
      const e = { id: randomUUID().slice(0, 8), text: String(text).trim(), createdAt: new Date().toISOString() };
      if (!e.text) throw new Error('内容为空');
      items.push(e);
      writeJson(f(uid, 'diary.json'), items);
      return e;
    },
    listDiary: (uid) => readJson(f(uid, 'diary.json'), []),
    removeDiary(uid, id) {
      const items = readJson(f(uid, 'diary.json'), []);
      const next = items.filter((e) => e.id !== id);
      writeJson(f(uid, 'diary.json'), next);
      return items.length !== next.length;
    },
    // ---- 会话历史与摘要 ----
    getSession: (uid) => readJson(f(uid, 'session.json'), { messages: [], summary: '', usage: [] }),
    saveSession: (uid, s) => writeJson(f(uid, 'session.json'), s),
    // ---- 用户偏好（主题、动画、语音等）----
    getPrefs: (uid) => readJson(f(uid, 'prefs.json'), {}),
    setPrefs: (uid, prefs) => writeJson(f(uid, 'prefs.json'), prefs),
    // 用户要求删除全部数据
    eraseAll(uid) {
      for (const n of ['memory.json', 'diary.json', 'session.json', 'prefs.json']) writeJson(f(uid, n), n === 'session.json' ? { messages: [], summary: '', usage: [] } : n === 'prefs.json' ? {} : []);
    },
  };
}
