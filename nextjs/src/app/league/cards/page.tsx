'use client';

// /league/cards — Draft Deck.
//
// Three tabs over one fetch: Packs is where cards come from, Deck is what you
// have, and Commissioner is the pool behind both. It was a single scroll — the
// ration, the opener, the rank card, the lineup, the standings, the grid and an
// admin panel, in that order — which meant opening a pack and looking something
// up in your deck were the same page-length journey.
//
// Cards are owned exclusively, so the standings are not a nicety bolted on the
// side — they are the scoreboard the whole game is played against.
//
// Signed-in members only, matching the sidebar link. A collection belongs to a
// person, so there is no public view to degrade to — a signed-out visitor gets
// an explanation rather than an empty grid.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { PackOpener } from '@/components/cards/PackOpener';
import { DeckGrid } from '@/components/cards/DeckGrid';
import { RosterPanel } from '@/components/cards/RosterPanel';
import { RankCard } from '@/components/cards/RankCard';
import { Standings } from '@/components/cards/Standings';
import { BonusBanner } from '@/components/cards/BonusBanner';
import { CardAdminPanel } from '@/components/cards/CardAdminPanel';
import { PendingWildcards } from '@/components/cards/WildcardReveal';
import { CardDetail } from '@/components/cards/CardDetail';
import { CardsDialog } from '@/components/cards/CardsDialog';
import { useForceSidebarCollapsed } from '@/components/useSidebarForceCollapse';
import { PANEL_BG } from '@/components/dashboard/shared';
import { DraftDeckIntro, openDraftDeckIntro } from '@/components/intro/DraftDeckIntro';
import { ROSTER_SIZE } from '@/lib/cards/roster';
import { MAX_CUSTOMIZATION_PACKS } from '@/lib/cards/customize';
import type {
  CollectionResponse, CustomizeResponse, OpenPackResponse,
  RosterUpdateResponse, WildcardResponse,
} from '@/types/cards';

/** The tabs, in bar order. Commissioner is right-aligned and gated on role. */
type Tab = 'packs' | 'deck' | 'lineup' | 'commissioner';

/**
 * Lineup is its own tab rather than a panel inside Deck.
 *
 * The two were stacked on one tab and they are different jobs. The deck is
 * hundreds of cards you browse; the lineup is eleven slots you set. Sharing a
 * scroll meant the thing that decides your standing sat under the thing you
 * only look at, and every lineup change was a scroll past the whole collection.
 */
const LEFT_TABS: { id: Tab; label: string }[] = [
  { id: 'packs',  label: 'Packs' },
  { id: 'deck',   label: 'Deck' },
  { id: 'lineup', label: 'Lineup' },
];

const RIGHT_TABS: { id: Tab; label: string }[] = [
  { id: 'commissioner', label: 'Commissioner' },
];

export default function CardsPage() {
  const { data: session, status } = useSession();
  const isCommissioner = session?.user?.role === 'COMMISSIONER';
  const [data, setData] = useState<CollectionResponse | null>(null);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Whether the first fetch has settled, rather than a `loading` flag. The
  // signed-out case never fetches at all, so a flag would have to be cleared
  // from inside the effect — a synchronous setState that cascades a re-render.
  // Deriving it below keeps the effect to just the fetch.
  const [settled, setSettled] = useState(false);
  const [rawTab, setRawTab] = useState<Tab>('packs');
  // The card open in the detail panel, by id rather than by value: the deck is
  // re-read after every save, so holding the object would pin a stale copy.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // The pack opener lives behind a dialog opened from the "Packs left" stat —
  // see the Packs tab below. Kept separate from `pack` state inside PackOpener
  // itself, which is why closing this never discards a reveal in progress.
  const [packDialogOpen, setPackDialogOpen] = useState(false);

  // The lineup is one card wide on a phone — see the Lineup tab below — and a
  // 52px collapsed sidebar is still real estate that card wants. Only takes
  // effect on a narrow viewport; a member with the sidebar pinned open on a
  // wide screen keeps it.
  useForceSidebarCollapsed(rawTab === 'lineup');

  // Derived rather than stored, so a member who loses the commissioner role
  // mid-session falls back to Packs instead of staring at a tab that is no
  // longer in the bar. Guarding only on setRawTab would leave the old value in
  // place and render nothing.
  const tab: Tab = rawTab === 'commissioner' && !isCommissioner ? 'packs' : rawTab;

  const setTab = useCallback((next: Tab) => {
    setRawTab(next);
    setMenuOpen(false);
  }, []);

  // Close the mobile menu on any click outside it.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  /**
   * One request, not two.
   *
   * The deck and the standings come from the same read: ranking a member means
   * ranking everybody, so /collection already pays for the whole standings
   * table. Fetching /leaderboard alongside it made the most expensive query in
   * the app run twice on every page load, and risked showing a card count next
   * to a rank computed a moment apart from it.
   */
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/cards/collection');
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Could not load your deck (${res.status})`);
      }
      setData((await res.json()) as CollectionResponse);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your deck');
    } finally {
      setSettled(true);
    }
  }, []);

  useEffect(() => {
    // The rule fires on any effect that reaches a setState, but `load` is async
    // and every setState in it happens after an await — the same fetch-on-mount
    // shape as NewsTab, and disabled the same way.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (status === 'authenticated') void load();
  }, [status, load]);

  const loading = status === 'loading' || (status === 'authenticated' && !settled);

  /** Spends a pack. The opener animates over this call. */
  const openPack = useCallback(async (): Promise<OpenPackResponse> => {
    const res = await fetch('/api/cards/open', { method: 'POST' });
    const body = (await res.json().catch(() => ({}))) as OpenPackResponse & { error?: string };
    if (!res.ok) throw new Error(body.error ?? 'Could not open that pack');
    return body;
  }, []);

  /**
   * Re-reads after a pack lands.
   *
   * The response already carries the new allowance, but the collection totals
   * and duplicate counts live server-side, so a re-read is simpler than merging
   * the pull into local state and cannot drift from it.
   */
  const onFinished = useCallback(() => { void load(); }, [load]);

  /**
   * Sets or clears one lineup slot.
   *
   * The response carries the whole lineup and the recomputed scores, so the
   * roster and the rank card update from the write itself; the standings are
   * re-read after, since a swap changes where everyone sits.
   */
  const assignSlot = useCallback(async (slotId: string, cardId: string | null) => {
    setBusySlot(slotId);
    try {
      const res = await fetch('/api/cards/roster', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot: slotId, cardId }),
      });
      const body = (await res.json().catch(() => ({}))) as
        RosterUpdateResponse & { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not update the lineup');

      setData((cur) => (cur ? { ...cur, roster: body.roster, stats: body.stats } : cur));
      void load();
    } finally {
      setBusySlot(null);
    }
  }, [load]);

  /**
   * Saves a nickname and/or a picture onto one card.
   *
   * Form-data when there is a file and JSON when there is not, which is the
   * split the route expects — the multipart envelope is only worth paying for
   * when something is actually being uploaded.
   *
   * `image === null` with no pending upload means "remove the picture", which
   * the route distinguishes from "leave it alone" by the field being present.
   */
  const saveCard = useCallback(async (
    cardId: string, nickname: string, image: Blob | null,
  ): Promise<CustomizeResponse> => {
    let res: Response;
    if (image) {
      const form = new FormData();
      form.append('cardId', cardId);
      form.append('nickname', nickname);
      form.append('image', image, 'portrait.jpg');
      res = await fetch('/api/cards/image', { method: 'POST', body: form });
    } else {
      res = await fetch('/api/cards/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId, nickname, customImage: null }),
      });
    }

    const body = (await res.json().catch(() => ({}))) as CustomizeResponse & { error?: string };
    if (!res.ok) throw new Error(body.error ?? 'Could not save that card');

    // Re-read rather than patching local state: a completed card pays packs,
    // and the allowance that reports them lives on the collection response.
    void load();
    return body;
  }, [load]);

  /**
   * Throws one wildcard.
   *
   * By id, because a member can be holding several — one per lucky pack — and
   * each is a separate die.
   */
  const rollWildcard = useCallback(async (id: string): Promise<WildcardResponse> => {
    const res = await fetch('/api/cards/wildcard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const body = (await res.json().catch(() => ({}))) as WildcardResponse & { error?: string };
    if (!res.ok) throw new Error(body.error ?? 'Could not roll');
    void load();
    return body;
  }, [load]);

  if (status === 'loading' || loading) {
    return <Shell><p className="text-xs" style={{ color: '#555' }}>Loading…</p></Shell>;
  }

  if (status === 'unauthenticated') {
    return (
      <Shell>
        <div className="rounded p-8 text-center" style={PANEL_BG}>
          <p className="text-sm mb-2" style={{ color: '#e8e6df' }}>Sign in to collect cards</p>
          <p className="text-xs" style={{ color: '#555' }}>
            Packs and collections are tied to your league account.
          </p>
        </div>
      </Shell>
    );
  }

  if (error || !data) {
    return (
      <Shell>
        <div className="rounded p-6" style={PANEL_BG}>
          <p className="text-xs" style={{ color: '#ff6b6b' }}>{error ?? 'No data'}</p>
        </div>
      </Shell>
    );
  }

  const { allowance, stats, cards, roster, standings, bonus, seasons } = data;
  const poolEmpty = allowance.poolSize === 0;

  // Resolved from the freshly-read deck rather than stored, so the panel shows
  // the saved card and not the copy that was selected before the write.
  const selected = cards.find((c) => c.id === selectedId) ?? null;

  // Counted here rather than returned by the collection route: the deck is
  // already in hand, and a card is finished exactly when it has both fields.
  const finished = cards.filter((c) => c.nickname && c.customImage).length;
  const rewardsRemaining = Math.max(0, MAX_CUSTOMIZATION_PACKS - finished);

  return (
    <Shell
      tab={tab}
      onTab={setTab}
      showCommissioner={isCommissioner}
      menuOpen={menuOpen}
      onMenu={setMenuOpen}
      menuRef={menuRef}
    >
      {/* ── Packs ──────────────────────────────────────────────────────────
          Kept mounted rather than unmounted on a tab switch: the opener holds
          a torn pack and a half-turned reveal in local state, and looking
          something up in the deck mid-pack should not throw the pack away. */}
      <div style={{ display: tab === 'packs' ? undefined : 'none' }}>
        {/* ── This week's ration ──
            Three tiles in one row even on the smallest current iPhone: the
            grid is a fixed three columns rather than auto-fit, so it never
            wraps, and Stat shrinks its own type at the sm breakpoint instead
            of the tiles reflowing. */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-6">
          {/* The pack itself stays off-screen until this is tapped — see the
              dialog below. The card doubles as that button, so opening a pack
              starts from the same number that says how many you have. */}
          <button
            type="button"
            onClick={() => setPackDialogOpen(true)}
            disabled={poolEmpty}
            className="text-left disabled:cursor-default"
            aria-haspopup="dialog"
          >
            <Stat label="Packs left" value={String(allowance.remaining)} accent
                  hint={
                    // Before the ration starts, say when it starts. "2 a week"
                    // beside a week-1 deck reads as two packs waiting, and
                    // there are none — week 1 is the starter grant and
                    // nothing else.
                    [
                      allowance.starterRemaining > 0
                        ? `${allowance.starterRemaining} starter`
                        : null,
                      allowance.week < allowance.rationStartsWeek
                        ? `${allowance.perWeek} a week from week ${allowance.rationStartsWeek}`
                        : `${allowance.perWeek} a week`,
                    ].filter(Boolean).join(' · ')
                  } />
          </button>
          <Stat label="Lineup" value={`${stats.rosterPpg.toFixed(1)} PPG`}
                hint={`${stats.started} of ${ROSTER_SIZE} started`} />
          <Stat
            label="Cards left"
            value={allowance.remainingCards.toLocaleString()}
            hint={`of ${allowance.poolSize.toLocaleString()} · ${allowance.members} playing`}
          />
        </div>

        {/* Wildcards found in an earlier pack and never thrown. The opener
            offers a die at the moment it is pulled; this is the safety net for
            a member who closed the tab mid-reveal. */}
        {allowance.pendingWildcards.length > 0 && (
          <div className="mb-6">
            <PendingWildcards wildcards={allowance.pendingWildcards} onRoll={rollWildcard} />
          </div>
        )}

        {/* Cards are exclusive, so a draining pool is a real end-state rather
            than a cosmetic number. Warn before it bites. */}
        {allowance.remainingCards > 0 && allowance.remainingCards < allowance.poolSize * 0.15 && (
          <div
            className="rounded px-3 py-2 mb-6 text-[11px]"
            style={{ background: 'rgba(255,176,71,0.08)', border: '1px solid rgba(255,176,71,0.3)', color: '#ffb347' }}
          >
            Only {allowance.remainingCards.toLocaleString()} cards left unclaimed. Once the
            pool runs dry there is nothing left to deal — a commissioner can widen it by
            backfilling older seasons.
          </div>
        )}

        {/* ── What Sleeper earned you this week ── */}
        <div className="mb-6">
          <BonusBanner bonus={bonus} remaining={allowance.bonusRemaining} />
        </div>

        {/* ── Opener, in place on the page ──
            Nothing to tear open, so there is nothing worth hiding behind a
            dialog for it — the pool being empty is a commissioner problem,
            and no packs left this week is stated plainly right here rather
            than making a member open a dialog to be told the same thing. */}
        {poolEmpty ? (
          <div className="rounded p-6" style={PANEL_BG}>
            <p className="text-xs text-center py-10" style={{ color: '#555' }}>
              No cards have been built yet — a commissioner needs to build the card pool first.
            </p>
          </div>
        ) : allowance.remaining === 0 ? (
          <p className="text-xs text-center py-6" style={{ color: '#555' }}>
            No packs left to open. More next week.
          </p>
        ) : (
          <p className="text-xs text-center py-6" style={{ color: '#555' }}>
            Tap <span style={{ color: '#80ff49' }}>Packs left</span> above to open one.
          </p>
        )}

        {/* ── The pack, in its dialog ──
            Kept mounted regardless of `open`: the opener holds a torn pack and
            a half-turned reveal in local state, and dismissing the dialog —
            by an outside tap, Escape, or the close button — should not throw
            a pack away any more than switching tabs used to. */}
        {!poolEmpty && (
          <CardsDialog
            open={packDialogOpen}
            onClose={() => setPackDialogOpen(false)}
            title="Draft Deck · Packs"
          >
            <PackOpener
              remaining={allowance.remaining}
              nextPackTier={allowance.nextPackTier}
              nextPackKind={allowance.nextPackKind}
              onOpen={openPack}
              onRollWildcard={rollWildcard}
              onFinished={onFinished}
            />
          </CardsDialog>
        )}
      </div>

      {/* ── Deck ───────────────────────────────────────────────────────────
          The tier tiles, the filters and the grid — picking a card opens it in
          a dialog with everything you can do to it, the same frame the packs
          dialog uses. That used to be a panel pinned above the grid, which
          cost every phone screen the height of a 260px card before the grid
          even started; a dialog only spends that space while a card is
          actually open. */}
      {tab === 'deck' && (
        <div className="mb-8">
          <DeckGrid
            cards={cards}
            stats={stats}
            seasons={seasons}
            selectedId={selectedId}
            onSelect={(card) => setSelectedId(card.id)}
          />
        </div>
      )}

      {/* Rendered alongside the grid rather than nested in `tab === 'deck'`
          only up above, so switching tabs — which unmounts that block — also
          closes this: there is nothing here worth keeping open once you have
          navigated away, unlike a pack mid-reveal. */}
      {tab === 'deck' && (
        <CardsDialog
          open={Boolean(selected)}
          onClose={() => setSelectedId(null)}
          title="Draft Deck · Card"
          widthClassName="sm:max-w-2xl"
        >
          <CardDetail
            // Remounts on a change of selection, which is what resets the
            // form. See the note on its useState initialisers.
            key={selectedId ?? 'none'}
            card={selected}
            roster={roster}
            onSave={saveCard}
            onAssign={assignSlot}
            busySlot={busySlot}
            rewardsRemaining={rewardsRemaining}
          />
        </CardsDialog>
      )}

      {/* ── Lineup ─────────────────────────────────────────────────────────
          The eleven slots that decide the standings, and the standings they
          decide. Rank moved here with the roster: it is the readout for what
          this tab does, and on the deck tab it was a number with no
          relationship to anything else on the page. */}
      {tab === 'lineup' && (
        <>
          <div className="mb-6">
            <RankCard stats={stats} standings={standings} />
          </div>

          <div className="rounded p-4 mb-8" style={PANEL_BG}>
            <RosterPanel
              roster={roster}
              cards={cards}
              stats={stats}
              onAssign={assignSlot}
              busySlot={busySlot}
            />
          </div>

          {standings.length > 1 && <Standings entries={standings} />}
        </>
      )}

      {/* ── Commissioner ── */}
      {tab === 'commissioner' && isCommissioner && (
        <CardAdminPanel gameSeason={allowance.gameSeason} onChanged={() => void load()} />
      )}
    </Shell>
  );
}

/**
 * Page chrome and the tab bar.
 *
 * The bar copies the league dashboard's: same button metrics, same 2px active
 * underline sitting on the container's own border, and Commissioner pushed to
 * the right by a flex spacer and a hairline divider. Right-alignment is the
 * dashboard's convention for "this is administration, not the thing you came
 * for", and repeating it here means it reads as the same idea rather than a
 * fourth thing to learn.
 *
 * Every state of the page renders inside this — loading, signed out, error —
 * so the header does not appear and disappear as the fetch settles. The bar
 * itself needs data-independent props only, which is why they are passed
 * rather than read from a context.
 */
function Shell({
  children, tab, onTab, showCommissioner, menuOpen, onMenu, menuRef,
}: {
  children: React.ReactNode;
  tab?: Tab;
  onTab?: (t: Tab) => void;
  showCommissioner?: boolean;
  menuOpen?: boolean;
  onMenu?: (open: boolean) => void;
  menuRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const tabbed = tab !== undefined && onTab !== undefined;
  const visible = [...LEFT_TABS, ...(showCommissioner ? RIGHT_TABS : [])];

  const TabBtn = ({ id, label }: { id: Tab; label: string }) => (
    <button
      onClick={() => onTab?.(id)}
      className="px-4 py-2.5 text-sm font-medium transition-colors"
      style={{
        color: tab === id ? '#e8e6df' : '#555',
        borderBottom: `2px solid ${tab === id ? '#80ff49' : 'transparent'}`,
        marginBottom: -1,
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-full px-4 py-8 sm:px-8" style={{ color: '#e8e6df' }}>
      <div className="max-w-5xl mx-auto">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <Link
              href="/league/dashboard"
              className="text-[10px] tracking-widest uppercase mb-2 block transition-colors hover:text-[#e8e6df]"
              style={{ color: '#555' }}
            >
              ← Dashboard
            </Link>
            <h1 className="text-xl font-semibold">Draft Deck</h1>
            <p className="text-xs mt-1" style={{ color: '#555' }}>
              Collect every player from every season the league has played.
            </p>
          </div>

          {/* The rules, on demand. The same carousel opens itself on a first
              visit and on a sidebar click; this is the way back to it for
              somebody who dismissed it for good. */}
          <button
            onClick={openDraftDeckIntro}
            className="text-[11px] font-medium px-3 py-1.5 rounded shrink-0 transition-colors"
            style={{ color: '#80ff49', border: '1px solid rgba(128,255,73,0.3)' }}
          >
            How it works
          </button>
        </div>

        {tabbed && (
          <>
            {/* ── Tab bar — desktop ── */}
            <div
              className="hidden sm:flex items-stretch border-b mb-6"
              style={{ borderColor: '#1e1e20' }}
            >
              {LEFT_TABS.map((t) => <TabBtn key={t.id} {...t} />)}
              {showCommissioner && (
                <>
                  <div className="flex-1" />
                  <div className="w-px my-2" style={{ background: '#1e1e20' }} />
                  {RIGHT_TABS.map((t) => <TabBtn key={t.id} {...t} />)}
                </>
              )}
            </div>

            {/* ── Tab bar — mobile ──
                A bar that scrolls sideways hides the right-hand tab, which is
                the one that is hardest to guess at. A menu shows all of them. */}
            <div
              ref={menuRef}
              className="flex sm:hidden relative border-b mb-6"
              style={{ borderColor: '#1e1e20' }}
            >
              <button
                onClick={() => onMenu?.(!menuOpen)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                className="px-4 py-2.5 text-sm font-medium flex items-center gap-2"
                style={{ color: '#e8e6df' }}
              >
                {visible.find((t) => t.id === tab)?.label ?? 'Packs'}
                <span style={{ color: '#555', fontSize: 10 }}>▾</span>
              </button>

              {menuOpen && (
                <div
                  role="menu"
                  className="absolute top-full left-0 z-50 min-w-[160px] rounded-lg overflow-hidden shadow-lg mt-1"
                  style={{ background: '#141415', border: '1px solid #1e1e20' }}
                >
                  {visible.map(({ id, label }) => (
                    <button
                      key={id}
                      role="menuitem"
                      onClick={() => onTab?.(id)}
                      className="block w-full text-left px-4 py-2.5 text-sm transition-colors"
                      style={{
                        color: tab === id ? '#80ff49' : '#999',
                        background: tab === id ? 'rgba(128,255,73,0.08)' : 'transparent',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {children}
      </div>

      {/* Rendered from the shell so the tour is available in every state of the
          page — loading, signed out and errored included. */}
      <DraftDeckIntro isCommissioner={showCommissioner ?? false} />
    </div>
  );
}

function Stat({
  label, value, hint, accent,
}: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div
      className="rounded p-2 sm:p-3 min-w-0"
      style={{ background: '#0e0e0f', border: '1px solid #1e1e20' }}
    >
      <div
        className="text-[8px] sm:text-[10px] uppercase mb-1 sm:mb-1.5 truncate"
        style={{ letterSpacing: '0.1em', color: '#444' }}
      >
        {label}
      </div>
      <div
        className="text-sm sm:text-lg font-bold truncate"
        style={{ color: accent ? '#80ff49' : '#e8e6df' }}
      >
        {value}
      </div>
      {hint && (
        <div className="text-[8px] sm:text-[10px] mt-0.5 truncate" style={{ color: '#444' }}>
          {hint}
        </div>
      )}
    </div>
  );
}
