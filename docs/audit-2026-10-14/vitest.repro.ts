import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
const ROOT = '/home/user/lastdonor';
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(ROOT, 'src') } },
  test: {
    environment: 'node',
    include: ['/tmp/claude-0/-home-user-lastdonor/ee7a750e-88d2-5e36-86ee-c1bd1a101a74/scratchpad/repro/**/*.test.tsx'],
    root: ROOT,
  },
});
