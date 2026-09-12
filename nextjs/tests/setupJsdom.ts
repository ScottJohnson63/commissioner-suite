// Globals that jsdom does not implement but Node does.
//
// jsdom ships no TextEncoder/TextDecoder (they are WHATWG Encoding APIs that
// jsdom has never picked up), so any module that reaches for them at import
// time throws a bare `ReferenceError: TextEncoder is not defined` before a
// single test runs.
//
// Prisma's client runtime is one such module: it generates ids with cuid2,
// which hashes a fingerprint via @noble/hashes at module load. That runs the
// moment a component test imports anything that transitively pulls in
// `@/lib/prisma`. Under the old Rust query engine the id generation happened
// outside JS, so this only started to matter with `engineType = "client"`.
//
// setupFiles (not setupFilesAfterEnv) so the assignment lands before the test
// file — and therefore its imports — is evaluated.
import { TextDecoder, TextEncoder } from 'node:util';

const globals = globalThis as unknown as {
  TextEncoder?: typeof TextEncoder;
  TextDecoder?: typeof TextDecoder;
};

globals.TextEncoder ??= TextEncoder;
globals.TextDecoder ??= TextDecoder;
