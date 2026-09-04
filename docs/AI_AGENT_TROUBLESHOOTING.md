# AI Agent — "Agent failed to respond"

Reference for diagnosing the assistant on `/league/ai` (`POST /api/agent`).

## Check the configuration first

While signed in, open:

```
GET /api/agent
```

```jsonc
{
  "ready": true,                                 // false → no provider configured
  "providers": { "groq": true, "gemini": false }, // which keys the server can see
  "models":    { "groq": "llama-3.1-8b-instant", "gemini": "gemini-2.5-flash" },
  "season":    2025                              // NFL_SEASON
}
```

It reports booleans and model IDs only — never key material. A missing or
invalid key otherwise looks exactly like an upstream outage from the browser.

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `GROQ_API_KEY` | one of the two | Primary provider for both passes. |
| `GEMINI_API_KEY` | one of the two | Takes over whenever Groq is unavailable or fails. |
| `GROQ_MODEL` | no | Overrides `llama-3.1-8b-instant`. |
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
