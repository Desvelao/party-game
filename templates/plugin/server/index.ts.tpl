// Server half of __NAME__: starts with the server, may keep state per room (shown to every player) and answer actions.
import type { ServerPlugin } from '__SRC__/shared/plugins';

const plugin: ServerPlugin = {
  start(host) {
    host.log(`started (${String(host.config.greeting)})`);
    // keep the room's state for this plugin up to date whenever a room is created
    host.rooms.on('created', (room) => room.setExt('__ID__', { greeting: host.config.greeting }));
  },
  onAction(room, clientId, data) {
    if (room.isHost(clientId) && data.a === 'ping') room.setExt('__ID__', { greeting: 'pong' });
  },
};
export default plugin;
