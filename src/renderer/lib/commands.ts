// SPDX-License-Identifier: Apache-2.0
/** Command palette registry — pure functions, no runes, no browser globals. */

export type CommandActionId =
  | 'clear-chat'
  | 'stop-streaming'
  | 'toggle-friendly'
  | 'toggle-theme'
  | 'toggle-details'
  | 'focus-chat'
  | 'change-backend'
  | 'new-conversation'
  | 'toggle-sidebar'
  | `request-template:${string}`
  | `activity-filter:${string}`;

export type CommandAction =
  | { type: 'ui'; actionId: CommandActionId }
  | { type: 'prefill'; text: string };

export interface Command {
  id: string;
  label: string;
  description?: string;
  group: string;
  keywords: string[];
  shortcut?: string;
  action: CommandAction;
}

export interface CommandContext {
  streaming: boolean;
  friendlyMode: boolean;
  theme: 'dark' | 'light';
  detailsOpen: boolean;
  appliedTemplateId: string;
  modKeyLabel: 'Cmd' | 'Ctrl';
  templates: Array<{ id: string; name: string }>;
  conversationCount: number;
  sidebarVisible: boolean;
}

const TEMPLATE_KEYWORDS: Record<string, string[]> = {
  look_around: ['read', 'only', 'look'],
  help_me_edit: ['edit', 'help', 'standard'],
  take_the_wheel: ['wheel', 'flexible'],
  unrestricted: ['unrestricted', 'permissive'],
};

export function buildCommands(ctx: CommandContext): Command[] {
  const commands: Command[] = [];

  // --- Control ---
  commands.push({
    id: 'toggle-friendly',
    label: ctx.friendlyMode ? 'Turn off Simple language' : 'Turn on Simple language',
    group: 'Control',
    keywords: ['jargon', 'friendly', 'simple', 'language', 'mode', 'friendly mode'],
    action: { type: 'ui', actionId: 'toggle-friendly' },
  });

  commands.push({
    id: 'toggle-theme',
    label: ctx.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
    group: 'Control',
    keywords: ['theme', 'light', 'dark', 'appearance', 'color'],
    action: { type: 'ui', actionId: 'toggle-theme' },
  });

  commands.push({
    id: 'focus-chat',
    label: 'Focus chat input',
    group: 'Control',
    keywords: ['focus', 'input', 'type', 'message'],
    shortcut: `${ctx.modKeyLabel}+K`,
    action: { type: 'ui', actionId: 'focus-chat' },
  });

  commands.push({
    id: 'clear-chat',
    label: 'Clear chat',
    group: 'Control',
    keywords: ['reset', 'history', 'messages'],
    shortcut: `${ctx.modKeyLabel}+Shift+Backspace`,
    action: { type: 'ui', actionId: 'clear-chat' },
  });

  if (ctx.streaming) {
    commands.push({
      id: 'stop-run',
      label: 'Stop current run',
      group: 'Control',
      keywords: ['cancel', 'abort', 'halt', 'stop'],
      shortcut: 'Escape',
      action: { type: 'ui', actionId: 'stop-streaming' },
    });
  }

  if (!ctx.streaming) {
    commands.push({
      id: 'change-backend',
      label: 'Change AI backend...',
      group: 'Control',
      keywords: ['backend', 'api', 'key', 'anthropic', 'ollama', 'setup', 'configure'],
      action: { type: 'ui', actionId: 'change-backend' },
    });
  }

  if (!ctx.streaming) {
    commands.push({
      id: 'new-conversation',
      label: 'New conversation',
      group: 'Control',
      keywords: ['new', 'chat', 'conversation', 'fresh'],
      shortcut: `${ctx.modKeyLabel}+N`,
      action: { type: 'ui', actionId: 'new-conversation' },
    });
  }

  if (ctx.conversationCount >= 2) {
    commands.push({
      id: 'toggle-sidebar',
      label: ctx.sidebarVisible ? 'Hide conversations' : 'Show conversations',
      group: 'Control',
      keywords: ['sidebar', 'conversations', 'list', 'toggle'],
      shortcut: `${ctx.modKeyLabel}+B`,
      action: { type: 'ui', actionId: 'toggle-sidebar' },
    });
  }

  commands.push({
    id: 'toggle-details',
    label: ctx.detailsOpen ? 'Hide details panel' : 'Show details panel',
    group: 'Control',
    keywords: ['details', 'activity', 'inspector', 'panel', 'drawer', 'log'],
    shortcut: `${ctx.modKeyLabel}+D`,
    action: { type: 'ui', actionId: 'toggle-details' },
  });

  // --- Profile ---
  for (const t of ctx.templates) {
    if (t.id === ctx.appliedTemplateId) continue;
    const extra = TEMPLATE_KEYWORDS[t.id] ?? [];
    commands.push({
      id: `profile-${t.id}`,
      label: `Use profile: ${t.name}`,
      group: 'Profile',
      keywords: ['profile', 'trust', 'mode', ...extra],
      action: { type: 'ui', actionId: `request-template:${t.id}` },
    });
  }

  // --- Activity ---
  commands.push({
    id: 'activity-all',
    label: 'Show all activity',
    group: 'Activity',
    keywords: ['filter', 'activity', 'log', 'feed'],
    action: { type: 'ui', actionId: 'activity-filter:all' },
  });

  commands.push({
    id: 'activity-blocked',
    label: ctx.friendlyMode ? 'Show stopped' : 'Show blocked',
    group: 'Activity',
    keywords: ['filter', 'blocked', 'denied', 'stopped', 'receipt', 'proof'],
    action: { type: 'ui', actionId: 'activity-filter:blocked' },
  });

  commands.push({
    id: 'activity-writes',
    label: ctx.friendlyMode ? 'Show changes' : 'Show writes',
    group: 'Activity',
    keywords: ['filter', 'write', 'edit', 'changes'],
    action: { type: 'ui', actionId: 'activity-filter:writes' },
  });

  // --- Workflow ---
  commands.push({
    id: 'workflow-find',
    label: 'Find files...',
    group: 'Workflow',
    keywords: ['search', 'glob', 'pattern', 'discover'],
    action: { type: 'prefill', text: 'Find files matching ' },
  });

  commands.push({
    id: 'workflow-grep',
    label: 'Search in files...',
    group: 'Workflow',
    keywords: ['grep', 'text', 'content', 'search'],
    action: { type: 'prefill', text: 'Search for ' },
  });

  commands.push({
    id: 'workflow-list',
    label: 'Browse files...',
    group: 'Workflow',
    keywords: ['list', 'directory', 'folder', 'ls', 'browse'],
    action: { type: 'prefill', text: 'List files in ' },
  });

  commands.push({
    id: 'workflow-read',
    label: 'Open file...',
    group: 'Workflow',
    keywords: ['read', 'open', 'view', 'cat', 'file'],
    action: { type: 'prefill', text: 'Read the file ' },
  });

  commands.push({
    id: 'workflow-edit',
    label: 'Edit file...',
    group: 'Workflow',
    keywords: ['patch', 'diff', 'modify', 'edit', 'overwrite'],
    action: { type: 'prefill', text: 'Edit the file ' },
  });

  return commands;
}

export function filterCommands(commands: Command[], query: string): Command[] {
  const trimmed = query.trim();
  if (!trimmed) return commands;

  const words = trimmed.toLowerCase().split(/\s+/);

  return commands.filter((cmd) => {
    const haystack = (cmd.label + ' ' + cmd.keywords.join(' ')).toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

export interface CommandGroup {
  group: string;
  commands: Command[];
}

export function groupCommands(commands: Command[]): CommandGroup[] {
  const map = new Map<string, Command[]>();
  for (const cmd of commands) {
    let list = map.get(cmd.group);
    if (!list) {
      list = [];
      map.set(cmd.group, list);
    }
    list.push(cmd);
  }
  const result: CommandGroup[] = [];
  for (const [group, cmds] of map) {
    result.push({ group, commands: cmds });
  }
  return result;
}
