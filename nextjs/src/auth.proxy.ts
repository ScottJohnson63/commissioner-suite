// src/auth.proxy.ts
//
// The `auth()` that src/proxy.ts uses — the same helper @/auth exports, built
// from @/auth.config alone so that no database code reaches the middleware.
//
// Why this is a module of its own rather than two lines inside proxy.ts: it
// keeps proxy.ts to routing policy, and it gives the proxy tests a seam to mock
// (tests/unit/proxy.test.ts) without pulling in next-auth, which ships ESM that
// ts-jest does not transform.
//
// See @/auth.config for why the middleware must not import @/auth.

import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';

export const { auth } = NextAuth(authConfig);
