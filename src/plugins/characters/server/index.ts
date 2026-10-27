// Server half of the characters plugin: nothing runs. The server reads the models' slots from plugin.json to check
// the players' looks; the games that name a model (`character` in game.json) need this plugin installed.
import type { ServerPlugin } from '../../../core/shared';

const plugin: ServerPlugin = {
  start() {},
};

export default plugin;
