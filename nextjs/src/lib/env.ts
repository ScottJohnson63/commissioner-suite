function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

export const env = {
  DATABASE_URL:   requireEnv('DATABASE_URL'),
  GROQ_API_KEY:   requireEnv('GROQ_API_KEY'),
  ODDS_API_KEY:   requireEnv('ODDS_API_KEY'),
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? '',
};
