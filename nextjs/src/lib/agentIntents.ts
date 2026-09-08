// src/lib/agentIntents.ts
//
// The assistant's intent vocabulary, and the questions the page offers.
//
// These two things live together because they have to agree exactly. The page
// shows six openers; the route recognises those same six strings and skips its
// classification call for them. A prompt reworded in one file and not the other
// would not break anything visibly — it would just quietly start paying for a
// model call to classify a question whose answer was already written down here.
//
// Pass 1 costs ~870 tokens and a request against a provider's per-minute quota.
// On the six most-clicked questions in the app, that is a round trip to learn
// something the button already knew.

/** What a question is asking for, which decides both the query and the panels. */
export type QueryIntent =
    | 'top_position'        // "best QBs last year"
    | 'player_vs_opponent'  // "Josh Allen vs the Patriots"
    | 'player_comparison'   // "Lamar vs Mahomes"
    | 'player_recent'       // "how has Davante Adams been doing"
    | 'air_yards_efficiency' // "WRs with high air yards but few catches"
    | 'workload_trend'       // "is RB X declining over the season"
    | 'efficiency_gap'       // "high targets, low points — buy-low"
    | 'standings'            // "who is in first place / league standings"
    | 'roster_scan'          // "who in our league has weak RBs"
    | 'playoff_schedule'     // "who has easiest playoff schedule"
    | 'start_sit'            // "should I start or sit my RB this week"
    | 'waiver_wire'          // "who should I pick up"
    | 'trade_analyzer'       // "who should I trade for"
    | 'trending'             // "who is being added league-wide"
    | 'general';             // fallback

export interface QueryPlan {
    intent: QueryIntent;
    players: string[];
    position: string | null;
    opponent: string | null;
    season: number | null;
    weeksBack: number | null;   // "last 3 weeks" → 3
}

/** Every intent the planner may return. Anything else is treated as `general`. */
export const VALID_INTENTS: QueryIntent[] = [
    'top_position', 'player_vs_opponent', 'player_comparison', 'player_recent',
    'air_yards_efficiency', 'workload_trend', 'efficiency_gap',
    'standings', 'roster_scan', 'playoff_schedule',
    'start_sit', 'waiver_wire', 'trade_analyzer', 'trending', 'general',
];

/** A plan with nothing extracted — the shape every field defaults to. */
export function emptyPlan(intent: QueryIntent = 'general'): QueryPlan {
    return { intent, players: [], position: null, opponent: null, season: null, weeksBack: null };
}

/**
 * The openers the page shows, each with the plan it resolves to.
 *
 * Every one is a question the route has a data source for. The set they
 * replaced was written before it did — "should I start or sit my running back
 * this week?" was in it, and the assistant answered by asking which running
 * back was meant, because nothing in its context knew.
 */
export const SUGGESTED_PROMPTS: { text: string; plan: QueryPlan }[] = [
    { text: 'How does my matchup look this week?',            plan: emptyPlan('start_sit') },
    { text: 'Who should I start at flex?',                    plan: { ...emptyPlan('start_sit'), position: 'RB' } },
    { text: 'Which free agents fix my weakest position?',     plan: emptyPlan('waiver_wire') },
    { text: 'What trade should I offer, and to who?',         plan: emptyPlan('trade_analyzer') },
    { text: 'Which running backs are trending up right now?', plan: { ...emptyPlan('trending'), position: 'RB', weeksBack: 2 } },
    { text: 'Who on my bench should be starting?',            plan: emptyPlan('start_sit') },
];

/**
 * Casing, spacing and trailing punctuation removed.
 *
 * A clicked opener arrives byte-identical, so this is only for the reader who
 * types one out or pastes it back with a full stop on the end. Nothing else is
 * normalised away: two questions that differ by a word are different questions.
 */
function normalise(message: string): string {
    return message.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[?.!]+$/, '');
}

const BY_TEXT = new Map(SUGGESTED_PROMPTS.map((p) => [normalise(p.text), p.plan]));

/**
 * The plan for a question the page already knows the answer shape of, or null.
 *
 * Exact matches only. A near-miss goes to the planner, which is the whole point
 * — guessing an intent from a partial match would put the wrong data in front
 * of the model to save a call that costs less than a wrong answer.
 */
export function plannerShortcut(message: string): QueryPlan | null {
    const plan = BY_TEXT.get(normalise(message));
    return plan ? { ...plan } : null;
}
