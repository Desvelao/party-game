/** Difficulty names a room may ask for; 'random' lets the host of the bots pick one per bot. What each level means is up to each game's AI. */
export const BOT_LEVELS = ['easy', 'normal', 'hard', 'expert', 'semigod', 'random'] as const;
export type BotLevel = (typeof BOT_LEVELS)[number];
export const isBotLevel = (v: unknown): v is BotLevel => typeof v === 'string' && (BOT_LEVELS as readonly string[]).includes(v);
