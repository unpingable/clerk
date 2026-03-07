// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { buildCommands, filterCommands, groupCommands } from '../../src/renderer/lib/commands';
import type { CommandContext } from '../../src/renderer/lib/commands';

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    streaming: false,
    friendlyMode: false,
    detailsOpen: false,
    theme: 'dark' as const,
    appliedTemplateId: 'help_me_edit',
    modKeyLabel: 'Cmd',
    templates: [
      { id: 'look_around', name: 'Look around' },
      { id: 'help_me_edit', name: 'Help me edit' },
      { id: 'take_the_wheel', name: 'Take the wheel' },
      { id: 'unrestricted', name: 'Unrestricted' },
    ],
    ...overrides,
  };
}

describe('buildCommands', () => {
  it('returns expected command set for non-streaming state', () => {
    const cmds = buildCommands(makeCtx());
    const ids = cmds.map(c => c.id);
    expect(ids).toContain('toggle-friendly');
    expect(ids).toContain('focus-chat');
    expect(ids).toContain('clear-chat');
    expect(ids).not.toContain('stop-run');
    expect(ids).toContain('workflow-find');
    expect(ids).toContain('workflow-grep');
    expect(ids).toContain('workflow-edit');
  });

  it('includes stop-run only when streaming', () => {
    const cmds = buildCommands(makeCtx({ streaming: true }));
    expect(cmds.find(c => c.id === 'stop-run')).toBeDefined();
  });

  it('excludes currently-applied template from profile group', () => {
    const cmds = buildCommands(makeCtx({ appliedTemplateId: 'help_me_edit' }));
    const profileIds = cmds.filter(c => c.group === 'Profile').map(c => c.id);
    expect(profileIds).not.toContain('profile-help_me_edit');
    expect(profileIds).toContain('profile-look_around');
    expect(profileIds).toContain('profile-take_the_wheel');
    expect(profileIds).toContain('profile-unrestricted');
  });

  it('toggle label reflects current friendlyMode state', () => {
    const on = buildCommands(makeCtx({ friendlyMode: true }));
    expect(on.find(c => c.id === 'toggle-friendly')!.label).toBe('Turn off Simple language');

    const off = buildCommands(makeCtx({ friendlyMode: false }));
    expect(off.find(c => c.id === 'toggle-friendly')!.label).toBe('Turn on Simple language');
  });

  it('activity labels respect friendlyMode', () => {
    const friendly = buildCommands(makeCtx({ friendlyMode: true }));
    expect(friendly.find(c => c.id === 'activity-blocked')!.label).toBe('Show stopped');
    expect(friendly.find(c => c.id === 'activity-writes')!.label).toBe('Show changes');

    const technical = buildCommands(makeCtx({ friendlyMode: false }));
    expect(technical.find(c => c.id === 'activity-blocked')!.label).toBe('Show blocked');
    expect(technical.find(c => c.id === 'activity-writes')!.label).toBe('Show writes');
  });

  it('uses modKeyLabel in shortcut strings', () => {
    const mac = buildCommands(makeCtx({ modKeyLabel: 'Cmd' }));
    expect(mac.find(c => c.id === 'focus-chat')!.shortcut).toBe('Cmd+K');

    const win = buildCommands(makeCtx({ modKeyLabel: 'Ctrl' }));
    expect(win.find(c => c.id === 'focus-chat')!.shortcut).toBe('Ctrl+K');
  });

  it('includes focus-chat command', () => {
    const cmds = buildCommands(makeCtx());
    const fc = cmds.find(c => c.id === 'focus-chat');
    expect(fc).toBeDefined();
    expect(fc!.action).toEqual({ type: 'ui', actionId: 'focus-chat' });
  });

  it('profile commands use "Use profile: {name}" format', () => {
    const cmds = buildCommands(makeCtx());
    const profile = cmds.find(c => c.id === 'profile-look_around');
    expect(profile!.label).toBe('Use profile: Look around');
  });

  it('toggle-theme label reflects current theme', () => {
    const dark = buildCommands(makeCtx({ theme: 'dark' }));
    expect(dark.find(c => c.id === 'toggle-theme')!.label).toBe('Switch to light theme');

    const light = buildCommands(makeCtx({ theme: 'light' }));
    expect(light.find(c => c.id === 'toggle-theme')!.label).toBe('Switch to dark theme');
  });

  it('toggle-details label reflects detailsOpen state', () => {
    const closed = buildCommands(makeCtx({ detailsOpen: false }));
    expect(closed.find(c => c.id === 'toggle-details')!.label).toBe('Show details panel');

    const opened = buildCommands(makeCtx({ detailsOpen: true }));
    expect(opened.find(c => c.id === 'toggle-details')!.label).toBe('Hide details panel');
  });

  it('toggle-details has correct shortcut', () => {
    const cmds = buildCommands(makeCtx());
    expect(cmds.find(c => c.id === 'toggle-details')!.shortcut).toBe('Cmd+D');
  });

  it('includes change-backend when not streaming', () => {
    const cmds = buildCommands(makeCtx({ streaming: false }));
    const cmd = cmds.find(c => c.id === 'change-backend');
    expect(cmd).toBeDefined();
    expect(cmd!.action).toEqual({ type: 'ui', actionId: 'change-backend' });
  });

  it('excludes change-backend when streaming', () => {
    const cmds = buildCommands(makeCtx({ streaming: true }));
    const cmd = cmds.find(c => c.id === 'change-backend');
    expect(cmd).toBeUndefined();
  });
});

describe('filterCommands', () => {
  const cmds = buildCommands(makeCtx());

  it('empty query returns all commands', () => {
    expect(filterCommands(cmds, '')).toEqual(cmds);
    expect(filterCommands(cmds, '  ')).toEqual(cmds);
  });

  it('single word matches label', () => {
    const result = filterCommands(cmds, 'Focus');
    expect(result.some(c => c.id === 'focus-chat')).toBe(true);
  });

  it('single word matches keywords', () => {
    const result = filterCommands(cmds, 'grep');
    expect(result.some(c => c.id === 'workflow-grep')).toBe(true);
  });

  it('multi-word: all words must appear (AND semantics)', () => {
    const result = filterCommands(cmds, 'focus input');
    expect(result.some(c => c.id === 'focus-chat')).toBe(true);
    // 'focus xyz' should not match
    expect(filterCommands(cmds, 'focus xyz')).toEqual([]);
  });

  it('is case-insensitive', () => {
    const result = filterCommands(cmds, 'CLEAR');
    expect(result.some(c => c.id === 'clear-chat')).toBe(true);
  });

  it('no match returns empty array', () => {
    expect(filterCommands(cmds, 'zzzznotreal')).toEqual([]);
  });
});

describe('groupCommands', () => {
  it('groups commands by group field', () => {
    const cmds = buildCommands(makeCtx());
    const groups = groupCommands(cmds);
    const names = groups.map(g => g.group);
    expect(names).toContain('Control');
    expect(names).toContain('Profile');
    expect(names).toContain('Activity');
    expect(names).toContain('Workflow');
  });

  it('preserves insertion order of groups', () => {
    const cmds = buildCommands(makeCtx());
    const groups = groupCommands(cmds);
    const names = groups.map(g => g.group);
    expect(names.indexOf('Control')).toBeLessThan(names.indexOf('Profile'));
    expect(names.indexOf('Profile')).toBeLessThan(names.indexOf('Activity'));
    expect(names.indexOf('Activity')).toBeLessThan(names.indexOf('Workflow'));
  });

  it('returns empty array for empty input', () => {
    expect(groupCommands([])).toEqual([]);
  });
});
