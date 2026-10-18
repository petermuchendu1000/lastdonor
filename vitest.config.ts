import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'test/security/**/*.test.ts'],
    exclude: ['e2e/**', 'src/**/*.integration.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // See test/stubs/server-only.ts for why.
      'server-only': path.resolve(__dirname, './test/stubs/server-only.ts'),
    },
  },
});
