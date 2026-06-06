import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    // Node16 resolves .js imports to .ts source files.
    // Vitest needs explicit alias to replicate this.
    alias: [
      {
        // Match any .js import and strip the extension so vite resolves .ts
        find: /^(.*)(\.js)$/,
        replacement: '$1',
      },
    ],
  },
  test: {
    environment: 'node',
    globals: true,
    timeout: 10000,
  },
});
