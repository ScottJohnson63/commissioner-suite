// tests/app/api/authIntent.test.ts
//
// Every API route states who may call each of its methods, and this test is
// what makes that statement binding.
//
// `src/proxy.ts` excludes /api from its matcher, so there is no middleware
// layer to fall back on: a route either guards itself or it is open to the
// internet. A route file is therefore only allowed to exist if (a) the
// inventory below names it, (b) every method it exports carries an `AUTH:`
// marker, and (c) the marker agrees with what the handler body actually does.
//
// The marker grammar, which lives in the header comment block of every route:
//
//   // AUTH: <METHOD>[,<METHOD>] <posture> [— reason]
//
// Postures:
//
//   public        no guard. Reason required — say why it is safe to serve
//                 this to a signed-out visitor.
//   session       any signed-in account, any role — requireSession().
//   user          signed in, and the handler needs the caller's id —
//                 requireUser().
//   member        MEMBER or COMMISSIONER — requireMember().
//   commissioner  COMMISSIONER only — requireCommissioner().
//   inline        the handler gates itself, because it needs the session for
//                 more than a yes/no. Reason required; the body is not
//                 checked mechanically.
//
// Routes are read from disk rather than imported: importing one pulls in
// Prisma and the NextAuth ESM stack, and the question being asked here is
// about the source text, not the runtime.
//
// What this does not catch, stated plainly because it is text analysis and not
// a type system: a guard moved into a helper the handler calls reads as
// missing; an `inline` marker that lies is not detected; and an unreachable
// guard (`if (false) { … }`) passes. INVENTORY is the real gate — a change to
// any posture has to show up in this file's diff — and the point is that a new
// route cannot land silently.

import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync } from 'fs';
import { join, resolve, sep } from 'path';

const API_ROOT = resolve(__dirname, '../../../src/app/api');

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

const POSTURES = ['public', 'session', 'user', 'member', 'commissioner', 'inline'] as const;
type Posture = (typeof POSTURES)[number];

/** The guard call that backs each mechanically-checkable posture. */
const GUARD_FOR: Partial<Record<Posture, string>> = {
  session:      'requireSession',
  user:         'requireUser',
  member:       'requireMember',
  commissioner: 'requireCommissioner',
};

/**
 * A stricter guard satisfies a looser marker, so no route has to over-declare.
 * Keyed by marker posture, valued by the guards that count as enforcing it.
 */
const ACCEPTED_GUARDS: Partial<Record<Posture, string[]>> = {
  session:      ['requireSession', 'requireUser', 'requireMember', 'requireCommissioner'],
  user:         ['requireUser'],
  member:       ['requireMember', 'requireCommissioner'],
  commissioner: ['requireCommissioner'],
};

/**
 * The expected shape of the whole API surface, checked in so that a new route —
 * or a loosened posture on an existing one — cannot happen without the change
 * showing up in this file's diff. Keys are paths relative to src/app/api.
 */
const INVENTORY: Record<string, Partial<Record<HttpMethod, Posture>>> = {
  'agent/route.ts':                        { GET: 'inline', POST: 'inline' },
  'assoc/divisions/route.ts':              { POST: 'commissioner' },
  'assoc/draft-order/route.ts':            { POST: 'commissioner' },
  'assoc/lottery-log/route.ts':            { POST: 'commissioner' },
  'assoc/standings/route.ts':              { GET: 'member' },
  'audit/route.ts':                        { GET: 'session' },
  'auth/[...nextauth]/route.ts':           { GET: 'inline', POST: 'inline' },
  'auth/connect-sleeper/route.ts':         { POST: 'inline' },
  'cards/collection/route.ts':             { GET: 'user' },
  'cards/image/route.ts':                  { GET: 'user', POST: 'user' },
  'cards/leaderboard/route.ts':            { GET: 'user' },
  'cards/lineup/route.ts':                 { POST: 'user' },
  'cards/open/route.ts':                   { POST: 'user' },
  'cards/pool/route.ts':                   { GET: 'user', POST: 'commissioner' },
  'cards/reset/route.ts':                  { POST: 'commissioner' },
  'cards/results/route.ts':                { GET: 'user' },
  'cards/roster/route.ts':                 { PUT: 'user' },
  'cards/wildcard/route.ts':               { POST: 'user' },
  'errors/route.ts':                       { GET: 'commissioner', POST: 'public' },
  'leagues/[id]/route.ts':                 { DELETE: 'commissioner' },
  'leagues/[id]/schedule/export/route.ts': { GET: 'member' },
  'leagues/[id]/schedule/route.ts':        { GET: 'member', POST: 'commissioner', DELETE: 'commissioner' },
  'leagues/route.ts':                      { GET: 'session', POST: 'commissioner' },
  'leagues/sync/route.ts':                 { POST: 'commissioner' },
  'matchups/[id]/route.ts':                { PATCH: 'commissioner' },
  'news/route.ts':                         { GET: 'public' },
  'nfl/[...path]/route.ts':                { GET: 'public' },
  'sleeper/league-teams/route.ts':         { GET: 'member' },
  'sleeper/matchup-report/route.ts':       { GET: 'session' },
  'sleeper/matchups/route.ts':             { GET: 'session' },
  'sleeper/trade-suggestions/route.ts':    { GET: 'session' },
  'sleeper/user/route.ts':                 { GET: 'session' },
  'sleeper/waiver-suggestions/route.ts':   { GET: 'session' },
  'sync/run/route.ts':                     { POST: 'commissioner' },
  'sync/status/route.ts':                  { GET: 'inline' },
  'trending/route.ts':                     { GET: 'public' },
  'users/[id]/route.ts':                   { PATCH: 'inline' },
  'users/route.ts':                        { GET: 'session' },
};

// ── Reading the routes ────────────────────────────────────────────────────────

function isHttpMethod(name: string): name is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(name);
}

function isPosture(name: string): name is Posture {
  return (POSTURES as readonly string[]).includes(name);
}

/** Every route.ts under src/app/api, as paths relative to API_ROOT. */
function listRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listRouteFiles(full));
    else if (entry.name === 'route.ts') {
      out.push(full.slice(API_ROOT.length + 1).split(sep).join('/'));
    }
  }
  return out.sort();
}

const ROUTE_FILES = listRouteFiles(API_ROOT);

function read(file: string): string[] {
  return readFileSync(join(API_ROOT, file.split('/').join(sep)), 'utf8').split('\n');
}

/**
 * Which HTTP methods a route file exports, and the line each one starts on.
 *
 * A line of null means the method is re-exported rather than defined here
 * (`export const { GET, POST } = handlers`), so there is no body to inspect.
 *
 * Anchoring on the fixed set of Next.js method names is what keeps the other
 * exports out — `export function clearBaselineCache()` in the matchup report,
 * `export const maxDuration = 60` in the agent.
 */
function discoverMethods(lines: string[]): Map<HttpMethod, number | null> {
  const found = new Map<HttpMethod, number | null>();

  lines.forEach((text, index) => {
    const fn = /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(text);
    if (fn && isHttpMethod(fn[1])) {
      if (!found.has(fn[1])) found.set(fn[1], index);
      return;
    }
    const assigned = /^export\s+const\s+([A-Za-z_$][\w$]*)\s*[:=]/.exec(text);
    if (assigned && isHttpMethod(assigned[1])) {
      if (!found.has(assigned[1])) found.set(assigned[1], index);
      return;
    }
    const destructured = /^export\s+const\s*\{([^}]+)\}\s*=/.exec(text);
    if (destructured) {
      for (const part of destructured[1].split(',')) {
        const name = part.split(':')[0].trim();
        if (isHttpMethod(name) && !found.has(name)) found.set(name, null);
      }
    }
  });

  return found;
}

/**
 * One handler's source, from its declaration to the first following line whose
 * first character is `}`.
 *
 * Per-method rather than whole-file, because several routes mix postures:
 * matching the whole file would pass cards/pool's commissioner-only POST on the
 * strength of the requireUser() in its GET, which is exactly the case this test
 * exists to catch. Handlers here are top-level and their closing brace is
 * unindented, so this is an exact body slice. It is also the safe direction to
 * be wrong in — every guard in this codebase is the first statement of its
 * handler, so a slice cut short still contains it.
 */
function sliceHandler(lines: string[], start: number): string {
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('}')) return lines.slice(start, i + 1).join('\n');
  }
  return lines.slice(start).join('\n');
}

/**
 * Whether a handler body really enforces `posture`.
 *
 * The signal is a pair — the guard call AND the rejection it returns — never
 * the guard name alone. Both apiAuth shapes are accepted:
 *
 *   const denied = await requireSession(); if (denied) return denied;
 *   const guard  = await requireUser();    if (guard.denied) return guard.denied;
 */
function enforces(body: string, posture: Posture): boolean {
  const returnsDenial = /return\s+(?:[A-Za-z_$][\w$]*\.)?denied\b/.test(body);
  if (!returnsDenial) return false;
  return (ACCEPTED_GUARDS[posture] ?? []).some((fn) =>
    new RegExp(`\\b${fn}\\s*\\(`).test(body),
  );
}

/** Whether a body calls any apiAuth guard at all — used to police `public`. */
function callsAnyGuard(body: string): string | null {
  const match = /\brequire(?:Session|User|Member|Commissioner)\s*\(/.exec(body);
  return match ? match[0].replace(/\s*\($/, '') : null;
}

// ── Reading the markers ───────────────────────────────────────────────────────

interface Marker {
  methods: HttpMethod[];
  posture: Posture;
  reason:  string | null;
  line:    number;
}

const MARKER_RE = /^\/\/\s*AUTH:\s+([A-Z][A-Z,\s]*?)\s+([a-z]+)\s*(?:[—–-]+\s*(\S.*?))?\s*$/;

/** Index of the first line that is neither blank nor part of a comment. */
function headerEnd(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim();
    if (text === '' || text.startsWith('//') || text.startsWith('/*') || text.startsWith('*')) continue;
    return i;
  }
  return lines.length;
}

function parseMarkers(lines: string[]): { markers: Marker[]; problems: string[] } {
  const markers: Marker[] = [];
  const problems: string[] = [];
  const limit = headerEnd(lines);

  lines.forEach((text, index) => {
    if (!/^\s*\/\/\s*AUTH:/.test(text)) return;

    if (index >= limit) {
      problems.push(
        `line ${index + 1}: an AUTH marker belongs in the file's header comment block, above the imports.`,
      );
      return;
    }

    const match = MARKER_RE.exec(text.trim());
    if (!match) {
      problems.push(
        `line ${index + 1}: cannot parse ${JSON.stringify(text.trim())}. ` +
          'Expected "// AUTH: <METHOD>[,<METHOD>] <posture> [— reason]".',
      );
      return;
    }

    const [, rawMethods, rawPosture, reason] = match;
    const methods: HttpMethod[] = [];
    for (const name of rawMethods.split(',').map((m) => m.trim()).filter(Boolean)) {
      if (isHttpMethod(name)) methods.push(name);
      else problems.push(`line ${index + 1}: "${name}" is not an HTTP method.`);
    }
    if (!isPosture(rawPosture)) {
      problems.push(
        `line ${index + 1}: unknown posture "${rawPosture}". One of: ${POSTURES.join(', ')}.`,
      );
      return;
    }

    markers.push({ methods, posture: rawPosture, reason: reason ?? null, line: index + 1 });
  });

  return { markers, problems };
}

// ── The audit ─────────────────────────────────────────────────────────────────

/** Everything wrong with one route file, each phrased as something to go and do. */
function auditFile(file: string): string[] {
  const lines = read(file);
  const exported = discoverMethods(lines);
  const { markers, problems } = parseMarkers(lines);
  const expected = INVENTORY[file] ?? {};

  const declared = new Map<HttpMethod, Marker>();
  for (const marker of markers) {
    for (const method of marker.methods) {
      if (declared.has(method)) {
        problems.push(`line ${marker.line}: ${method} already has an AUTH marker above.`);
        continue;
      }
      declared.set(method, marker);
    }
  }

  // A marker for a method that is not exported is a leftover from a deleted
  // handler, and a misleading thing to leave in a security header.
  for (const [method, marker] of declared) {
    if (!exported.has(method)) {
      problems.push(
        `line ${marker.line}: the marker declares ${method}, but this file exports no ${method} ` +
          'handler. Delete the marker, or restore the handler.',
      );
    }
  }

  for (const [method, start] of exported) {
    const marker = declared.get(method);
    if (!marker) {
      problems.push(
        `${method} is exported but declares no auth intent. Add ` +
          `"// AUTH: ${method} ${expected[method] ?? '<posture>'}" to the file's header comment ` +
          `(postures: ${POSTURES.join(', ')}).`,
      );
      continue;
    }

    if (expected[method] && expected[method] !== marker.posture) {
      problems.push(
        `${method} is marked "${marker.posture}" but INVENTORY in authIntent.test.ts says ` +
          `"${expected[method]}". If the change is deliberate, change both; if not, restore the guard.`,
      );
    }

    if (marker.posture === 'public' || marker.posture === 'inline') {
      if (!marker.reason) {
        problems.push(
          `${method} is marked "${marker.posture}" with no reason. Write ` +
            `"// AUTH: ${method} ${marker.posture} — <why>" — a route that opts out of the shared ` +
            'guards owes the next reader an explanation.',
        );
      }
    }

    if (marker.posture === 'inline') continue;

    if (start === null) {
      problems.push(
        `${method} is re-exported rather than defined here, so its body cannot be checked. ` +
          'Use the "inline" posture, or define the handler in this file.',
      );
      continue;
    }

    const body = sliceHandler(lines, start);

    if (marker.posture === 'public') {
      const guard = callsAnyGuard(body);
      if (guard) {
        problems.push(
          `${method} is marked "public" but its body calls ${guard}(). Change the marker to the ` +
            'posture that guard enforces.',
        );
      }
      continue;
    }

    if (!enforces(body, marker.posture)) {
      problems.push(
        `${method} is marked "${marker.posture}" but its body shows no guard enforcing it. Add as ` +
          `the first statement of ${method}: const denied = await ${GUARD_FOR[marker.posture]}(); ` +
          'if (denied) return denied; — or, if the method really is open, change the marker to ' +
          '"public — <reason>".',
      );
    }
  }

  return problems;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('API auth intent', () => {
  it('has an inventory entry for every route file, and a route file for every entry', () => {
    const onDisk = new Set(ROUTE_FILES);
    const listed = new Set(Object.keys(INVENTORY));

    expect({
      // A new route has to be added to INVENTORY above, with the posture of
      // every method it exports. That edit is the review hook.
      routeFilesMissingFromInventory: ROUTE_FILES.filter((f) => !listed.has(f)),
      // An entry with no file behind it: the route moved or was deleted.
      inventoryEntriesWithNoRouteFile: [...listed].filter((f) => !onDisk.has(f)),
    }).toEqual({ routeFilesMissingFromInventory: [], inventoryEntriesWithNoRouteFile: [] });
  });

  it('exports exactly the methods the inventory expects', () => {
    const mismatches: string[] = [];
    for (const file of ROUTE_FILES) {
      const expected = Object.keys(INVENTORY[file] ?? {}).sort();
      const actual = [...discoverMethods(read(file)).keys()].sort();
      if (expected.join(',') !== actual.join(',')) {
        mismatches.push(
          `${file}: exports [${actual.join(', ')}] but INVENTORY lists [${expected.join(', ')}]. ` +
            'Add the new method to INVENTORY with its posture, and give it an AUTH marker.',
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it.each(ROUTE_FILES)('%s declares and enforces auth intent for every method', (file) => {
    expect(auditFile(file)).toEqual([]);
  });
});
