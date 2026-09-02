'use client';

// The commissioner's allowlist editor.
//
// A Sleeper league appears nowhere in this app until its ID is added here, and
// members only ever see the intersection of this list with their own Sleeper
// leagues. That makes this the control that decides what the app is about, so
// it lives on the Data Sync page next to the feeds it governs.

import { useState, useEffect, useCallback } from 'react';
import { PANEL_BG, INNER_BG, PanelActionBtn, PanelSkeleton } from '@/components/dashboard/shared';

export interface RegisteredLeague {
  id: string;
  sleeperLeagueId: string;
  name: string;
  season: number;
}

export function LeagueManager({
  onChange,
  selectedId,
  onSelect,
  reloadKey = 0,
}: {
  /**
   * Called after the allowlist changes, with a predicate over the leagues that
   * remain — so a caller holding a selection can tell whether it survived.
   */
  onChange?: (stillPresent: (sleeperLeagueId: string) => boolean) => void;
  /** Sleeper id of the card currently chosen, or null for none. */
  selectedId: string | null;
  onSelect: (sleeperLeagueId: string) => void;
  /**
   * Bump to re-read the allowlist. Adds and removes reload on their own; this
   * is for changes made elsewhere — a Sleeper sync rewrites the stored name of
   * a league that was renamed, and the card would otherwise keep the old one.
   */
  reloadKey?: number;
}) {
  const [leagues, setLeagues] = useState<RegisteredLeague[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  /** Re-reads the allowlist and returns it, so callers can react to what is left. */
  const load = useCallback(async (): Promise<RegisteredLeague[]> => {
    try {
      // no-store: this list changes on every add and remove, and a cached copy
      // would leave a just-deleted league on screen.
      const res = await fetch('/api/leagues', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load leagues');
      const data = (await res.json()) as RegisteredLeague[];
      const list = Array.isArray(data) ? data : [];
      setLeagues(list);
      return list;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
      return [];
    } finally {
      setLoaded(true);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load, reloadKey]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const sleeperLeagueId = input.trim();
    if (!sleeperLeagueId || busy) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/leagues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sleeperLeagueId }),
      });
      const body = (await res.json()) as { error?: string; league?: RegisteredLeague };
      if (!res.ok) throw new Error(body.error ?? 'Could not add that league');

      setNotice(`Added ${body.league?.name || sleeperLeagueId}.`);
      setInput('');
      const remaining = await load();
      onChange?.((id) => remaining.some((l) => l.sleeperLeagueId === id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that league');
    } finally {
      setBusy(false);
    }
  }

  async function remove(league: RegisteredLeague) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/leagues/${league.id}`, { method: 'DELETE' });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not remove that league');

      setNotice(`Removed ${league.name || league.sleeperLeagueId}.`);
      setConfirmId(null);
      const remaining = await load();
      onChange?.((id) => remaining.some((l) => l.sleeperLeagueId === id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove that league');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg p-4 mb-4" style={PANEL_BG}>
      <h2 className="text-sm font-semibold mb-1">Registered leagues</h2>
      <p className="text-xs mb-4" style={{ color: '#888' }}>
        Only leagues listed here appear in the app. Members see the ones they
        belong to; everyone else sees nothing until you add them. Pick one to
        work with its data feeds.
      </p>

      <form onSubmit={add} className="flex flex-wrap gap-2 mb-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Sleeper league ID"
          inputMode="numeric"
          className="flex-1 min-w-[180px] text-xs px-3 py-2 rounded outline-none"
          style={{ ...INNER_BG, color: '#e8e6df' }}
        />
        <PanelActionBtn
          disabled={busy || !input.trim()}
          loading={busy}
          label="Add league"
          loadingLabel="Adding…"
          type="submit"
        />
      </form>

      {notice && (
        <p className="text-xs mb-3 rounded px-3 py-2" style={{ ...INNER_BG, color: '#80ff49' }}>
          {notice}
        </p>
      )}
      {error && <p className="text-xs mb-3" style={{ color: '#ff6b6b' }}>{error}</p>}

      {!loaded && <PanelSkeleton rows={2} height={40} />}

      {loaded && leagues.length === 0 && (
        <p className="text-xs" style={{ color: '#555' }}>
          No leagues registered yet. Paste a Sleeper league ID above — it is the
          number in the league&apos;s Sleeper URL.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {leagues.map((league) => {
          const selected = selectedId === league.sleeperLeagueId;
          return (
          <div
            key={league.id}
            className="rounded p-3 flex flex-wrap items-center justify-between gap-3 transition-colors"
            style={{
              ...INNER_BG,
              borderColor: selected ? '#80ff49' : '#1e1e20',
              background: selected ? 'rgba(128,255,73,0.06)' : INNER_BG.background,
            }}
          >
            {/* The card itself is the selector — clicking it is what reveals
                the feeds below, so the whole row is the hit target. */}
            <button
              onClick={() => onSelect(league.sleeperLeagueId)}
              aria-pressed={selected}
              className="min-w-0 flex-1 text-left"
            >
              <p
                className="text-sm font-medium truncate"
                style={{ color: selected ? '#80ff49' : '#e8e6df' }}
              >
                {league.name || 'Unnamed league'}
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: '#555' }}>
                {league.sleeperLeagueId} · {league.season}
                {selected && ' · selected'}
              </p>
            </button>

            {confirmId === league.id ? (
              <div className="flex items-center gap-2">
                <span className="text-[11px]" style={{ color: '#ff6b6b' }}>
                  Delete its teams and schedules?
                </span>
                <button
                  onClick={() => void remove(league)}
                  disabled={busy}
                  className="text-xs font-medium px-3 py-1.5 rounded disabled:opacity-40"
                  style={{ background: '#ff4949', color: '#0e0e0f' }}
                >
                  {busy ? 'Removing…' : 'Remove'}
                </button>
                <button
                  onClick={() => setConfirmId(null)}
                  className="text-xs px-2 py-1.5 rounded"
                  style={{ color: '#888' }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setConfirmId(league.id); setError(null); setNotice(null); }}
                disabled={busy}
                className="text-xs px-3 py-1.5 rounded border transition-colors disabled:opacity-40"
                style={{ borderColor: '#2a2a2c', color: '#888' }}
              >
                Remove
              </button>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}
