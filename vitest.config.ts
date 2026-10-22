import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    // Vitest tests under `e2e/` are included on purpose, and the exclude
    // below is narrowed from a blanket `e2e` glob to the Playwright specs
    // only.
    //
    // The E2E seed fixture lives in `e2e/fixtures/`, and its guard - the
    // thing that refuses to write to a database that is not obviously
    // disposable - needs to be a real gate in the unit suite. Under the old
    // blanket exclude, a test file next to that fixture was collected by
    // nothing and asserted nothing, which is the shape of a ratchet that has
    // quietly stopped ratcheting (docs/99).
    //
    // The split is by extension and is unambiguous: Playwright specs are
    // `.spec.ts` and only Playwright runs them; Vitest tests are `.test.ts`.
    //
    // (Line comments, not a block comment: the glob patterns below contain
    // the sequence that would close one, which is an error the config fails
    // to parse on rather than ignores.)
    include: [
      'src/**/*.test.{ts,tsx}',
      'test/security/**/*.test.ts',
      'e2e/**/*.test.ts',
    ],
    exclude: ['e2e/**/*.spec.ts', 'src/**/*.integration.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // See test/stubs/server-only.ts for why.
      'server-only': path.resolve(__dirname, './test/stubs/server-only.ts'),
    },
  },
});
