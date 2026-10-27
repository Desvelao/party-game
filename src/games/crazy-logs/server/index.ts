// Server half of Crazy Logs: the river simulation.
import type { ServerGamePlugin } from '../../../core/shared/plugin-api';
import { CrazyLogs } from './CrazyLogs';
import { greedyLogs } from './bot';
import { applyOptions } from './config';
import { crazyLogs } from '../bot';

const plugin: ServerGamePlugin = {
  createMinigame: (_playableId, options, rng) => new CrazyLogs(applyOptions(options), rng),
  bot: greedyLogs,
  ai: crazyLogs,
};
export default plugin;
