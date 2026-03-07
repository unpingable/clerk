// SPDX-License-Identifier: Apache-2.0
/** IPC channel names — single source of truth for main, preload, and renderer. */

export const Channels = {
  // Connection
  HEALTH: 'governor:health',
  CONNECT: 'governor:connect',
  CONNECTION_STATE: 'connection:state-changed',

  // Governor state
  NOW: 'governor:now',
  STATUS: 'governor:status',

  // Chat (Clerk's key unlock — generation through governance)
  CHAT_SEND: 'clerk:chat:send',
  CHAT_STREAM_START: 'clerk:chat:stream:start',
  CHAT_STREAM_DELTA: 'clerk:chat:stream:delta',
  CHAT_STREAM_END: 'clerk:chat:stream:end',
  CHAT_MODELS: 'clerk:chat:models',

  // Receipts
  RECEIPTS_LIST: 'receipts:list',
  RECEIPTS_DETAIL: 'receipts:detail',

  // Commit / waive (violation resolution)
  COMMIT_PENDING: 'commit:pending',
  COMMIT_FIX: 'commit:fix',
  COMMIT_REVISE: 'commit:revise',
  COMMIT_PROCEED: 'commit:proceed',

  // Daemon resolver
  DAEMON_STATUS: 'daemon:status',

  // Templates
  TEMPLATES_LIST: 'templates:list',
  TEMPLATES_CURRENT: 'templates:current',
  TEMPLATES_APPLY: 'templates:apply',

  // File operations
  FILES_READ: 'files:read',
  FILES_WRITE: 'files:write',
  FILES_OVERWRITE: 'files:overwrite',
  FILES_LIST: 'files:list',
  FILES_MKDIR: 'files:mkdir',
  FILES_COPY: 'files:copy',
  FILES_MOVE: 'files:move',
  FILES_DELETE: 'files:delete',
  FILES_FIND: 'files:find',
  FILES_GREP: 'files:grep',
  FILES_PATCH: 'files:patch',

  // Chat stream control
  CHAT_STREAM_STOP: 'clerk:chat:stream:stop',

  // Ask (interactive approval)
  CHAT_ASK_REQUEST: 'clerk:chat:ask:request',
  CHAT_ASK_RESPOND: 'clerk:chat:ask:respond',

  // File action events (tool loop)
  CHAT_FILE_ACTION: 'clerk:chat:file-action',

  // Backend config
  BACKEND_STATUS: 'backend:status',
  BACKEND_CONFIGURE: 'backend:configure',

  // Settings
  SETTINGS_GET_ALL: 'settings:getAll',
  SETTINGS_SET: 'settings:set',

  // Activity feed
  ACTIVITY_LIST: 'activity:list',
  ACTIVITY_EVENT: 'activity:event',
} as const;

export type Channel = (typeof Channels)[keyof typeof Channels];
