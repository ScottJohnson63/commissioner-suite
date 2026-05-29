'use client';

import { useState, useCallback, useEffect } from 'react';
import Image from 'next/image';
import type { TrendingData } from '@/types/trending';
import { TrendingTicker } from './TrendingTicker';

interface StatLeader {
  playerId: string;
  playerDisplayName: string | null;
  position: string | null;
  team: string | null;
  headshot: string | null;
  statValue: number;
  gamesPlayed: number;
}

const STAT_CATEGORIES: { key: string; label: string; unit: string; decimals: number; group: string }[] = [
  // Fantasy
  { key: 'fantasyPointsPpr',         label: 'Fantasy Points (PPR)', unit: 'pts', decimals: 1, group: 'Fantasy'   },
  { key: 'fantasyPoints',            label: 'Fantasy Points (STD)', unit: 'pts', decimals: 1, group: 'Fantasy'   },
  // Passing
  { key: 'passingYards',             label: 'Passing Yards',        unit: 'yds', decimals: 0, group: 'Passing'   },
  { key: 'passingTds',               label: 'Passing TDs',          unit: 'TD',  decimals: 0, group: 'Passing'   },
  { key: 'passingInterceptions',     label: 'Interceptions',        unit: '',    decimals: 0, group: 'Passing'   },
  { key: 'completions',              label: 'Completions',          unit: '',    decimals: 0, group: 'Passing'   },
  { key: 'attempts',                 label: 'Pass Attempts',        unit: '',    decimals: 0, group: 'Passing'   },
  { key: 'passingAirYards',          label: 'Air Yards',            unit: 'yds', decimals: 0, group: 'Passing'   },
  { key: 'passingYardsAfterCatch',   label: 'YAC',                  unit: 'yds', decimals: 0, group: 'Passing'   },
  { key: 'passingFirstDowns',        label: 'Pass 1st Downs',       unit: '',    decimals: 0, group: 'Passing'   },
  { key: 'sacksSuffered',            label: 'Sacks Taken',          unit: '',    decimals: 0, group: 'Passing'   },
  { key: 'passingEpa',               label: 'Passing EPA',          unit: '',    decimals: 1, group: 'Passing'   },
  { key: 'passingCpoe',              label: 'CPOE',                 unit: '%',   decimals: 1, group: 'Passing'   },
  { key: 'pacr',                     label: 'PACR',                 unit: '',    decimals: 2, group: 'Passing'   },
  // Rushing
  { key: 'rushingYards',             label: 'Rushing Yards',        unit: 'yds', decimals: 0, group: 'Rushing'   },
  { key: 'rushingTds',               label: 'Rushing TDs',          unit: 'TD',  decimals: 0, group: 'Rushing'   },
  { key: 'carries',                  label: 'Carries',              unit: '',    decimals: 0, group: 'Rushing'   },
  { key: 'rushingFirstDowns',        label: 'Rush 1st Downs',       unit: '',    decimals: 0, group: 'Rushing'   },
  { key: 'rushingEpa',               label: 'Rushing EPA',          unit: '',    decimals: 1, group: 'Rushing'   },
  // Receiving
  { key: 'receivingYards',           label: 'Receiving Yards',      unit: 'yds', decimals: 0, group: 'Receiving' },
  { key: 'receivingTds',             label: 'Receiving TDs',        unit: 'TD',  decimals: 0, group: 'Receiving' },
  { key: 'receptions',               label: 'Receptions',           unit: '',    decimals: 0, group: 'Receiving' },
  { key: 'targets',                  label: 'Targets',              unit: '',    decimals: 0, group: 'Receiving' },
  { key: 'receivingAirYards',        label: 'Air Yards',            unit: 'yds', decimals: 0, group: 'Receiving' },
  { key: 'receivingYardsAfterCatch', label: 'YAC',                  unit: 'yds', decimals: 0, group: 'Receiving' },
  { key: 'receivingFirstDowns',      label: 'Rec 1st Downs',        unit: '',    decimals: 0, group: 'Receiving' },
  { key: 'receivingEpa',             label: 'Rec EPA',              unit: '',    decimals: 1, group: 'Receiving' },
  { key: 'targetShare',              label: 'Target Share',         unit: '%',   decimals: 1, group: 'Receiving' },
  { key: 'airYardsShare',            label: 'Air Yards Share',      unit: '%',   decimals: 1, group: 'Receiving' },
  { key: 'wopr',                     label: 'WOPR',                 unit: '',    decimals: 2, group: 'Receiving' },
  { key: 'racr',                     label: 'RACR',                 unit: '',    decimals: 2, group: 'Receiving' },
  // Defense
  { key: 'defTacklesSolo',           label: 'Solo Tackles',         unit: '',    decimals: 0, group: 'Defense'   },
  { key: 'defTacklesForLoss',        label: 'TFL',                  unit: '',    decimals: 1, group: 'Defense'   },
  { key: 'defSacks',                 label: 'Sacks',                unit: '',    decimals: 1, group: 'Defense'   },
  { key: 'defQbHits',                label: 'QB Hits',              unit: '',    decimals: 0, group: 'Defense'   },
  { key: 'defInterceptions',         label: 'INTs',                 unit: '',    decimals: 0, group: 'Defense'   },
  { key: 'defPassDefended',          label: 'Pass Breakups',        unit: '',    decimals: 0, group: 'Defense'   },
  { key: 'defFumblesForced',         label: 'Forced Fumbles',       unit: '',    decimals: 0, group: 'Defense'   },
  { key: 'defTds',                   label: 'Def TDs',              unit: 'TD',  decimals: 0, group: 'Defense'   },
  // Kicking
  { key: 'fgMade',                   label: 'FG Made',              unit: '',    decimals: 0, group: 'Kicking'   },
  { key: 'fgAtt',                    label: 'FG Attempts',          unit: '',    decimals: 0, group: 'Kicking'   },
  { key: 'patMade',                  label: 'PAT Made',             unit: '',    decimals: 0, group: 'Kicking'   },
];

const STAT_GROUPS = [...new Set(STAT_CATEGORIES.map((c) => c.group))];
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
  const [position, setPosition] = useState('All');
  const [leaders, setLeaders]   = useState<StatLeader[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const fetchLeaders = useCallback(async (stat: string, pos: string) => {
    setLoading(true);
    setError(null);
    try {
      const posParam = pos !== 'All' ? `&position=${pos}` : '';
      const res = await fetch(`/api/nfl/leaders?season=2025&stat=${stat}&limit=25${posParam}`);
      if (!res.ok) throw new Error('Failed to load stats');
      setLeaders(await res.json() as StatLeader[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void fetchLeaders(statKey, position); }, [statKey, position, fetchLeaders]);

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

        <div className="flex items-center gap-3">
          <p className="text-[10px] uppercase tracking-widest flex-1" style={{ color: '#80ff49' }}>
            NFL Stat Leaders · 2025
          </p>
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
  trendingError: _trendingError,
  onRetryTrending: _onRetryTrending,
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
