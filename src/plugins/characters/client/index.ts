// Interface half of the characters plugin: how its models are drawn (their slots and options are in plugin.json).
import type { ClientPlugin } from '../../../core/client/src/plugins/features';
import { blobShapes } from './blob';

const plugin: ClientPlugin = {
  characters: { blob: blobShapes },
};

export default plugin;
