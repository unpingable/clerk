// SPDX-License-Identifier: Apache-2.0
/**
 * Preload script — contextBridge exposes typed API to renderer.
 * Renderer NEVER touches Node APIs. All system access through this bridge.
 */

import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../shared/channels.js';
import type { ClerkAPI } from '../shared/types.js';

const api: ClerkAPI = {
  // Connection
  health: () => ipcRenderer.invoke(Channels.HEALTH),
  connect: (dirOrUrl: string) => ipcRenderer.invoke(Channels.CONNECT, dirOrUrl),

  // Chat
  chatSend: (messages, options) =>
    ipcRenderer.invoke(Channels.CHAT_SEND, messages, options),
  chatStreamStart: (messages, options) =>
    ipcRenderer.invoke(Channels.CHAT_STREAM_START, messages, options),
  onChatDelta: (cb) => {
    ipcRenderer.on(Channels.CHAT_STREAM_DELTA, (_e, data) => cb(data));
  },
  onChatEnd: (cb) => {
    ipcRenderer.on(Channels.CHAT_STREAM_END, (_e, data) => cb(data));
  },
  offChatDelta: () => {
    ipcRenderer.removeAllListeners(Channels.CHAT_STREAM_DELTA);
  },
  offChatEnd: () => {
    ipcRenderer.removeAllListeners(Channels.CHAT_STREAM_END);
  },
  chatModels: () => ipcRenderer.invoke(Channels.CHAT_MODELS),

  // Governor
  now: () => ipcRenderer.invoke(Channels.NOW),
  status: () => ipcRenderer.invoke(Channels.STATUS),

  // Receipts
  receiptsList: (filter?) => ipcRenderer.invoke(Channels.RECEIPTS_LIST, filter),
  receiptsDetail: (id: string) => ipcRenderer.invoke(Channels.RECEIPTS_DETAIL, id),

  // Commit / waive
  commitPending: () => ipcRenderer.invoke(Channels.COMMIT_PENDING),
  commitFix: (correctedText?: string) => ipcRenderer.invoke(Channels.COMMIT_FIX, correctedText),
  commitRevise: () => ipcRenderer.invoke(Channels.COMMIT_REVISE),
  commitProceed: (reason: string) => ipcRenderer.invoke(Channels.COMMIT_PROCEED, reason),

  // Daemon resolver
  daemonStatus: () => ipcRenderer.invoke(Channels.DAEMON_STATUS),

  // Templates
  templatesList: () => ipcRenderer.invoke(Channels.TEMPLATES_LIST),
  templatesCurrent: () => ipcRenderer.invoke(Channels.TEMPLATES_CURRENT),
  templatesApply: (req) => ipcRenderer.invoke(Channels.TEMPLATES_APPLY, req),

  // File attachments (drag-and-drop)
  readAbsoluteFile: (absolutePath: string) =>
    ipcRenderer.invoke(Channels.FILES_READ_ABSOLUTE, absolutePath),

  // File operations
  fileRead: (relativePath: string) =>
    ipcRenderer.invoke(Channels.FILES_READ, relativePath),
  fileWrite: (relativePath: string, content: string) =>
    ipcRenderer.invoke(Channels.FILES_WRITE, relativePath, content),
  fileOverwrite: (relativePath: string, content: string, expectedHash: string) =>
    ipcRenderer.invoke(Channels.FILES_OVERWRITE, relativePath, content, expectedHash),
  fileList: (relativePath: string) =>
    ipcRenderer.invoke(Channels.FILES_LIST, relativePath),
  fileMkdir: (relativePath: string) =>
    ipcRenderer.invoke(Channels.FILES_MKDIR, relativePath),
  fileCopy: (srcRelative: string, destRelative: string) =>
    ipcRenderer.invoke(Channels.FILES_COPY, srcRelative, destRelative),
  fileMove: (srcRelative: string, destRelative: string) =>
    ipcRenderer.invoke(Channels.FILES_MOVE, srcRelative, destRelative),
  fileDelete: (relativePath: string) =>
    ipcRenderer.invoke(Channels.FILES_DELETE, relativePath),
  fileFind: (basePath: string, pattern?: string) =>
    ipcRenderer.invoke(Channels.FILES_FIND, basePath, pattern),
  fileGrep: (query: string, basePath?: string) =>
    ipcRenderer.invoke(Channels.FILES_GREP, query, basePath),
  filePatch: (relativePath: string, patch: string, expectedHash: string) =>
    ipcRenderer.invoke(Channels.FILES_PATCH, relativePath, patch, expectedHash),

  // Chat stream control
  chatStreamStop: (streamId: string) =>
    ipcRenderer.invoke(Channels.CHAT_STREAM_STOP, streamId),

  // Ask (interactive approval)
  onAskRequest: (cb) => {
    ipcRenderer.on(Channels.CHAT_ASK_REQUEST, (_e, data) => cb(data));
  },
  offAskRequest: () => {
    ipcRenderer.removeAllListeners(Channels.CHAT_ASK_REQUEST);
  },
  askRespond: (askId: string, decision) =>
    ipcRenderer.invoke(Channels.CHAT_ASK_RESPOND, askId, decision),

  // File action events (tool loop)
  onFileAction: (cb) => {
    ipcRenderer.on(Channels.CHAT_FILE_ACTION, (_e, data) => cb(data));
  },
  offFileAction: () => {
    ipcRenderer.removeAllListeners(Channels.CHAT_FILE_ACTION);
  },

  // Backend config
  backendStatus: () => ipcRenderer.invoke(Channels.BACKEND_STATUS),
  backendConfigure: (config) => ipcRenderer.invoke(Channels.BACKEND_CONFIGURE, config),

  // Settings
  settingsGetAll: () => ipcRenderer.invoke(Channels.SETTINGS_GET_ALL),
  settingsSet: (partial) => ipcRenderer.invoke(Channels.SETTINGS_SET, partial),

  // Conversations
  conversationList: () => ipcRenderer.invoke(Channels.CONV_LIST),
  conversationLoad: (id: string) => ipcRenderer.invoke(Channels.CONV_LOAD, id),
  conversationSave: (data) => ipcRenderer.invoke(Channels.CONV_SAVE, data),
  conversationDelete: (id: string) => ipcRenderer.invoke(Channels.CONV_DELETE, id),
  conversationRename: (id: string, title: string) => ipcRenderer.invoke(Channels.CONV_RENAME, id, title),
  conversationSetActive: (id) => ipcRenderer.invoke(Channels.CONV_SET_ACTIVE, id),

  // Activity feed
  activityList: (limit?) => ipcRenderer.invoke(Channels.ACTIVITY_LIST, limit),
  onActivityEvent: (cb) => {
    ipcRenderer.on(Channels.ACTIVITY_EVENT, (_e, event) => cb(event));
  },
  offActivityEvent: () => {
    ipcRenderer.removeAllListeners(Channels.ACTIVITY_EVENT);
  },

  // Connection state
  onConnectionState: (cb) => {
    ipcRenderer.on(Channels.CONNECTION_STATE, (_e, state) => cb(state));
  },
  offConnectionState: () => {
    ipcRenderer.removeAllListeners(Channels.CONNECTION_STATE);
  },
};

contextBridge.exposeInMainWorld('clerk', api);
