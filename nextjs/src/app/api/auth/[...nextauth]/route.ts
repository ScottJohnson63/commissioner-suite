// src/app/api/auth/[...nextauth]/route.ts
//
// AUTH: GET,POST inline — NextAuth owns these handlers; this is the sign-in
//      endpoint itself

import { handlers } from '@/auth';

export const { GET, POST } = handlers;
