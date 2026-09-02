// src/lib/cards/eligibility.ts
//
// Who is allowed to play, expressed as a Prisma predicate.
//
// The card game's roster of players is not a list it keeps — it is whoever the
// league already considers a member. The members page is the canonical view of
// that, and it is drawn from /api/users, which excludes the seeded superuser by
// username. Ranking the superuser alongside real members put a house account at
// the top of a table nobody else could beat.
//
// This lives in its own module so the standings and the "N playing" count share
// one definition. They were written apart and drifted apart: the table filtered
// nothing and the count filtered nothing, so both agreed — wrongly — and fixing
// only one of them would have made the page contradict itself.
//
// Kept deliberately in sync with the members-page query in
// src/app/api/users/route.ts. If eligibility ever grows past "not the admin"
// — a role filter, a league-membership join — both should start calling this.

/** The account the seed creates and the members page hides. */
export function adminUsername(): string {
  return process.env.ADMIN_USERNAME ?? 'admin';
}

/**
 * A `where` clause selecting every user the members page would show.
 *
 * Read from the environment on each call rather than captured at module load:
 * the value is per-deployment, and a module-level constant would freeze
 * whatever was set the first time this file was imported — which in tests is
 * before the case has set it.
 */
export function eligiblePlayerWhere(): { NOT: { username: string } } {
  return { NOT: { username: adminUsername() } };
}
