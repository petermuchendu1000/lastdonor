/*
  `server-only` throws on import so a server module can never be pulled
  into a client bundle. Under Vitest every module is "client", so any
  test that transitively imports a server module died at collection
  with "This module cannot be imported from a Client Component module".

  Tests used to work around it one file at a time with
  `vi.mock('server-only', () => ({}))`. That only protects the files
  someone remembered: adding `src/lib/echo-counters.ts` (which imports
  it, correctly) broke FIVE existing suites at once, and because a file
  that fails to collect contributes zero tests, the summary still read
  "5898 passed" while 80 tests silently stopped running.

  Aliasing it here neutralises it for the whole suite, so the guard
  keeps working in the build and stops being a tripwire in tests.
*/
export {};
