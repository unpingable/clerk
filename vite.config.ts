import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig({
  plugins: [svelte()],
  root: 'src/renderer',
  base: './',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
  resolve: {
    // .svelte.ts/.svelte.js required: runes ($state etc.) are compile-time macros that only
    // work in files the Svelte compiler processes. Plain .ts files silently pass $state through
    // as an unresolved runtime symbol. See: stores/*.svelte.ts
    extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json', '.svelte.ts', '.svelte.js'],
    alias: {
      '$lib': path.resolve(__dirname, 'src/renderer/lib'),
      '$shared': path.resolve(__dirname, 'src/shared'),
    },
  },
});
