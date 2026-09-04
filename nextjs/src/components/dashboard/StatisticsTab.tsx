'use client';

import { useState, useCallback, useEffect } from 'react';
import Image from 'next/image';
import type { TrendingData } from '@/types/trending';
import { TrendingTicker } from './TrendingTicker';
import { STAT_CATEGORIES, STAT_GROUPS } from '@/lib/nflStats';

interface StatLeader {
  playerId: string;
  playerDisplayName: string | null;
  position: string | null;
  team: string | null;
  headshot: string | null;
  statValue: number;
  gamesPlayed: number;
}


const POSITIONS   = ['All', 'QB', 'RB', 'WR', 'TE', 'DEF', 'K'];

const STAT_SITES: { label: string; url: string; desc: string }[] = [
  { label: 'Pro Football Reference', url: 'https://www.pro-football-reference.com/', desc: 'Historical stats & records'  },
  { label: 'StatMuse',               url: 'https://www.statmuse.com/nfl',            desc: 'Natural language queries'    },
  { label: 'NFL Next Gen Stats',     url: 'https://nextgenstats.nfl.com/',           desc: 'Official NGS tracking data'  },
  { label: 'ESPN Stats',             url: 'https://www.espn.com/nfl/stats',          desc: 'Season leaders & splits'     },
  { label: 'Football Outsiders',     url: 'https://www.footballoutsiders.com/',      desc: 'DVOA & advanced metrics'     },
  { label: '4th Down Analytics',     url: 'https://rbsdm.com',                       desc: 'EPA, CPOE, open-source'      },
  { label: 'PFF',                    url: 'https://www.pff.com/nfl',                 desc: 'Grades & premium analytics'  },
  { label: 'FantasyPros',            url: 'https://www.fantasypros.com/nfl/',        desc: 'Rankings & projections'      },
  { label: 'Rotowire',               url: 'https://www.rotowire.com/football/',      desc: 'Injury news & depth charts'  },
  { label: 'The Athletic',           url: 'https://theathletic.com/nfl/',            desc: 'In-depth reporting'          },
];

function StatLeadersTable() {
  const [statKey, setStatKey]   = useState('fantasyPointsPpr');
  // Populated from the table, newest first. Null until loaded, so the first
  // leaders fetch can let the server pick rather than guessing a year.
  const [seasons, setSeasons]   = useState<number[]>([]);
  const [season, setSeason]     = useState<number | null>(null);
  const [position, setPosition] = useState('All');
  // Regular season only by default — the postseason is a separate body of work
  // and folding it in silently would quietly change every historical total.
  const [includePlayoffs, setIncludePlayoffs] = useState(false);
  const [leaders, setLeaders]   = useState<StatLeader[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const fetchLeaders = useCallback(async (
    stat: string,
    pos: string,
    yr: number | null,
    withPlayoffs: boolean,
  ) => {
    setLoading(true);
    setError(null);
    try {
      const posParam = pos !== 'All' ? `&position=${pos}` : '';
      // No season param on the first load — the server answers with its newest.
      const yrParam = yr ? `&season=${yr}` : '';
      const postParam = withPlayoffs ? '&includePlayoffs=true' : '';
      const res = await fetch(
        `/api/nfl/leaders?stat=${stat}&limit=25${posParam}${yrParam}${postParam}`,
      );
      if (!res.ok) throw new Error('Failed to load stats');
      setLeaders(await res.json() as StatLeader[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchLeaders(statKey, position, season, includePlayoffs);
  }, [statKey, position, season, includePlayoffs, fetchLeaders]);

  useEffect(() => {
    void fetch('/api/nfl/seasons')
      .then((r) => (r.ok ? (r.json() as Promise<number[]>) : null))
      .then((data) => {
        if (!Array.isArray(data) || data.length === 0) return;
        setSeasons(data);
        setSeason((current) => current ?? data[0]);
      })
      .catch(() => { /* the picker stays hidden; leaders still load */ });
  }, []);

  const cat = STAT_CATEGORIES.find((c) => c.key === statKey) ?? STAT_CATEGORIES[0];

  function fmt(v: number) {
    const n = cat.decimals > 0 ? v.toFixed(cat.decimals) : Math.round(v).toLocaleString();
    return cat.unit ? `${n} ${cat.unit}` : n;
  }

  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: '#141415', border: '1px solid #1e1e20' }}>

      <div className="flex flex-col gap-2 px-4 py-3 border-b"
        style={{ borderColor: '#1e1e20' }}>

        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-[10px] uppercase tracking-widest flex-1" style={{ color: '#80ff49' }}>
            NFL Stat Leaders{season ? ` · ${season}` : ''}
            {includePlayoffs ? ' · incl. playoffs' : ''}
          </p>

          {/* Only worth showing once more than one season has been synced. */}
          {seasons.length > 1 && (
            <div className="relative shrink-0">
              <select
                value={season ?? seasons[0]}
                onChange={(e) => setSeason(Number(e.target.value))}
                className="appearance-none text-xs pl-2.5 pr-7 py-1.5 rounded border cursor-pointer"
                style={{ background: '#0e0e0f', borderColor: '#2a2a2c', color: '#e8e6df' }}
                aria-label="Season"
              >
                {seasons.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          )}
          <div className="relative shrink-0">
            <select
              value={statKey}
              onChange={(e) => setStatKey(e.target.value)}
              className="appearance-none pl-3 pr-7 py-1.5 rounded text-xs focus:outline-none cursor-pointer"
              style={{ background: '#0e0e0f', border: '1px solid #2a2a2c', color: '#e8e6df' }}
            >
              {STAT_GROUPS.map((group) => (
                <optgroup key={group} label={group}>
                  {STAT_CATEGORIES.filter((c) => c.group === group).map((c) => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"
              width="8" height="5" viewBox="0 0 8 5" fill="none">
              <path d="M1 1l3 3 3-3" stroke="#555" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          {/* Off by default: the totals are regular season, and this adds the
              postseason on top. Framed like the dropdown beside it — at the
              palette's de-emphasized greys this read as part of the header
              rather than as something you could click. */}
          <label
            className="flex items-center gap-2 shrink-0 cursor-pointer select-none
              rounded px-2.5 py-1.5 transition-colors"
            style={{
              background: includePlayoffs ? 'rgba(128,255,73,0.12)' : '#0e0e0f',
              border: `1px solid ${includePlayoffs ? 'rgba(128,255,73,0.35)' : '#2a2a2c'}`,
            }}
          >
            <input
              type="checkbox"
              checked={includePlayoffs}
              onChange={(e) => setIncludePlayoffs(e.target.checked)}
              className="sr-only peer"
            />
            <span
              aria-hidden="true"
              className="w-3.5 h-3.5 rounded-[3px] shrink-0 flex items-center justify-center
                transition-colors peer-focus-visible:outline peer-focus-visible:outline-1
                peer-focus-visible:outline-offset-1 peer-focus-visible:outline-[#80ff49]"
              style={{
                background: includePlayoffs ? '#80ff49' : 'transparent',
                border: `1px solid ${includePlayoffs ? '#80ff49' : '#6b6b70'}`,
              }}
            >
              {includePlayoffs && (
                <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                  <path d="M1 3.5L3.5 6L8 1" stroke="#0e0e0f" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <span className="text-xs whitespace-nowrap"
              style={{ color: includePlayoffs ? '#80ff49' : '#9a9a9a' }}>
              Includes playoffs
            </span>
          </label>
        </div>

        <div className="flex gap-1 overflow-x-auto pb-0.5"
          style={{ scrollbarWidth: 'none' }}>
          {POSITIONS.map((p) => (
            <button
              key={p}
              onClick={() => setPosition(p)}
              className="text-[11px] px-2.5 py-1 rounded transition-colors shrink-0"
              style={{
                background: p === position ? 'rgba(128,255,73,0.12)' : 'transparent',
                color: p === position ? '#80ff49' : '#555',
                border: `1px solid ${p === position ? 'rgba(128,255,73,0.2)' : 'transparent'}`,
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col gap-0">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0"
              style={{ borderColor: '#1a1a1c' }}>
              <div className="w-4 h-3 rounded animate-pulse" style={{ background: '#1e1e20' }} />
              <div className="w-8 h-8 rounded-full animate-pulse" style={{ background: '#1e1e20' }} />
              <div className="flex-1 flex flex-col gap-1">
                <div className="h-3 rounded animate-pulse" style={{ background: '#1e1e20', width: '60%' }} />
                <div className="h-2.5 rounded animate-pulse" style={{ background: '#1e1e20', width: '40%' }} />
              </div>
              <div className="h-3 w-12 rounded animate-pulse" style={{ background: '#1e1e20' }} />
            </div>
          ))}
        </div>
      ) : error ? (
        <p className="text-xs p-4" style={{ color: '#ff4949' }}>{error}</p>
      ) : leaders.length === 0 ? (
        <p className="text-xs p-4 text-center" style={{ color: '#444' }}>No data available</p>
      ) : (
        <div>
          {leaders.map((leader, i) => (
            <div key={leader.playerId}
              className="flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0"
              style={{ borderColor: '#1a1a1c' }}>
              <span className="w-4 text-right text-[11px] tabular-nums shrink-0"
                style={{ color: '#444' }}>{i + 1}</span>
              {leader.headshot ? (
                <Image src={leader.headshot} alt={leader.playerDisplayName ?? ''}
                  width={32} height={32} className="w-8 h-8 rounded-full object-cover shrink-0"
                  style={{ background: '#1e1e20' }}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              ) : (
                <div className="w-8 h-8 rounded-full shrink-0" style={{ background: '#1e1e20' }} />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate" style={{ color: '#e8e6df' }}>
                  {leader.playerDisplayName ?? `Player #${leader.playerId}`}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {leader.position && (
                    <span className="text-[10px] px-1 rounded"
                      style={{ background: '#1e1e20', color: '#555' }}>{leader.position}</span>
                  )}
                  {leader.team && (
                    <span className="text-[10px]" style={{ color: '#444' }}>{leader.team}</span>
                  )}
                  <span className="text-[10px]" style={{ color: '#333' }}>
                    {leader.gamesPlayed}G
                  </span>
                </div>
              </div>
              <span className="text-sm font-semibold tabular-nums shrink-0"
                style={{ color: '#e8e6df' }}>
                {fmt(leader.statValue)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function StatisticsTab({
  trending,
  trendingLoading,
}: {
  trending: TrendingData | null;
  trendingLoading: boolean;
  trendingError: string | null;
  onRetryTrending: () => void;
}) {

  return (
    <div>
      <TrendingTicker
        adds={trending?.adds ?? []}
        drops={trending?.drops ?? []}
        loading={trendingLoading}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <StatLeadersTable />
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: '#555' }}>
            Statistics Resources
          </p>
          <div className="rounded-xl overflow-hidden"
            style={{ background: '#141415', border: '1px solid #1e1e20' }}>
            {STAT_SITES.map((site) => (
              <a
                key={site.label}
                href={site.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 group"
                style={{ borderColor: '#1a1a1c' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#1a1a1c')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium transition-colors group-hover:text-[#80ff49]"
                    style={{ color: '#e8e6df' }}>
                    {site.label}
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: '#444' }}>{site.desc}</p>
                </div>
                <svg className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M1 9L9 1M9 1H3M9 1V7" stroke="#80ff49" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}
