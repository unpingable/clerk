// SPDX-License-Identifier: Apache-2.0
/** Pure summary string generator for activity events. No DI needed. */

import path from 'node:path';
import type { ActivityKind } from '../shared/activity-types.js';

export function activitySummary(
  kind: ActivityKind,
  filePath: string | undefined,
  allowed: boolean,
  extra?: Record<string, unknown>,
): string {
  const name = filePath ? path.basename(filePath) : undefined;

  switch (kind) {
    case 'file_write_create':
      return allowed
        ? `Created ${name ?? 'file'}`
        : `Blocked from creating ${name ?? 'file'}`;

    case 'file_write_overwrite':
      return allowed
        ? `Overwrote ${name ?? 'file'}`
        : `Blocked from overwriting ${name ?? 'file'}`;

    case 'file_read':
      return allowed
        ? `Read ${name ?? 'file'}`
        : `Blocked from reading ${name ?? 'file'}`;

    case 'file_list': {
      const target = filePath === '.' ? 'project root' : (name ?? 'directory');
      return allowed
        ? `Listed ${target}`
        : `Blocked from listing ${target}`;
    }

    case 'file_mkdir':
      return allowed
        ? `Created directory ${name ?? 'directory'}`
        : `Blocked from creating directory ${name ?? 'directory'}`;

    case 'file_copy': {
      const destName = extra?.['destName'] as string | undefined;
      return allowed
        ? `Copied ${name ?? 'file'} to ${destName ?? 'destination'}`
        : `Blocked from copying ${name ?? 'file'}`;
    }

    case 'file_move': {
      const destName = extra?.['destName'] as string | undefined;
      return allowed
        ? `Moved ${name ?? 'file'} to ${destName ?? 'destination'}`
        : `Blocked from moving ${name ?? 'file'}`;
    }

    case 'file_delete':
      return allowed
        ? `Moved ${name ?? 'file'} to Trash`
        : `Blocked from deleting ${name ?? 'file'}`;

    case 'file_find': {
      const count = extra?.['count'] as number | undefined;
      const pattern = extra?.['pattern'] as string | undefined;
      const target = filePath === '.' ? 'project' : (name ?? 'directory');
      if (!allowed) return `Blocked from searching ${target}`;
      const patternLabel = pattern ? ` matching ${pattern}` : '';
      return count != null
        ? `Found ${count} file${count !== 1 ? 's' : ''}${patternLabel} in ${target}`
        : `Searched ${target}`;
    }

    case 'file_patch': {
      const appliedHunks = extra?.['appliedHunks'] as number | undefined;
      if (!allowed) return `Blocked from patching ${name ?? 'file'}`;
      return appliedHunks != null
        ? `Patched ${name ?? 'file'} (${appliedHunks} hunk${appliedHunks !== 1 ? 's' : ''})`
        : `Patched ${name ?? 'file'}`;
    }

    case 'file_grep': {
      const matchCount = extra?.['matchCount'] as number | undefined;
      const fileCount = extra?.['fileCount'] as number | undefined;
      const query = extra?.['query'] as string | undefined;
      const target = filePath === '.' ? 'project' : (name ?? 'directory');
      if (!allowed) return `Blocked from searching ${target}`;
      const queryLabel = query ? ` '${query}'` : '';
      return matchCount != null
        ? `Searched for${queryLabel} in ${target} (${matchCount} match${matchCount !== 1 ? 'es' : ''} in ${fileCount ?? 0} file${(fileCount ?? 0) !== 1 ? 's' : ''})`
        : `Searched ${target}`;
    }

    case 'mode_change': {
      const templateName = extra?.['templateName'] as string | undefined;
      if (allowed) {
        return templateName ? `Mode set to ${templateName}` : 'Mode changed';
      }
      const reason = extra?.['reason'] as string | undefined;
      return reason ? `Mode change failed: ${reason}` : 'Mode change failed';
    }

    case 'system': {
      const message = extra?.['message'] as string | undefined;
      return message ?? 'System event';
    }

    default:
      return 'Unknown event';
  }
}
