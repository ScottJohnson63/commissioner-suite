// Shared Prisma mock helper.
//
// Import `mockPrisma` in any test file that touches the database.
// The module-level jest.mock() must still be declared in each test file
// (Jest hoisting requires the call to appear in the file that uses it),
// but this helper gives you typed mock functions to call .mockResolvedValue()
// on without repeating the full mock shape everywhere.
//
// Usage in a test file:
//
//   jest.mock('@/lib/prisma', () => require('../../../tests/mocks/prisma').prismaMockModule);
//   import { mockPrisma } from '../../mocks/prisma';
//   ...
//   mockPrisma.league.findMany.mockResolvedValue([...]);

import { jest } from '@jest/globals';

// The shape mirrors every Prisma model method used across the codebase.
// Add new models/methods here as tests expand coverage.
export const mockPrisma = {
  league: {
    findMany:   jest.fn(),
    findUnique: jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
    upsert:     jest.fn(),
  },
  team: {
    findMany:   jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  auditLog: {
    create:   jest.fn(),
    findMany: jest.fn(),
  },
  user: {
    findMany:   jest.fn(),
    findUnique: jest.fn(),
    update:     jest.fn(),
  },
  sleeperCache: {
    findUnique: jest.fn(),
    upsert:     jest.fn(),
  },
  nflWeeklyStat: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  schedule: {
    findFirst:  jest.fn(),
    findUnique: jest.fn(),
    create:     jest.fn(),
    delete:     jest.fn(),
    upsert:     jest.fn(),
  },
  draftOrder: {
    findFirst:  jest.fn(),
    findUnique: jest.fn(),
    create:     jest.fn(),
    upsert:     jest.fn(),
  },
  lotteryLog: {
    findMany: jest.fn(),
    create:   jest.fn(),
  },
};

// The object that jest.mock's factory function should return.
// Using `require()` syntax because jest.mock factories are hoisted before imports.
export const prismaMockModule = { prisma: mockPrisma };

// Resets all mock implementations and call history.
// Call in beforeEach to keep tests isolated.
export function resetMockPrisma(): void {
  for (const model of Object.values(mockPrisma)) {
    for (const fn of Object.values(model as Record<string, ReturnType<typeof jest.fn>>)) {
      fn.mockReset();
    }
  }
}
