import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const SLEEPER_BASE = 'https://api.sleeper.app/v1';

interface SleeperLeagueInfo {
  previous_league_id: string | null;
}

interface SleeperRoster {
  roster_id: number;
  owner_id: string | null;
}

interface SleeperUser {
  user_id: string;
  display_name: string;
  metadata?: { team_name?: string };
}

type MatchFrom = { w: number } | { l: number } | null;

interface BracketMatch {
  r: number;
  m: number;
  t1: number | null;
  t2: number | null;
  w: number | null;
  l: number | null;
  t1_from: MatchFrom;
  t2_from: MatchFrom;
}

export interface StandingEntry {
  rank: number;
  rosterId: number;
  name: string;
  ownerName: string | null;
  isChampion: boolean;
  division: 1 | 2;
}

async function sleeperFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${SLEEPER_BASE}${path}`, { next: { revalidate: 86400 } });
  if (!res.ok) throw new Error(`Sleeper ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

function rankFromBrackets(winners: BracketMatch[], losers: BracketMatch[]): Map<number, number> {
  const rankMap = new Map<number, number>();
  let nextRank = 1;

  function fromWinner(f: MatchFrom): boolean {
    return f === null || 'w' in f;
  }

  function process(matches: BracketMatch[]): void {
    if (!matches.length) return;
    const maxRound = Math.max(...matches.map((m) => m.r));

    for (let r = maxRound; r >= 1; r--) {
      const round = matches.filter((m) => m.r === r);

      // In the final round: championship match (both from winning path) before
      // consolation match (both from losing path) so ranks flow 1→2→3→4.
      if (r === maxRound) {
        round.sort((a, b) => {
          const aChamp = fromWinner(a.t1_from) && fromWinner(a.t2_from);
          const bChamp = fromWinner(b.t1_from) && fromWinner(b.t2_from);
          return aChamp === bChamp ? a.m - b.m : aChamp ? -1 : 1;
        });
      } else {
        round.sort((a, b) => a.m - b.m);
      }

      for (const match of round) {
        if (match.w !== null && !rankMap.has(match.w)) rankMap.set(match.w, nextRank++);
        if (match.l !== null && !rankMap.has(match.l)) rankMap.set(match.l, nextRank++);
      }
    }
  }

  process(winners);
  process(losers);
  return rankMap;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const leagueId = req.nextUrl.searchParams.get('leagueId');
  if (!leagueId) return NextResponse.json({ error: 'leagueId is required' }, { status: 400 });

  const league = await prisma.league.findUnique({ where: { id: leagueId } });
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 });

  const { previous_league_id } = await sleeperFetch<SleeperLeagueInfo>(
    `/league/${league.sleeperLeagueId}`,
  );
  if (!previous_league_id) {
    return NextResponse.json({ error: 'No previous season found for this league' }, { status: 404 });
  }

  const [users, rosters, winners, losers] = await Promise.all([
    sleeperFetch<SleeperUser[]>(`/league/${previous_league_id}/users`),
    sleeperFetch<SleeperRoster[]>(`/league/${previous_league_id}/rosters`),
    sleeperFetch<BracketMatch[]>(`/league/${previous_league_id}/winners_bracket`),
    sleeperFetch<BracketMatch[]>(`/league/${previous_league_id}/losers_bracket`),
  ]);

  const userMap = new Map(users.map((u) => [u.user_id, u]));
  const rosterInfo = new Map(
    rosters.map((r) => {
      const u = r.owner_id ? userMap.get(r.owner_id) : undefined;
      return [r.roster_id, {
        name: u?.metadata?.team_name ?? u?.display_name ?? `Team ${r.roster_id}`,
        ownerName: u?.display_name ?? null,
      }];
    }),
  );

  const rankMap = rankFromBrackets(winners, losers);

  const standings: StandingEntry[] = Array.from(rankMap.entries())
    .sort(([, a], [, b]) => a - b)
    .map(([rosterId, rank]) => {
      const info = rosterInfo.get(rosterId);
      return {
        rank,
        rosterId,
        name: info?.name ?? `Team ${rosterId}`,
        ownerName: info?.ownerName ?? null,
        isChampion: rank === 1,
        division: (rank % 2 === 1 ? 1 : 2) as 1 | 2,
      };
    });

  return NextResponse.json({ standings });
}
