// Interface half of __NAME__ (optional): slots in the lobby. Import types only from the core.
import type { ClientPlugin } from '__SRC__/client/src/plugins/features';

const plugin: ClientPlugin = {
  lobbyInfo(ctx) {
    const state = ctx.state() as { greeting?: string } | undefined;
    return state?.greeting ? ctx.h('p', { class: 'sub' }, state.greeting) : null;
  },
};
export default plugin;
