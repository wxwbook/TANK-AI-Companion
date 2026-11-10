import { join } from 'node:path';
import { loadPersona, createHermesClient, createHermesRouter } from '../agent-runtime/hermes.js';
import { createCharacterState } from '../agent-runtime/state.js';
import { createTaskCenter } from '../agent-runtime/tasks.js';
import { createChatService } from '../agent-runtime/chat.js';
import { createPersonaStore } from '../agent-runtime/persona.js';
import { createTeam } from '../agent-runtime/team.js';
import { createAgentSettings } from '../agent-runtime/agents.js';
import { createMemoryStore } from '../memory-engine/store.js';
import { createUnraidAdapter } from '../adapters/unraid.js';
import { createUnraidOps } from '../adapters/unraid-ops.js';
import { createAudit } from '../audit/audit.js';
import { createApprovals } from './approvals.js';
import { createOps } from './ops.js';
import { createRegistry } from '../plugin-hub/registry.js';
import { createPluginRuntime } from '../plugin-hub/runtime.js';
import { createBuiltinHandlers } from '../plugin-hub/builtin/index.js';
import { createVoice } from '../voice/voice.js';
import { createThemes } from './themes.js';
import { createWorkshop } from '../workshop/workshop.js';
import { validateSpec } from '../workshop/spec.js';
import { runSpec } from '../workshop/interpreter.js';
import { ROOT } from './config.js';

// 组装所有服务。API 与 Bot 共用同一套，保证身份与状态一致。
export function createServices(cfg, overrides = {}) {
  const audit = createAudit(cfg.dataDir);
  const store = createMemoryStore(cfg.dataDir);
  const hermes = overrides.hermes ?? createHermesClient(cfg.hermes);
  const hermesFriend = overrides.hermesFriend ?? createHermesClient(cfg.hermesFriend);
  const router = createHermesRouter(hermes, hermesFriend);
  const personaStore = createPersonaStore({ dataDir: cfg.dataDir, audit });
  const tasks = createTaskCenter();
  const character = createCharacterState();
  const unraid = overrides.unraid ?? createUnraidAdapter(cfg.unraid);
  const unraidOps = overrides.unraidOps ?? createUnraidOps(cfg.unraid, { reader: unraid });
  const approvals = createApprovals({ audit });
  const ops = createOps({ approvals, audit, unraidOps, tasks, character, ownerId: cfg.ownerId });
  const agentSettings = createAgentSettings(cfg.dataDir);
  const registry = createRegistry({ pluginsDir: join(ROOT, 'plugins'), extraDirs: [join(cfg.dataDir, 'generated-plugins')], dataDir: cfg.dataDir, audit });

  // chat 与插件运行时、团队之间有循环依赖，用延迟引用打破
  let chat;
  const pluginRuntime = createPluginRuntime({ registry, audit, handlers: createBuiltinHandlers({ unraid, chat: () => chat, ops }),
    // 生成的插件：声明式规格由解释器执行；每次运行前重新校验规格，且所有工具调用仍经过插件运行时
    generated: (id, tool) => tool !== 'run' ? null : async (_args, ctx) => {
      const spec = registry.spec(id);
      const v = validateSpec(spec, registry);
      if (!v.ok) throw new Error('规格无效：' + v.errors.join('；'));
      return runSpec(spec, { user: ctx.user, runtime: pluginRuntime });
    } });
  const team = createTeam({ pluginRuntime, tasks, audit, store, settings: agentSettings });
  chat = createChatService({ store, router, personaStore, team, tasks, character, audit, contextWindow: cfg.contextWindow });

  const workshop = createWorkshop({ registry, pluginRuntime, router, audit, dataDir: cfg.dataDir });
  const voice = overrides.voice ?? createVoice(cfg.voice, store);
  const themes = createThemes({ dataDir: cfg.dataDir, audit });
  const svc = { voice, themes, workshop, cfg, audit, store, hermes, hermesFriend, router, personaStore, persona: loadPersona(), tasks, character,
    unraid, unraidOps, approvals, ops, agentSettings, registry, pluginRuntime, team, chat };
  return svc;
}
