'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrendingPlayer {
  player_id: string;
  count: number;
  type: 'add' | 'drop';
  name: string | null;
  position: string | null;
  team: string | null;
}

interface TrendingData {
  adds: TrendingPlayer[];
  drops: TrendingPlayer[];
}

type NewsSource = 'espn' | 'yahoo' | 'pft' | 'cbs';

interface NewsArticle {
  title: string;
  description: string;
  link: string;
  pubDate: string;
  imageUrl: string | null;
  source: NewsSource;
  sourceLabel: string;
}

interface SleeperLeague {
  leagueId: string;
  name: string;
  season: number;
  totalRosters: number;
  status: string;
}

interface SleeperUser {
  userId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  leagues: SleeperLeague[];
}


type Tab = 'league' | 'statistics' | 'news';

// ─── League feature types ─────────────────────────────────────────────────────

interface WaiverSuggestion {
  playerId: string; name: string; position: string; team: string | null;
  recentAvg: number; reason: string; trendingCount: number | null;
}
interface WaiverSuggestionsResponse {
  weakPositions: string[];
  suggestions: WaiverSuggestion[];
  demo?: boolean;
}

interface TradePlayer { playerId: string; name: string; position: string; seasonPts: number }
interface TradeProposal {
  targetTeamName: string; targetOwnerId: string;
  give: TradePlayer[]; receive: TradePlayer[];
  fairnessScore: number; summary: string;
}
interface TradeSuggestionsResponse {
  myPositionRanks: Record<string, number>;
  proposals: TradeProposal[];
  demo?: boolean;
}

interface PlayerProjection {
  playerId: string; name: string; position: string; team: string | null;
  floor: number; ceiling: number; projected: number;
  defAdjustment: number; weatherNote: string | null;
}
interface TeamProjection { name: string; rosterId: number; floor: number; ceiling: number; projected: number }
interface WeatherInfo { team: string; tempF: number; windMph: number; precipPct: number; stadiumName: string; note: string }
interface VegasLine { homeTeam: string; awayTeam: string; total: number; spread: number; sport?: string }
interface MatchupReportResponse {
  week: number; season: number;
  myTeam: TeamProjection; opponent: TeamProjection;
  myPlayers: PlayerProjection[]; opponentPlayers: PlayerProjection[];
  weather: WeatherInfo[] | null; vegasLines: VegasLine[] | null;
  narrative: string; demo?: boolean;
}

// ─── Onboarding modal ─────────────────────────────────────────────────────────

function OnboardingModal({ onConnect }: { onConnect: (user: SleeperUser) => void }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const username = input.trim().toLowerCase();
    if (!username) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sleeper/user?username=${encodeURIComponent(username)}`);
      const data = await res.json() as SleeperUser & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'User not found');
      localStorage.setItem('sleeper_username', username);
      onConnect(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-sm rounded-xl p-8"
        style={{ background: '#141415', border: '1px solid #2a2a2c' }}>
        <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: '#80ff49' }}>
          Get started
        </p>
        <h2 className="text-lg font-semibold mb-1" style={{ color: '#e8e6df' }}>
          Connect your Sleeper account
        </h2>
        <p className="text-sm mb-6" style={{ color: '#555' }}>
          Enter your Sleeper username to pull in your leagues and player data.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Your Sleeper username"
            autoFocus
            className="w-full rounded px-3 py-2.5 text-sm text-[#e8e6df] placeholder-[#444] focus:outline-none"
            style={{ background: '#0e0e0f', border: '1px solid #2a2a2c' }}
          />
          {error && <p className="text-xs" style={{ color: '#ff4949' }}>{error}</p>}
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="w-full py-2.5 rounded text-sm font-medium transition-colors disabled:opacity-40"
            style={{ background: '#80ff49', color: '#0e0e0f' }}
          >
            {loading ? 'Looking up…' : 'Connect'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── League dropdown ──────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  in_season: '#80ff49',
  pre_draft: '#facc15',
  drafting:  '#60a5fa',
  complete:  '#555',
};

function LeagueDropdown({
  leagues,
  activeLeagueId,
  onSelect,
}: {
  leagues: SleeperLeague[];
  activeLeagueId: string | null;
  onSelect: (id: string) => void;
}) {
  if (leagues.length === 0) return null;

  const active = leagues.find((l) => l.leagueId === activeLeagueId) ?? leagues[0];
  const dot = STATUS_COLOR[active.status] ?? '#555';

  return (
    <div className="relative">
      {/* Custom arrow */}
      <div
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
        style={{ color: '#555' }}
      >
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* Status dot */}
      <div
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full"
        style={{ background: dot }}
      />

      <select
        value={activeLeagueId ?? ''}
        onChange={(e) => onSelect(e.target.value)}
        className="appearance-none pl-6 pr-8 py-2 rounded-lg text-sm font-medium focus:outline-none cursor-pointer"
        style={{
          background: '#141415',
          border: '1px solid #2a2a2c',
          color: '#e8e6df',
        }}
      >
        {leagues.map((l) => (
          <option key={l.leagueId} value={l.leagueId}>
            {l.name} ({l.season})
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Player avatar (Sleeper CDN headshot) ─────────────────────────────────────

const SLEEPER_THUMB = (id: string) =>
  `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`;

function PlayerAvatar({ playerId, name }: { playerId: string; name: string | null }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={SLEEPER_THUMB(playerId)}
      alt={name ?? playerId}
      width={36}
      height={36}
      className="rounded-full object-cover shrink-0"
      style={{ width: 36, height: 36, background: '#1e1e20' }}
      onError={(e) => {
        e.currentTarget.style.display = 'none';
        const sib = e.currentTarget.nextElementSibling as HTMLElement | null;
        if (sib) sib.style.display = 'flex';
      }}
    />
  );
}

// ─── Trending card ────────────────────────────────────────────────────────────

function TrendingCard({
  title,
  players,
  accentColor,
}: {
  title: string;
  players: TrendingPlayer[];
  accentColor: string;
}) {
  return (
    <div className="rounded-xl p-5 flex flex-col gap-4 h-full"
      style={{ background: '#141415', border: '1px solid #1e1e20' }}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-widest" style={{ color: accentColor }}>
          {title}
        </p>
        <a href="https://sleeper.com" target="_blank" rel="noopener noreferrer"
          className="text-[10px] transition-colors" style={{ color: '#333' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = accentColor)}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#333')}>
          via Sleeper ↗
        </a>
      </div>

      {players.length === 0 ? (
        <p className="text-xs" style={{ color: '#444' }}>No data available</p>
      ) : (
        <ol className="flex flex-col gap-0.5">
          {players.map((p, i) => (
            <li key={p.player_id}
              className="flex items-center gap-2.5 py-1.5 border-b last:border-b-0"
              style={{ borderColor: '#1a1a1c' }}>
              <span className="w-4 text-right text-[11px] shrink-0 tabular-nums"
                style={{ color: '#333' }}>{i + 1}</span>

              <div className="relative shrink-0" style={{ width: 36, height: 36 }}>
                <PlayerAvatar playerId={p.player_id} name={p.name} />
                <div className="rounded-full items-center justify-center text-[11px] font-medium"
                  style={{
                    display: 'none', width: 36, height: 36, background: '#1e1e20',
                    color: '#555', position: 'absolute', top: 0, left: 0,
                  }}>
                  {p.name ? p.name.charAt(0).toUpperCase() : '?'}
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate" style={{ color: '#e8e6df' }}>
                  {p.name ?? `#${p.player_id}`}
                </p>
                <div className="flex items-center gap-1 mt-0.5">
                  {p.position && (
                    <span className="text-[10px] px-1 rounded"
                      style={{ background: '#1e1e20', color: '#555' }}>{p.position}</span>
                  )}
                  {p.team && (
                    <span className="text-[10px]" style={{ color: '#444' }}>{p.team}</span>
                  )}
                </div>
              </div>

              <span className="text-[11px] font-medium tabular-nums px-1.5 py-0.5 rounded shrink-0"
                style={{ background: `${accentColor}12`, color: accentColor }}>
                {p.count.toLocaleString()}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}


// ─── Shared panel helpers ─────────────────────────────────────────────────────

const PANEL_BG = { background: '#141415', border: '1px solid #1e1e20' } as const;
const INNER_BG = { background: '#0e0e0f', border: '1px solid #1e1e20' } as const;

function PanelActionBtn({
  onClick, disabled, loading, label, loadingLabel,
}: {
  onClick: () => void; disabled: boolean; loading: boolean; label: string; loadingLabel: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="text-xs font-medium px-3 py-1.5 rounded transition-opacity disabled:opacity-40 shrink-0"
      style={{ background: '#80ff49', color: '#0e0e0f' }}
    >
      {loading ? loadingLabel : label}
    </button>
  );
}

function PanelSkeleton({ rows = 3, height = 10 }: { rows?: number; height?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded animate-pulse" style={{ background: '#1e1e20', height }} />
      ))}
    </div>
  );
}

function NoLeague() {
  return <p className="text-xs text-center py-6" style={{ color: '#444' }}>Select a league first</p>;
}

// ─── Waiver Wire Suggestions Panel ───────────────────────────────────────────

function WaiverSuggestionsPanel({
  leagueId, userId,
}: { leagueId: string | null; userId: string | null }) {
  const [data, setData]       = useState<WaiverSuggestionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function run() {
    if (!leagueId || !userId) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(
        `/api/sleeper/waiver-suggestions?leagueId=${leagueId}&userId=${userId}&season=2025`,
      );
      if (!res.ok) throw new Error('Failed to load suggestions');
      setData(await res.json() as WaiverSuggestionsResponse);
    } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
    finally { setLoading(false); }
  }

  return (
    <div className="rounded-xl p-5 flex flex-col gap-4" style={PANEL_BG}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg shrink-0">📋</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: '#e8e6df' }}>Waiver Wire</p>
          </div>
        </div>
        <PanelActionBtn onClick={() => void run()} disabled={!leagueId || !userId}
          loading={loading} label="Find Suggestions" loadingLabel="Loading…" />
      </div>

      {(!leagueId || !userId) && <NoLeague />}
      {error && <p className="text-xs" style={{ color: '#ff4949' }}>{error}</p>}
      {loading && <PanelSkeleton rows={4} height={40} />}

      {data && !loading && (
        <>
          {data.weakPositions.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: '#555' }}>
                Weak spots:
              </span>
              {data.weakPositions.map((pos) => (
                <span key={pos} className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                  style={{ background: 'rgba(255,109,73,0.12)', color: '#ff6d49' }}>
                  {pos}
                </span>
              ))}
            </div>
          )}
          <div className="flex flex-col">
            {data.suggestions.length === 0 ? (
              <p className="text-xs text-center py-3" style={{ color: '#444' }}>
                No suggestions available — check back after more games
              </p>
            ) : data.suggestions.map((s) => (
              <div key={s.playerId}
                className="flex items-center gap-3 py-2.5 border-b last:border-b-0"
                style={{ borderColor: '#1a1a1c' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={SLEEPER_THUMB(s.playerId)} alt={s.name}
                  width={30} height={30} className="rounded-full shrink-0 object-cover"
                  style={{ width: 30, height: 30, background: '#1e1e20' }}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium truncate" style={{ color: '#e8e6df' }}>
                      {s.name}
                    </span>
                    <span className="text-[10px] px-1 rounded shrink-0"
                      style={{ background: '#1e1e20', color: '#555' }}>{s.position}</span>
                    {s.team && (
                      <span className="text-[10px] shrink-0" style={{ color: '#444' }}>{s.team}</span>
                    )}
                  </div>
                  <p className="text-[10px] truncate mt-0.5" style={{ color: '#555' }}>{s.reason}</p>
                </div>
                <span className="text-xs font-semibold tabular-nums shrink-0"
                  style={{ color: '#80ff49' }}>
                  {s.recentAvg.toFixed(1)} pts
                </span>
              </div>
            ))}
          </div>
          {data.suggestions.some((s) => s.trendingCount !== null) && (
            <p className="text-[10px] text-right" style={{ color: '#333' }}>
              Add counts via{' '}
              <a
                href="https://sleeper.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#444' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#80ff49')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#444')}
              >
                Sleeper
              </a>
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ─── Trade Analyzer Panel ─────────────────────────────────────────────────────

function TradeAnalyzerPanel({
  leagueId, userId,
}: { leagueId: string | null; userId: string | null }) {
  const [data, setData]       = useState<TradeSuggestionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function run() {
    if (!leagueId || !userId) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(
        `/api/sleeper/trade-suggestions?leagueId=${leagueId}&userId=${userId}&season=2025`,
      );
      if (!res.ok) throw new Error('Failed to load trades');
      setData(await res.json() as TradeSuggestionsResponse);
    } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
    finally { setLoading(false); }
  }

  return (
    <div className="rounded-xl p-5 flex flex-col gap-4" style={PANEL_BG}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg shrink-0">🔄</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: '#e8e6df' }}>Trade Finder</p>
            <p className="text-[10px] truncate" style={{ color: '#555' }}>
              Realistic trades that address your roster needs
            </p>
          </div>
        </div>
        <PanelActionBtn onClick={() => void run()} disabled={!leagueId || !userId}
          loading={loading} label="Analyze Trades" loadingLabel="Loading…" />
      </div>

      {(!leagueId || !userId) && <NoLeague />}
      {error && <p className="text-xs" style={{ color: '#ff4949' }}>{error}</p>}
      {loading && <PanelSkeleton rows={3} height={56} />}

      {data && !loading && (
        <>
          {/* Position rank chips */}
          {Object.keys(data.myPositionRanks).length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider shrink-0" style={{ color: '#555' }}>
                Your ranks:
              </span>
              {Object.entries(data.myPositionRanks).map(([pos, rank]) => (
                <span key={pos} className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                  style={{
                    background: rank <= 3  ? 'rgba(128,255,73,0.12)'
                              : rank <= 6  ? 'rgba(250,204,21,0.12)'
                              :              'rgba(255,73,73,0.12)',
                    color: rank <= 3 ? '#80ff49' : rank <= 6 ? '#facc15' : '#ff4949',
                  }}>
                  {pos} #{rank}
                </span>
              ))}
            </div>
          )}

          {/* Trade cards */}
          {data.proposals.length === 0 ? (
            <p className="text-xs text-center py-3" style={{ color: '#444' }}>
              No fair trades found — try again after more games are played
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {data.proposals.map((p, i) => (
                <div key={i} className="rounded-lg p-3 flex flex-col gap-2" style={INNER_BG}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium truncate" style={{ color: '#e8e6df' }}>
                      {p.targetTeamName}
                    </span>
                    {/* Fairness bar */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className="w-14 h-1.5 rounded-full overflow-hidden"
                        style={{ background: '#1e1e20' }}>
                        <div className="h-full rounded-full transition-all" style={{
                          width: `${p.fairnessScore}%`,
                          background: p.fairnessScore >= 75 ? '#80ff49'
                                    : p.fairnessScore >= 50 ? '#facc15'
                                    : '#ff4949',
                        }} />
                      </div>
                      <span className="text-[10px] tabular-nums w-5 text-right"
                        style={{ color: '#555' }}>
                        {Math.round(p.fairnessScore)}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(['give', 'receive'] as const).map((side) => (
                      <div key={side}>
                        <p className="text-[9px] uppercase tracking-wider mb-1"
                          style={{ color: '#555' }}>
                          {side === 'give' ? 'You give' : 'You get'}
                        </p>
                        {p[side].map((pl) => (
                          <div key={pl.playerId}
                            className="flex items-center justify-between text-[10px] gap-1">
                            <span className="truncate"
                              style={{ color: '#e8e6df' }}>{pl.name}</span>
                            <span className="tabular-nums shrink-0"
                              style={{ color: side === 'receive' ? '#80ff49' : '#555' }}>
                              {pl.seasonPts.toFixed(0)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] italic" style={{ color: '#555' }}>{p.summary}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Matchup Report Panel ─────────────────────────────────────────────────────

function MatchupReportPanel({
  leagueId, userId,
}: { leagueId: string | null; userId: string | null }) {
  const [data, setData]       = useState<MatchupReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function run() {
    if (!leagueId || !userId) return;
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`/api/sleeper/matchup-report?leagueId=${leagueId}&userId=${userId}`);
      const json = await res.json() as MatchupReportResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Failed to load matchup report');
      setData(json);
    } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
    finally { setLoading(false); }
  }

  return (
    <div className="rounded-xl p-5 flex flex-col gap-4" style={PANEL_BG}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg shrink-0">⚔️</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: '#e8e6df' }}>Matchup Analysis</p>
          </div>
        </div>
        <PanelActionBtn onClick={() => void run()} disabled={!leagueId || !userId}
          loading={loading} label="Analyze Matchup" loadingLabel="Analyzing…" />
      </div>

      {(!leagueId || !userId) && <NoLeague />}
      {error && <p className="text-xs" style={{ color: '#ff4949' }}>{error}</p>}
      {loading && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="h-20 rounded animate-pulse" style={{ background: '#1e1e20' }} />
            <div className="h-20 rounded animate-pulse" style={{ background: '#1e1e20' }} />
          </div>
          <PanelSkeleton rows={2} height={14} />
        </div>
      )}

      {data && !loading && (
        <div className="flex flex-col gap-4">
          {/* Score comparison — two columns */}
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                { key: 'myTeam', team: data.myTeam },
                { key: 'opponent', team: data.opponent },
              ] as const
            ).map(({ key, team }) => (
              <div key={key} className="rounded-lg p-3 flex flex-col gap-1" style={{
                ...INNER_BG,
                border: `1px solid ${key === 'myTeam' ? 'rgba(128,255,73,0.25)' : '#1e1e20'}`,
              }}>
                <p className="text-[10px] uppercase tracking-wider truncate"
                  style={{ color: key === 'myTeam' ? '#80ff49' : '#555' }}>
                  {team.name}
                </p>
                <p className="text-2xl font-bold tabular-nums" style={{ color: '#e8e6df' }}>
                  {team.projected.toFixed(1)}
                </p>
                <div className="flex gap-2 text-[10px] tabular-nums">
                  <span style={{ color: '#ff6d49' }}>↓{team.floor.toFixed(1)}</span>
                  <span style={{ color: '#2a2a2c' }}>·</span>
                  <span style={{ color: '#80ff49' }}>↑{team.ceiling.toFixed(1)}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Weather + Vegas row */}
          {(data.vegasLines || data.weather) && (
            <div className="flex flex-wrap gap-2 text-[10px]">
              {data.vegasLines?.slice(0, 3).map((l, i) => (
                <span key={i} className="px-2 py-1 rounded flex items-center gap-1"
                  style={{ background: '#1e1e20', color: '#555' }}>
                  {l.sport && (
                    <span className="font-semibold" style={{ color: '#facc15' }}>{l.sport}</span>
                  )}
                  {l.sport
                    ? `${l.homeTeam.split(' ').at(-1)} vs ${l.awayTeam.split(' ').at(-1)} · O/U ${l.total}`
                    : `O/U ${l.total} · ${l.spread > 0 ? '+' : ''}${l.spread}`}
                </span>
              ))}
              {data.weather?.map((w, i) => (
                <span key={i} className="px-2 py-1 rounded"
                  style={{
                    background: '#1e1e20',
                    color: w.windMph > 20 || w.precipPct > 60 ? '#facc15' : '#555',
                  }}>
                  {w.team}: {w.tempF}°F · {w.windMph}mph · {w.precipPct}% rain
                </span>
              ))}
            </div>
          )}

          {/* Narrative */}
          {data.narrative && (
            <p className="text-xs leading-relaxed" style={{ color: '#888' }}>
              {data.narrative}
            </p>
          )}

          {/* Player tables */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { label: data.myTeam.name, players: data.myPlayers, accent: '#80ff49' },
              { label: data.opponent.name, players: data.opponentPlayers, accent: '#555' },
            ].map(({ label, players, accent }) => (
              <div key={label}>
                <p className="text-[10px] uppercase tracking-wider mb-1.5 truncate"
                  style={{ color: accent }}>{label}</p>
                <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #1e1e20' }}>
                  {players.slice(0, 9).map((p) => (
                    <div key={p.playerId}
                      className="flex items-center justify-between px-3 py-1.5 border-b last:border-b-0 gap-2"
                      style={{ borderColor: '#1a1a1c' }}>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[9px] px-1 rounded shrink-0"
                          style={{ background: '#1e1e20', color: '#555' }}>
                          {p.position}
                        </span>
                        <span className="text-[11px] truncate" style={{ color: '#e8e6df' }}>
                          {p.name}
                        </span>
                        {p.weatherNote && (
                          <span className="text-[9px] shrink-0" style={{ color: '#facc15' }}>⚠</span>
                        )}
                      </div>
                      <span className="text-[11px] tabular-nums shrink-0"
                        style={{ color: accent }}>
                        {p.floor.toFixed(0)}–{p.ceiling.toFixed(0)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab content: League ──────────────────────────────────────────────────────

function LeagueTab({
  sleeperUser,
  activeLeagueId,
  onSelect,
}: {
  sleeperUser: SleeperUser | null;
  activeLeagueId: string | null;
  onSelect: (id: string) => void;
}) {
  const active = sleeperUser?.leagues.find((l) => l.leagueId === activeLeagueId);
  const dot = active ? (STATUS_COLOR[active.status] ?? '#555') : '#555';

  return (
    <div className="flex flex-col gap-6">
      {/* Dropdown + league meta */}
      {sleeperUser && sleeperUser.leagues.length > 0 && (
        <div className="flex flex-wrap items-center gap-4">
          <LeagueDropdown
            leagues={sleeperUser.leagues}
            activeLeagueId={activeLeagueId}
            onSelect={onSelect}
          />
          {active && (
            <div className="flex items-center gap-2 text-xs" style={{ color: '#555' }}>
              <span className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: dot, display: 'inline-block' }} />
              <span className="capitalize">{active.status.replace(/_/g, ' ')}</span>
              <span>·</span>
              <span>{active.totalRosters} teams</span>
              <span>·</span>
              <span>{active.season} season</span>
            </div>
          )}
        </div>
      )}

      {/* Demo mode banner */}
      {IS_DEMO && (
        <div className="rounded-lg px-4 py-3 flex items-center gap-3"
          style={{ background: 'rgba(250,204,21,0.06)', border: '1px solid rgba(250,204,21,0.2)' }}>
          <span className="text-base shrink-0" style={{ color: '#facc15' }}>⚗</span>
          <div>
            <p className="text-xs font-semibold" style={{ color: '#facc15' }}>Demo Mode Active</p>
            <p className="text-[10px] mt-0.5" style={{ color: 'rgba(250,204,21,0.5)' }}>
              Mock rosters · Real 2025 stats · Live odds from the current active sport · Set{' '}
              <code style={{ color: 'rgba(250,204,21,0.75)' }}>DEMO_MODE=false</code> in{' '}
              <code style={{ color: 'rgba(250,204,21,0.75)' }}>.env</code> to connect your Sleeper account
            </p>
          </div>
        </div>
      )}

      {/* Feature panels */}
      <div className="flex flex-col gap-4">
        <MatchupReportPanel
          leagueId={activeLeagueId}
          userId={sleeperUser?.userId ?? null}
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <WaiverSuggestionsPanel
            leagueId={activeLeagueId}
            userId={sleeperUser?.userId ?? null}
          />
          <TradeAnalyzerPanel
            leagueId={activeLeagueId}
            userId={sleeperUser?.userId ?? null}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Trending ticker ──────────────────────────────────────────────────────────

type TickerItem = TrendingPlayer & { rank: number };

function TrendingTicker({
  adds,
  drops,
  loading,
}: {
  adds: TrendingPlayer[];
  drops: TrendingPlayer[];
  loading: boolean;
}) {
  // Interleave adds and drops, tracking each player's rank within its own list.
  const items = useMemo<TickerItem[]>(() => {
    const out: TickerItem[] = [];
    const len = Math.max(adds.length, drops.length);
    for (let i = 0; i < len; i++) {
      if (adds[i])  out.push({ ...adds[i],  rank: i + 1 });
      if (drops[i]) out.push({ ...drops[i], rank: i + 1 });
    }
    return out;
  }, [adds, drops]);

  const PAGE_SIZE = 5;
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const [page, setPage]       = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (items.length <= PAGE_SIZE) return;
    const id = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setPage((p) => (p + 1) % pageCount);
        setVisible(true);
      }, 350);
    }, 10000);
    return () => clearInterval(id);
  }, [items.length, pageCount]);

  const slice = items.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <div
      className="rounded-lg px-4 py-2.5 flex items-center gap-3 mb-4"
      style={{ background: '#141415', border: '1px solid #1e1e20' }}
    >
      {/* Label — links to Sleeper for attribution */}
      <a
        href="https://sleeper.com"
        target="_blank"
        rel="noopener noreferrer"
        className="text-[10px] uppercase tracking-widest shrink-0 transition-colors"
        style={{ color: '#555' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = '#80ff49')}
        onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
      >
        Sleeper Trending
      </a>
      <div className="w-px h-3.5 shrink-0" style={{ background: '#2a2a2c' }} />

      {/* Player chips */}
      {loading ? (
        <div className="flex gap-4 flex-1">
          {[80, 96, 72, 88, 64].map((w, i) => (
            <div key={i} className="h-3.5 rounded animate-pulse"
              style={{ background: '#1e1e20', width: w }} />
          ))}
        </div>
      ) : (
        <div
          className="flex items-center gap-4 flex-1 min-w-0 overflow-hidden"
          style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.35s ease-in-out' }}
        >
          {slice.map((p, idx) => {
            const isAdd = p.type === 'add';
            const accent = isAdd ? '#80ff49' : '#ff6d49';
            return (
              <div key={`${p.type}-${p.player_id}`}
                className={`flex items-center gap-1.5 min-w-0 shrink-0${idx >= 3 ? ' hidden sm:flex' : ''}`}>
                {/* Direction arrow */}
                <span className="text-[11px] shrink-0 font-bold" style={{ color: accent }}>
                  {isAdd ? '▲' : '▼'}
                </span>
                {/* Rank in list */}
                <span className="text-[10px] tabular-nums shrink-0 font-medium"
                  style={{ color: accent, opacity: 0.6 }}>
                  #{p.rank}
                </span>
                {/* Headshot */}
                <div className="relative shrink-0" style={{ width: 22, height: 22 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={SLEEPER_THUMB(p.player_id)}
                    alt={p.name ?? p.player_id}
                    width={22}
                    height={22}
                    className="rounded-full object-cover"
                    style={{ width: 22, height: 22, background: '#1e1e20' }}
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                      const sib = e.currentTarget.nextElementSibling as HTMLElement | null;
                      if (sib) sib.style.display = 'flex';
                    }}
                  />
                  <div className="rounded-full items-center justify-center text-[9px] font-medium"
                    style={{
                      display: 'none', width: 22, height: 22, background: '#1e1e20',
                      color: '#555', position: 'absolute', top: 0, left: 0,
                    }}>
                    {p.name ? p.name.charAt(0).toUpperCase() : '?'}
                  </div>
                </div>
                {/* Name */}
                <span className="text-xs font-medium truncate" style={{ color: '#e8e6df' }}>
                  {p.name ?? `#${p.player_id}`}
                </span>
                {/* Position */}
                {p.position && (
                  <span className="text-[10px] shrink-0 hidden sm:inline" style={{ color: '#444' }}>
                    {p.position}
                  </span>
                )}
                {/* Team */}
                {p.team && (
                  <span className="text-[10px] shrink-0 hidden md:inline" style={{ color: '#333' }}>
                    {p.team}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}

// ─── Stat leaders table ───────────────────────────────────────────────────────

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

// Unique ordered groups for <optgroup> rendering
const STAT_GROUPS = [...new Set(STAT_CATEGORIES.map((c) => c.group))];

const POSITIONS = ['All', 'QB', 'RB', 'WR', 'TE', 'DEF', 'K'];

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

  useEffect(() => { void fetchLeaders(statKey, position); }, [statKey, position, fetchLeaders]);

  const cat = STAT_CATEGORIES.find((c) => c.key === statKey) ?? STAT_CATEGORIES[0];

  function fmt(v: number) {
    const n = cat.decimals > 0 ? v.toFixed(cat.decimals) : Math.round(v).toLocaleString();
    return cat.unit ? `${n} ${cat.unit}` : n;
  }

  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: '#141415', border: '1px solid #1e1e20' }}>

      {/* Controls — stacked on mobile, inline on sm+ */}
      <div className="flex flex-col gap-2 px-4 py-3 border-b"
        style={{ borderColor: '#1e1e20' }}>

        {/* Row 1: label + dropdown */}
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

        {/* Row 2: position pills — horizontally scrollable on mobile */}
        <div className="flex gap-1 overflow-x-auto pb-0.5"
          style={{ scrollbarWidth: 'none' }}>
          {POSITIONS.map((p) => (
            <button
              key={p}
              onClick={() => setPosition(p)}
              className="text-[11px] px-2.5 py-1 rounded transition-colors shrink-0"
              style={{
                background: p === position ? 'rgba(128,255,73,0.12)' : 'transparent',
                border: `1px solid ${p === position ? 'rgba(128,255,73,0.3)' : '#1e1e20'}`,
                color: p === position ? '#80ff49' : '#555',
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Table header */}
      <div className="flex items-center px-4 py-2 text-[10px] uppercase tracking-widest gap-2"
        style={{ color: '#444', borderBottom: '1px solid #1a1a1c' }}>
        <span className="w-5 shrink-0">#</span>
        <span className="flex-1">Player</span>
        <span className="hidden sm:block w-10 shrink-0">Team</span>
        <span className="hidden sm:block w-10 shrink-0">Pos</span>
        <span className="hidden sm:block w-8 shrink-0">GP</span>
        <span className="w-16 text-right shrink-0">{cat.label}</span>
      </div>

      {/* Rows */}
      {loading ? (
        <div className="flex flex-col">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 border-b"
              style={{ borderColor: '#1a1a1c' }}>
              <div className="w-5 h-3 rounded animate-pulse shrink-0" style={{ background: '#1e1e20' }} />
              <div className="h-3 rounded animate-pulse flex-1" style={{ background: '#1e1e20', maxWidth: `${50 + (i % 4) * 12}%` }} />
              <div className="h-3 rounded animate-pulse w-14 shrink-0" style={{ background: '#1e1e20' }} />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="px-4 py-6 text-center">
          <p className="text-xs mb-3" style={{ color: '#ff4949' }}>{error}</p>
          <button onClick={() => void fetchLeaders(statKey, position)}
            className="text-xs" style={{ color: '#555' }}>↺ Retry</button>
        </div>
      ) : leaders.length === 0 ? (
        <p className="px-4 py-6 text-xs text-center" style={{ color: '#444' }}>
          No stats synced yet — run the NFL sync script to populate.
        </p>
      ) : (
        <div className="overflow-y-auto" style={{ maxHeight: 520 }}>
          {leaders.map((row, i) => (
            <div
              key={row.playerId}
              className="flex items-center px-4 py-2 border-b last:border-b-0 gap-2 transition-colors"
              style={{ borderColor: '#1a1a1c' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#1a1a1c')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {/* Rank */}
              <span className="w-5 text-xs tabular-nums shrink-0 text-right" style={{ color: '#444' }}>
                {i + 1}
              </span>

              {/* Player — name + mobile meta below */}
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {row.headshot ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={row.headshot} alt="" width={28} height={28}
                    className="rounded-full object-cover shrink-0"
                    style={{ width: 28, height: 28, background: '#1e1e20' }}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                ) : (
                  <div className="rounded-full shrink-0 flex items-center justify-center text-[10px]"
                    style={{ width: 28, height: 28, background: '#1e1e20', color: '#444' }}>
                    {(row.playerDisplayName ?? '?').charAt(0)}
                  </div>
                )}
                <div className="min-w-0">
                  <span className="text-sm block truncate" style={{ color: '#e8e6df' }}>
                    {row.playerDisplayName ?? row.playerId}
                  </span>
                  {/* Pos + team shown inline on mobile only */}
                  <div className="flex items-center gap-1 mt-0.5 sm:hidden">
                    {row.position && (
                      <span className="text-[10px] px-1 rounded"
                        style={{ background: '#1e1e20', color: '#555' }}>
                        {row.position}
                      </span>
                    )}
                    {row.team && (
                      <span className="text-[10px]" style={{ color: '#444' }}>{row.team}</span>
                    )}
                    <span className="text-[10px]" style={{ color: '#333' }}>
                      {row.gamesPlayed}g
                    </span>
                  </div>
                </div>
              </div>

              {/* Team — desktop only */}
              <span className="hidden sm:block w-10 text-xs shrink-0" style={{ color: '#555' }}>
                {row.team ?? '—'}
              </span>

              {/* Position — desktop only */}
              <div className="hidden sm:flex w-10 shrink-0">
                {row.position && (
                  <span className="text-[10px] px-1 rounded"
                    style={{ background: '#1e1e20', color: '#555' }}>
                    {row.position}
                  </span>
                )}
              </div>

              {/* Games played — desktop only */}
              <span className="hidden sm:block w-8 text-xs tabular-nums shrink-0"
                style={{ color: '#444' }}>
                {row.gamesPlayed}
              </span>

              {/* Stat value */}
              <span className="w-16 text-sm font-semibold tabular-nums text-right shrink-0"
                style={{ color: '#80ff49' }}>
                {fmt(row.statValue)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab content: Statistics ──────────────────────────────────────────────────

function StatisticsTab({
  trending,
  trendingLoading,
  trendingError,
  onRetryTrending,
}: {
  trending: TrendingData | null;
  trendingLoading: boolean;
  trendingError: string | null;
  onRetryTrending: () => void;
}) {
  void trendingError;
  void onRetryTrending;

  return (
    <div>
      {/* Trending ticker */}
      <TrendingTicker
        adds={trending?.adds ?? []}
        drops={trending?.drops ?? []}
        loading={trendingLoading}
      />

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Stat leaders table — 2 cols */}
        <div className="lg:col-span-2">
          <StatLeadersTable />
        </div>

        {/* Stats sites sidebar — 1 col */}
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

// ─── NFL reporters directory ──────────────────────────────────────────────────

const NFL_REPORTERS: {
  name: string;
  handle: string;
  affiliation: string;
  specialty: string;
}[] = [
  { name: 'Adam Schefter',   handle: 'AdamSchefter',     affiliation: 'ESPN',          specialty: 'Breaking news / transactions' },
  { name: 'Ian Rapoport',    handle: 'RapSheet',          affiliation: 'NFL Network',   specialty: 'Breaking news / transactions' },
  { name: 'Tom Pelissero',   handle: 'TomPelissero',      affiliation: 'NFL Network',   specialty: 'Contracts & injuries'         },
  { name: 'Jay Glazer',      handle: 'JayGlazer',         affiliation: 'Fox Sports',    specialty: 'Insider scoops'               },
  { name: 'Mike Garafolo',   handle: 'MikeGarafolo',      affiliation: 'NFL Network',   specialty: 'Transactions & injuries'      },
  { name: 'Jeremy Fowler',   handle: 'JFowlerESPN',       affiliation: 'ESPN',          specialty: 'League-wide coverage'         },
  { name: 'Diana Russini',   handle: 'dianaussini',       affiliation: 'The Athletic',  specialty: 'NFL insiders & front office'  },
  { name: 'Albert Breer',    handle: 'AlbertBreer',       affiliation: 'SI / MMQB',     specialty: 'Analysis & draft intel'       },
  { name: 'Field Yates',     handle: 'FieldYates',        affiliation: 'ESPN',          specialty: 'Fantasy & roster moves'       },
  { name: 'Mike Florio',     handle: 'ProFootballTalk',   affiliation: 'NBC Sports',    specialty: 'News & commentary'            },
  { name: 'Jordan Schultz',  handle: 'Schultz_Report',    affiliation: 'Independent',   specialty: 'Breaking news'                },
  { name: 'Dan Graziano',    handle: 'DanGrazianoESPN',   affiliation: 'ESPN',          specialty: 'NFC coverage & analysis'      },
];

// ─── Source badge colours ─────────────────────────────────────────────────────

const SOURCE_COLOR: Record<string, string> = {
  espn:  '#e8224a',
  yahoo: '#6001d2',
  pft:   '#d4501c',
  cbs:   '#1a6eb5',
};

// ─── Tab content: News ────────────────────────────────────────────────────────

function relativeDate(raw: string): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const mins  = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days  = Math.floor(diffMs / 86_400_000);
  if (mins  <  1) return 'Just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  <  7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const NEWS_SOURCES: { key: NewsSource | 'all'; label: string }[] = [
  { key: 'all',   label: 'All'              },
  { key: 'espn',  label: 'ESPN'             },
  { key: 'yahoo', label: 'Yahoo Sports'     },
  { key: 'pft',   label: 'Pro Football Talk'},
  { key: 'cbs',   label: 'CBS Sports'       },
];

function NewsTab() {
  const [activeSource, setActiveSource] = useState<NewsSource | 'all'>('all');
  const [news, setNews]                 = useState<NewsArticle[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);

  const fetchNews = useCallback(async (source: NewsSource | 'all') => {
    setLoading(true);
    setError(null);
    try {
      const qs = source === 'all' ? '' : `?source=${source}`;
      const res = await fetch(`/api/news${qs}`);
      if (!res.ok) throw new Error('Failed to load news');
      setNews(await res.json() as NewsArticle[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchNews(activeSource); }, [activeSource, fetchNews]);

  function handleSource(src: NewsSource | 'all') {
    setActiveSource(src);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">

      {/* ── News feed — 2 cols ── */}
      <div className="lg:col-span-2 flex flex-col gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: '#555' }}>
            NFL Headlines
          </p>
          {/* Source filter pills */}
          <div className="flex flex-wrap gap-1.5">
            {NEWS_SOURCES.map(({ key, label }) => {
              const active = key === activeSource;
              return (
                <button
                  key={key}
                  onClick={() => handleSource(key)}
                  className="text-xs px-2.5 py-1 rounded-full transition-colors"
                  style={{
                    background: active ? 'rgba(128,255,73,0.12)' : '#141415',
                    border: `1px solid ${active ? 'rgba(128,255,73,0.3)' : '#1e1e20'}`,
                    color: active ? '#80ff49' : '#555',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl overflow-hidden"
          style={{ background: '#141415', border: '1px solid #1e1e20' }}>
          {loading ? (
            <div className="flex flex-col gap-3 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex gap-3 items-start">
                  <div className="w-14 h-14 rounded shrink-0 animate-pulse"
                    style={{ background: '#1e1e20' }} />
                  <div className="flex-1 flex flex-col gap-2 pt-1">
                    <div className="h-3.5 rounded animate-pulse"
                      style={{ background: '#1e1e20', width: `${65 + (i % 3) * 10}%` }} />
                    <div className="h-3 rounded animate-pulse"
                      style={{ background: '#1e1e20', width: '40%' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="p-4 flex items-center gap-3">
              <p className="text-xs flex-1" style={{ color: '#ff4949' }}>{error}</p>
              <button onClick={() => void fetchNews(activeSource)}
                className="text-xs transition-colors" style={{ color: '#555' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#e8e6df')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}>
                ↺ Retry
              </button>
            </div>
          ) : news.length === 0 ? (
            <p className="text-xs p-4" style={{ color: '#444' }}>No headlines available.</p>
          ) : (
            news.map((article, i) => (
              <a key={i} href={article.link} target="_blank" rel="noopener noreferrer"
                className="flex items-start gap-3 px-4 py-3 border-b last:border-b-0 group"
                style={{ borderColor: '#1a1a1c' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#1a1a1c')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                {article.imageUrl && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={article.imageUrl} alt=""
                    className="w-14 h-14 rounded object-cover shrink-0"
                    style={{ background: '#1e1e20' }} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-snug transition-colors group-hover:text-[#80ff49]"
                    style={{ color: '#e8e6df' }}>
                    {article.title}
                  </p>
                  {article.description && (
                    <p className="text-[11px] mt-0.5 line-clamp-2" style={{ color: '#555' }}>
                      {article.description}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1.5">
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0"
                      style={{
                        background: `${SOURCE_COLOR[article.source] ?? '#333'}22`,
                        color: SOURCE_COLOR[article.source] ?? '#555',
                      }}
                    >
                      {article.sourceLabel}
                    </span>
                    <span className="text-xs font-medium" style={{ color: '#666' }}>
                      {relativeDate(article.pubDate)}
                    </span>
                  </div>
                </div>
              </a>
            ))
          )}
        </div>
      </div>

      {/* ── Reporter directory — 1 col ── */}
      <div>
        <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: '#555' }}>
          NFL Reporters on X
        </p>
        <div className="rounded-xl overflow-hidden"
          style={{ background: '#141415', border: '1px solid #1e1e20' }}>
          {NFL_REPORTERS.map((r, i) => (
            <a
              key={r.handle}
              href={`https://x.com/${r.handle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 group"
              style={{ borderColor: '#1a1a1c' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#1a1a1c')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-[11px] font-semibold"
                style={{
                  background: `hsl(${(i * 47) % 360} 30% 18%)`,
                  color: `hsl(${(i * 47) % 360} 60% 60%)`,
                }}
              >
                {r.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate transition-colors group-hover:text-[#80ff49]"
                  style={{ color: '#e8e6df' }}>
                  {r.name}
                </p>
                <p className="text-[10px] truncate" style={{ color: '#444' }}>
                  @{r.handle} · {r.affiliation}
                </p>
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
  );
}

// ─── Dashboard page ───────────────────────────────────────────────────────────

export default function LeagueDashboardPage() {
  const [sleeperUser, setSleeperUser]     = useState<SleeperUser | null>(null);
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [tab, setTab]                     = useState<Tab>('league');

  const [trending, setTrending]           = useState<TrendingData | null>(null);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [trendingError, setTrendingError] = useState<string | null>(null);



  // ── Restore Sleeper session ──────────────────────────────────────────────────
  useEffect(() => {
    const savedUserId   = localStorage.getItem('sleeper_user_id');
    const savedUsername = localStorage.getItem('sleeper_username');
    if (!savedUserId && !savedUsername) { setShowOnboarding(true); return; }
    void (async () => {
      try {
        const param = savedUserId
          ? `userId=${encodeURIComponent(savedUserId)}`
          : `username=${encodeURIComponent(savedUsername!)}`;
        const res = await fetch(`/api/sleeper/user?${param}`);
        if (!res.ok) { setShowOnboarding(true); return; }
        const data = await res.json() as SleeperUser;
        localStorage.setItem('sleeper_user_id', data.userId);
        setSleeperUser(data);
        const saved = localStorage.getItem('sleeper_active_league');
        setActiveLeagueId(saved ?? data.leagues[0]?.leagueId ?? null);
      } catch { setShowOnboarding(true); }
    })();
  }, []);

  // ── Fetch trending ───────────────────────────────────────────────────────────
  const fetchTrending = useCallback(async () => {
    setTrendingLoading(true);
    setTrendingError(null);
    try {
      const res = await fetch('/api/trending?limit=10');
      if (!res.ok) throw new Error('Failed to load trending data');
      setTrending(await res.json() as TrendingData);
    } catch (err) {
      setTrendingError(err instanceof Error ? err.message : 'Error');
    } finally {
      setTrendingLoading(false);
    }
  }, []);



  useEffect(() => { void fetchTrending(); }, [fetchTrending]);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  function handleConnect(user: SleeperUser) {
    setSleeperUser(user);
    localStorage.setItem('sleeper_user_id', user.userId);
    localStorage.setItem('sleeper_username', user.username);
    const first = user.leagues[0];
    setActiveLeagueId(first?.leagueId ?? null);
    if (first) {
      localStorage.setItem('sleeper_active_league', first.leagueId);
      localStorage.setItem('sleeper_active_league_name', first.name);
    }
    setShowOnboarding(false);
  }

  function handleLeagueSelect(id: string) {
    setActiveLeagueId(id);
    localStorage.setItem('sleeper_active_league', id);
    const name = sleeperUser?.leagues.find((l) => l.leagueId === id)?.name ?? '';
    localStorage.setItem('sleeper_active_league_name', name);
  }

  function handleDisconnect() {
    localStorage.removeItem('sleeper_username');
    localStorage.removeItem('sleeper_user_id');
    localStorage.removeItem('sleeper_active_league');
    localStorage.removeItem('sleeper_active_league_name');
    setSleeperUser(null);
    setActiveLeagueId(null);
    setShowOnboarding(true);
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'league',     label: 'League'     },
    { id: 'statistics', label: 'Statistics' },
    { id: 'news',       label: 'News'       },
  ];

  return (
    <div className="min-h-full px-5 py-6 sm:px-8" style={{ color: '#e8e6df' }}>
      {showOnboarding && <OnboardingModal onConnect={handleConnect} />}

      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: '#555' }}>
            League Portal
          </p>
          <h1 className="text-xl font-semibold">Dashboard</h1>
        </div>

        {sleeperUser && (
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs" style={{ color: '#80ff49' }}>
              {' '}
              <span style={{ color: '#80ff49' }}>{sleeperUser.displayName}</span>
            </span>
            <button
              onClick={handleDisconnect}
              className="text-[10px] transition-colors"
              style={{ color: '#80ff49' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#c849ff')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#80ff49')}
            >
              disconnect
            </button>
          </div>
        )}
      </div>

      {/* ── Tab bar ── */}
      <div className="flex border-b mb-6" style={{ borderColor: '#1e1e20' }}>
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="px-4 py-2.5 text-sm font-medium transition-colors"
            style={{
              color: tab === id ? '#e8e6df' : '#555',
              borderBottom: `2px solid ${tab === id ? '#80ff49' : 'transparent'}`,
              marginBottom: -1,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      {tab === 'league' && (
        <LeagueTab
          sleeperUser={sleeperUser}
          activeLeagueId={activeLeagueId}
          onSelect={handleLeagueSelect}
        />
      )}

      {tab === 'statistics' && (
        <StatisticsTab
          trending={trending}
          trendingLoading={trendingLoading}
          trendingError={trendingError}
          onRetryTrending={fetchTrending}
        />
      )}

      {tab === 'news' && <NewsTab />}

      {/* ── Attribution ── */}
      <p className="mt-8 text-center text-[11px]" style={{ color: '#80ff49' }}>
        Trending data from{' '}
        <a href="https://sleeper.com" target="_blank" rel="noopener noreferrer"
          className="underline" style={{ color: '#80ff49' }}>Sleeper</a>
        {' '}· Stats from nfl_data_py · Headlines from ESPN
      </p>
    </div>
  );
}

// ─── Utility components ───────────────────────────────────────────────────────

function SkeletonCard({ rows }: { rows: number }) {
  return (
    <div className="rounded-xl p-5 flex flex-col gap-3"
      style={{ background: '#141415', border: '1px solid #1e1e20' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-4 rounded animate-pulse"
          style={{ background: '#1e1e20', width: `${65 + (i % 3) * 10}%` }} />
      ))}
    </div>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl p-5 flex flex-col gap-3"
      style={{ background: '#141415', border: '1px solid rgba(255,73,73,0.2)' }}>
      <p className="text-xs" style={{ color: '#ff4949' }}>{message}</p>
      <button onClick={onRetry} className="text-xs self-start transition-colors"
        style={{ color: '#555' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = '#e8e6df')}
        onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}>
        ↺ Retry
      </button>
    </div>
  );
}

function EmptyCard({ message }: { message: string }) {
  return (
    <div className="rounded-xl p-5"
      style={{ background: '#141415', border: '1px solid #1e1e20' }}>
      <p className="text-xs" style={{ color: '#444' }}>{message}</p>
    </div>
  );
}
