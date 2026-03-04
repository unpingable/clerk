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
