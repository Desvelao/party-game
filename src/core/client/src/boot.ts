// Entry point: installed games register in the catalog before the app builds any menu.
import { setupInstall } from './install';
import { bootFeatures } from './plugins/features';
import { bootGames } from './plugins/registry';

setupInstall();

void Promise.all([bootGames(), bootFeatures()]).then(() => import('./main'));
