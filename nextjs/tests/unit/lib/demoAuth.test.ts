// tests/unit/lib/demoAuth.test.ts
//
// The demo provider hands out a real session with no password, so the guard
// that decides whether it exists at all is the thing worth pinning down.
//
// IS_DEMO_LOGIN is read at module load, so every case re-imports the module
// after setting the environment rather than mutating a captured constant.

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

const findUnique = jest.fn<(args: unknown) => Promise<unknown>>();

jest.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique } },
}));

const ORIGINAL_ENV = { ...process.env };

async function loadModule() {
  jest.resetModules();
  return import('@/lib/demoAuth');
}

describe('demoAuth', () => {
  beforeEach(() => {
    findUnique.mockReset();
    delete process.env.DEMO_MODE;
    delete process.env.DEMO_LOGIN_USERNAME;
    delete process.env.ADMIN_USERNAME;
  });

  afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

  it('does not enable the provider unless DEMO_MODE is exactly "true"', async () => {
    process.env.DEMO_MODE = 'TRUE';
    expect((await loadModule()).IS_DEMO_LOGIN).toBe(false);
  });

  it('is disabled when DEMO_MODE is unset', async () => {
    expect((await loadModule()).IS_DEMO_LOGIN).toBe(false);
  });

  it('is enabled when DEMO_MODE=true', async () => {
    process.env.DEMO_MODE = 'true';
    expect((await loadModule()).IS_DEMO_LOGIN).toBe(true);
  });

  // WHY: A stale DEMO_MODE on a real deployment would otherwise sign visitors
  //      in as the admin. Refusing without the flag is the whole safety story.
  it('refuses to authorize while disabled, even with a matching user', async () => {
    findUnique.mockResolvedValue({ id: 'u1', name: 'Admin', email: null });
    const { authorizeDemo } = await loadModule();

    expect(await authorizeDemo()).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('resolves the admin account by default', async () => {
    process.env.DEMO_MODE = 'true';
    findUnique.mockResolvedValue({ id: 'u1', name: 'Admin', email: 'a@b.c' });
    const { authorizeDemo, demoUsername } = await loadModule();

    expect(demoUsername()).toBe('admin');
    expect(await authorizeDemo()).toEqual({ id: 'u1', name: 'Admin', email: 'a@b.c' });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { username: 'admin' } }),
    );
  });

  it('prefers DEMO_LOGIN_USERNAME over ADMIN_USERNAME', async () => {
    process.env.DEMO_MODE = 'true';
    process.env.ADMIN_USERNAME = 'root';
    process.env.DEMO_LOGIN_USERNAME = 'guest';
    findUnique.mockResolvedValue({ id: 'u2', name: null, email: null });
    const { authorizeDemo, demoUsername } = await loadModule();

    expect(demoUsername()).toBe('guest');
    await authorizeDemo();
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { username: 'guest' } }),
    );
  });

  it('falls back to ADMIN_USERNAME when no demo account is named', async () => {
    process.env.DEMO_MODE = 'true';
    process.env.ADMIN_USERNAME = 'root';
    expect((await loadModule()).demoUsername()).toBe('root');
  });

  // WHY: A synthetic id would produce a session that 404s in every route that
  //      looks the user up, which is harder to diagnose than a failed sign-in.
  it('fails the sign-in rather than inventing a user', async () => {
    process.env.DEMO_MODE = 'true';
    findUnique.mockResolvedValue(null);
    const { authorizeDemo } = await loadModule();

    expect(await authorizeDemo()).toBeNull();
  });
});
