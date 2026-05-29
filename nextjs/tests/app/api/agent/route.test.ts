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
  getClientId:      jest.fn().mockReturnValue('test-client'),
  checkHourlyLimit: jest.fn(),
  getDailyCount:    jest.fn().mockReturnValue(1),
  incrementDaily:   jest.fn(),
}));

jest.mock('@/lib/agentContext', () => ({
  fetchTrending:         jest.fn(),
  fetchSleeperPlayerMap: jest.fn(),
  fetchLeagueContext:    jest.fn(),
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
jest.mock('groq-sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockGroqCreate } },
  })),
}));

// Gemini SDK mock — used for the fallback streaming path.
// __esModule: true prevents the same double-wrapping issue as groq-sdk.
const mockSendMessageStream = jest.fn<() => Promise<unknown>>();
const mockStartChat = jest.fn().mockReturnValue({ sendMessageStream: mockSendMessageStream });
const mockGetGenerativeModel = jest.fn().mockReturnValue({ startChat: mockStartChat });
jest.mock('@google/generative-ai', () => ({
  __esModule: true,
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}));

import { POST } from '@/app/api/agent/route';
import { auth } from '@/auth';
import { checkHourlyLimit } from '@/lib/rateLimit';
import { fetchTrending, fetchSleeperPlayerMap } from '@/lib/agentContext';
import { prisma } from '@/lib/prisma';

const mockAuth           = auth           as jest.MockedFunction<typeof auth>;
const mockCheckLimit     = checkHourlyLimit as jest.MockedFunction<typeof checkHourlyLimit>;
const mockFetchTrending  = fetchTrending   as jest.MockedFunction<typeof fetchTrending>;
const mockFetchPlayerMap = fetchSleeperPlayerMap as jest.MockedFunction<typeof fetchSleeperPlayerMap>;
const mockStatFindFirst  = prisma.nflWeeklyStat.findFirst as jest.MockedFunction<typeof prisma.nflWeeklyStat.findFirst>;
const mockStatFindMany   = prisma.nflWeeklyStat.findMany  as jest.MockedFunction<typeof prisma.nflWeeklyStat.findMany>;
const mockStatGroupBy    = prisma.nflWeeklyStat.groupBy   as jest.MockedFunction<typeof prisma.nflWeeklyStat.groupBy>;

// ── Helpers ───────────────────────────────────────────────────────────────────

// A minimal, valid session object.
const fakeSession = { user: { id: 'user-1', role: 'MEMBER', pendingOAuth: false } };

// The two Groq responses needed for a full round-trip:
//   Pass 1: non-streaming JSON intent plan.
//   Pass 2: streaming async iterable of text chunks.
const pass1Response = {
  choices: [{
    message: {
      content: '{"intent":"general","players":[],"position":null,"opponent":null,"season":null,"weeksBack":null}',
    },
  }],
};

async function* fakeGroqStream() {
  yield { choices: [{ delta: { content: 'Great pick!' } }] };
  yield { choices: [{ delta: { content: ' Start him.' } }] };
}

// Sets up the happy-path mock chain for a successful two-pass agent response.
function setupHappyPath(): void {
  mockGroqCreate
    .mockResolvedValueOnce(pass1Response)        // Pass 1: intent classification
    .mockResolvedValueOnce(fakeGroqStream());    // Pass 2: streaming answer
  mockFetchTrending.mockResolvedValue({ adds: [], drops: [] });
  mockFetchPlayerMap.mockResolvedValue({});
  // DB fallback stats query
  mockStatFindFirst.mockResolvedValue(null as never);
  mockStatFindMany.mockResolvedValue([] as never);
  mockStatGroupBy.mockResolvedValue([] as never);
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
    mockFetchPlayerMap.mockReset();
    mockStatFindFirst.mockReset();
    mockStatFindMany.mockReset();
    mockStatGroupBy.mockReset();
    mockSendMessageStream.mockReset();

    // Default: authenticated, within rate limit.
    mockAuth.mockResolvedValue(fakeSession as never);
    mockCheckLimit.mockReturnValue({ allowed: true, remaining: 9, resetAt: 9999999 });
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
    // Route returns a generic 500 error when neither key is present.
    expect(res.status).toBeGreaterThanOrEqual(400);

    process.env.GROQ_API_KEY   = originalGroq;
    process.env.GEMINI_API_KEY = originalGemini;
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

  // WHY: When Groq returns 429 and GEMINI_API_KEY is configured, the route must
  //      automatically retry on Gemini without returning an error to the client.
  //      The X-Model-Used header tells the client which path was taken, and
  //      X-Fallback-Reason explains why Groq was bypassed.
  it('falls back to Gemini when Groq returns a 429 rate-limit error', async () => {
    process.env.GROQ_API_KEY   = 'test-groq-key';
    process.env.GEMINI_API_KEY = 'test-gemini-key';

    // Pass 1 succeeds (always Groq), Pass 2 throws with a 429 message.
    const groqRateLimitErr = new Error('429 rate_limit exceeded') as Error & { status: number };
    groqRateLimitErr.status = 429;

    mockGroqCreate
      .mockResolvedValueOnce(pass1Response)           // Pass 1: OK
      .mockRejectedValueOnce(groqRateLimitErr);       // Pass 2: 429

    // Gemini fallback streaming response.
    async function* fakeGeminiStream() {
      yield { text: () => 'Gemini answer here.' };
    }
    mockSendMessageStream.mockResolvedValueOnce({ stream: fakeGeminiStream() });

    mockFetchTrending.mockResolvedValue({ adds: [], drops: [] });
    mockFetchPlayerMap.mockResolvedValue({});
    mockStatFindFirst.mockResolvedValue(null as never);
    mockStatFindMany.mockResolvedValue([] as never);
    mockStatGroupBy.mockResolvedValue([] as never);

    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'Fallback test' }] }));

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Model-Used')).toBe('gemini');
    expect(res.headers.get('X-Fallback-Reason')).toBe('groq_rate_limit');

    delete process.env.GEMINI_API_KEY;
  });

  // WHY: If Groq fails with a non-429 error (e.g. invalid key, server error),
  //      there is no reason to try Gemini — return 502 immediately so the client
  //      can display a clear error rather than waiting for a second timeout.
  it('returns 502 when Groq fails with a non-rate-limit error', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';

    mockGroqCreate
      .mockResolvedValueOnce(pass1Response)            // Pass 1: OK
      .mockRejectedValueOnce(new Error('Invalid API key')); // Pass 2: auth error

    mockFetchTrending.mockResolvedValue({ adds: [], drops: [] });
    mockFetchPlayerMap.mockResolvedValue({});
    mockStatFindFirst.mockResolvedValue(null as never);
    mockStatFindMany.mockResolvedValue([] as never);
    mockStatGroupBy.mockResolvedValue([] as never);

    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'Error test' }] }));
    expect(res.status).toBe(502);
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
});
