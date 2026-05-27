/** @type {import('jest').Config} */

// Shared @/ alias used by both test environments
const baseMapper = { '^@/(.*)$': '<rootDir>/src/$1' };

const config = {
  // v8 is faster and requires no babel transforms
  coverageProvider: 'v8',

  // Which source files to measure
  collectCoverageFrom: [
    'src/lib/**/*.ts',
    'src/app/api/**/*.ts',
    'src/hooks/**/*.ts',
    'src/components/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/lib/prisma.tsx',         // thin re-export, not worth mocking
    '!src/lib/scheduler/types.ts', // type-only, no runtime branches
    '!src/types/**',
    // Old non-Jest scripts that are superseded by proper test files in tests/unit/
    '!src/lib/scheduler/engine.test.ts',
    '!src/lib/sleeper/sync.test.ts',
    // Components and hooks have no tests yet (Phase 6). Exclude until that phase
    // is complete; add them back and raise the threshold once tests are written.
    '!src/components/**',
    '!src/hooks/**',
  ],

  // Phase 2–5 thresholds.
  // These reflect the current state: pure-lib and targeted API route tests are
  // written; complex routes (agent, matchup-report, waiver/trade, auth) and all
  // components/hooks are deferred to later phases.
  // Target: raise to 85/80/85/85 after Phase 6 (component tests) is complete.
  coverageThreshold: {
    global: { lines: 35, branches: 60, functions: 40, statements: 35 },
  },

  // Two separate Jest projects so API-route tests run under Node and
  // component tests run under jsdom (avoids per-file @jest-environment pragmas).
  // The jsdom project requires: npm install --save-dev jest-environment-jsdom
  //   @testing-library/react @testing-library/user-event @testing-library/jest-dom
  projects: [
    {
      displayName: 'node',
      preset: 'ts-jest',
      testEnvironment: 'node',
      moduleNameMapper: baseMapper,
      // Unit tests in tests/unit/ and API route tests in tests/app/
      testMatch: [
        '<rootDir>/tests/unit/**/*.test.ts',
        '<rootDir>/tests/app/**/*.test.ts',
      ],
      setupFiles: ['<rootDir>/tests/setup.ts'],
    },
    {
      displayName: 'jsdom',
      preset: 'ts-jest',
      testEnvironment: 'jest-environment-jsdom',
      moduleNameMapper: baseMapper,
      // Component and hook tests that require a DOM
      testMatch: [
        '<rootDir>/tests/components/**/*.test.tsx',
        '<rootDir>/tests/hooks/**/*.test.ts',
      ],
      setupFiles: ['<rootDir>/tests/setup.ts'],
      // setupFilesAfterEnv runs after Jest's test environment is ready, making
      // jest-dom's custom matchers (toBeInTheDocument etc.) available globally.
      setupFilesAfterEnv: ['<rootDir>/tests/setupDom.ts'],
    },
  ],
};

module.exports = config;