// One line per game. Adding a game = a folder under bot/games/<id> exporting a GamePlugin, plus its line here.
import { registerGame } from '../core/registry';
import { ballistix } from './ballistix';
import { sprintSmash } from './sprint-smash';
import { boxBonanza } from './box-bonanza';
import { tankWars } from './tank-wars';
import { rumbleCards } from './rumble-cards';
import { springShowdown } from './spring-showdown';
import { crazyLogs } from './crazy-logs';
import { frostShove } from './frost-shove';

registerGame(ballistix);
registerGame(frostShove);
registerGame(crazyLogs);
registerGame(springShowdown);
registerGame(rumbleCards);
registerGame(tankWars);
registerGame(boxBonanza);
registerGame(sprintSmash);
