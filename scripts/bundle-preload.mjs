// SPDX-License-Identifier: Apache-2.0
/**
 * Bundle the preload script as a single CJS file.
 *
 * Electron's sandboxed preload runs in a special context where ESM imports
 * don't always work (especially under Playwright's Electron automation which
 * injects a loader via -r flag). Bundling to CJS makes it universally safe.
 *
 * This runs after tsc as part of `npm run build`.
 */

import { build } from 'esbuild';

await build({
  entryPoints: ['dist/preload/index.js'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist/preload/index.cjs',
  external: ['electron'],
});

console.log('Bundled preload -> dist/preload/index.cjs');
