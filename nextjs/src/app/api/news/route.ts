// src/app/api/news/route.ts
//
// Aggregates NFL headlines from multiple public RSS feeds.
// Each feed is cached independently for 15 minutes.

import { NextRequest, NextResponse } from 'next/server';
import { ok, err } from '@/lib/api';

export type NewsSource = 'espn' | 'yahoo' | 'pft' | 'cbs';

export interface NewsArticle {
  title: string;
  description: string;
  link: string;
  pubDate: string;
  imageUrl: string | null;
  source: NewsSource;
  sourceLabel: string;
}

// ── Feed definitions ──────────────────────────────────────────────────────────

const FEEDS: { key: NewsSource; label: string; url: string }[] = [
  {
    key: 'espn',
    label: 'ESPN',
    url: 'https://www.espn.com/espn/rss/nfl/news',
  },
  {
    key: 'yahoo',
    label: 'Yahoo Sports',
    url: 'https://sports.yahoo.com/nfl/rss.xml',
  },
  {
    key: 'pft',
    label: 'Pro Football Talk',
    url: 'https://www.nbcsports.com/profootballtalk.rss',
  },
  {
    key: 'cbs',
    label: 'CBS Sports',
    url: 'https://www.cbssports.com/rss/headlines/nfl/',
  },
];

const TTL = 15 * 60 * 1000; // 15 min

// ── In-process cache per source ───────────────────────────────────────────────

interface CacheEntry {
  articles: NewsArticle[];
  ts: number;
}

const cache = new Map<NewsSource, CacheEntry>();

// ── XML helpers ───────────────────────────────────────────────────────────────

/**
 * Extracts the text content of the first matching XML tag.
 * Handles both CDATA-wrapped content (`<tag><![CDATA[...]]></tag>`) and
 * plain text content (`<tag>...</tag>`). Returns an empty string when not found.
 */
function extractTag(xml: string, tag: string): string {
  const m =
    xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i')) ??
    xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

/**
 * Extracts the value of `attr` from the first occurrence of `tag` in `xml`.
 * Returns null if the tag or attribute is not found.
 * Used to pull image URLs from `<media:content url="...">` and `<enclosure>` tags.
 */
function extractAttr(xml: string, tag: string, attr: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]+${attr}=["']([^"']+)["']`, 'i'));
  return m ? m[1] : null;
}

// Named HTML entities commonly seen in RSS feeds
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: ' ', copy: '©', reg: '®', trade: '™',
  mdash: '—', ndash: '–', hellip: '…', bull: '•',
  lsquo: '‘', rsquo: '’', sbquo: '‚',
  ldquo: '“', rdquo: '”', bdquo: '„',
  laquo: '«', raquo: '»',
  eacute: 'é', Eacute: 'É', egrave: 'è', Egrave: 'È',
  ecirc: 'ê',  Ecirc: 'Ê',  euml: 'ë',  Euml: 'Ë',
  agrave: 'à', Agrave: 'À', aacute: 'á', Aacute: 'Á',
  acirc: 'â',  Acirc: 'Â',  atilde: 'ã', Atilde: 'Ã',
  auml: 'ä',   Auml: 'Ä',   aring: 'å',  Aring: 'Å',
  oacute: 'ó', Oacute: 'Ó', ograve: 'ò', Ograve: 'Ò',
  ocirc: 'ô',  Ocirc: 'Ô',  otilde: 'õ', Otilde: 'Õ',
  ouml: 'ö',   Ouml: 'Ö',   oslash: 'ø', Oslash: 'Ø',
  uacute: 'ú', Uacute: 'Ú', ugrave: 'ù', Ugrave: 'Ù',
  ucirc: 'û',  Ucirc: 'Û',  uuml: 'ü',  Uuml: 'Ü',
  ntilde: 'ñ', Ntilde: 'Ñ', ccedil: 'ç', Ccedil: 'Ç',
  szlig: 'ß',  iexcl: '¡',  iquest: '¿',
  frac12: '½', frac14: '¼', frac34: '¾',
  times: '×',  divide: '÷',
};

/**
 * Decodes HTML entities in an RSS feed string to their Unicode equivalents.
 * Handles:
 *   1. Hex numeric entities  (&#x2019;)
 *   2. Decimal numeric entities (&#8217;)
 *   3. Named entities (&amp;, &rsquo;, &eacute;, …) via the NAMED_ENTITIES table
 */
function decodeEntities(s: string): string {
  // 1. Hex numeric entities:  &#x2019;  &#X2019;
  s = s.replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
    String.fromCodePoint(parseInt(hex, 16)),
  );
  // 2. Decimal numeric entities:  &#8217;  &#160;
  s = s.replace(/&#(\d+);/g, (_, dec) =>
    String.fromCodePoint(parseInt(dec, 10)),
  );
  // 3. Named entities:  &amp;  &rsquo;  (case-sensitive lookup, then lower fallback)
  s = s.replace(/&([A-Za-z]+);/g, (match, name) =>
    NAMED_ENTITIES[name] ?? NAMED_ENTITIES[name.toLowerCase()] ?? match,
  );
  return s;
}

/**
 * Strips HTML tags and decodes entities to produce plain text.
 * Collapses multiple consecutive whitespace characters to a single space.
 */
function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ' '))
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── Fetch one feed ────────────────────────────────────────────────────────────

/**
 * Fetches and parses a single RSS feed, returning up to 12 articles.
 * All tag extraction and entity decoding is done with regex — no XML parser
 * dependency — which keeps this lightweight and handles malformed feeds.
 *
 * @param key    Source identifier used to tag each article.
 * @param label  Human-readable source name (e.g. "ESPN").
 * @param url    RSS feed URL.
 * @throws       `Error` if the HTTP response is not 2xx.
 */
async function fetchFeed(
  key: NewsSource,
  label: string,
  url: string,
): Promise<NewsArticle[]> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CommissionerSuite/1.0)' },
    next: { revalidate: 900 },
  });
  if (!res.ok) throw new Error(`${label} RSS ${res.status}`);

  const xml = await res.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);

  return items.slice(0, 12).map((item): NewsArticle => ({
    title: stripHtml(extractTag(item, 'title')),
    description: stripHtml(extractTag(item, 'description')).slice(0, 180),
    link:
      extractTag(item, 'link') ||
      extractAttr(item, 'link', 'href') ||
      '#',
    pubDate: extractTag(item, 'pubDate'),
    imageUrl:
      extractAttr(item, 'media:content', 'url') ??
      extractAttr(item, 'media:thumbnail', 'url') ??
      extractAttr(item, 'enclosure', 'url') ??
      null,
    source: key,
    sourceLabel: label,
  }));
}

// ── Cached fetch ──────────────────────────────────────────────────────────────

/**
 * Returns cached articles for a feed if the cache is fresh (< TTL),
 * otherwise re-fetches. On fetch failure, returns the stale cached articles
 * rather than an error — partial results are better than no results.
 */
async function getCached(
  key: NewsSource,
  label: string,
  url: string,
): Promise<NewsArticle[]> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.ts < TTL) return hit.articles;

  try {
    const articles = await fetchFeed(key, label, url);
    cache.set(key, { articles, ts: now });
    return articles;
  } catch {
    // Return stale cache rather than an error if available
    if (hit) return hit.articles;
    return [];
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const sourceFilter = searchParams.get('source') as NewsSource | null;

  const feeds = sourceFilter
    ? FEEDS.filter((f) => f.key === sourceFilter)
    : FEEDS;

  if (feeds.length === 0) {
    return err('Unknown source', 400);
  }

  const results = await Promise.all(
    feeds.map((f) => getCached(f.key, f.label, f.url)),
  );

  // Merge all sources, sort newest-first, cap at 40
  const all = results
    .flat()
    .sort((a, b) => {
      const ta = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const tb = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return tb - ta;
    })
    .slice(0, 40);

  return ok(all);
}
