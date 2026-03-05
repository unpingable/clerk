// SPDX-License-Identifier: Apache-2.0
/**
 * Jargon mapping — translates technical identifiers to friendly labels.
 * Pure functions, no runes. Each returns { label, tooltip }.
 */

export interface JargonResult {
  label: string;
  tooltip: string;
}

function prettify(raw: string): string {
  return raw
    .split(/[_-]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function mapped(raw: string, friendly: boolean, map: Record<string, string>): JargonResult {
  if (!friendly) return { label: raw, tooltip: raw };
  const label = map[raw] ?? prettify(raw);
  return { label, tooltip: raw };
}

// --- Tool names ---

const TOOL_MAP: Record<string, string> = {
  file_list: 'List files',
  file_read: 'Read file',
  file_write_create: 'Create file',
  file_write_overwrite: 'Edit file',
  file_patch: 'Patch file',
  file_mkdir: 'Create folder',
  file_copy: 'Copy file',
  file_move: 'Move file',
  file_delete: 'Delete file',
  file_find: 'Find files',
  file_grep: 'Search in files',
};

export function friendlyTool(raw: string, friendly: boolean): JargonResult {
  return mapped(raw, friendly, TOOL_MAP);
}

// --- Profile names ---

const PROFILE_MAP: Record<string, string> = {
  strict: 'locked down',
  production: 'standard',
  research: 'flexible',
  permissive: 'unrestricted',
};

export function friendlyProfile(raw: string, friendly: boolean): JargonResult {
  return mapped(raw, friendly, PROFILE_MAP);
}

// --- Error codes ---

const ERROR_MAP: Record<string, string> = {
  PATH_DENIED: 'Path not allowed',
  BLOCKED: 'Blocked',
  NOT_FOUND: 'Not found',
  FILE_EXISTS: 'Already exists',
  DEST_EXISTS: 'Destination exists',
  NOT_A_DIRECTORY: 'Not a folder',
  DAEMON_NOT_READY: 'Engine not ready',
  IO_ERROR: 'File error',
  CONTENT_TOO_LARGE: 'File too large',
  PATH_TOO_LONG: 'Path too long',
  BINARY_FILE: 'Binary file',
  HASH_MISMATCH: 'File changed',
  INVALID_PATCH: 'Bad patch',
  PATCH_FAILED: 'Patch failed',
  ASK_REQUIRED: 'Needs approval',
};

export function friendlyError(raw: string, friendly: boolean): JargonResult {
  return mapped(raw, friendly, ERROR_MAP);
}

// --- Verdict labels ---

const VERDICT_MAP: Record<string, string> = {
  pass: 'approved',
  allow: 'approved',
  block: 'stopped',
  warn: 'caution',
};

export function friendlyVerdict(raw: string, friendly: boolean): JargonResult {
  return mapped(raw, friendly, VERDICT_MAP);
}

// Exported for test coverage assertions
export const KNOWN_TOOLS = Object.keys(TOOL_MAP);
export const KNOWN_ERRORS = Object.keys(ERROR_MAP);
export const KNOWN_PROFILES = Object.keys(PROFILE_MAP);
export const KNOWN_VERDICTS = Object.keys(VERDICT_MAP);
