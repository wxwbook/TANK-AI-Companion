import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, renameSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validateManifest, isWritePermission } from './manifest.js';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// 插件中心注册表。
// 核心原则：安装 ≠ 授权。插件默认停用且无任何授权；Owner 逐项授予权限后才可启用。
// 完整性：记录清单 SHA-256，磁盘上的清单被改动后自动停用并要求重新审核。
export function createRegistry({ pluginsDir, extraDirs = [], dataDir, audit }) {
  const stateFile = join(dataDir, 'plugin-hub', 'state.json');
  mkdirSync(join(dataDir, 'plugin-hub'), { recursive: true });
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { plugins: {} };
  const manifests = new Map(); // id -> { manifest, hash, errors }

  const save = () => {
    if (existsSync(stateFile)) copyFileSync(stateFile, stateFile + '.bak'); // 状态备份，便于恢复
    const t = stateFile + '.tmp'; writeFileSync(t, JSON.stringify(state, null, 2)); renameSync(t, stateFile);
  };
  const specs = new Map();

  // 扫描目录并与持久化状态对账
  function scan() {
    manifests.clear(); specs.clear();
    for (const root of [pluginsDir, ...extraDirs]) {
      if (!existsSync(root)) continue;
      for (const dir of readdirSync(root, { withFileTypes: true })) {
        if (!dir.isDirectory()) continue;
        const file = join(root, dir.name, 'plugin.json');
        if (!existsSync(file)) continue;
        const specFile = join(root, dir.name, 'spec.json');
        const rawManifest = readFileSync(file);
        const raw = existsSync(specFile) ? Buffer.concat([rawManifest, readFileSync(specFile)]) : rawManifest; // 哈希同时覆盖 spec
        let manifest; let errors = [];
        try { manifest = JSON.parse(rawManifest.toString('utf8')); errors = validateManifest(manifest).errors; }
        catch { errors = ['plugin.json 不是合法 JSON']; }
        const id = manifest?.id || dir.name;
        if (manifest?.id && manifest.id !== dir.name) errors.push('目录名必须与 id 一致');
        if (manifests.has(id)) { errors.push('插件 id 重复（已忽略后者）'); continue; }
        manifests.set(id, { manifest, hash: sha256(raw), errors });
        if (existsSync(specFile)) { try { specs.set(id, JSON.parse(readFileSync(specFile, 'utf8'))); } catch { errors.push('spec.json 不是合法 JSON'); } }

        const rec = state.plugins[id];
        if (!rec) continue;
        if (rec.hash !== sha256(raw) || rec.version !== manifest?.version) {
          // 清单/规格变化（升级或被篡改）：停用、清空授权、要求重新审核；保留历史便于追溯
          rec.history = [...(rec.history || []), { version: rec.version, hash: rec.hash, at: new Date().toISOString() }].slice(-10);
          rec.enabled = false; rec.grants = []; rec.needsReview = true;
          rec.version = manifest?.version; rec.hash = sha256(raw);
          audit?.record({ type: 'plugin.manifest_changed', pluginId: id });
        }
      }
    }
    save();
  }

  const view = (id) => {
    const m = manifests.get(id); const rec = state.plugins[id];
    if (!m) return null;
    const mf = m.manifest || {};
    return {
      id, name: mf.name, version: mf.version, type: mf.type, author: mf.author, source: mf.source,
      description: mf.description, level: mf.level, permissions: mf.permissions || [], tools: mf.tools || [],
      hash: m.hash, valid: m.errors.length === 0, errors: m.errors,
      installed: !!rec, enabled: !!rec?.enabled, grants: rec?.grants || [], needsReview: !!rec?.needsReview,
      requires: mf.requires || [], canRollbackState: !!rec?.prev,
      runnable: mf.source === 'builtin' || mf.source === 'generated', // 外部插件在沙盒实现前不可运行；generated 为声明式，由解释器执行
    };
  };

  // 每次变更前保存一份“启用状态 + 授权”快照，支持撤销上一次变更（一级回滚）
  const snap = (rec) => { rec.prev = { enabled: rec.enabled, grants: [...rec.grants], at: new Date().toISOString() }; };

  scan();

  return {
    // 撤销上一次启停/授权变更。恢复后仍需满足启用条件，否则保持停用。
    rollbackState(id, by) {
      const rec = state.plugins[id]; const m = manifests.get(id);
      if (!rec || !m) throw new Error('插件未安装');
      if (!rec.prev) throw new Error('没有可撤销的变更');
      const { enabled, grants } = rec.prev;
      rec.grants = grants;
      rec.enabled = enabled && !rec.needsReview && m.errors.length === 0 && m.manifest.permissions.every((p) => grants.includes(p));
      rec.prev = null; save();
      audit?.record({ type: 'plugin.rollback_state', pluginId: id, by });
      return view(id);
    },
    scan,
    list: () => [...manifests.keys()].map(view),
    get: view,
    spec: (id) => specs.get(id),
    isEnabled: (id) => !!state.plugins[id]?.enabled,
    granted: (id) => state.plugins[id]?.grants || [],

    install(id, by) {
      const m = manifests.get(id);
      if (!m) throw new Error('插件不存在');
      if (m.errors.length) throw new Error('清单无效：' + m.errors.join('；'));
      if (!state.plugins[id]) state.plugins[id] = { version: m.manifest.version, hash: m.hash, enabled: false, grants: [], installedAt: new Date().toISOString(), history: [] };
      save(); audit?.record({ type: 'plugin.install', pluginId: id, by });
      return view(id);
    },

    // 逐项授予权限。写类权限本版本不可授予；只能授予清单已声明的权限。
    grant(id, perms, by) {
      const rec = state.plugins[id]; const m = manifests.get(id);
      if (!rec || !m) throw new Error('插件未安装');
      snap(rec);
      for (const p of perms) {
        if (!m.manifest.permissions.includes(p)) throw new Error(`清单未声明权限：${p}`);
        if (isWritePermission(p) && m.manifest.source !== 'builtin') throw new Error(`写类权限 ${p} 仅内置插件可授予`);
      }
      rec.grants = [...new Set([...rec.grants, ...perms])];
      rec.needsReview = false;
      save(); audit?.record({ type: 'plugin.grant', pluginId: id, perms, by });
      return view(id);
    },
    revoke(id, perms, by) {
      const rec = state.plugins[id]; if (!rec) throw new Error('插件未安装');
      snap(rec);
      rec.grants = rec.grants.filter((p) => !perms.includes(p));
      if (!rec.grants.length) rec.enabled = false; // 没有任何授权就不应保持启用
      save(); audit?.record({ type: 'plugin.revoke', pluginId: id, perms, by });
      return view(id);
    },

    enable(id, by) {
      const rec = state.plugins[id]; const m = manifests.get(id);
      if (!rec || !m) throw new Error('插件未安装');
      if (m.errors.length) throw new Error('清单无效，无法启用');
      if (!['builtin', 'generated'].includes(m.manifest.source)) throw new Error('外部插件需要沙盒运行时，暂不可启用');
      const unmet = (m.manifest.requires || []).filter((d) => !state.plugins[d]?.enabled);
      if (unmet.length) throw new Error('依赖插件未启用：' + unmet.join(', '));
      if (rec.needsReview) throw new Error('清单已变化，需重新审核并授权');
      const missing = m.manifest.permissions.filter((p) => !rec.grants.includes(p));
      if (missing.length) throw new Error('尚未授予权限：' + missing.join(', '));
      snap(rec); rec.enabled = true; save(); audit?.record({ type: 'plugin.enable', pluginId: id, by });
      return view(id);
    },
    disable(id, by) {
      const rec = state.plugins[id]; if (!rec) throw new Error('插件未安装');
      snap(rec); rec.enabled = false; save(); audit?.record({ type: 'plugin.disable', pluginId: id, by });
      return view(id);
    },
    uninstall(id, by) {
      if (!state.plugins[id]) throw new Error('插件未安装');
      delete state.plugins[id]; save(); audit?.record({ type: 'plugin.uninstall', pluginId: id, by });
      return view(id);
    },
  };
}
