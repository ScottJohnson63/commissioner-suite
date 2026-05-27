// tests/app/api/news/route.test.ts
//
// GET /api/news?source=<key>
//
// Aggregates NFL headlines from up to four RSS feeds (ESPN, Yahoo, PFT, CBS).
// Each feed is cached independently for 15 minutes. A single ?source= filter
// can restrict the response to one feed.
//
// Mocks: global.fetch (RSS HTTP calls)
//
// Cache isolation: the module keeps a module-level Map<NewsSource, CacheEntry>.
// We reset modules in beforeEach so every test starts with an empty cache.

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// ── Helpers ───────────────────────────────────────────────────────────────────

let GET: (req: NextRequest) => Promise<Response>;
let mockFetch: jest.MockedFunction<typeof fetch>;

// Builds a minimal RSS <item> block with the supplied title.
function rssItem(title: string, pubDate = 'Mon, 01 Jan 2025 12:00:00 GMT'): string {
  return `<item>
    <title><![CDATA[${title}]]></title>
    <description><![CDATA[Description for ${title}]]></description>
    <link>https://example.com/${title.replace(/\s/g, '-')}</link>
    <pubDate>${pubDate}</pubDate>
  </item>`;
}

// Builds a minimal RSS document containing the given items.
function rssFeed(items: string[]): string {
  return `<?xml version="1.0"?><rss><channel>${items.join('')}</channel></rss>`;
}

function okRss(items: string[]): Response {
  return new Response(rssFeed(items), {
    status: 200,
    headers: { 'Content-Type': 'application/rss+xml' },
  });
}

function makeReq(params: Record<string, string> = {}): NextRequest {
  const qs = Object.keys(params).length ? `?${new URLSearchParams(params)}` : '';
  return new NextRequest(`http://localhost/api/news${qs}`);
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(async () => {
  // Reset modules so the module-level cache Map starts empty.
  jest.resetModules();

  // Re-import GET from the fresh module instance.
  const mod = await import('@/app/api/news/route');
  GET = mod.GET as typeof GET;

  // Install a fresh fetch spy on the new module context.
  mockFetch = jest.spyOn(global, 'fetch') as jest.MockedFunction<typeof fetch>;
});

afterEach(() => {
  mockFetch.mockRestore();
  jest.resetModules();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/news', () => {

  // WHY: An unrecognised ?source= value maps to an empty FEEDS slice — the route
  //      treats this as a bad request rather than returning an empty array.
  it('returns 400 for an unknown source filter', async () => {
    const res = await GET(makeReq({ source: 'garbage' }));
    expect(res.status).toBe(400);
  });

  // WHY: With no source filter, all four feeds are fetched concurrently. Each
  //      must be called once. The combined response is capped at 40 articles.
  // WHY: ok() returns the articles array directly (no { data: ... } wrapper).
  // NOTE: mockImplementation (not mockResolvedValue) is required here because a
  //       Response body stream can only be consumed once. mockResolvedValue would
  //       hand the same Response instance to all 4 concurrent fetches — the 2nd-4th
  //       calls see an already-consumed stream and silently return 0 articles.
  it('fetches all four feeds when no source filter is provided', async () => {
    // Four feeds × one article each — fresh Response per call avoids stream re-use.
    mockFetch.mockImplementation(() => Promise.resolve(okRss([rssItem('Headline 1')])));

    const res = await GET(makeReq());
    const json = await res.json() as { source: string }[];

    expect(res.status).toBe(200);
    // Four calls — one per feed.
    expect(mockFetch).toHaveBeenCalledTimes(4);
    // Each of the four sources appears exactly once.
    const sources = new Set(json.map((a) => a.source));
    expect(sources.size).toBe(4);
  });

  // WHY: ?source=espn must restrict fetching to the ESPN feed only — not all four.
  //      One fetch call is the proof that the filter worked.
  it('fetches only the requested source when source filter is provided', async () => {
    mockFetch.mockResolvedValueOnce(okRss([rssItem('ESPN Story')]));

    const res = await GET(makeReq({ source: 'espn' }));
    const json = await res.json() as { source: string }[];

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(json.every((a) => a.source === 'espn')).toBe(true);
  });

  // WHY: RSS items are returned with the correct shape. The route parses title,
  //      description, link, pubDate, and source from the raw XML.
  it('returns articles with the expected shape', async () => {
    mockFetch.mockResolvedValueOnce(okRss([rssItem('Test Headline')]));

    const res = await GET(makeReq({ source: 'espn' }));
    const json = await res.json() as { title: string; description: string; source: string; sourceLabel: string }[];

    expect(json[0]).toMatchObject({
      title: 'Test Headline',
      source: 'espn',
      sourceLabel: 'ESPN',
    });
    expect(typeof json[0].description).toBe('string');
  });

  // WHY: When one feed's HTTP request fails (non-ok status), the route should
  //      return empty results for that feed rather than a 500. Other feeds
  //      are unaffected — partial results are better than no results.
  it('returns empty results for a feed that fails', async () => {
    // ESPN: error; Yahoo, PFT, CBS: success
    mockFetch
      .mockResolvedValueOnce(new Response('error', { status: 500 }))
      .mockResolvedValue(okRss([rssItem('Non-ESPN Story')]));

    const res = await GET(makeReq());
    const json = await res.json() as { source: string }[];

    expect(res.status).toBe(200);
    // ESPN produced no articles.
    expect(json.every((a) => a.source !== 'espn')).toBe(true);
    // Other three feeds contributed articles.
    expect(json.length).toBeGreaterThan(0);
  });

  // WHY: Results across feeds are sorted newest-first by pubDate before being
  //      capped at 40. The most-recent article must appear first.
  it('sorts articles newest-first across feeds', async () => {
    const older = rssItem('Old Story',   'Mon, 01 Jan 2024 12:00:00 GMT');
    const newer = rssItem('New Story',   'Mon, 01 Jan 2025 12:00:00 GMT');
    // Only request ESPN to keep it simple.
    mockFetch.mockResolvedValueOnce(okRss([older, newer]));

    const res = await GET(makeReq({ source: 'espn' }));
    const json = await res.json() as { title: string }[];

    expect(json[0].title).toBe('New Story');
    expect(json[1].title).toBe('Old Story');
  });

  // WHY: When the same endpoint is called twice within the TTL, the second call
  //      must return cached data without calling fetch again.
  it('serves from cache on the second call within TTL', async () => {
    mockFetch.mockResolvedValue(okRss([rssItem('Cached Story')]));

    // First request — populates cache
    await GET(makeReq({ source: 'espn' }));
    // Second request — should hit cache
    await GET(makeReq({ source: 'espn' }));

    // fetch is called once total (cache hit on the second call).
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
