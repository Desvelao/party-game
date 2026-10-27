// Rumble Cards: the card catalogue. Shared by the server (rules) and the client (what a card shows).
// A card is a list of effects; `def` makes it a Defense card that stays on the table until its hit points are gone.

export type Effect =
  | { k: 'dmg'; n: number } // damage to one opponent
  | { k: 'all'; n: number } // damage to every opponent
  | { k: 'heal'; n: number } // recover hit points (up to the maximum)
  | { k: 'draw'; n: number } // draw cards
  | { k: 'play'; n: number } // play more cards this turn
  | { k: 'steal' } // take a random card from an opponent's hand
  | { k: 'smash' }; // destroy an opponent's oldest Defense card

/** The illustrations the client can draw (see client/art.ts); `n` repeats the motif for a stronger card. */
export type Motif = 'bolt' | 'paw' | 'rock' | 'wall' | 'shield' | 'heart' | 'swirl' | 'feather' | 'eye' | 'moon' | 'comet' | 'stars';

export interface CardDef {
  name: string;
  fx: Effect[];
  /** Defense card: hit points it absorbs before it is discarded */
  def?: number;
  art: { m: Motif; n?: number };
  /** future: URL of a bitmap artwork; when set, a client draws it instead of the `art` illustration */
  img?: string;
  /** English sentence for effects the icons cannot say (steal, smash); translated by the client */
  note?: string;
}

export interface Hero {
  name: string;
  color: number;
  /** [card index, copies]; 28 cards */
  deck: [number, number][];
}

export const CARDS: CardDef[] = [];
const add = (name: string, art: CardDef['art'], fx: Effect[], def?: number, note?: string): number => CARDS.push({ name, art, fx, def, note }) - 1;

export const NOTE_STEAL = "Take a random card from your target's hand.";
export const NOTE_SMASH = "Destroy your target's oldest Defense card.";

// Volt Fox: fast, plays many cards
const zap = add('Zap', { m: 'bolt' }, [{ k: 'dmg', n: 1 }]);
const pounce = add('Pounce', { m: 'paw', n: 2 }, [{ k: 'dmg', n: 2 }]);
const quickDash = add('Quick Dash', { m: 'swirl' }, [{ k: 'draw', n: 1 }, { k: 'play', n: 1 }]);
const nap = add('Nap', { m: 'heart' }, [{ k: 'heal', n: 1 }]);
const furShield = add('Fur Shield', { m: 'shield' }, [], 1);
const chainZap = add('Chain Zap', { m: 'bolt', n: 2 }, [{ k: 'dmg', n: 1 }, { k: 'play', n: 1 }]);
const rush = add('Lightning Rush', { m: 'bolt', n: 3 }, [{ k: 'dmg', n: 1 }, { k: 'draw', n: 1 }]);
// Iron Mole: sturdy
const digClaw = add('Dig Claw', { m: 'paw' }, [{ k: 'dmg', n: 1 }]);
const boulder = add('Boulder Toss', { m: 'rock', n: 2 }, [{ k: 'dmg', n: 2 }]);
const burrowWall = add('Burrow Wall', { m: 'wall', n: 2 }, [], 2);
const rockPlate = add('Rock Plate', { m: 'wall' }, [], 1);
const mudBath = add('Mud Bath', { m: 'heart' }, [{ k: 'heal', n: 1 }]);
const tunnel = add('Tunnel', { m: 'swirl' }, [{ k: 'draw', n: 1 }, { k: 'play', n: 1 }]);
const quake = add('Quake', { m: 'rock', n: 3 }, [{ k: 'all', n: 1 }]);
// Hex Owl: tricks
const peck = add('Peck', { m: 'feather' }, [{ k: 'dmg', n: 1 }]);
const hex = add('Hex', { m: 'eye' }, [{ k: 'dmg', n: 1 }, { k: 'steal' }], undefined, NOTE_STEAL);
const shatter = add('Shatter', { m: 'eye', n: 2 }, [{ k: 'dmg', n: 1 }, { k: 'smash' }], undefined, NOTE_SMASH);
const featherWard = add('Feather Ward', { m: 'shield' }, [], 1);
const moonSip = add('Moon Sip', { m: 'moon' }, [{ k: 'heal', n: 1 }]);
const insight = add('Insight', { m: 'swirl' }, [{ k: 'draw', n: 1 }, { k: 'play', n: 1 }]);
const curseBolt = add('Curse Bolt', { m: 'bolt', n: 2 }, [{ k: 'dmg', n: 2 }]);
// Comet Cat: sweeping hits
const swipe = add('Swipe', { m: 'paw' }, [{ k: 'dmg', n: 1 }]);
const cometStrike = add('Comet Strike', { m: 'comet' }, [{ k: 'dmg', n: 2 }]);
const meteors = add('Meteor Shower', { m: 'comet', n: 3 }, [{ k: 'all', n: 1 }]);
const starShield = add('Star Shield', { m: 'shield' }, [], 1);
const stardust = add('Stardust', { m: 'stars' }, [{ k: 'heal', n: 1 }]);
const warp = add('Warp', { m: 'swirl' }, [{ k: 'draw', n: 1 }, { k: 'play', n: 1 }]);
const orbit = add('Orbit', { m: 'stars', n: 2 }, [{ k: 'dmg', n: 1 }, { k: 'draw', n: 1 }]);

export const HEROES: Hero[] = [
  { name: 'Volt Fox', color: 0xffc83d, deck: [[zap, 7], [pounce, 3], [quickDash, 2], [nap, 3], [furShield, 5], [chainZap, 2], [rush, 6]] },
  { name: 'Iron Mole', color: 0x9b8579, deck: [[digClaw, 9], [boulder, 4], [burrowWall, 3], [rockPlate, 3], [mudBath, 3], [tunnel, 3], [quake, 3]] },
  { name: 'Hex Owl', color: 0xb36bff, deck: [[peck, 6], [hex, 4], [shatter, 3], [featherWard, 3], [moonSip, 3], [insight, 4], [curseBolt, 5]] },
  { name: 'Comet Cat', color: 0x4fc3ff, deck: [[swipe, 6], [cometStrike, 5], [meteors, 3], [starShield, 3], [stardust, 3], [warp, 4], [orbit, 4]] },
];

/** the cards of a hero's deck, one entry per copy */
export function deckOf(hero: number): number[] {
  const out: number[] = [];
  for (const [card, copies] of HEROES[hero % HEROES.length].deck) for (let i = 0; i < copies; i++) out.push(card);
  return out;
}

/** does playing this card aim at one opponent? */
export const needsTarget = (card: number): boolean => CARDS[card].fx.some((f) => f.k === 'dmg' || f.k === 'steal' || f.k === 'smash');

/** where a seat sits on the table (world 1000x1000): the first seat at the bottom, the rest clockwise */
export function seatPos(index: number, count: number): { x: number; y: number } {
  const a = Math.PI / 2 + (index * Math.PI * 2) / count;
  return { x: 500 + Math.cos(a) * 330, y: 500 + Math.sin(a) * 330 };
}

/** the hero whose deck holds a card (every card belongs to exactly one) */
export function heroOfCard(card: number): number {
  const i = HEROES.findIndex((h) => h.deck.some(([c]) => c === card));
  return i < 0 ? 0 : i;
}
