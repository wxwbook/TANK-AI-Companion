// 内置插件的处理函数。第三方（external）插件在沙盒实现之前不会被执行。
export function createBuiltinHandlers({ unraid, chat, ops }) {
  const req = (action) => async ({ target }, ctx) => ({ approvalRequired: true, approval: await ops.request(ctx.user, { action, target }) });
  return {
    'unraid-ops': { 'docker.restart': req('restart'), 'docker.start': req('start'), 'docker.stop': req('stop') },
    unraid: {
      'status': () => unraid.status(),
      'docker.list': () => unraid.dockerList(),
      'array.status': () => unraid.arrayStatus(),
      'disks.list': () => unraid.disks(),
    },
    'session-stats': {
      'usage': (_args, ctx) => chat().usage(ctx.user.id),
    },
  };
}
