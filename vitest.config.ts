import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig({
  plugins: [svelte({ hot: false })],
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      '$lib': path.resolve(__dirname, 'src/renderer/lib'),
      '$shared': path.resolve(__dirname, 'src/shared'),
    },
    conditions: ['browser'],
  },
});
