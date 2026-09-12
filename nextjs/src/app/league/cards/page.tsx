'use client';

// /league/cards — Draft Deck.
//
// Three tabs over one fetch: Packs is where cards come from, Deck is what you
// have, and Lineup is the week you are playing. It was a single scroll — the
// ration, the opener, the rank card, the lineup, the standings, the grid and an
// admin panel, in that order — which meant opening a pack and looking something
// up in your deck were the same page-length journey.
//
// The pool behind all of it was a fourth tab here, right-aligned and
// commissioner-only. It is now the Draft Deck tab of /league/commissioner,
// alongside the rest of running the league — this page is the game.
//
// The results of a published week are the one thing not on the collection
// fetch. They are a league-wide read of every lineup rather than a member's own
// deck, they are only wanted on one tab, and they change once a week — so they
// are fetched when that tab is opened rather than paid for on every page load.
//
// Cards are owned exclusively, so the standings are not a nicety bolted on the
// side — they are the scoreboard the whole game is played against.
//
// Signed-in members only, matching the sidebar link. A collection belongs to a
// person, so there is no public view to degrade to — a signed-out visitor gets
// an explanation rather than an empty grid.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { PackOpener } from '@/components/cards/PackOpener';
import { DeckGrid } from '@/components/cards/DeckGrid';
import { RosterPanel } from '@/components/cards/RosterPanel';
import { RankCard } from '@/components/cards/RankCard';
import { Standings } from '@/components/cards/Standings';
import { PendingWildcards } from '@/components/cards/WildcardReveal';
import { WeeklyPanel } from '@/components/cards/WeeklyPanel';
import { WeekResults } from '@/components/cards/WeekResults';
import { CardsLeftPanel } from '@/components/cards/CardsLeftPanel';
import { CardDetail } from '@/components/cards/CardDetail';
import { CardsDialog } from '@/components/cards/CardsDialog';
import { useForceSidebarCollapsed } from '@/components/useSidebarForceCollapse';
import { PANEL_BG } from '@/components/dashboard/shared';
import { DraftDeckIntro, openDraftDeckIntro } from '@/components/intro/DraftDeckIntro';
import { ROSTER_SIZE } from '@/lib/cards/roster';
import { MAX_CUSTOMIZATION_PACKS } from '@/lib/cards/customize';
import type {
  CollectionResponse, CustomizeResponse, OpenPackResponse,
  RosterUpdateResponse, WeekResultsDto, WildcardResponse,
} from '@/types/cards';

/** The tabs, in bar order. */
type Tab = 'packs' | 'deck' | 'lineup';

/**
 * Lineup is its own tab rather than a panel inside Deck.
 *
 * The two were stacked on one tab and they are different jobs. The deck is
 * hundreds of cards you browse; the lineup is eleven slots you set. Sharing a
 * scroll meant the thing that decides your standing sat under the thing you
 * only look at, and every lineup change was a scroll past the whole collection.
 */
const TABS: { id: Tab; label: string }[] = [
  { id: 'packs',  label: 'Packs' },
  { id: 'deck',   label: 'Deck' },
  { id: 'lineup', label: 'Lineup' },
];

export default function CardsPage() {
  const { status } = useSession();
  const [data, setData] = useState<CollectionResponse | null>(null);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Whether the first fetch has settled, rather than a `loading` flag. The
  // signed-out case never fetches at all, so a flag would have to be cleared
  // from inside the effect — a synchronous setState that cascades a re-render.
  // Deriving it below keeps the effect to just the fetch.
  const [settled, setSettled] = useState(false);
  const [tab, setTab] = useState<Tab>('packs');
  // The card open in the detail panel, by id rather than by value: the deck is
  // re-read after every save, so holding the object would pin a stale copy.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The pack opener lives behind a dialog opened from the "Packs left" stat —
  // see the Packs tab below. Kept separate from `pack` state inside PackOpener
  // itself, which is why closing this never discards a reveal in progress.
  const [packDialogOpen, setPackDialogOpen] = useState(false);
  // The week's results behind the "Season" stat, the same idea one tile over:
  // the number is the button for the thing it summarises.
  const [seasonDialogOpen, setSeasonDialogOpen] = useState(false);
  // And the third tile the same way: "Cards left" is one number, and what it is
  // a number *of* — the pool, what has been claimed, and whose decks it went
  // into — is behind this.
  const [cardsLeftDialogOpen, setCardsLeftDialogOpen] = useState(false);
  // Published results, fetched per week rather than with the collection — see
  // the note at the top. `null` week means "whatever the latest one is", which
  // is what the route answers an absent ?week= with.
  const [results, setResults] = useState<WeekResultsDto | null>(null);
  const [resultsWeek, setResultsWeek] = useState<number | null>(null);
  const [resultsLoading, setResultsLoading] = useState(false);

  // A lineup row is a card chip plus a name, a tier line and a PPG figure on
  // one line — see the Lineup tab below — and a 52px collapsed sidebar is real
  // estate that row wants before any of that starts truncating. Only takes
  // effect on a narrow viewport; a member with the sidebar pinned open on a
  // wide screen keeps it.
  useForceSidebarCollapsed(tab === 'lineup');

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

  /**
   * Reads one published week.
   *
   * A failure is swallowed into an empty result rather than blanking the page:
   * the results are one panel on one tab, and a week that will not load should
   * not take the lineup down with it.
   */
  const loadResults = useCallback(async (week: number | null) => {
    setResultsLoading(true);
    try {
      const query = week === null ? '' : `?week=${week}`;
      const res = await fetch(`/api/cards/results${query}`);
      const body = (await res.json().catch(() => null)) as WeekResultsDto | null;
      if (res.ok && body) {
        setResults(body);
        setResultsWeek(body.week || null);
      }
    } finally {
      setResultsLoading(false);
    }
  }, []);

  // Fetched the first time the lineup tab is opened or the Season dialog is
  // and re-fetched when a new week is published — `revealedWeeks` growing is
  // what says that has happened.
  //
  // Opening the dialog re-reads with a null week, which is what makes it open
  // on the current week however deep into the season's back catalogue the last
  // visit wandered.
  const revealed = data?.weekly.revealedWeeks.length ?? 0;
  const wantsResults = tab === 'lineup' || seasonDialogOpen;
  useEffect(() => {
    // Same shape as the fetch-on-mount above, disabled for the same reason.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (wantsResults && revealed > 0) void loadResults(null);
  }, [wantsResults, revealed, loadResults]);

  const loading = status === 'loading' || (status === 'authenticated' && !settled);

  /** Spends a pack. The opener animates over this call. */
  const openPack = useCallback(async (): Promise<OpenPackResponse> => {
    const res = await fetch('/api/cards/open', { method: 'POST' });
    const body = (await res.json().catch(() => ({}))) as OpenPackResponse & { error?: string };
    if (!res.ok) throw new Error(body.error ?? 'Could not open that pack');
    return body;
  }, []);

  /**
   * Re-reads as soon as a pack is dealt.
   *
   * The response already carries the new allowance, but the collection totals
   * and duplicate counts live server-side, so a re-read is simpler than merging
   * the pull into local state and cannot drift from it.
   *
   * This runs when the wrapper comes off, not when the last card is turned.
   * The opener fires it that early on purpose: the cards are claimed by the
   * time the open request answers, so a member who closes the dialog partway
   * through the reveal owns them regardless — and the deck behind the dialog
   * has to say so rather than wait for a flip that is never coming.
   */
  const onPackDealt = useCallback(() => { void load(); }, [load]);

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

  /**
   * Freezes this week's lineup as a submission.
   *
   * Re-reads afterwards rather than patching state: the submission retires
   * nothing until Monday night, but it does change what the panel says about
   * itself, and the deck is the source of truth for that.
   */
  const submitLineup = useCallback(async () => {
    const res = await fetch('/api/cards/lineup', { method: 'POST' });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(body.error ?? 'Could not submit your lineup');
    await load();
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

  const { allowance, stats, cards, roster, standings, weekly, seasons } = data;
  const poolEmpty = allowance.poolSize === 0;

  // Resolved from the freshly-read deck rather than stored, so the panel shows
  // the saved card and not the copy that was selected before the write.
  const selected = cards.find((c) => c.id === selectedId) ?? null;

  // Counted here rather than returned by the collection route: the deck is
  // already in hand, and a card is finished exactly when it has both fields.
  const finished = cards.filter((c) => c.nickname && c.customImage).length;
  const rewardsRemaining = Math.max(0, MAX_CUSTOMIZATION_PACKS - finished);

  return (
    <Shell tab={tab} onTab={setTab}>
      {/* ── Packs ──────────────────────────────────────────────────────────
          Kept mounted rather than unmounted on a tab switch: the opener holds
          a torn pack and a half-turned reveal in local state, and looking
          something up in the deck mid-pack should not throw the pack away. */}
      <div style={{ display: tab === 'packs' ? undefined : 'none' }}>
        {/* ── This week's ration ──
            Draft Packs on a row of its own, above the pair.

            The three were one row of equal tiles, which said they were three
            statistics. They are not: two report the season and the pool, and
            the third is how you play — the sealed pack is behind it. It now
            gets the width and the size that says so, and the row under it is
            the two readouts, side by side on the smallest current iPhone
            without wrapping. */}
        <div className="flex justify-center mb-2 sm:mb-3">
          {/* The pack itself stays off-screen until this is tapped — see the
              dialog below. The card doubles as that button, so opening a pack
              starts from the same number that says how many you have. */}
          <button
            type="button"
            onClick={() => setPackDialogOpen(true)}
            disabled={poolEmpty}
            className="w-full max-w-[15rem] disabled:cursor-default"
            aria-haspopup="dialog"
          >
            <Stat label="Draft Packs" value={String(allowance.remaining)} accent center
                  hint={
                    // The ration is the tour's to explain. Spelling it out here
                    // — "2 a week", or "2 a week from week 2" before it starts
                    // — read as packs waiting to be opened, right under the
                    // number saying how many actually are. Starter packs stay,
                    // because those are a supply in hand rather than a rule.
                    allowance.starterRemaining > 0
                      ? `${allowance.starterRemaining} starter`
                      : undefined
                  } />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:gap-3 mb-6">
          {/* Same bargain as "Draft Packs": the tile that reports the season is
              the way into what the season is made of — every published week's
              reveal, newest first, in a dialog rather than a trip to the
              lineup tab. */}
          <button
            type="button"
            onClick={() => setSeasonDialogOpen(true)}
            className="text-left h-full"
            aria-haspopup="dialog"
          >
            <Stat label="Season" value={stats.seasonPoints.toFixed(1)}
                  hint={`${stats.started} of ${ROSTER_SIZE} started · wk ${weekly.week}`} />
          </button>
          {/* And the third: just the count. What it is out of, and who has
              taken the rest, is a tap away rather than an unreadable hint line
              under it — the tile is the question and the dialog is the
              answer. */}
          <button
            type="button"
            onClick={() => setCardsLeftDialogOpen(true)}
            className="text-left h-full"
            aria-haspopup="dialog"
          >
            <Stat label="Cards left" value={allowance.remainingCards.toLocaleString()} />
          </button>
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
            Tap <span style={{ color: '#80ff49' }}>Draft Packs</span> above to open one.
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
              onDealt={onPackDealt}
            />
          </CardsDialog>
        )}

        {/* ── The week's results, behind the Season tile ──
            The same panel the lineup tab draws, in its dialog variant. Wide
            enough for the run of played cards to be more than one per row on a
            laptop, which is the half of the reveal worth opening for. */}
        <CardsDialog
          open={seasonDialogOpen}
          onClose={() => setSeasonDialogOpen(false)}
          title="Draft Deck · Results"
          widthClassName="sm:max-w-2xl"
        >
          <WeekResults
            results={results}
            week={resultsWeek}
            onWeek={(w) => void loadResults(w)}
            loading={resultsLoading}
            variant="dialog"
          />
        </CardsDialog>

        {/* ── The pool, itemised, behind the Cards left tile ──
            The third tile's dialog, and the one that needs the least room:
            a headline count and a row per member at the default width. */}
        <CardsDialog
          open={cardsLeftDialogOpen}
          onClose={() => setCardsLeftDialogOpen(false)}
          title="Draft Deck · Cards Left"
        >
          <CardsLeftPanel
            remainingCards={allowance.remainingCards}
            poolSize={allowance.poolSize}
            claimed={allowance.claimed}
            members={allowance.members}
            entries={standings}
          />
        </CardsDialog>
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

      {/* Rendered alongside the grid rather than nested in the block up above,
          so switching tabs — which unmounts that block — also closes this:
          there is nothing here worth keeping open once you have navigated
          away, unlike a pack mid-reveal.

          Reachable from the lineup too, because the lineup's rows draw their
          cards as 46px chips: this is where the chip's tap goes, and the
          reason shrinking them costs nothing. */}
      {(tab === 'deck' || tab === 'lineup') && (
        <CardsDialog
          open={Boolean(selected)}
          onClose={() => setSelectedId(null)}
          title="Draft Deck · Card"
          widthClassName="sm:max-w-2xl"
          // The one dialog whose child sizes itself to the phone, so the one
          // that holds still instead of scrolling. A card is a fixed set of
          // controls — a name, a picture, the lineup — not a list that can
          // grow past the pane.
          fitViewport
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
            onSaved={() => setSelectedId(null)}
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

          {/* The deadline sits above the slots it applies to. A submit button
              under nine cards on a phone is a button nobody scrolls to. */}
          <div className="mb-4">
            <WeeklyPanel weekly={weekly} roster={roster} onSubmit={submitLineup} />
          </div>

          <div className="rounded p-4 mb-8" style={PANEL_BG}>
            <RosterPanel
              roster={roster}
              cards={cards}
              stats={stats}
              onAssign={assignSlot}
              busySlot={busySlot}
              onInspect={setSelectedId}
            />
          </div>

          {/* Tuesday morning's reveal, on the page it is about. */}
          <div className="mb-8">
            <WeekResults
              results={results}
              week={resultsWeek}
              onWeek={(w) => void loadResults(w)}
              loading={resultsLoading}
            />
          </div>

          {standings.length > 1 && <Standings entries={standings} />}
        </>
      )}
    </Shell>
  );
}

/**
 * Page chrome and the tab bar.
 *
 * The bar copies the league dashboard's: same button metrics, same 2px active
 * underline sitting on the container's own border — and, on a phone, the same
 * place. The tabs are what you come here to switch, so they sit at the very top
 * of the screen and stay there as the page scrolls, rather than under a title
 * and a back link that cost a phone its first screenful before the game starts.
 *
 * They were a dropdown on a phone, which hid two of three tabs behind a tap and
 * gave Packs, Deck and Lineup no presence at all. Three short labels fit across
 * the narrowest phone in use, so there is nothing to hide.
 *
 * Every state of the page renders inside this — loading, signed out, error —
 * so the header does not appear and disappear as the fetch settles. The bar
 * itself needs data-independent props only, which is why they are passed
 * rather than read from a context.
 */
function Shell({
  children, tab, onTab,
}: {
  children: React.ReactNode;
  tab?: Tab;
  onTab?: (t: Tab) => void;
}) {
  const tabbed = tab !== undefined && onTab !== undefined;

  // One definition for both bars, so the phone's tabs cannot drift from the
  // desktop's — the same arrangement the dashboard uses.
  const TabBtn = ({ id, label }: { id: Tab; label: string }) => (
    <button
      onClick={() => onTab?.(id)}
      className="px-4 py-2.5 text-sm font-medium transition-colors shrink-0 whitespace-nowrap"
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
    <div className="min-h-full" style={{ color: '#e8e6df' }}>
      {/* ── Tab bar — mobile ──
          Pinned to the top of `main`, which is the pane that scrolls — see the
          note in league/layout.tsx for why the shell around it has to be sized
          in `dvh` for that to hold still on a phone. */}
      {tabbed && (
        <div
          className="sm:hidden sticky top-0 z-30 border-b"
          style={{
            borderColor: '#1e1e20',
            background: 'rgba(14,14,15,0.95)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div className="flex items-stretch px-1">
            {TABS.map((t) => <TabBtn key={t.id} {...t} />)}
          </div>
        </div>
      )}

      <div className="px-4 py-6 sm:px-8 sm:py-8">
        <div className="max-w-5xl mx-auto">
          <div className="mb-6 sm:mb-8 flex items-start justify-between gap-4">
            <div>
              {/* Desktop only. A phone reaches the dashboard from the nav it
                  already has, and the link was sitting where the tabs now are —
                  the top of the screen, which on a phone is the whole budget. */}
              <Link
                href="/league/dashboard"
                className="hidden sm:block text-[10px] tracking-widest uppercase mb-2 transition-colors hover:text-[#e8e6df]"
                style={{ color: '#555' }}
              >
                ← Dashboard
              </Link>
              <h1 className="text-xl font-semibold">Draft Deck</h1>
              <p className="text-xs mt-1" style={{ color: '#555' }}>
                Build your deck. Win your legacy.
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

          {/* ── Tab bar — desktop ──
              A wide screen has room for the title above the tabs, so they stay
              where they were rather than following the phone's to the top. */}
          {tabbed && (
            <div
              className="hidden sm:flex items-stretch border-b mb-6"
              style={{ borderColor: '#1e1e20' }}
            >
              {TABS.map((t) => <TabBtn key={t.id} {...t} />)}
            </div>
          )}

          {children}
        </div>
      </div>

      {/* Rendered from the shell so the tour is available in every state of the
          page — loading, signed out and errored included. */}
      <DraftDeckIntro />
    </div>
  );
}

function Stat({
  label, value, hint, accent, center,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
  /**
   * The hero treatment: centered and a size up.
   *
   * Only Draft Packs wears it. It is the tile the game starts from — the pack
   * itself is behind it — and on a row of three identical tiles it read as one
   * statistic among three rather than as the button it is.
   */
  center?: boolean;
}) {
  return (
    <div
      className={`rounded min-w-0 h-full ${center ? 'p-3 sm:p-4 text-center' : 'p-2 sm:p-3'}`}
      style={{ background: '#0e0e0f', border: `1px solid ${center && accent ? 'rgba(128,255,73,0.28)' : '#1e1e20'}` }}
    >
      <div
        className="text-[8px] sm:text-[10px] uppercase mb-1 sm:mb-1.5 truncate"
        style={{ letterSpacing: '0.1em', color: '#444' }}
      >
        {label}
      </div>
      <div
        className={`font-bold truncate ${center ? 'text-2xl sm:text-3xl' : 'text-sm sm:text-lg'}`}
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
