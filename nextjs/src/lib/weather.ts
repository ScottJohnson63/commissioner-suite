// src/lib/weather.ts — Open-Meteo forecast lookup for a game venue.
// Free API — no key required.

import { RouteCache } from '@/lib/cache';
import type { Stadium } from '@/lib/stadiums';
import type { WeatherInfo } from '@/types/projections';

const weatherCache = new RouteCache<WeatherInfo>();

const ENRICHMENT_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Fetches a game-time forecast for a venue.
 *
 * Takes coordinates rather than a team. A team-keyed lookup would only reach the
 * thirty-two home grounds, which leaves out every international game —
 * Melbourne, Wembley, the Maracanã — and gets a road game wrong besides, since
 * the venue is the *other* team's ground. Resolving a fixture to its venue is
 * `venueOf` in src/lib/matchupContext.ts.
 *
 * @param key      Cache key and the `team` reported on the result. For a
 *                 neutral site this is the nominal home team, so the caller can
 *                 still find the forecast by the team it asked about.
 * @param venue    Coordinates and name. A covered venue returns null.
 * @param week     Part of the cache key; forecasts are per week.
 */
export async function getVenueWeather(
  key: string,
  venue: Stadium,
  week: number,
): Promise<WeatherInfo | null> {
  if (venue.dome) return null;

  const cacheKey = `${key}-${week}`;
  const hit = weatherCache.get(cacheKey, ENRICHMENT_TTL);
  if (hit) return hit;

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${venue.lat}&longitude=${venue.lon}` +
      `&hourly=temperature_2m,precipitation_probability,wind_speed_10m` +
      `&forecast_days=7&timezone=auto&temperature_unit=fahrenheit&wind_speed_unit=mph`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return null;

    const json = await res.json() as {
      hourly: {
        time:                      string[];
        temperature_2m:            number[];
        precipitation_probability: number[];
        wind_speed_10m:            number[];
      };
    };

    // Find the next Sunday 1 pm slot (or closest future slot)
    const now   = new Date();
    const times = json.hourly.time;
    let bestIdx   = 0;
    let bestScore = Infinity;
    for (let i = 0; i < times.length; i++) {
      const t = new Date(times[i]);
      if (t < now) continue;
      const dayScore   = t.getDay() === 0 ? 0 : Math.abs(t.getDay() - 0) * 24;
      const hourScore  = Math.abs(t.getHours() - 13);
      const totalScore = dayScore + hourScore;
      if (totalScore < bestScore) { bestScore = totalScore; bestIdx = i; }
    }

    const tempF     = Math.round(json.hourly.temperature_2m[bestIdx]             ?? 55);
    const windMph   = Math.round(json.hourly.wind_speed_10m[bestIdx]             ?? 0);
    const precipPct = json.hourly.precipitation_probability[bestIdx]             ?? 0;

    const notes: string[] = [];
    if (windMph  >  20) notes.push(`High wind (${windMph} mph) — passing may suffer`);
    if (precipPct > 60) notes.push(`Rain likely (${precipPct}%) — impacts passing/receiving`);
    if (tempF    <  20) notes.push(`Extreme cold (${tempF}°F)`);

    const data: WeatherInfo = {
      team: key, tempF, windMph, precipPct,
      stadiumName: venue.name,
      note: notes.join('; ') || 'Good conditions',
    };
    weatherCache.set(cacheKey, data);
    return data;
  } catch {
    return null;
  }
}
