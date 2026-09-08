// src/lib/agentTools.ts
//
// The three dashboard panels, read as prompt context for the AI assistant.
//
// Matchup Analysis, Waiver Wire and the Trade Analyzer already answer the
// questions people actually ask the assistant — "should I start him", "who do I
// pick up", "who should I trade for" — and they answer them from the reader's
// own roster. The assistant could not see any of it: its only league data was
// standings, rosters as bare name lists, and Sleeper's global trending counts.
// So it kept replying that it did not know which running back was mine.
//
// Rather than reimplement the projection, the waiver scan and the trade finder
// against a second set of rules, this module calls the routes that already run
// them and renders their answers into the compact blocks the system prompt
// wants. One implementation of each panel, two readers.
//
// The route handlers are invoked in-process. They take `leagueId` and `userId`
// as query parameters and carry no auth of their own — the assistant route has
// already established the session before it gets here — so a synthetic request
// is all they need, and it costs no extra HTTP hop. Each of them holds its
// assembled response for a minute, so a reader who opened the dashboard tab and
// then asked the assistant about it pays for the work once.

import { NextRequest } from 'next/server';
import { GET as matchupReportRoute } from '@/app/api/sleeper/matchup-report/route';
import { GET as waiverSuggestionsRoute } from '@/app/api/sleeper/waiver-suggestions/route';
import { GET as tradeSuggestionsRoute } from '@/app/api/sleeper/trade-suggestions/route';
import type { MatchupReportResponse, PlayerProjection } from '@/types/projections';
import type { WaiverSuggestionsResponse, TradeSuggestionsResponse, StatWindow } from '@/types/suggestions';
import type { PlayerContext } from '@/lib/matchupContext';

/** What the assistant can ask for, and what it gets back. */
export interface AgentTools {
  matchup: MatchupReportResponse | null;
  waivers: WaiverSuggestionsResponse | null;
  trades:  TradeSuggestionsResponse | null;
  /** Panels that were asked for and could not answer, with the route's reason. */
  errors:  string[];
}

export const EMPTY_TOOLS: AgentTools = { matchup: null, waivers: null, trades: null, errors: [] };

/** Which panels a question needs. Nothing is fetched that nobody asked for. */
export interface ToolRequest {
  matchup?: boolean;
  waivers?: boolean;
  trades?:  boolean;
}

// A panel build reaches Sleeper, the odds API and the weather service. All three
// sit on the request path of an AI answer that is already running two model
// calls, so a slow one is dropped rather than waited on — the assistant answers
// from the rest of its context instead of timing out with nothing.
const TOOL_TIMEOUT_MS = 12_000;

// ─── Route invocation ─────────────────────────────────────────────────────────

/**
 * Calls one panel route in-process and returns its parsed body.
 *
 * @param handler  The route's GET export.
 * @param path     Route path, for the synthetic request's URL.
 * @param params   Query parameters the route reads.
 * @param label    Panel name, used in the error string a failure produces.
 */
async function callPanel<T>(
  handler: (req: NextRequest) => Promise<Response>,
  path: string,
  params: Record<string, string>,
  label: string,
): Promise<{ data: T | null; error: string | null }> {
  const url = new URL(path, 'http://agent.internal');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  try {
    const res  = await handler(new NextRequest(url));
    const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok || !body) return { data: null, error: `${label}: ${body?.error ?? `HTTP ${res.status}`}` };
    return { data: body, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    console.error(`[agent-tools] ${label} failed:`, e);
    return { data: null, error: `${label}: ${message}` };
  }
}

/**
 * Resolves to `fallback` rather than hanging the answer behind a slow panel.
 *
 * The timer is cleared when the work wins the race. An uncleared one keeps the
 * serverless function alive for its full duration after the response has been
 * sent — and holds a Node process open for the same twelve seconds under test.
 */
function withTimeout<T>(work: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), TOOL_TIMEOUT_MS);
  });
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer));
}

/**
 * Fetches the panels a question needs, in parallel.
 *
 * Returns `EMPTY_TOOLS` when either identifier is missing: every one of these
 * routes is about one manager's own roster, and without both there is no roster
 * to be about. The caller turns that into the "connect your Sleeper account"
 * note rather than a silent gap in the prompt.
 */
export async function fetchAgentTools(
  sleeperLeagueId: string | null | undefined,
  sleeperUserId:   string | null | undefined,
  want: ToolRequest,
): Promise<AgentTools> {
  if (!sleeperLeagueId || !sleeperUserId) return EMPTY_TOOLS;
  const params = { leagueId: sleeperLeagueId, userId: sleeperUserId };
  const none = { data: null, error: null };

  const [matchup, waivers, trades] = await Promise.all([
    want.matchup
      ? withTimeout(callPanel<MatchupReportResponse>(
          matchupReportRoute, '/api/sleeper/matchup-report', params, 'Matchup report'), none)
      : Promise.resolve(none),
    want.waivers
      ? withTimeout(callPanel<WaiverSuggestionsResponse>(
          waiverSuggestionsRoute, '/api/sleeper/waiver-suggestions', params, 'Waiver suggestions'), none)
      : Promise.resolve(none),
    want.trades
      ? withTimeout(callPanel<TradeSuggestionsResponse>(
          tradeSuggestionsRoute, '/api/sleeper/trade-suggestions', params, 'Trade suggestions'), none)
      : Promise.resolve(none),
  ]);

  return {
    matchup: matchup.data,
    waivers: waivers.data,
    trades:  trades.data,
    errors:  [matchup.error, waivers.error, trades.error].filter((e): e is string => e !== null),
  };
}

// ─── Formatting ───────────────────────────────────────────────────────────────

const n1 = (v: number | null | undefined): string =>
  typeof v === 'number' && Number.isFinite(v) ? v.toFixed(1) : '—';

function windowLabel(w: StatWindow | undefined): string {
  if (!w) return 'recent weeks';
  const weeks = w.startWeek === w.endWeek ? `wk ${w.startWeek}` : `wks ${w.startWeek}-${w.endWeek}`;
  return `${w.season} ${weeks}${w.fallback ? ' (last season — this one has no games yet)' : ''}`;
}

/**
 * Fixture, opposing unit, forecast and line, on one line.
 *
 * The same read-only context the panels print under a player. None of it is in
 * the projection beside it, so it is labelled as context and the model is told
 * as much in the prompt — otherwise it reads a soft defense as though the
 * number already accounted for it.
 */
function contextLine(c: PlayerContext | undefined): string {
  if (!c) return '';
  const bits: string[] = [];
  if (c.opponent) bits.push(`${c.home ? 'vs' : '@'} ${c.opponent}`);
  if (c.opposing) bits.push(`opp unit ${c.opposing.tier} (rank ${c.opposing.rank}/${c.opposing.of}, ${n1(c.opposing.perGame)}/g)`);
  if (c.weather)  bits.push(`${Math.round(c.weather.tempF)}F wind ${Math.round(c.weather.windMph)}mph rain ${Math.round(c.weather.precipPct)}%`);
  if (c.line)     bits.push(`total ${n1(c.line.total)} spread ${n1(c.line.spread)}`);
  return bits.length ? ` [${bits.join('; ')}]` : '';
}

function projectionLine(p: PlayerProjection): string {
  return `  ${p.position} ${p.name}${p.team ? ` ${p.team}` : ''} — proj ${n1(p.projected)} `
    + `(floor ${n1(p.floor)}, ceiling ${n1(p.ceiling)}, ${p.games}g behind it)${contextLine(p.context)}`;
}

/**
 * The reader's own week: both projected totals, every starter, and the bench.
 *
 * The bench is included in full because half the questions this block exists to
 * answer are start/sit ones, and a start/sit answer needs the player who is not
 * starting as much as the one who is.
 */
export function formatMatchupReport(r: MatchupReportResponse): string {
  const starters = (list: PlayerProjection[]) => list.filter((p) => p.starter);
  const bench    = (list: PlayerProjection[]) => list.filter((p) => !p.starter);

  const myBench = bench(r.myPlayers);
  const margin  = r.myTeam.projected - r.opponent.projected;

  return `--- MY MATCHUP — Week ${r.week}, ${r.season} ---
MY TEAM "${r.myTeam.name}": projected ${n1(r.myTeam.projected)} (floor ${n1(r.myTeam.floor)}, ceiling ${n1(r.myTeam.ceiling)}) from ${r.myTeam.starterCount} starters; ${n1(r.myTeam.benchProjected)} sits on the bench.
OPPONENT "${r.opponent.name}": projected ${n1(r.opponent.projected)} (floor ${n1(r.opponent.floor)}, ceiling ${n1(r.opponent.ceiling)}) from ${r.opponent.starterCount} starters.
PROJECTED MARGIN: ${margin >= 0 ? '+' : ''}${n1(margin)} in my favour.

MY STARTERS (these are MY players — when the user says "my", "I" or "should I start", they mean this list and MY BENCH below):
${starters(r.myPlayers).map(projectionLine).join('\n') || '  Lineup not set for this week.'}

MY BENCH:
${myBench.map(projectionLine).join('\n') || '  Empty.'}

OPPONENT STARTERS:
${starters(r.opponentPlayers).map(projectionLine).join('\n') || '  Lineup not set for this week.'}

Bracketed context (fixture, opposing unit, forecast, betting line) is NOT included in the projection beside it — read it as a reason to lean, never as a number.
${r.narrative ? `\nPANEL NARRATIVE: ${r.narrative}` : ''}`;
}

/** Positional needs, then the free agents that answer them. */
export function formatWaiverSuggestions(r: WaiverSuggestionsResponse): string {
  const needs = r.positionNeeds
    .map((p) => `  ${p.position}: rank ${p.rank}/${p.of} in the league `
      + `(${n1(p.mine)} ppg over ${p.slots} starting slot${p.slots === 1 ? '' : 's'}, league median ${n1(p.median)})`
      + `${p.unmeasured ? ' — not measured, no games in the window' : p.weak ? ' — WEAK' : ''}`)
    .join('\n');

  const picks = r.suggestions
    .map((s, i) => `  ${i + 1}. ${s.position} ${s.name}${s.team ? ` ${s.team}` : ''} — `
      + `${n1(s.recentAvg)} ppg over ${s.games}g, proj ${n1(s.projected)} (floor ${n1(s.floor)}, ceiling ${n1(s.ceiling)})`
      + `${s.trendingCount != null ? `, added ${s.trendingCount}x league-wide in 24h` : ''}`
      + `${contextLine(s.context)}\n     Why: ${s.reason}`)
    .join('\n');

  return `--- MY WAIVER WIRE — week ${r.week}, averages over ${windowLabel(r.window)} ---
MY POSITION NEEDS, worst first:
${needs || '  Nothing measured.'}
${r.weakPositions.length ? `Genuinely weak: ${r.weakPositions.join(', ')}.` : 'No position is far enough below the league to call weak.'}

BEST AVAILABLE FREE AGENTS (un-rostered in MY league — ${r.scanned} players were scanned):
${picks || '  None available.'}`;
}

/** Every proposal the finder stands behind, with both sides' gain. */
export function formatTradeSuggestions(r: TradeSuggestionsResponse): string {
  const basis = r.valueBasis === 'projected'
    ? `PROJECTED points per GAME over ${windowLabel(r.valueWindow)} — these are per-game numbers, never season totals`
    : 'season points to date';

  const ranks = Object.entries(r.myPositionRanks)
    .sort((a, b) => a[1] - b[1])
    .map(([pos, rank]) => `${pos} ${rank}`)
    .join(', ');

  const side = (list: { position: string; name: string; seasonPts: number; depthRank: number; starter: boolean }[]) =>
    list.map((p) => `${p.position} ${p.name} (${n1(p.seasonPts)}, their ${p.position}${p.depthRank}`
      + `${p.starter ? ', a starter' : ', bench'})`).join(' + ');

  const proposals = r.proposals
    .map((p, i) => `  ${i + 1}. With ${p.targetTeamName} — I GIVE ${side(p.give)}; I GET ${side(p.receive)}.\n`
      + `     My lineup gains ${n1(p.lineupGain)}, theirs gains ${n1(p.theirLineupGain)}; `
      + `fairness ${Math.round(p.fairnessScore)}/100; acceptance: ${p.acceptance}.\n`
      + `     ${p.summary}`)
    .join('\n');

  const empty = r.noTradesReason === 'no-stats'
    ? '  No proposals: the stat table has no points for these rosters, so nothing can be priced.'
    : r.noTradesReason === 'no-upgrades'
      ? '  No proposals: no player on another roster would improve my starting lineup.'
      : '  No proposals: no deal was found that improves both lineups.';

  return `--- MY TRADE TARGETS (values on ${basis}) ---
MY POSITION RANKS IN THIS LEAGUE (1 = best): ${ranks || 'not measured'}.
${r.scoredPlayers} rostered players priced; ${r.upgradesAvailable} of them would upgrade my starting lineup.

PROPOSALS:
${proposals || empty}`;
}

/** All requested panels, rendered in order, as one prompt section. */
export function formatAgentTools(tools: AgentTools): string {
  const blocks = [
    tools.matchup ? formatMatchupReport(tools.matchup) : '',
    tools.waivers ? formatWaiverSuggestions(tools.waivers) : '',
    tools.trades  ? formatTradeSuggestions(tools.trades)   : '',
  ].filter(Boolean);

  if (tools.errors.length) {
    blocks.push(`--- PANEL DATA UNAVAILABLE ---\n${tools.errors.map((e) => `  ${e}`).join('\n')}`);
  }
  return blocks.join('\n\n');
}
