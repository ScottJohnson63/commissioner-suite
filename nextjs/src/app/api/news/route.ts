// src/app/api/news/route.ts
//
// Aggregates NFL headlines from multiple public RSS feeds.
// Each feed is cached independently for 15 minutes.

import { NextRequest, NextResponse } from 'next/server';

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

function extractTag(xml: string, tag: string): string {
  const m =
    xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i')) ??
    xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

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

function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ' '))
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── Fetch one feed ────────────────────────────────────────────────────────────

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
    return NextResponse.json({ error: 'Unknown source' }, { status: 400 });
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

  return NextResponse.json(all);
}
