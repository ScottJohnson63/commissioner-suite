// src/lib/publicError.ts
//
// A marker for errors whose message is written for the person who will read it.
//
// `fail()` in lib/api.ts drops a thrown message by default, because the usual
// thrown message is written for whoever is debugging and can name tables,
// columns, file paths and third-party services. That default is right for the
// accident — a null dereference, a Prisma constraint, a database refusing
// queries — and wrong for the deliberate: "Expected 10 teams, got 9" is not a
// leak, it is the answer, and a commissioner who sees "Generation failed"
// instead has been told nothing they can act on.
//
// So exposure is opt-in and carried by the type rather than by the call site. A
// domain error that means to be read extends this; everything else is an
// accident and is summarised. The one rule for a subclass: the message must be
// worth saying to a stranger, since that is who might see it.
//
// Deliberately importing nothing. Both lib/api.ts (which pulls in next/server)
// and lib/scheduler/types.ts (which is reachable from client code) need it.

/** An error whose `message` is safe and intended to be shown to the caller. */
export class PublicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicError';
  }
}
