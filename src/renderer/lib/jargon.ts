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

// --- Chat / streaming error classification ---

export type ErrorSeverity = 'warning' | 'error' | 'fatal';

export interface ChatErrorInfo {
  /** User-facing message */
  message: string;
  /** Recovery hint (what the user can do) */
  hint: string;
  /** Severity level for visual treatment */
  severity: ErrorSeverity;
  /** Whether a retry would make sense */
  retryable: boolean;
}

/** Patterns matched against the raw error string (case-insensitive). */
const CHAT_ERROR_PATTERNS: Array<{
  test: RegExp;
  info: ChatErrorInfo;
}> = [
  {
    test: /network|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up/i,
    info: {
      message: 'Network connection failed',
      hint: 'Check your internet connection and try again.',
      severity: 'error',
      retryable: true,
    },
  },
  {
    test: /401|unauthorized|invalid.*api.?key|authentication/i,
    info: {
      message: 'Authentication failed',
      hint: 'Your API key may be invalid. Open the command palette (Ctrl+P) and choose "Change AI backend" to update it.',
      severity: 'fatal',
      retryable: false,
    },
  },
  {
    test: /429|rate.?limit|too many requests|overloaded/i,
    info: {
      message: 'Rate limited',
      hint: 'The AI service is busy. Wait a moment and try again.',
      severity: 'warning',
      retryable: true,
    },
  },
  {
    test: /500|502|503|504|internal server|bad gateway|service unavailable/i,
    info: {
      message: 'The AI service is temporarily unavailable',
      hint: 'This usually resolves on its own. Try again in a minute.',
      severity: 'error',
      retryable: true,
    },
  },
  {
    test: /timeout|timed?\s*out|deadline exceeded/i,
    info: {
      message: 'Request timed out',
      hint: 'The request took too long. Try a shorter message or try again.',
      severity: 'warning',
      retryable: true,
    },
  },
  {
    test: /model.*not found|no.*models|unknown model/i,
    info: {
      message: 'AI model not available',
      hint: 'The selected model may not be accessible. Try changing the model or backend configuration.',
      severity: 'error',
      retryable: false,
    },
  },
  {
    test: /DAEMON_NOT_READY|daemon.*not.*running|governor.*not/i,
    info: {
      message: 'The engine is not ready',
      hint: 'Clerk is still starting up or lost connection to its engine. Try again in a moment.',
      severity: 'error',
      retryable: true,
    },
  },
  {
    test: /conversation.*not found|load.*failed/i,
    info: {
      message: 'Conversation could not be loaded',
      hint: 'The conversation data may be corrupted. Try starting a new conversation.',
      severity: 'error',
      retryable: false,
    },
  },
];

const DEFAULT_ERROR: ChatErrorInfo = {
  message: 'Something went wrong',
  hint: 'Try again, or start a new conversation if the problem persists.',
  severity: 'error',
  retryable: true,
};

/**
 * Classify a raw error string into a user-friendly error with severity and hints.
 * Works for both friendly and technical mode — technical mode appends the raw error.
 */
export function classifyChatError(raw: string, friendly: boolean): ChatErrorInfo {
  for (const { test, info } of CHAT_ERROR_PATTERNS) {
    if (test.test(raw)) {
      if (!friendly) {
        return { ...info, message: `${info.message} (${raw})` };
      }
      return info;
    }
  }
  if (!friendly) {
    return { ...DEFAULT_ERROR, message: `Error: ${raw}` };
  }
  return DEFAULT_ERROR;
}

// Exported for test coverage assertions
export const KNOWN_TOOLS = Object.keys(TOOL_MAP);
export const KNOWN_ERRORS = Object.keys(ERROR_MAP);
export const KNOWN_PROFILES = Object.keys(PROFILE_MAP);
export const KNOWN_VERDICTS = Object.keys(VERDICT_MAP);
