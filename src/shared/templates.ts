// SPDX-License-Identifier: Apache-2.0
/** Built-in constraint templates — the "trust dial". */

import type { ConstraintTemplate } from './types.js';

export const DEFAULT_TEMPLATE_ID = 'help_me_edit';

export const BUILTIN_TEMPLATES: readonly ConstraintTemplate[] = [
  {
    id: 'look_around',
    name: 'Look around',
    version: '1.0.0',
    origin: 'builtin',
    description: 'Read-only. The agent can look but not touch.',
    requiresConfirmation: false,
    capabilities: {
      read: 'allow',
      write: 'deny',
      execute: 'deny',
      network: 'deny',
      destructive: 'deny',
    },
    governorProfile: 'strict',
  },
  {
    id: 'help_me_edit',
    name: 'Help me edit',
    version: '1.0.0',
    origin: 'builtin',
    description: 'Can read freely. May ask before writing.',
    requiresConfirmation: false,
    capabilities: {
      read: 'allow',
      write: 'ask',
      execute: 'deny',
      network: 'deny',
      destructive: 'deny',
    },
    governorProfile: 'established',
  },
  {
    id: 'take_the_wheel',
    name: 'Take the wheel',
    version: '1.0.0',
    origin: 'builtin',
    description: 'Can read, write, and run commands. May ask before network or destructive actions.',
    requiresConfirmation: false,
    capabilities: {
      read: 'allow',
      write: 'allow',
      execute: 'allow',
      network: 'ask',
      destructive: 'ask',
    },
    governorProfile: 'greenfield',
  },
  {
    id: 'unrestricted',
    name: 'Unrestricted',
    version: '1.0.0',
    origin: 'builtin',
    description: 'This removes all guardrails. Actions are still logged.',
    requiresConfirmation: true,
    capabilities: {
      read: 'allow',
      write: 'allow',
      execute: 'allow',
      network: 'allow',
      destructive: 'allow',
    },
    governorProfile: 'permissive',
  },
] as const;

export function getTemplateById(id: string): ConstraintTemplate | undefined {
  return BUILTIN_TEMPLATES.find(t => t.id === id);
}

export function getDefaultTemplate(): ConstraintTemplate {
  return BUILTIN_TEMPLATES.find(t => t.id === DEFAULT_TEMPLATE_ID)!;
}
