// SPDX-License-Identifier: Apache-2.0
/**
 * Shared E2E test helpers — launch, teardown, common patterns.
 *
 * Every E2E test should use launchApp() from here to ensure consistent
 * environment setup (daemon.conf, userData isolation, backend check).
 */

import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');

export const STUB_DAEMON = path.resolve(__dirname, 'stub-daemon.mjs');
export const MAIN_ENTRY = path.resolve(ROOT, 'dist', 'main', 'index.js');

export function makeTmpDirs(prefix = 'clerk-e2e-') {
  return {
    govDir: fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}gov-`)),
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}data-`)),
  };
}

export function cleanupDirs(...dirs: string[]) {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export interface LaunchOptions {
  /** Write daemon.conf before launch (default: true) */
  writeDaemonConf?: boolean;
  /** Extra env vars to merge */
  extraEnv?: Record<string, string>;
  /** Wait for textarea to appear (default: true). Set false for setup-wizard tests. */
  waitForTextarea?: boolean;
}

export async function launchApp(
  govDir: string,
  userDataDir: string,
  opts: LaunchOptions = {},
) {
  const { writeDaemonConf = true, extraEnv = {}, waitForTextarea = true } = opts;

  if (writeDaemonConf) {
    fs.writeFileSync(
      path.join(govDir, 'daemon.conf'),
      '[backend]\ntype = anthropic\nanthropic.api_key = sk-test\n',
    );
  }

  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const electronPath = require('electron') as unknown as string;

  const app = await electron.launch({
    executablePath: electronPath,
    args: ['--no-sandbox', MAIN_ENTRY],
    env: {
      ...process.env,
      CLERK_E2E: '1',
      GOVERNOR_BIN: STUB_DAEMON,
      GOVERNOR_DIR: govDir,
      GOVERNOR_MODE: 'general',
      ELECTRON_DISABLE_GPU: '1',
      ELECTRON_DISABLE_SANDBOX: '1',
      E2E_BACKEND_CHECK: '1',
      CLERK_USER_DATA: userDataDir,
      ...extraEnv,
    },
  });

  const page = await app.firstWindow();
  if (waitForTextarea) {
    await page.waitForSelector('textarea', { timeout: 15000 });
  }
  return { app, page };
}
