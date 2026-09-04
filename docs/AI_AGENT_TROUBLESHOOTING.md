# AI Agent — "Agent failed to respond"

Reference for diagnosing the assistant on `/league/ai` (`POST /api/agent`).

## Check the configuration first

While signed in, open `GET /api/agent` for the free, offline summary:

```jsonc
{
  "ready": true,                                  // false → no provider configured
  "providers": { "groq": true, "gemini": false }, // which keys the server can see
  "season":    2025                               // NFL_SEASON
}
```

That only proves a key is *present*. To find out whether it **works**, add
`?live=1` — this calls each provider:

```jsonc
{
  "ready": true,
  "groq": {
    "configured": true,
    "reachable":  true,
    "selected":   { "planner": "llama-3.1-8b-instant", "answer": "llama-3.3-70b-versatile" },
    "available":  ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "…"]
  },
  "gemini": {
    "configured": true,
    "reachable":  false,
    "model":      "gemini-2.5-flash",
    "error":      "HTTP 400: API key not valid…"
  }
}
```

`available` is the definitive list of model IDs your key can use, and
`selected` is what the route will pick. Both report booleans, model IDs and the
provider's own error text — never key material.

## Model IDs are discovered, not hardcoded

Providers retire models, and a retired ID answers every request with a 404 that
is indistinguishable from an outage. So the Groq model is chosen at request time
from the account's own catalogue (`GET /openai/v1/models`), preferring a short
candidate list and falling back to any chat model the account offers. A
`model_not_found` mid-flight re-reads the catalogue and retries once.

Pin a model with `GROQ_MODEL` (both passes) or `GROQ_PLANNER_MODEL` (pass 1
only) to skip discovery entirely. The `X-Model-Id` response header and the
model badge on the page both report the ID that actually answered.

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `GROQ_API_KEY` | one of the two | Primary provider for both passes. |
| `GEMINI_API_KEY` | one of the two | Takes over whenever Groq is unavailable or fails. |
| `GROQ_MODEL` | no | Pins the Groq model for both passes, skipping discovery. |
| `GROQ_PLANNER_MODEL` | no | Pins pass 1 only. |
| `GEMINI_MODEL` | no | Overrides `gemini-2.5-flash`. |
| `NFL_SEASON` | recommended | Most recently completed season, e.g. `2025`. A stale value is the usual cause of wrong-season answers, not of a failure. |

At least one of `GROQ_API_KEY` / `GEMINI_API_KEY` must be set. Either alone is
enough to serve the whole feature, intent classification included.

## What the errors mean

The route answers failures as `{ "error": string }`, and the page renders that
text verbatim, so the message on screen is the real reason.

| Status | Meaning | Fix |
| --- | --- | --- |
| 401 | Session expired. | Sign in again. |
| 400 | Malformed request body. | Client bug — check the request payload. |
| 429 | Hourly per-client prompt cap (`HOURLY_LIMIT`, currently 15). | Wait for the reset in `X-RateLimit-Reset`. |
| 503 | Neither API key is set on the server. | Set `GROQ_API_KEY` or `GEMINI_API_KEY` and redeploy. |
| 502 | Every configured provider failed. The body names each one and its error. | Usually a revoked key, a retired model ID, or a provider outage. |

## Response headers

| Header | Use |
| --- | --- |
| `X-Model-Used` | `groq` or `gemini` — which provider answered. |
| `X-Model-Id` | The exact model ID that served the answer. |
| `X-Fallback-Reason` | `groq_rate_limit`, `groq_error`, or `groq_unavailable`. Present only when Gemini answered. |
| `X-Query-Intent` | Pass-1 classification; `general` on every question suggests the planner call is failing. |
| `X-League-Context` | `true` when live Sleeper standings/rosters were injected. |
| `X-RateLimit-Remaining` / `X-RateLimit-Reset` | Hourly bucket state. |

## Known failure modes now handled

- **Missing `GROQ_API_KEY` crashed the module.** `new Groq({ apiKey: undefined })`
  throws, and it ran at module scope, so every request 500'd before reaching the
  route's own "no API keys" guard. Both clients are now built lazily, per key.
- **Only a 429 fell back to Gemini.** A revoked key, a retired model, or a Groq
  outage took the assistant down with a healthy Gemini key sitting unused. Any
  Groq failure now falls back, and a missing `GROQ_API_KEY` skips Groq entirely.
- **Unhandled throws became HTML 500s.** The handler is wrapped, so failures come
  back as JSON the page can display.
- **Mid-stream failures and empty completions** are written into the stream as
  readable text rather than tearing it down or leaving an empty bubble.

Server-side logs are prefixed `[pass-1]` (intent classification), `[pass-2]`
(answer generation), and `[agent]` (route-level).

## If the probe says `ready: true` and it still fails

Both keys are visible to the server, so the failure is downstream of
configuration. The page now prints the route's real error text — read that
first, then match it here:

| On screen | Cause |
| --- | --- |
| `HTTP 504` / `HTTP 502` with no JSON body | The function was killed before it answered. The route now declares `maxDuration = 60`, and every Sleeper call is bounded (6 s, 12 s for the ~10 MB player list). |
| `Every AI provider failed — Groq: …; Gemini: …` | Both upstreams rejected the call. The quoted text is the provider's own message. |
| `Groq: 404 … model … does not exist or you do not have access` | The model ID is retired or not on your plan. Discovery handles this automatically now; if it persists, check `available` in the live probe and pin `GROQ_MODEL`. |
| `Gemini: … API_KEY_INVALID` | The key is wrong, revoked, or restricted. Mint a fresh one in Google AI Studio, confirm it belongs to a project with the Generative Language API enabled, and remove any HTTP-referrer restriction — this is a server-side call, so a browser-restricted key always fails. |
| `⚠ Response interrupted: …` after partial text | The provider dropped the connection mid-answer. |
| `The model returned an empty response.` | The provider accepted the call and produced no tokens. |
| Answers that ignore your league | Check `X-Query-Intent`. Always `general` means Pass 1 is failing; always `false` on `X-League-Context` means no Sleeper league ID was sent. |

`NFL_SEASON` is unset if the probe's `season` matches the current calendar
year by accident. Set it explicitly — it decides which season "this year" and
"last year" resolve to, and a season with no rows yet produces confident,
empty-handed answers rather than an error.

## The Sleeper player map is downloaded once a day, app-wide

`/players/nfl` is ~10 MB and Sleeper asks callers to hit it at most once per
day. `src/lib/sleeper/playerCache.ts` is the **only** place in the app that
calls it, and it enforces the limit on four levels: an in-memory cache, a
single-flight promise so concurrent callers share one download, the
`nfl_players` DB row, and an `nfl_players_fetch_attempt` DB row claimed
*before* the download — so a Sleeper outage, a timeout, a failed write-back, or
a fleet of cold serverless instances cannot buy a second attempt. When the
day's slot is spent and the stored map is stale, the stale map is served
instead of refreshed.

The agent's `fetchSleeperPlayerMap()` delegates to that cache. It previously
kept a second copy under its own key (`nfl_player_map`), which meant two
independent daily downloads. That key is no longer written; the leftover row
can be deleted from `SleeperCache` whenever convenient.
