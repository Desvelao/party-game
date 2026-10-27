/**
 * Test environment: the core ships without games, so every test file gets the games under src/games/
 * registered from their source (no build step), exactly as the loader registers installed packs.
 */
import { registerSourceGames } from './server/plugins/sourceGames';

await registerSourceGames();
