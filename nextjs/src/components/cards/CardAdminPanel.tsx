'use client';

// src/components/cards/CardAdminPanel.tsx
//
// The two commissioner controls the card game needs, kept on the game's own
// page rather than buried in a sync screen — they are about the game, and this
// is where someone will be standing when they realise the pool is stale.
//
//   Build pool  — re-derive the cards from the stat table. Safe to run any
//                 time; collections survive it.
//   Reset       — wipe a season's collections. Destructive, so it is typed out.

import { useState } from 'react';
import { PanelActionBtn } from '@/components/dashboard/shared';

interface RebuildResult {
  seasons: number[];
  total: number;
  perWeek: number;
}

export function CardAdminPanel({
  gameSeason, onChanged,
}: {
  gameSeason: number;
  /** Called after a rebuild or reset, so the page re-reads. */
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<'build' | 'reset' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The reset is guarded by typing the season back, rather than by a confirm
  // dialog: it destroys every member's collection, and a dialog is one careless
  // Enter away from doing it.
  const [confirmText, setConfirmText] = useState('');
  const confirmed = confirmText.trim() === String(gameSeason);

  async function call(
    kind: 'build' | 'reset',
    url: string,
    body?: unknown,
  ): Promise<void> {
    setBusy(kind);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
      const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error((payload.error as string) ?? `Request failed (${res.status})`);

      if (kind === 'build') {
        const r = payload as unknown as RebuildResult;
        setNote(
          `Built ${r.total.toLocaleString()} cards across ${r.seasons.length} season` +
          `${r.seasons.length === 1 ? '' : 's'} (${r.seasons.join(', ')}) — ${r.perWeek} packs a week.`,
        );
      } else {
        // Reports the lineups too. The old message named only cards and grants,
        // which is exactly the blind spot that hid rosters never being cleared.
        setNote(
          `Cleared ${gameSeason}: ${payload.ownerships} cards, ${payload.grants} grants, ` +
          `${payload.rosters} lineup slots.`,
        );
        setConfirmText('');
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded p-4" style={{ background: '#0e0e0f', border: '1px solid #1e1e20' }}>
      <div
        className="text-[10px] uppercase mb-3"
        style={{ letterSpacing: '0.16em', color: '#444' }}
      >
        Commissioner
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <PanelActionBtn
          onClick={() => void call('build', '/api/cards/pool')}
          disabled={busy !== null}
          loading={busy === 'build'}
          label="Rebuild card pool"
          loadingLabel="Building…"
        />
        <span className="text-[10px]" style={{ color: '#444' }}>
          Re-derives cards from the NFL stats. Collections are kept.
        </span>
      </div>

      <div className="mt-4 pt-4 flex flex-wrap items-center gap-2" style={{ borderTop: '1px solid #1e1e20' }}>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={`Type ${gameSeason} to reset`}
          aria-label={`Type ${gameSeason} to confirm the season reset`}
          className="text-xs px-2 py-1.5 rounded outline-none"
          style={{ background: '#141415', border: '1px solid #1e1e20', color: '#e8e6df', width: 170 }}
        />
        <button
          onClick={() => void call('reset', '/api/cards/reset', { season: gameSeason })}
          disabled={!confirmed || busy !== null}
          className="text-xs font-medium px-3 py-1.5 rounded transition-opacity disabled:opacity-30"
          style={{ background: '#ff4949', color: '#0e0e0f' }}
        >
          {busy === 'reset' ? 'Resetting…' : `Reset ${gameSeason}`}
        </button>
        <span className="text-[10px]" style={{ color: '#444' }}>
          Wipes every member&apos;s collection for the season. Cannot be undone.
        </span>
      </div>

      {note && <p className="text-[11px] mt-3" style={{ color: '#80ff49' }}>{note}</p>}
      {error && <p className="text-[11px] mt-3" style={{ color: '#ff6b6b' }}>{error}</p>}
    </div>
  );
}
