'use client';

import { useState, useCallback, useEffect } from 'react';
import Image from 'next/image';
import type { NewsArticle, NewsSource } from '@/types/news';

const NFL_REPORTERS: {
  name: string;
  handle: string;
  affiliation: string;
  specialty: string;
}[] = [
  { name: 'Adam Schefter',   handle: 'AdamSchefter',     affiliation: 'ESPN',          specialty: 'Breaking news / transactions' },
  { name: 'Ian Rapoport',    handle: 'RapSheet',          affiliation: 'NFL Network',   specialty: 'Breaking news / transactions' },
  { name: 'Tom Pelissero',   handle: 'TomPelissero',      affiliation: 'NFL Network',   specialty: 'Contracts & injuries'         },
  { name: 'Jay Glazer',      handle: 'JayGlazer',         affiliation: 'Fox Sports',    specialty: 'Insider scoops'               },
  { name: 'Mike Garafolo',   handle: 'MikeGarafolo',      affiliation: 'NFL Network',   specialty: 'Transactions & injuries'      },
  { name: 'Jeremy Fowler',   handle: 'JFowlerESPN',       affiliation: 'ESPN',          specialty: 'League-wide coverage'         },
  { name: 'Albert Breer',    handle: 'AlbertBreer',       affiliation: 'SI / MMQB',     specialty: 'Analysis & draft intel'       },
  { name: 'Field Yates',     handle: 'FieldYates',        affiliation: 'ESPN',          specialty: 'Fantasy & roster moves'       },
  { name: 'Mike Florio',     handle: 'ProFootballTalk',   affiliation: 'NBC Sports',    specialty: 'News & commentary'            },
  { name: 'Jordan Schultz',  handle: 'Schultz_Report',    affiliation: 'Independent',   specialty: 'Breaking news'                },
  { name: 'Dan Graziano',    handle: 'DanGrazianoESPN',   affiliation: 'ESPN',          specialty: 'NFC coverage & analysis'      },
];

const SOURCE_COLOR: Record<string, string> = {
  espn:  '#e8224a',
  yahoo: '#6001d2',
  pft:   '#d4501c',
  cbs:   '#1a6eb5',
};

const NEWS_SOURCES: { key: NewsSource | 'all'; label: string }[] = [
  { key: 'all',   label: 'All'              },
  { key: 'espn',  label: 'ESPN'             },
  { key: 'yahoo', label: 'Yahoo Sports'     },
  { key: 'pft',   label: 'Pro Football Talk'},
  { key: 'cbs',   label: 'CBS Sports'       },
];

function relativeDate(raw: string): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const mins  = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days  = Math.floor(diffMs / 86_400_000);
  if (mins  <  1) return 'Just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  <  7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function NewsTab() {
  const [activeSource, setActiveSource] = useState<NewsSource | 'all'>('all');
  const [news, setNews]                 = useState<NewsArticle[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);

  const fetchNews = useCallback(async (source: NewsSource | 'all') => {
    setLoading(true);
    setError(null);
    try {
      const qs = source === 'all' ? '' : `?source=${source}`;
      const res = await fetch(`/api/news${qs}`);
      if (!res.ok) throw new Error('Failed to load news');
      setNews(await res.json() as NewsArticle[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchNews(activeSource); }, [activeSource, fetchNews]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">

      <div className="lg:col-span-2 flex flex-col gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: '#555' }}>
            NFL Headlines
          </p>
          <div className="flex flex-wrap gap-1.5">
            {NEWS_SOURCES.map(({ key, label }) => {
              const active = key === activeSource;
              return (
                <button
                  key={key}
                  onClick={() => setActiveSource(key)}
                  className="text-xs px-2.5 py-1 rounded-full transition-colors"
                  style={{
                    background: active ? 'rgba(128,255,73,0.12)' : '#141415',
                    border: `1px solid ${active ? 'rgba(128,255,73,0.3)' : '#1e1e20'}`,
                    color: active ? '#80ff49' : '#555',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl overflow-hidden"
          style={{ background: '#141415', border: '1px solid #1e1e20' }}>
          {loading ? (
            <div className="flex flex-col gap-3 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex gap-3 items-start">
                  <div className="w-14 h-14 rounded shrink-0 animate-pulse"
                    style={{ background: '#1e1e20' }} />
                  <div className="flex-1 flex flex-col gap-2 pt-1">
                    <div className="h-3.5 rounded animate-pulse"
                      style={{ background: '#1e1e20', width: `${65 + (i % 3) * 10}%` }} />
                    <div className="h-3 rounded animate-pulse"
                      style={{ background: '#1e1e20', width: '40%' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="p-4 flex items-center gap-3">
              <p className="text-xs flex-1" style={{ color: '#ff4949' }}>{error}</p>
              <button onClick={() => void fetchNews(activeSource)}
                className="text-xs transition-colors" style={{ color: '#555' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#e8e6df')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}>
                ↺ Retry
              </button>
            </div>
          ) : news.length === 0 ? (
            <p className="text-xs p-4" style={{ color: '#444' }}>No headlines available.</p>
          ) : (
            news.map((article, i) => (
              <a key={i} href={article.link} target="_blank" rel="noopener noreferrer"
                className="flex items-start gap-3 px-4 py-3 border-b last:border-b-0 group"
                style={{ borderColor: '#1a1a1c' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#1a1a1c')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                {article.imageUrl && (
                  <Image src={article.imageUrl} alt=""
                    width={56} height={56} unoptimized
                    className="w-14 h-14 rounded object-cover shrink-0"
                    style={{ background: '#1e1e20' }} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-snug transition-colors group-hover:text-[#80ff49]"
                    style={{ color: '#e8e6df' }}>
                    {article.title}
                  </p>
                  {article.description && (
                    <p className="text-[11px] mt-0.5 line-clamp-2" style={{ color: '#555' }}>
                      {article.description}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1.5">
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0"
                      style={{
                        background: `${SOURCE_COLOR[article.source] ?? '#333'}22`,
                        color: SOURCE_COLOR[article.source] ?? '#555',
                      }}
                    >
                      {article.sourceLabel}
                    </span>
                    <span className="text-xs font-medium" style={{ color: '#666' }}>
                      {relativeDate(article.pubDate)}
                    </span>
                  </div>
                </div>
              </a>
            ))
          )}
        </div>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: '#555' }}>
          NFL Reporters on X
        </p>
        <div className="rounded-xl overflow-hidden"
          style={{ background: '#141415', border: '1px solid #1e1e20' }}>
          {NFL_REPORTERS.map((r, i) => (
            <a
              key={r.handle}
              href={`https://x.com/${r.handle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 group"
              style={{ borderColor: '#1a1a1c' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#1a1a1c')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-[11px] font-semibold"
                style={{
                  background: `hsl(${(i * 47) % 360} 30% 18%)`,
                  color: `hsl(${(i * 47) % 360} 60% 60%)`,
                }}
              >
                {r.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate transition-colors group-hover:text-[#80ff49]"
                  style={{ color: '#e8e6df' }}>
                  {r.name}
                </p>
                <p className="text-[10px] truncate" style={{ color: '#444' }}>
                  @{r.handle} · {r.affiliation}
                </p>
              </div>
              <svg className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1 9L9 1M9 1H3M9 1V7" stroke="#80ff49" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
