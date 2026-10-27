/** Tunable numbers of the sumo policy (full strength). Override with --param name=value; they are written to every report. */
export const DEFAULT_PARAMS: Record<string, number> = {
  /** the policy sees the world this many ms late (human reaction time) */
  reactionMs: 0,
  /** attention lapses per second: the stick freezes for 300-600 ms and nothing is pressed */
  lapse: 0,
  /** cap on the stick length: acceleration as a fraction of the maximum */
  speed: 1,
  /** px of random error in where it wants to stand and where it aims a dash */
  noise: 0,
  /** px of ice it wants between itself and the edge (more = plays safer) */
  edgeMargin: 70,
  /** s of movement simulated per candidate direction */
  lookahead: 0.5,
  /** 1 = dash into rivals */
  dash: 1,
  /** 0..1: least share of a dash's push that must point the rival over the edge (lower = dashes more freely) */
  dashAlign: 0.35,
  /** fraction of the dash reach it attacks from */
  dashRange: 1,
  /** 0..1: how much it keeps out of reach of a rival's dash when its back is to the edge */
  dodge: 1,
  /** 0..1: how much it goes for good boxes and avoids bad ones */
  items: 1,
  /** 0..1: how well it plays Lightning and Weight (pass the Weight on, keep clear of it, hold and protect the Lightning) */
  carry: 1,
  /** 0..1: weight of getting into a pushing position behind the rival (0 = only survives) */
  aggro: 1,
  /** 0..1: wait where a rival in the water climbs back (it is stunned on the rim) instead of ignoring it */
  camp: 1,
  /** button presses per second while climbing out of the water (5 are needed within 1.4 s, after the reaction time) */
  mash: 12,
  /** 1 = know the rules of the variant being played (bolts, tilt, melting, bombs); 0 = play every variant as Frost Shove */
  variantAware: 1,
  /** Wild Frenzy: 0..1 accuracy of bomb throws (lead on a moving rival); 0 = throws at where the rival is */
  bombLead: 1,
};
