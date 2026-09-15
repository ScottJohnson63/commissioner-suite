// src/lib/dbCache.ts
//
// A single expensive answer, cached in a `SleeperCache` row.
//
// For facts that cost a whole-table scan to compute and then stay true for a
// long time: the seasons the stat table holds, the size and tier split of the
// card pool. Turso bills row reads, and re-deriving one of these on every
// request is what emptied the database's read allowance — see the Turso
// footprint section of docs/CARDS.md.
//
// Why a row and not RouteCache: an in-process cache is defeated by serverless
// cold starts, which is the condition these scans were running under in the
// first place. A row is shared by every Function instance and survives every
// restart. An in-process memo sits in front of it so repeat calls within one
// process — and within one request — cost nothing at all.
//
// Three properties are worth stating plainly, because each one is a bug this
// class exists to not have:
//
//   * **Single-flighted.** Callers that arrive together on a cold cache share
//     one measurement. The collection route asks for the seasons and the pack
//     allowance in the same `Promise.all`, so without this a request would pay
//     for the scan twice — the exact cost being removed.
//
//   * **Invalidation cancels a measurement in flight.** A `measure()` that
//     started before a rebuild describes the pool that rebuild replaced.
//     Publishing it afterwards would pin stale facts for the whole maximum age,
//     across every instance. So each refresh carries the generation it began
//     under, and a refresh whose generation has moved returns its value to its
//     own caller without storing it anywhere.
//
//   * **A cache failure is never a read failure.** A row that cannot be read,
//     parsed or written is a cache miss by another name: the scans are slow,
//     not broken, and falling back to them is always correct. A malformed blob
//     must never be why a member cannot see a page.

import { prisma } from '@/lib/prisma';

/**
 * One cached answer, addressed by its `SleeperCache` key.
 *
 * @template T  The cached value. Must survive a JSON round-trip.
 */
export class DbCache<T> {
  private memo: { value: T; until: number } | null = null;
  private inFlight: Promise<T> | null = null;
  /** Bumped by every invalidation, so a refresh can tell it has been overtaken. */
  private generation = 0;

  /**
   * @param key       `SleeperCache.key` this answer is stored under.
   * @param maxAgeMs  How long a stored row is trusted.
   * @param measure   The expensive derivation, run only on a miss.
   * @param isValid   Guard against a blob written by an older shape of the code.
   */
  constructor(
    private readonly key: string,
    private readonly maxAgeMs: number,
    private readonly measure: () => Promise<T>,
    private readonly isValid: (value: unknown) => value is T,
  ) {}

  /** The value — from memory, then from the cache row, then by measuring. */
  async read(): Promise<T> {
    const now = Date.now();
    if (this.memo && now < this.memo.until) return this.memo.value;
    if (this.inFlight) return this.inFlight;

    // Captured before anything is awaited, so an invalidation arriving at any
    // point from here on is seen by the refresh below. Taking it later — inside
    // refresh() — leaves a window where the read has begun, the rebuild lands,
    // and the measurement then reads a half-written table under a generation it
    // believes is current.
    const pending = this.load(now, this.generation);
    this.inFlight = pending;
    try {
      return await pending;
    } finally {
      // Compared by identity: an invalidation during the read has already
      // cleared this, and a later reader may have started one of its own that
      // this call must not reach in and drop.
      if (this.inFlight === pending) this.inFlight = null;
    }
  }

  /** Row, then measurement. Separated from read() so the memo check stays flat. */
  private async load(now: number, startedAt: number): Promise<T> {
    try {
      const row = await prisma.sleeperCache.findUnique({ where: { key: this.key } });
      if (row) {
        const storedAt = new Date(row.fetchedAt).getTime();
        if (now - storedAt < this.maxAgeMs) {
          const parsed: unknown = JSON.parse(row.data);
          if (this.isValid(parsed)) {
            // Same guard as refresh(): this row was read before an invalidation
            // that has since deleted it, so memoising it would restore in this
            // process exactly what the invalidation removed.
            if (this.generation === startedAt) {
              this.memo = { value: parsed, until: storedAt + this.maxAgeMs };
            }
            return parsed;
          }
        }
      }
    } catch {
      // Unreadable or unparseable — a miss, and fall through to measuring.
    }
    return this.refresh(now, startedAt);
  }

  /**
   * Measures, and publishes only if it has not been overtaken.
   *
   * The value is returned to the caller either way. A refresh that raced a
   * rebuild still has an answer that was true when it was asked for; what it
   * must not do is write it down for everybody else.
   */
  private async refresh(now: number, startedAt: number): Promise<T> {
    const value = await this.measure();
    if (this.generation !== startedAt) return value;

    this.memo = { value, until: now + this.maxAgeMs };

    try {
      const data = JSON.stringify(value);
      await prisma.sleeperCache.upsert({
        where:  { key: this.key },
        update: { data, fetchedAt: new Date() },
        create: { key: this.key, data, fetchedAt: new Date() },
      });
    } catch {
      // A read must not fail because its cache could not be written. The memo
      // still spares the rest of this process.
    }

    return value;
  }

  /**
   * Drops the cached answer — the row, the memo, and any measurement in flight.
   *
   * Deletes the row rather than rewriting it, so the next reader measures and
   * only if there is one. Other instances are covered by the row being gone,
   * which is the reason this is a row rather than a RouteCache.
   */
  async invalidate(): Promise<void> {
    this.generation++;
    this.memo = null;
    this.inFlight = null;

    try {
      await prisma.sleeperCache.deleteMany({ where: { key: this.key } });
    } catch {
      // Non-fatal: maxAgeMs still expires it, and a rebuild that worked must not
      // be reported as failed because its cache eviction could not reach the DB.
    }
  }

  /** Empties the in-process state only. Exists for tests — see RouteCache.clearAll. */
  resetMemo(): void {
    this.memo = null;
    this.inFlight = null;
  }
}
