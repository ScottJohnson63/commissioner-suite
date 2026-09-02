// tests/app/api/news/route.test.ts
//
// GET /api/news?source=<key>
//
// Aggregates NFL headlines from four sources: Yahoo, PFT and CBS are RSS feeds;
// ESPN is a JSON site API (its RSS feed carries no imagery). Each feed is cached
// independently for 15 minutes. A single ?source= filter can restrict the
// response to one feed.
//
// Mocks: global.fetch (RSS + JSON HTTP calls)
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

// Builds an <item> whose only image is an <img> inside <content:encoded> —
// this is the shape Yahoo publishes (no media:* or <enclosure> tags at all).
function yahooItem(title: string, imgUrl: string): string {
  return `<item>
    <title><![CDATA[${title}]]></title>
    <description><![CDATA[Description for ${title}]]></description>
    <link>https://example.com/${title.replace(/\s/g, '-')}</link>
    <pubDate>Mon, 01 Jan 2025 12:00:00 GMT</pubDate>
    <content:encoded><![CDATA[<figure><img alt="" src="${imgUrl}"><figcaption>x</figcaption></figure><p>Body</p>]]></content:encoded>
  </item>`;
}

// One article in the shape ESPN's site API returns.
function espnArticle(
  headline: string,
  images: { url: string; type?: string }[],
  published = '2025-01-01T12:00:00Z',
) {
  return {
    headline,
    description: `Description for ${headline}`,
    published,
    images,
    links: { web: { href: `https://espn.com/${headline.replace(/\s/g, '-')}` } },
  };
}

function okEspn(articles: ReturnType<typeof espnArticle>[]): Response {
  return new Response(JSON.stringify({ articles }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Routes each mocked fetch by URL: the ESPN host gets JSON, everything else RSS.
function routeByUrl(
  espn: () => Response,
  rss: () => Response,
): (input: unknown) => Promise<Response> {
  return (input: unknown) => {
    const url = typeof input === 'string' ? input : String((input as Request).url);
    return Promise.resolve(url.includes('espn.com') ? espn() : rss());
  };
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
    // ESPN is a JSON API, the other three are RSS, so the mock routes by URL.
    mockFetch.mockImplementation(routeByUrl(
      () => okEspn([espnArticle('ESPN Story', [])]),
      () => okRss([rssItem('Headline 1')]),
    ) as typeof fetch);

    const res = await GET(makeReq());
    const json = await res.json() as { source: string }[];

    expect(res.status).toBe(200);
    // Four calls — one per feed.
    expect(mockFetch).toHaveBeenCalledTimes(4);
    // Each of the four sources appears exactly once.
    const sources = new Set(json.map((a) => a.source));
    expect(sources.size).toBe(4);
  });

  // WHY: ?source=cbs must restrict fetching to the CBS feed only — not all four.
  //      One fetch call is the proof that the filter worked.
  it('fetches only the requested source when source filter is provided', async () => {
    mockFetch.mockResolvedValueOnce(okRss([rssItem('CBS Story')]));

    const res = await GET(makeReq({ source: 'cbs' }));
    const json = await res.json() as { source: string }[];

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(json.every((a) => a.source === 'cbs')).toBe(true);
  });

  // WHY: RSS items are returned with the correct shape. The route parses title,
  //      description, link, pubDate, and source from the raw XML.
  it('returns articles with the expected shape', async () => {
    mockFetch.mockResolvedValueOnce(okRss([rssItem('Test Headline')]));

    const res = await GET(makeReq({ source: 'cbs' }));
    const json = await res.json() as { title: string; description: string; source: string; sourceLabel: string }[];

    expect(json[0]).toMatchObject({
      title: 'Test Headline',
      source: 'cbs',
      sourceLabel: 'CBS Sports',
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
    // Only request CBS to keep it simple.
    mockFetch.mockResolvedValueOnce(okRss([older, newer]));

    const res = await GET(makeReq({ source: 'cbs' }));
    const json = await res.json() as { title: string }[];

    expect(json[0].title).toBe('New Story');
    expect(json[1].title).toBe('Old Story');
  });

  // WHY: When the same endpoint is called twice within the TTL, the second call
  //      must return cached data without calling fetch again.
  it('serves from cache on the second call within TTL', async () => {
    mockFetch.mockResolvedValue(okRss([rssItem('Cached Story')]));

    // First request — populates cache
    await GET(makeReq({ source: 'cbs' }));
    // Second request — should hit cache
    await GET(makeReq({ source: 'cbs' }));

    // fetch is called once total (cache hit on the second call).
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  // ── Image extraction ──────────────────────────────────────────────────────

  // WHY: Yahoo emits no media:content, media:thumbnail or enclosure tags — the
  //      lead image is an <img> buried in the <content:encoded> HTML. Without
  //      the <img src> fallback every Yahoo article renders with no thumbnail.
  it('extracts a Yahoo image from the <img> inside content:encoded', async () => {
    const img = 'https://media.zenfs.com/en/example/lead.jpg';
    mockFetch.mockResolvedValueOnce(okRss([yahooItem('Yahoo Story', img)]));

    const res = await GET(makeReq({ source: 'yahoo' }));
    const json = await res.json() as { imageUrl: string | null }[];

    expect(json[0].imageUrl).toBe(img);
  });

  // WHY: The <img> fallback is last in the chain — a feed that provides a proper
  //      media:content tag must still win, so richer feed metadata is preferred
  //      over whatever image happens to appear first in the article body.
  it('prefers media:content over an inline <img>', async () => {
    const item = `<item>
      <title><![CDATA[Both]]></title>
      <media:content url="https://cdn.example.com/preferred.jpg" type="image/jpeg" />
      <description><![CDATA[<img src="https://cdn.example.com/body.jpg">]]></description>
      <pubDate>Mon, 01 Jan 2025 12:00:00 GMT</pubDate>
    </item>`;
    mockFetch.mockResolvedValueOnce(okRss([item]));

    const res = await GET(makeReq({ source: 'pft' }));
    const json = await res.json() as { imageUrl: string | null }[];

    expect(json[0].imageUrl).toBe('https://cdn.example.com/preferred.jpg');
  });

  // WHY: An RSS item with no image of any kind must yield null rather than an
  //      empty string — NewsTab renders the thumbnail conditionally on it.
  it('returns a null imageUrl when an item has no image at all', async () => {
    mockFetch.mockResolvedValueOnce(okRss([rssItem('Plain Story')]));

    const res = await GET(makeReq({ source: 'cbs' }));
    const json = await res.json() as { imageUrl: string | null }[];

    expect(json[0].imageUrl).toBeNull();
  });

  // ── ESPN JSON source ──────────────────────────────────────────────────────

  // WHY: ESPN is parsed from JSON, not RSS. Headline, description, web link and
  //      ISO published date all come from different fields than the RSS path.
  it('maps ESPN JSON articles into the shared article shape', async () => {
    mockFetch.mockResolvedValueOnce(okEspn([
      espnArticle('ESPN Headline', [
        { url: 'https://a.espncdn.com/photo/header.jpg', type: 'header' },
      ]),
    ]));

    const res = await GET(makeReq({ source: 'espn' }));
    const json = await res.json() as {
      title: string; link: string; pubDate: string; imageUrl: string | null;
      source: string; sourceLabel: string;
    }[];

    expect(json[0]).toMatchObject({
      title: 'ESPN Headline',
      link: 'https://espn.com/ESPN-Headline',
      pubDate: '2025-01-01T12:00:00Z',
      imageUrl: 'https://a.espncdn.com/photo/header.jpg',
      source: 'espn',
      sourceLabel: 'ESPN',
    });
  });

  // WHY: ESPN lists images in mixed order and video entries carry no `header`
  //      image at all — the header type must win when present, and the first
  //      available image must be used when it is not.
  it('prefers the ESPN header image but falls back to the first image', async () => {
    mockFetch.mockResolvedValueOnce(okEspn([
      espnArticle('Story', [
        { url: 'https://a.espncdn.com/media-still.jpg', type: 'Media' },
        { url: 'https://a.espncdn.com/the-header.jpg', type: 'header' },
      ]),
      espnArticle('Video', [
        { url: 'https://a.espncdn.com/only-still.jpg', type: 'Media' },
      ]),
    ]));

    const res = await GET(makeReq({ source: 'espn' }));
    const json = await res.json() as { title: string; imageUrl: string | null }[];

    const byTitle = Object.fromEntries(json.map((a) => [a.title, a.imageUrl]));
    expect(byTitle['Story']).toBe('https://a.espncdn.com/the-header.jpg');
    expect(byTitle['Video']).toBe('https://a.espncdn.com/only-still.jpg');
  });

  // WHY: An ESPN article with an empty images array must yield null, not crash
  //      on the undefined lookup.
  it('returns a null imageUrl for an ESPN article with no images', async () => {
    mockFetch.mockResolvedValueOnce(okEspn([espnArticle('Imageless', [])]));

    const res = await GET(makeReq({ source: 'espn' }));
    const json = await res.json() as { imageUrl: string | null }[];

    expect(json[0].imageUrl).toBeNull();
  });
});
