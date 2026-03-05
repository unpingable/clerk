// SPDX-License-Identifier: Apache-2.0
/** Canonical activity event types — shared between main and renderer. */

export type ActivityKind =
  | 'file_list'
  | 'file_read'
  | 'file_write_create'
  | 'file_write_overwrite'
  | 'file_mkdir'
  | 'file_copy'
  | 'file_move'
  | 'file_delete'
  | 'file_find'
  | 'file_grep'
  | 'file_patch'
  | 'mode_change'
  | 'system';

export type ActivityDecisionSource = 'local' | 'daemon';

export type ActivityFilter = 'all' | 'blocked' | 'writes' | 'asks';

export type FileActionStatus =
  | 'allowed'
  | 'blocked'
  | 'ask_pending'
  | 'ask_approved'
  | 'ask_denied';

export interface AppliedModeInfo {
  templateId: string;
  templateName: string;
  templateVersion: string;
  governorProfile: string;
}

export interface ActivityEvent {
  id: string;                         // uuid
  ts: string;                         // ISO 8601
  kind: ActivityKind;

  streamId?: string;                  // present when from chat tool loop
  correlationId?: string;             // streamId:callId for grouping
  toolId?: string;                    // e.g. "file.read", "file.write.create"
  path?: string;                      // relative to project

  mode: AppliedModeInfo;              // applied mode at time of event

  allowed: boolean;                   // decision outcome
  status?: FileActionStatus;          // granular status for ask flows
  decisionSource: ActivityDecisionSource;
  reason?: string;                    // short human reason
  errorCode?: string;                 // normalized code (BLOCKED, ENOENT, etc.)
  summary: string;                    // one-liner for feed

  details?: Record<string, unknown>;  // raw data for "Copy details"

  /** Schema version for future migrations. Always 1 for now. */
  schemaVersion?: number;
}
