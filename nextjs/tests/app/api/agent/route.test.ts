// tests/app/api/agent/route.test.ts
//
// POST /api/agent — AI fantasy football assistant (two-pass: intent → stream).
//
// The handler gates on auth + rate limit, then calls Groq Pass 1 (intent
// classification, non-streaming), then Groq Pass 2 (streaming answer), with a
// Gemini fallback when Groq returns 429. Both AI clients and all data-fetching
// helpers are fully mocked so no real AI calls are made.
//
// Mocks:
//   @/auth              — auth()
//   @/lib/rateLimit     — checkHourlyLimit, getClientId, getDailyCount, incrementDaily
//   @/lib/agentContext  — fetchTrending, fetchSleeperPlayerMap, fetchLeagueContext
//   @/lib/prisma        — nflWeeklyStat
//   groq-sdk            — Groq class (Pass 1 + Pass 2 streaming)
//   @google/generative-ai — GoogleGenerativeAI (Gemini fallback)

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@/auth', () => ({
  auth: jest.fn(),
}));

jest.mock('@/lib/rateLimit', () => ({
  HOURLY_LIMIT:     10,
  DAILY_LIMIT:      50,
  getClientId:      jest.fn().mockReturnValue('test-client'),
  checkHourlyLimit: jest.fn(),
  peekHourlyLimit:  jest.fn().mockReturnValue({ used: 0, remaining: 10, resetAt: 0 }),
  checkDailyLimit:  jest.fn(),
  dailyResetAt:     jest.fn().mockReturnValue(1750000000000),
  getDailyCount:    jest.fn().mockReturnValue(1),
  incrementDaily:   jest.fn(),
}));

jest.mock('@/lib/agentContext', () => ({
  fetchTrending:           jest.fn(),
  fetchSleeperPlayerMap:   jest.fn(),
  fetchSleeperPlayerIndex: jest.fn(),
  fetchLeagueContext:      jest.fn(),
}));

// The three dashboard panels the route now reads for league-aware intents.
// Mocked wholesale: each one is a live Sleeper/odds/weather build behind its
// own route, and none of it is what these tests are about.
jest.mock('@/lib/agentTools', () => ({
  fetchAgentTools:  jest.fn(),
  formatAgentTools: jest.fn().mockReturnValue(''),
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    nflWeeklyStat: {
      findFirst: jest.fn(),
      findMany:  jest.fn(),
      groupBy:   jest.fn(),
    },
  },
}));

// Groq SDK mock — handles both Pass 1 (non-streaming JSON) and Pass 2 (stream).
// __esModule: true is required so TypeScript's __importDefault doesn't double-wrap
// the mock, which would make `groq_sdk_1.default` a plain object instead of a constructor.
const mockGroqCreate = jest.fn<(params: unknown) => Promise<unknown>>();
const mockGroqModelList = jest.fn<() => Promise<unknown>>();
jest.mock('groq-sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat:   { completions: { create: mockGroqCreate } },
    models: { list: mockGroqModelList },
  })),
}));

// Gemini SDK mock — used for the fallback streaming path and, when Groq is not
// configured, for Pass 1 intent classification (generateContent).
// __esModule: true prevents the same double-wrapping issue as groq-sdk.
const mockSendMessageStream = jest.fn<() => Promise<unknown>>();
const mockGenerateContent   = jest.fn<() => Promise<unknown>>();
const mockStartChat = jest.fn().mockReturnValue({ sendMessageStream: mockSendMessageStream });
const mockGetGenerativeModel = jest.fn().mockReturnValue({
  startChat:       mockStartChat,
  generateContent: mockGenerateContent,
});
jest.mock('@google/generative-ai', () => ({
  __esModule: true,
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}));

import { GET, POST } from '@/app/api/agent/route';
import { auth } from '@/auth';
import { checkHourlyLimit, peekHourlyLimit, checkDailyLimit } from '@/lib/rateLimit';
import { fetchTrending, fetchSleeperPlayerIndex, fetchLeagueContext } from '@/lib/agentContext';
import { SUGGESTED_PROMPTS } from '@/lib/agentIntents';
import { fetchAgentTools, formatAgentTools } from '@/lib/agentTools';
import { prisma } from '@/lib/prisma';

const mockAuth           = auth           as jest.MockedFunction<typeof auth>;
const mockCheckLimit     = checkHourlyLimit as jest.MockedFunction<typeof checkHourlyLimit>;
const mockFetchTrending  = fetchTrending   as jest.MockedFunction<typeof fetchTrending>;
const mockFetchPlayerIndex = fetchSleeperPlayerIndex as jest.MockedFunction<typeof fetchSleeperPlayerIndex>;
const mockFetchTools     = fetchAgentTools as jest.MockedFunction<typeof fetchAgentTools>;
const mockFormatTools    = formatAgentTools as jest.MockedFunction<typeof formatAgentTools>;
const mockPeekLimit      = peekHourlyLimit as jest.MockedFunction<typeof peekHourlyLimit>;
const mockDailyLimit     = checkDailyLimit as jest.MockedFunction<typeof checkDailyLimit>;
const mockFetchLeagueContext = fetchLeagueContext as jest.MockedFunction<typeof fetchLeagueContext>;
const mockStatFindFirst  = prisma.nflWeeklyStat.findFirst as jest.MockedFunction<typeof prisma.nflWeeklyStat.findFirst>;
const mockStatFindMany   = prisma.nflWeeklyStat.findMany  as jest.MockedFunction<typeof prisma.nflWeeklyStat.findMany>;
const mockStatGroupBy    = prisma.nflWeeklyStat.groupBy   as jest.MockedFunction<typeof prisma.nflWeeklyStat.groupBy>;

// ── Helpers ───────────────────────────────────────────────────────────────────

// A minimal, valid session object.
const fakeSession = {
  user: { id: 'user-1', role: 'MEMBER', pendingOAuth: false, sleeperUserId: 'sleeper-1' },
};

// The two Groq responses needed for a full round-trip:
//   Pass 1: non-streaming JSON intent plan.
//   Pass 2: streaming async iterable of text chunks.
const pass1Content = '{"intent":"general","players":[],"position":null,"opponent":null,"season":null,"weeksBack":null}';

const pass1Response = {
  choices: [{ message: { content: pass1Content } }],
};

async function* fakeGroqStream() {
  yield { choices: [{ delta: { content: 'Great pick!' } }] };
  yield { choices: [{ delta: { content: ' Start him.' } }] };
}

// Sleeper + DB context mocks — needed by every request that reaches Pass 2.
function setupContextMocks(): void {
  mockFetchTrending.mockResolvedValue({ adds: [], drops: [] });
  mockFetchPlayerIndex.mockResolvedValue({});
  mockFetchTools.mockResolvedValue({ matchup: null, waivers: null, trades: null, errors: [] });
  // DB fallback stats query
  mockStatFindFirst.mockResolvedValue(null as never);
  mockStatFindMany.mockResolvedValue([] as never);
  mockStatGroupBy.mockResolvedValue([] as never);
}

// Sets up the happy-path mock chain for a successful two-pass agent response.
function setupHappyPath(): void {
  mockGroqCreate
    .mockResolvedValueOnce(pass1Response)        // Pass 1: intent classification
    .mockResolvedValueOnce(fakeGroqStream());    // Pass 2: streaming answer
  setupContextMocks();
}

/**
 * The Pass 2 system prompt — everything the answering model was shown.
 *
 * The LAST Groq call, not the second: a question the page itself offers skips
 * Pass 1 entirely, so the answer call is sometimes the only one there is.
 */
function systemPromptSent(): string {
  const calls = mockGroqCreate.mock.calls;
  const last = calls[calls.length - 1][0] as { messages: { role: string; content: string }[] };
  return last.messages.find((m) => m.role === 'system')?.content ?? '';
}

/** A Pass 1 response that classifies as `intent`, with optional extracted entities. */
function planningAs(intent: string, extra: Record<string, unknown> = {}) {
  return {
    choices: [{
      message: {
        content: JSON.stringify({
          intent, players: [], position: null, opponent: null, season: null, weeksBack: null, ...extra,
        }),
      },
    }],
  };
}

function makeReq(body: object): NextRequest {
  return new NextRequest('http://localhost/api/agent', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/agent', () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockCheckLimit.mockReset();
    mockGroqCreate.mockReset();
    mockFetchTrending.mockReset();
    mockFetchPlayerIndex.mockReset();
    mockFetchTools.mockReset();
    mockFormatTools.mockReset();
    mockFormatTools.mockReturnValue('');
    mockFetchLeagueContext.mockReset();
    mockFetchLeagueContext.mockResolvedValue(null);
    mockStatFindFirst.mockReset();
    mockStatFindMany.mockReset();
    mockStatGroupBy.mockReset();
    mockSendMessageStream.mockReset();
    mockGenerateContent.mockReset();
    mockGroqModelList.mockReset();
    // Default catalogue: the model the candidate lists prefer for each pass.
    mockGroqModelList.mockResolvedValue({
      data: [{ id: 'llama-3.1-8b-instant' }, { id: 'llama-3.3-70b-versatile' }],
    });
    delete process.env.GROQ_MODEL;
    delete process.env.GROQ_PLANNER_MODEL;

    // Keys are opted into per test — a leaked key would silently change which
    // provider a test exercises.
    delete process.env.GEMINI_API_KEY;

    // Gemini answers first now, so the default happy path needs its key. Tests
    // that are about Groq opt into being Groq-first explicitly.
    delete process.env.AGENT_PRIMARY;
    delete process.env.AGENT_GROQ_TPM;
    delete process.env.GEMINI_MODEL;

    // Default: authenticated, within both budgets.
    mockAuth.mockResolvedValue(fakeSession as never);
    mockCheckLimit.mockReturnValue({ allowed: true, remaining: 9, resetAt: 9999999 });
    mockDailyLimit.mockReturnValue({ allowed: true, used: 1, remaining: 49, resetAt: 1750000000000 });
  });

  // WHY: No session means the request is unauthenticated — must return 401
  //      before any AI calls are made. The AI budget should not be spent on
  //      unauthenticated requests.
  it('returns 401 when the user is not authenticated', async () => {
    mockAuth.mockResolvedValueOnce(null as never);

    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'Who should I start?' }] }));
    expect(res.status).toBe(401);
    expect(mockGroqCreate).not.toHaveBeenCalled();
  });

  // WHY: messages is required — the AI has nothing to respond to without it.
  //      Fail with 400 before consuming any API quota.
  it('returns 400 when messages array is missing', async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
    expect(mockGroqCreate).not.toHaveBeenCalled();
  });

  it('returns 400 when messages is an empty array', async () => {
    const res = await POST(makeReq({ messages: [] }));
    expect(res.status).toBe(400);
  });

  // WHY: When the hourly per-client limit is reached, the route must return 429
  //      with rate-limit headers rather than proceeding and burning shared quota.
  //      The resetAt timestamp lets the client show a countdown.
  it('returns 429 with rate-limit headers when hourly limit is exceeded', async () => {
    mockCheckLimit.mockReturnValueOnce({ allowed: false, remaining: 0, resetAt: 1999999999 });

    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'Hello' }] }));
    expect(res.status).toBe(429);
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(mockGroqCreate).not.toHaveBeenCalled();
  });

  // WHY: Without any AI API key configured, every response would fail. The route
  //      checks this early to return a clear error rather than a cryptic 502.
  it('returns an error when no AI API keys are configured', async () => {
    const originalGroq   = process.env.GROQ_API_KEY;
    const originalGemini = process.env.GEMINI_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'Hello' }] }));
    // 503: the server is reachable, but no provider is configured to answer.
    expect(res.status).toBe(503);
    expect((await res.json() as { error: string }).error).toMatch(/GROQ_API_KEY or GEMINI_API_KEY/);
    expect(mockGroqCreate).not.toHaveBeenCalled();

    // NOTE: assigning undefined to process.env stores the *string* "undefined",
    // which would leave a truthy key set for every later test — delete instead.
    if (originalGroq === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalGroq;
    if (originalGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGemini;
  });

  // WHY: A successful two-pass response must stream plain text back with the
  //      required observability headers: X-Model-Used, X-Query-Intent,
  //      X-RateLimit-Remaining, X-Daily-Prompts-Used.
  it('returns a streaming text response with correct headers on success', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    setupHappyPath();

    const res = await POST(makeReq({
      messages: [{ role: 'user', content: 'Who should I start this week?' }],
    }));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    expect(res.headers.get('X-Model-Used')).toBe('groq');
    expect(res.headers.get('X-Query-Intent')).toBe('general');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('9');
    expect(res.headers.get('X-League-Context')).toBe('false');
  });

  // WHY: Pass 1 must be called with the user's message text so intent can be
  //      classified. Pass 2 must be called with stream: true for the streaming
  //      answer. The two-pass architecture is the core of the agent's design.
  it('calls Groq twice — once for intent classification, once for streaming answer', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    setupHappyPath();

    await POST(makeReq({ messages: [{ role: 'user', content: 'Best WRs this year?' }] }));

    expect(mockGroqCreate).toHaveBeenCalledTimes(2);
    const [pass1Call, pass2Call] = mockGroqCreate.mock.calls;
    expect((pass1Call[0] as { stream: boolean }).stream).toBe(false);  // Pass 1: non-streaming
    expect((pass2Call[0] as { stream: boolean }).stream).toBe(true);   // Pass 2: streaming
  });

  // WHY: Gemini answers first now, and that is a quota decision rather than a
  //      quality one — a panel-backed prompt is 5,000-9,000 tokens and Groq's
  //      free tier allows 100,000 a day, which is about a dozen answers for a
  //      whole league. Nothing fell back, so there is no fallback reason.
  it('answers on Gemini by default, with Groq configured and healthy', async () => {
    process.env.GROQ_API_KEY   = 'test-groq-key';
    process.env.GEMINI_API_KEY = 'test-gemini-key';

    mockGroqCreate.mockResolvedValueOnce(pass1Response);   // Pass 1 stays on Groq
    async function* geminiStream() { yield { text: () => 'Gemini answer here.' }; }
    mockSendMessageStream.mockResolvedValueOnce({ stream: geminiStream() });
    setupContextMocks();

    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'Anything' }] }));

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Model-Used')).toBe('gemini');
    expect(res.headers.get('X-Fallback-Reason')).toBeNull();
    // Pass 1 only — the answer did not go to Groq.
    expect(mockGroqCreate).toHaveBeenCalledTimes(1);

    delete process.env.GEMINI_API_KEY;
  });

  // WHY: On a paid Groq plan it is much the faster of the two, and then this
  //      ordering is the only thing in the way. One env var has to flip it.
  it('answers on Groq first when AGENT_PRIMARY=groq', async () => {
    process.env.GROQ_API_KEY   = 'test-groq-key';
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.AGENT_PRIMARY  = 'groq';
    setupHappyPath();

    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'Anything' }] }));

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Model-Used')).toBe('groq');
    expect(res.headers.get('X-Fallback-Reason')).toBeNull();
    expect(mockSendMessageStream).not.toHaveBeenCalled();

    delete process.env.GEMINI_API_KEY;
  });

  // WHY: Whichever provider leads, a 429 from it must hand off rather than
  //      surface. X-Fallback-Reason is how the page explains the switch.
  it('falls back to Groq when Gemini fails', async () => {
    process.env.GROQ_API_KEY   = 'test-groq-key';
    process.env.GEMINI_API_KEY = 'test-gemini-key';

    mockSendMessageStream.mockRejectedValueOnce(new Error('429 quota exceeded'));
    mockGroqCreate
      .mockResolvedValueOnce(pass1Response)      // Pass 1
      .mockResolvedValueOnce(fakeGroqStream());  // Pass 2, after Gemini failed
    setupContextMocks();

    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'Fallback test' }] }));

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Model-Used')).toBe('groq');
    expect(res.headers.get('X-Fallback-Reason')).toBe('gemini_error');

    delete process.env.GEMINI_API_KEY;
  });

  // WHY: Groq's free tier caps tokens per MINUTE below what a panel-backed
  //      prompt costs on every model it offers, and an oversized prompt does not
  //      degrade there — it 413s. A live deployment answered "Limit 8000,
  //      Requested 12890". Trimming what the prompt carries is not the same as
  //      capping it: no fixed set of blocks is small enough for every league, so
  //      the prompt is fitted to whichever model is about to receive it.
  it('cuts an over-budget prompt down to fit rather than sending it', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    process.env.AGENT_PRIMARY = 'groq';
    process.env.AGENT_GROQ_TPM = '2600';   // ~1,100 for the prompt after reserves
    mockGroqCreate
      .mockResolvedValueOnce(planningAs('waiver_wire'))
      .mockResolvedValueOnce(fakeGroqStream());
    setupContextMocks();
    mockFetchTrending.mockResolvedValue({
      adds:  [...Array(40)].map((_, i) => ({ player_id: `a${i}`, count: 900 - i, type: 'add' as const })),
      drops: [...Array(40)].map((_, i) => ({ player_id: `d${i}`, count: 800 - i, type: 'drop' as const })),
    });
    const index: Record<string, { name: string; position: string; team: string | null }> = {};
    for (let i = 0; i < 40; i += 1) {
      index[`a${i}`] = { name: `Trending Add Number ${i}`, position: 'RB', team: 'BUF' };
      index[`d${i}`] = { name: `Trending Drop Number ${i}`, position: 'WR', team: 'NYG' };
    }
    mockFetchPlayerIndex.mockResolvedValue(index);
    mockFormatTools.mockReturnValue(
      `--- MY WAIVER WIRE ---\n${[...Array(30)].map((_, i) => `  ${i}. A free agent with a reason attached`).join('\n')}`,
    );

    const res = await POST(makeReq({
      messages: [{ role: 'user', content: 'Who do I add?' }],
      sleeperLeagueId: 'league-1',
    }));

    expect(res.status).toBe(200);
    // It fit, and it said what it gave up to fit.
    expect(Number(res.headers.get('X-Prompt-Tokens'))).toBeLessThanOrEqual(1200);
    expect(res.headers.get('X-Prompt-Dropped')).not.toBe('none');
  });

  // WHY: Least important goes first, and the panel that answers the question
  //      goes last. An answer built on a shortened trending list is worth
  //      having; one with the reader's own roster cut out of it is not.
  it('shortens trending while leaving the panel that answers the question whole', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    process.env.AGENT_PRIMARY = 'groq';
    process.env.AGENT_GROQ_TPM = '3000';
    mockGroqCreate
      .mockResolvedValueOnce(planningAs('waiver_wire'))
      .mockResolvedValueOnce(fakeGroqStream());
    setupContextMocks();
    mockFetchTrending.mockResolvedValue({
      adds:  [...Array(40)].map((_, i) => ({ player_id: `a${i}`, count: 900 - i, type: 'add' as const })),
      drops: [...Array(40)].map((_, i) => ({ player_id: `d${i}`, count: 800 - i, type: 'drop' as const })),
    });
    const index: Record<string, { name: string; position: string; team: string | null }> = {};
    for (let i = 0; i < 40; i += 1) {
      index[`a${i}`] = { name: `Trending Add Number ${i}`, position: 'RB', team: 'BUF' };
      index[`d${i}`] = { name: `Trending Drop Number ${i}`, position: 'WR', team: 'NYG' };
    }
    mockFetchPlayerIndex.mockResolvedValue(index);
    mockFormatTools.mockReturnValue('--- MY WAIVER WIRE ---\n  1. The one free agent that matters');

    await POST(makeReq({
      messages: [{ role: 'user', content: 'Who do I add?' }],
      sleeperLeagueId: 'league-1',
    }));

    const prompt = systemPromptSent();
    // The panel survived in full.
    expect(prompt).toContain('The one free agent that matters');
    // Trending gave up room for it: some of the forty names are gone.
    expect(prompt).toContain('list shortened to fit');
    expect(prompt).not.toContain('Trending Add Number 39');
  });

  // WHY: A silently shortened list reads as a complete one, and the model will
  //      call it complete — "these are the only players available" about a list
  //      that was cut to fit.
  it('marks a shortened list as shortened, and tells the model so', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    process.env.AGENT_PRIMARY = 'groq';
    process.env.AGENT_GROQ_TPM = '2200';
    mockGroqCreate
      .mockResolvedValueOnce(planningAs('waiver_wire'))
      .mockResolvedValueOnce(fakeGroqStream());
    setupContextMocks();
    mockFormatTools.mockReturnValue(
      `--- MY WAIVER WIRE ---\n${[...Array(80)].map((_, i) => `  ${i}. A free agent with a reason attached to him`).join('\n')}`,
    );

    await POST(makeReq({
      messages: [{ role: 'user', content: 'Who do I add?' }],
      sleeperLeagueId: 'league-1',
    }));

    const prompt = systemPromptSent();
    expect(prompt).toContain('list shortened to fit');
    expect(prompt).toContain('A list marked as shortened was cut to fit a size limit');
  });

  // WHY: Gemini allows a quarter of a million tokens a minute. Cutting its
  //      prompt to Groq's few thousand would throw away data it could have used.
  it('sends Gemini the whole prompt while Groq gets a fitted one', async () => {
    process.env.GROQ_API_KEY   = 'test-groq-key';
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.AGENT_GROQ_TPM = '2000';
    mockGroqCreate.mockResolvedValueOnce(planningAs('waiver_wire'));
    async function* geminiStream() { yield { text: () => 'Gemini answer.' }; }
    mockSendMessageStream.mockResolvedValueOnce({ stream: geminiStream() });
    setupContextMocks();
    mockFormatTools.mockReturnValue(
      `--- MY WAIVER WIRE ---\n${[...Array(80)].map((_, i) => `  ${i}. A free agent with a reason attached to him`).join('\n')}`,
    );

    const res = await POST(makeReq({
      messages: [{ role: 'user', content: 'Who do I add?' }],
      sleeperLeagueId: 'league-1',
    }));

    expect(res.headers.get('X-Model-Used')).toBe('gemini');
    expect(res.headers.get('X-Prompt-Dropped')).toBe('none');
    expect(res.headers.get('X-Prompt-Shortened')).toBe('none');

    delete process.env.GEMINI_API_KEY;
  });

  // WHY: The budget defers Groq, it does not veto it. Skipping a request that
  //      will probably 429 is worth doing while another provider might answer;
  //      refusing to make it when nothing else can is not. The first version of
  //      this got it backwards, and a bad Gemini key produced no answer at all
  //      with a healthy Groq key sitting right there — reported from a live
  //      deployment as "Every AI provider failed" with an invalid Gemini key
  //      and an over-budget Groq skip as the only two reasons.
  it('sends an over-budget prompt to Groq anyway when nothing else can answer', async () => {
    process.env.GROQ_API_KEY   = 'test-groq-key';
    process.env.GEMINI_API_KEY = 'bad-key';
    process.env.AGENT_GROQ_TPM = '10';   // Any real prompt is over this.

    mockSendMessageStream.mockRejectedValueOnce(new Error('[400 Bad Request] API key not valid.'));
    mockGroqCreate
      .mockResolvedValueOnce(pass1Response)      // Pass 1
      .mockResolvedValueOnce(fakeGroqStream());  // Pass 2, over budget but tried
    setupContextMocks();

    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'Anything' }] }));

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Model-Used')).toBe('groq');
    expect(await res.text()).toBe('Great pick! Start him.');

    delete process.env.GEMINI_API_KEY;
  });

  // WHY: When the deferred attempt fails too, the reader needs both reasons —
  //      the invalid key AND the size — not just whichever came last.
  it('names every reason when the over-budget retry also fails', async () => {
    process.env.GROQ_API_KEY   = 'test-groq-key';
    process.env.GEMINI_API_KEY = 'bad-key';
    process.env.AGENT_GROQ_TPM = '10';

    mockSendMessageStream.mockRejectedValueOnce(new Error('API key not valid'));
    mockGroqCreate
      .mockResolvedValueOnce(pass1Response)
      .mockRejectedValueOnce(new Error('429 rate_limit exceeded'));
    setupContextMocks();

    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'Anything' }] }));

    expect(res.status).toBe(502);
    const { error } = await res.json() as { error: string };
    expect(error).toContain('API key not valid');
    expect(error).toContain('rate_limit');

    delete process.env.GEMINI_API_KEY;
  });

  // WHY: A live catalogue read came back with no llama model on it at all —
  //      Groq had retired the family on that account — so the search fell
  //      through to gpt-oss-120b while the budget still carried llama-70b's
  //      12,000 ceiling. gpt-oss allows 8,000, and the difference is every
  //      panel-backed question refused. The ceiling belongs to the model that
  //      is actually going to serve the request.
  it('takes the per-minute budget from the model that will answer', async () => {
    // A distinct key: the catalogue cache is keyed by API key, so reusing the
    // shared one would serve an earlier test's model list.
    process.env.GROQ_API_KEY = 'groq-key-no-llama';
    process.env.AGENT_PRIMARY = 'groq';
    // A catalogue with no llama on it, exactly as reported from production.
    mockGroqModelList.mockResolvedValue({
      data: [{ id: 'openai/gpt-oss-120b' }, { id: 'openai/gpt-oss-20b' }, { id: 'groq/compound' }],
    });
    setupHappyPath();

    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'Anything' }] }));

    expect(res.headers.get('X-Groq-Tpm-Budget')).toBe('8000');
  });

  // WHY: An operator on a paid plan has a far higher ceiling than any of these,
  //      and must not be held to a free-tier table.
  it('lets AGENT_GROQ_TPM override the per-model table', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    process.env.AGENT_PRIMARY = 'groq';
    process.env.AGENT_GROQ_TPM = '300000';
    setupHappyPath();

    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'Anything' }] }));

    expect(res.headers.get('X-Groq-Tpm-Budget')).toBe('300000');
  });

  // WHY: The "take whatever chat model is on offer" fallback must not reach for
  //      a speech model or an agentic system. Both were on a real catalogue.
  it('never falls back to a non-chat model on the catalogue', async () => {
    process.env.GROQ_API_KEY = 'groq-key-exotic-catalogue';
    process.env.AGENT_PRIMARY = 'groq';
    // Nothing the candidate lists know about; only one of these can chat.
    mockGroqModelList.mockResolvedValue({
      data: [
        { id: 'canopylabs/orpheus-v1-english' },
        { id: 'groq/compound-mini' },
        { id: 'allam-2-7b' },
      ],
    });
    setupHappyPath();

    await POST(makeReq({ messages: [{ role: 'user', content: 'Anything' }] }));

    const answerCall = mockGroqCreate.mock.calls[1][0] as { model: string };
    expect(answerCall.model).toBe('allam-2-7b');
  });

  // WHY: A pinned Gemini model is a time bomb, and this one went off:
  //
  //        404 — This model models/gemini-2.5-flash is no longer available to
  //        new users. Please update your code to use models/gemini-3.6-flash
  //
  //      The probe had reported that model as available minutes earlier: being
  //      on the catalogue and being callable by a NEW key are different things.
  //      So a 404 has to move down the list rather than surface as an outage.
  it('moves to the next Gemini model when one is no longer available', async () => {
    delete process.env.GROQ_API_KEY;
    process.env.GEMINI_API_KEY = 'test-gemini-key';

    mockGenerateContent.mockResolvedValueOnce({ response: { text: () => pass1Content } });
    async function* geminiStream() { yield { text: () => 'Answered by the newer model.' }; }
    mockSendMessageStream
      .mockRejectedValueOnce(new Error(
        '[404 Not Found] This model models/gemini-2.5-flash is no longer available to new users. '
        + 'Please update your code to use models/gemini-3.6-flash',
      ))
      .mockResolvedValueOnce({ stream: geminiStream() });
    setupContextMocks();

    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'Anything' }] }));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('Answered by the newer model.');
    expect(mockSendMessageStream).toHaveBeenCalledTimes(2);

    delete process.env.GEMINI_API_KEY;
  });

  // WHY: Only a missing model is worth retrying. Walking the whole candidate
  //      list against a revoked key would turn one clear error into five.
  it('does not walk the model list on an error that is not a missing model', async () => {
    delete process.env.GROQ_API_KEY;
    process.env.GEMINI_API_KEY = 'bad-key';

    mockGenerateContent.mockResolvedValueOnce({ response: { text: () => pass1Content } });
    mockSendMessageStream.mockRejectedValue(new Error('[400 Bad Request] API key not valid.'));
    setupContextMocks();

    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'Anything' }] }));

    expect(res.status).toBe(502);
    expect(mockSendMessageStream).toHaveBeenCalledTimes(1);

    delete process.env.GEMINI_API_KEY;
  });

  // WHY: An operator who pins GEMINI_MODEL means it — a chain that wandered off
  //      a deliberate choice would be a surprise, not a recovery.
  it('uses only the pinned model when GEMINI_MODEL is set', async () => {
    delete process.env.GROQ_API_KEY;
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.GEMINI_MODEL   = 'gemini-3.6-flash';

    mockGenerateContent.mockResolvedValueOnce({ response: { text: () => pass1Content } });
    async function* geminiStream() { yield { text: () => 'Pinned.' }; }
    mockSendMessageStream.mockResolvedValueOnce({ stream: geminiStream() });
    setupContextMocks();

    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'Anything' }] }));

    expect(res.headers.get('X-Model-Id')).toBe('gemini-3.6-flash');

    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_API_KEY;
  });

  // WHY: A deployment cannot tell whether it is near its provider's per-minute
  //      ceiling without knowing what its prompts actually cost.
  it('reports the prompt size on every answer', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    process.env.AGENT_PRIMARY = 'groq';
    setupHappyPath();

    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'Anything' }] }));

    expect(Number(res.headers.get('X-Prompt-Tokens'))).toBeGreaterThan(0);
  });

  // WHY: A revoked key, a retired model ID or a Groq outage is not a 429, and it
  //      used to kill the whole assistant even with a healthy Gemini key present.
  //      Any provider failure must hand off, tagged with which one it was.
  it('falls back to Gemini when a Groq-first deployment hits a non-rate-limit error', async () => {
    process.env.GROQ_API_KEY   = 'test-groq-key';
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.AGENT_PRIMARY  = 'groq';

    mockGroqCreate
      .mockResolvedValueOnce(pass1Response)                 // Pass 1: OK
      .mockRejectedValueOnce(new Error('Invalid API key')); // Pass 2: auth error

    async function* fakeGeminiStream() {
      yield { text: () => 'Gemini answer here.' };
    }
    mockSendMessageStream.mockResolvedValueOnce({ stream: fakeGeminiStream() });
    setupContextMocks();

    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'Error test' }] }));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Model-Used')).toBe('gemini');
    expect(res.headers.get('X-Fallback-Reason')).toBe('groq_error');
    expect(await res.text()).toBe('Gemini answer here.');

    delete process.env.GEMINI_API_KEY;
  });

  // WHY: A Gemini-only deployment must work with no Groq key at all — including
  //      Pass 1, which prefers Groq and has to fall through to Gemini for the
  //      classification rather than silently downgrading every question to the
  //      `general` intent. Nothing fell back on the answer: Gemini leads.
  it('serves both passes from Gemini when GROQ_API_KEY is not configured', async () => {
    delete process.env.GROQ_API_KEY;
    process.env.GEMINI_API_KEY = 'test-gemini-key';

    // Pass 1 falls back to Gemini too — first generateContent is the planner.
    mockGenerateContent.mockResolvedValueOnce({
      response: { text: () => pass1Content },
    });
    async function* fakeGeminiStream() {
      yield { text: () => 'Gemini-only answer.' };
    }
    mockSendMessageStream.mockResolvedValueOnce({ stream: fakeGeminiStream() });
    setupContextMocks();

    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'Gemini only' }] }));
    expect(res.status).toBe(200);
    expect(mockGroqCreate).not.toHaveBeenCalled();
    expect(res.headers.get('X-Model-Used')).toBe('gemini');
    expect(res.headers.get('X-Fallback-Reason')).toBeNull();
    expect(await res.text()).toBe('Gemini-only answer.');

    delete process.env.GEMINI_API_KEY;
  });

  // WHY: When every provider is down the client needs the actual reasons, not a
  //      bare status — the 502 body names each provider and its error.
  it('returns 502 naming both providers when Groq and Gemini both fail', async () => {
    process.env.GROQ_API_KEY   = 'test-groq-key';
    process.env.GEMINI_API_KEY = 'test-gemini-key';

    mockGroqCreate
      .mockResolvedValueOnce(pass1Response)                  // Pass 1: OK
      .mockRejectedValueOnce(new Error('Invalid API key'));  // Pass 2: Groq down
    mockSendMessageStream.mockRejectedValueOnce(new Error('Gemini quota exhausted'));
    setupContextMocks();

    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'Both down' }] }));
    expect(res.status).toBe(502);
    const bodyText = (await res.json() as { error: string }).error;
    expect(bodyText).toContain('Invalid API key');
    expect(bodyText).toContain('Gemini quota exhausted');

    delete process.env.GEMINI_API_KEY;
  });

  // WHY: A provider that completes without emitting a token used to leave an
  //      empty assistant bubble on screen, indistinguishable from a hang.
  it('streams an explanatory note when the model emits no content', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    async function* emptyStream() { /* no chunks */ }
    mockGroqCreate
      .mockResolvedValueOnce(pass1Response)
      .mockResolvedValueOnce(emptyStream());
    setupContextMocks();

    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'Silence' }] }));
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/empty response/i);
  });

  // WHY: Headers are already flushed when a mid-stream failure hits, so the
  //      error cannot become a status code. It must reach the user as text
  //      appended to whatever had already streamed, not as a torn-down stream.
  it('appends a readable note when the stream breaks mid-answer', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    async function* brokenStream() {
      yield { choices: [{ delta: { content: 'Start him' } }] };
      throw new Error('upstream connection reset');
    }
    mockGroqCreate
      .mockResolvedValueOnce(pass1Response)
      .mockResolvedValueOnce(brokenStream());
    setupContextMocks();

    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'Break' }] }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('Start him');
    expect(text).toContain('upstream connection reset');
  });

  // WHY: A hardcoded model ID is a time bomb — Groq retires models and every
  //      request then 404s, which reads as an outage. The model actually used
  //      must come from the account's own catalogue.
  //      NOTE: the catalogue cache is keyed by API key, so these tests use a
  //      distinct key to avoid inheriting an earlier test's catalogue.
  it('picks the model from the catalogue the account can reach', async () => {
    process.env.GROQ_API_KEY = 'discovery-key-1';
    // llama-3.1-8b-instant is gone; the next answer candidate should win.
    mockGroqModelList.mockResolvedValue({
      data: [{ id: 'llama-3.3-70b-versatile' }, { id: 'whisper-large-v3' }],
    });
    setupHappyPath();

    await POST(makeReq({ messages: [{ role: 'user', content: 'Which model?' }] }));

    const [pass1Call, pass2Call] = mockGroqCreate.mock.calls;
    expect((pass1Call[0] as { model: string }).model).toBe('llama-3.3-70b-versatile');
    expect((pass2Call[0] as { model: string }).model).toBe('llama-3.3-70b-versatile');
  });

  // WHY: An operator pinning GROQ_MODEL must not be second-guessed, and pinning
  //      it should not cost a catalogue round-trip.
  it('honours GROQ_MODEL without listing the catalogue', async () => {
    process.env.GROQ_API_KEY = 'discovery-key-2';
    process.env.GROQ_MODEL   = 'pinned-model-id';
    setupHappyPath();

    await POST(makeReq({ messages: [{ role: 'user', content: 'Pinned' }] }));

    expect(mockGroqModelList).not.toHaveBeenCalled();
    expect((mockGroqCreate.mock.calls[1][0] as { model: string }).model).toBe('pinned-model-id');
  });

  // WHY: This is the exact failure seen in production — a 404 model_not_found on
  //      every request. A stale cached catalogue must be re-read and retried
  //      once, rather than falling through to a second provider.
  it('refreshes the catalogue and retries once on model_not_found', async () => {
    process.env.GROQ_API_KEY = 'discovery-key-3';
    mockGroqModelList.mockResolvedValue({ data: [{ id: 'llama-3.3-70b-versatile' }] });

    mockGroqCreate
      .mockResolvedValueOnce(pass1Response)                                        // Pass 1
      .mockRejectedValueOnce(new Error('404 {"error":{"code":"model_not_found"}}')) // Pass 2, stale ID
      .mockResolvedValueOnce(fakeGroqStream());                                     // Pass 2, retry
    setupContextMocks();

    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'Retry' }] }));

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Model-Used')).toBe('groq');
    expect(await res.text()).toBe('Great pick! Start him.');
  });

  // WHY: A malformed body used to throw out of req.json() as an unhandled
  //      framework 500 with an HTML body, which the client could only render as
  //      a generic failure.
  it('returns 400 with a JSON error when the body is not valid JSON', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';

    const req = new NextRequest('http://localhost/api/agent', {
      method: 'POST',
      body: 'not json at all',
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toMatch(/valid JSON/);
  });

  // WHY: The route trims conversation history to the last 6 messages before
  //      sending to the model (context window budget). A 10-message conversation
  //      must only forward messages 5–10 to the AI.
  it('trims messages to the last 6 before sending to Groq', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    setupHappyPath();

    const manyMessages = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i + 1}`,
    }));

    await POST(makeReq({ messages: manyMessages }));

    // Pass 2's messages argument (index 1 in the call) should be the last 6.
    const pass2Args = mockGroqCreate.mock.calls[1][0] as {
      messages: { role: string; content: string }[]
    };
    // The system prompt is prepended, so user messages start at index 1.
    const userMessages = pass2Args.messages.filter((m) => m.role !== 'system');
    expect(userMessages).toHaveLength(6);
    expect(userMessages[0].content).toBe('Message 5');
    expect(userMessages[5].content).toBe('Message 10');
  });
  // ── Phase 3: the dashboard panels ─────────────────────────────────────────
  //
  // The issue these come from quoted the assistant answering "should I start or
  // sit my running back this week?" with a request to name the running back. It
  // had no way to know: its league data was standings and bare roster lists.
  // These pin the three panels reaching the prompt instead.

  // WHY: A start/sit question is answered from the asker's own lineup. If the
  //      panel is not fetched there is nothing to answer it with, and the model
  //      falls back to asking the reader who they meant.
  it('fetches the matchup and waiver panels for a start/sit question', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    mockGroqCreate
      .mockResolvedValueOnce(planningAs('start_sit', { position: 'RB' }))
      .mockResolvedValueOnce(fakeGroqStream());
    setupContextMocks();

    const res = await POST(makeReq({
      messages: [{ role: 'user', content: 'Should I start or sit my running back this week?' }],
      sleeperLeagueId: 'league-1',
    }));

    expect(res.headers.get('X-Query-Intent')).toBe('start_sit');
    expect(mockFetchTools).toHaveBeenCalledWith('league-1', 'sleeper-1', { matchup: true, waivers: true });
  });

  // WHY: Which manager's roster this is about is not the browser's to nominate.
  //      The Sleeper ID comes off the session; the body only names the league.
  it('takes the Sleeper user from the session, never from the request body', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    mockGroqCreate
      .mockResolvedValueOnce(planningAs('waiver_wire'))
      .mockResolvedValueOnce(fakeGroqStream());
    setupContextMocks();

    await POST(makeReq({
      messages: [{ role: 'user', content: 'Who should I pick up?' }],
      sleeperLeagueId: 'league-1',
      sleeperUserId: 'somebody-else',
    }));

    expect(mockFetchTools).toHaveBeenCalledWith('league-1', 'sleeper-1', expect.anything());
  });

  // WHY: A question about the NFL at large costs no Sleeper build. Fetching all
  //      three panels behind every prompt would put a live roster/odds/weather
  //      round trip in front of "who were the best QBs last year".
  it('fetches no panels for a question that is not about the reader\'s team', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    mockGroqCreate
      .mockResolvedValueOnce(planningAs('top_position', { position: 'QB', season: 2024 }))
      .mockResolvedValueOnce(fakeGroqStream());
    setupContextMocks();

    await POST(makeReq({
      messages: [{ role: 'user', content: 'Who were the best QBs last year?' }],
      sleeperLeagueId: 'league-1',
    }));

    expect(mockFetchTools).toHaveBeenCalledWith('league-1', 'sleeper-1', {});
  });

  // WHY: The panel block is the answer to the start/sit question. If it does not
  //      reach the system prompt, none of the rest of this matters.
  it('puts the panel block in the system prompt and names it in a header', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    mockGroqCreate
      .mockResolvedValueOnce(planningAs('start_sit'))
      .mockResolvedValueOnce(fakeGroqStream());
    setupContextMocks();
    mockFetchTools.mockResolvedValue({
      matchup: { week: 12 } as never, waivers: { scanned: 1 } as never, trades: null, errors: [],
    });
    mockFormatTools.mockReturnValue('--- MY MATCHUP — Week 12 ---\nMY STARTERS:\n  RB Real Player');

    const res = await POST(makeReq({
      messages: [{ role: 'user', content: 'Who should I start at flex?' }],
      sleeperLeagueId: 'league-1',
    }));

    expect(res.headers.get('X-Panel-Data')).toBe('matchup,waivers');
    expect(systemPromptSent()).toContain('MY STARTERS');
  });

  // WHY: With no roster to read, the old prompt told the model the data was
  //      insufficient and it refused. The instruction now is to answer the
  //      general question and mention the league selector once.
  it('tells the model to answer generally when no roster could be read', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    mockGroqCreate
      .mockResolvedValueOnce(planningAs('start_sit'))
      .mockResolvedValueOnce(fakeGroqStream());
    setupContextMocks();

    const res = await POST(makeReq({
      messages: [{ role: 'user', content: 'Should I start my running back?' }],
    }));

    expect(res.headers.get('X-Panel-Data')).toBe('none');
    const prompt = systemPromptSent();
    expect(prompt).toContain('No roster is connected');
    expect(prompt).toContain('league selector');
  });

  // WHY: The other failure in the issue — "none of these are quarterbacks" —
  //      came from ten bare names with no positions on them.
  it('labels trending rows with each player\'s position and team', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    mockGroqCreate
      .mockResolvedValueOnce(planningAs('trending', { position: 'QB' }))
      .mockResolvedValueOnce(fakeGroqStream());
    setupContextMocks();
    mockFetchTrending.mockResolvedValue({
      adds:  [{ player_id: 'a1', count: 12043, type: 'add' as const }],
      drops: [{ player_id: 'd1', count: 900,   type: 'drop' as const }],
    });
    mockFetchPlayerIndex.mockResolvedValue({
      a1: { name: 'Rising Passer', position: 'QB', team: 'WAS' },
      d1: { name: 'Falling Back',  position: 'RB', team: 'NYG' },
    });

    await POST(makeReq({ messages: [{ role: 'user', content: 'Which QBs are trending up this week?' }] }));

    const prompt = systemPromptSent();
    expect(prompt).toContain('Rising Passer (QB WAS) — added 12,043x');
    expect(prompt).toContain('Falling Back (RB NYG) — dropped 900x');
  });

  // WHY: "None of these are quarterbacks" was a true statement about a
  //      popularity list read as if it were a form ranking. The prompt now says
  //      which list answers which question.
  it('tells the model the trending list is popularity, not form', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    mockGroqCreate
      .mockResolvedValueOnce(planningAs('trending', { position: 'QB' }))
      .mockResolvedValueOnce(fakeGroqStream());
    setupContextMocks();

    await POST(makeReq({ messages: [{ role: 'user', content: 'Which QBs are trending up this week?' }] }));

    const prompt = systemPromptSent();
    expect(prompt).toContain('popularity snapshot');
    expect(prompt).toMatch(/answer from NFL STATS instead/);
  });
  // ── Cost control ──────────────────────────────────────────────────────────
  //
  // A panel-backed prompt runs 5,000-9,000 tokens, twice per question, against
  // free-tier quotas measured in hundreds of requests a day. These are the
  // places that were spending more than they had to.

  // WHY: The six openers the page shows are fixed strings with known intents.
  //      Classifying them costs ~870 tokens and a request against a per-minute
  //      quota to learn what the button already knew.
  it('skips the classification pass for a prompt the page itself offers', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    mockGroqCreate.mockResolvedValueOnce(fakeGroqStream());  // the answer, and nothing else
    setupContextMocks();
    process.env.AGENT_PRIMARY = 'groq';

    const res = await POST(makeReq({
      messages: [{ role: 'user', content: SUGGESTED_PROMPTS[1].text }],
      sleeperLeagueId: 'league-1',
    }));

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Query-Intent')).toBe('start_sit');
    // One call: the answer. Pass 1 never happened.
    expect(mockGroqCreate).toHaveBeenCalledTimes(1);
  });

  // WHY: A near-miss is a different question, and guessing its intent to save a
  //      call would put the wrong data in front of the model — which costs more
  //      than the call does.
  it('still classifies a question that only resembles an opener', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    process.env.AGENT_PRIMARY = 'groq';
    mockGroqCreate
      .mockResolvedValueOnce(planningAs('waiver_wire'))
      .mockResolvedValueOnce(fakeGroqStream());
    setupContextMocks();

    await POST(makeReq({ messages: [{ role: 'user', content: 'Who should I start at quarterback?' }] }));

    expect(mockGroqCreate).toHaveBeenCalledTimes(2);
  });

  // WHY: The app's daily budget is its copy of the provider's. Reaching ours
  //      first is the point: past the provider's, the 429 arrives from inside a
  //      streaming answer and the browser can only say "unavailable".
  it('returns 429 with the daily figures once the app-wide budget is spent', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    mockDailyLimit.mockReturnValueOnce({ allowed: false, used: 50, remaining: 0, resetAt: 1750000000000 });

    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'Hello' }] }));

    expect(res.status).toBe(429);
    expect((await res.json() as { error: string }).error).toMatch(/daily limit for everyone/);
    expect(res.headers.get('X-Daily-Limit')).toBe('50');
    expect(res.headers.get('X-Daily-Prompts-Used')).toBe('50');
    // Refused before either model call — that is the whole saving.
    expect(mockGroqCreate).not.toHaveBeenCalled();
  });

  // WHY: ~1,600 tokens of every roster in the league, on a question about which
  //      of two of the reader's own running backs to start. The matchup panel
  //      already carries their roster and their opponent's, with projections.
  it('leaves league context out of a question the panels already answer', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    process.env.AGENT_PRIMARY = 'groq';
    mockGroqCreate
      .mockResolvedValueOnce(planningAs('start_sit'))
      .mockResolvedValueOnce(fakeGroqStream());
    setupContextMocks();

    const res = await POST(makeReq({
      messages: [{ role: 'user', content: 'Should I start my running back?' }],
      sleeperLeagueId: 'league-1',
    }));

    expect(mockFetchLeagueContext).not.toHaveBeenCalled();
    expect(res.headers.get('X-League-Context')).toBe('false');
  });

  // WHY: The three questions that ARE about the other rosters still need them.
  it('still fetches league context for a standings question', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    process.env.AGENT_PRIMARY = 'groq';
    mockGroqCreate
      .mockResolvedValueOnce(planningAs('standings'))
      .mockResolvedValueOnce(fakeGroqStream());
    setupContextMocks();

    await POST(makeReq({
      messages: [{ role: 'user', content: 'Who is in first place?' }],
      sleeperLeagueId: 'league-1',
    }));

    expect(mockFetchLeagueContext).toHaveBeenCalled();
  });

  // WHY: ~900 tokens of fifty players who are not on the roster being asked
  //      about. The prompt had to warn the model not to misread them; not
  //      showing them where they cannot help is cheaper than the warning.
  it('leaves the trending lists out of a start/sit question and keeps them for waivers', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    process.env.AGENT_PRIMARY = 'groq';
    mockGroqCreate
      .mockResolvedValueOnce(planningAs('start_sit'))
      .mockResolvedValueOnce(fakeGroqStream());
    setupContextMocks();
    mockFetchTrending.mockResolvedValue({
      adds:  [{ player_id: 'a1', count: 12043, type: 'add' as const }],
      drops: [{ player_id: 'd1', count: 900,   type: 'drop' as const }],
    });
    mockFetchPlayerIndex.mockResolvedValue({
      a1: { name: 'Rising Passer', position: 'QB', team: 'WAS' },
      d1: { name: 'Falling Back',  position: 'RB', team: 'NYG' },
    });

    await POST(makeReq({ messages: [{ role: 'user', content: 'Start or sit?' }], sleeperLeagueId: 'league-1' }));
    expect(systemPromptSent()).not.toContain('TRENDING ADDS');

    mockGroqCreate.mockReset();
    mockGroqCreate
      .mockResolvedValueOnce(planningAs('waiver_wire'))
      .mockResolvedValueOnce(fakeGroqStream());

    await POST(makeReq({ messages: [{ role: 'user', content: 'Who do I add?' }], sleeperLeagueId: 'league-1' }));
    expect(systemPromptSent()).toContain('Rising Passer (QB WAS)');
  });
});

// ── GET /api/agent ────────────────────────────────────────────────────────────

describe('GET /api/agent?usage=1', () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockPeekLimit.mockReset();
    mockCheckLimit.mockReset();
    mockDailyLimit.mockReset();
    mockDailyLimit.mockReturnValue({ allowed: true, used: 4, remaining: 46, resetAt: 1750000000000 });
    mockAuth.mockResolvedValue(fakeSession as never);
    mockPeekLimit.mockReturnValue({ used: 7, remaining: 3, resetAt: 1750000000000 });
  });

  function usageReq(): NextRequest {
    return new NextRequest('http://localhost/api/agent?usage=1');
  }

  // WHY: This is what a reloaded page reads. Before it existed the browser had
  //      no way to ask, and drew a full allowance over a spent window.
  it('reports the client\'s current hourly usage', async () => {
    const res = await GET(usageReq());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      limit: 10, used: 7, remaining: 3, resetAt: 1750000000000,
      dailyLimit: 50, dailyUsed: 4, dailyResetAt: 1750000000000,
    });
  });

  // WHY: The page polls this on every mount. A debiting read would spend the
  //      allowance on page loads rather than on prompts.
  it('reads the bucket without spending from it', async () => {
    await GET(usageReq());
    expect(mockPeekLimit).toHaveBeenCalledTimes(1);
    expect(mockCheckLimit).not.toHaveBeenCalled();
  });

  // WHY: Usage is per client, and a signed-out caller has none to report.
  it('returns 401 when the caller is not signed in', async () => {
    mockAuth.mockResolvedValueOnce(null as never);
    expect((await GET(usageReq())).status).toBe(401);
  });
});
