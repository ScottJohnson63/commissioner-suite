// src/lib/weather.ts — Open-Meteo weather lookup for NFL stadiums.
// Free API — no key required.

import { RouteCache } from '@/lib/cache';
import { STADIUM_COORDS } from '@/lib/stadiums';
import type { WeatherInfo } from '@/types/projections';

const weatherCache = new RouteCache<WeatherInfo>();

const ENRICHMENT_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Fetches a game-time weather forecast for the given NFL team's home stadium.
 * Returns null for dome stadiums or if the fetch fails.
 */
export async function getWeather(team: string, week: number): Promise<WeatherInfo | null> {
  const stadium = STADIUM_COORDS[team];
  if (!stadium || stadium.dome) return null;

  const cacheKey = `${team}-${week}`;
  const hit = weatherCache.get(cacheKey, ENRICHMENT_TTL);
  if (hit) return hit;

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${stadium.lat}&longitude=${stadium.lon}` +
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
      team, tempF, windMph, precipPct,
      stadiumName: stadium.name,
      note: notes.join('; ') || 'Good conditions',
    };
    weatherCache.set(cacheKey, data);
    return data;
  } catch {
    return null;
  }
}
