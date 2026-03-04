// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { activitySummary } from '../../src/main/activity-summary';

describe('activitySummary', () => {
  it('allowed write shows "Created basename"', () => {
    expect(activitySummary('file_write_create', 'docs/notes.md', true)).toBe('Created notes.md');
  });

  it('blocked write shows "Blocked from creating basename"', () => {
    expect(activitySummary('file_write_create', 'secrets.key', false)).toBe('Blocked from creating secrets.key');
  });

  it('allowed read shows "Read basename"', () => {
    expect(activitySummary('file_read', 'README.md', true)).toBe('Read README.md');
  });

  it('blocked read shows "Blocked from reading basename"', () => {
    expect(activitySummary('file_read', 'private.txt', false)).toBe('Blocked from reading private.txt');
  });

  it('allowed list of "." shows "Listed project root"', () => {
    expect(activitySummary('file_list', '.', true)).toBe('Listed project root');
  });

  it('allowed list of subdir shows "Listed dirname"', () => {
    expect(activitySummary('file_list', 'src', true)).toBe('Listed src');
  });

  it('blocked list shows "Blocked from listing"', () => {
    expect(activitySummary('file_list', 'secret-dir', false)).toBe('Blocked from listing secret-dir');
  });

  it('mode change success shows template name', () => {
    expect(activitySummary('mode_change', undefined, true, { templateName: 'Help me edit' }))
      .toBe('Mode set to Help me edit');
  });

  it('mode change failure shows reason', () => {
    expect(activitySummary('mode_change', undefined, false, { reason: 'compile failed' }))
      .toBe('Mode change failed: compile failed');
  });

  it('system event with message', () => {
    expect(activitySummary('system', undefined, true, { message: 'Clerk started' }))
      .toBe('Clerk started');
  });

  it('system event without message', () => {
    expect(activitySummary('system', undefined, true)).toBe('System event');
  });

  it('handles undefined path gracefully', () => {
    expect(activitySummary('file_read', undefined, true)).toBe('Read file');
  });

  it('allowed overwrite shows "Overwrote basename"', () => {
    expect(activitySummary('file_write_overwrite', 'docs/notes.md', true)).toBe('Overwrote notes.md');
  });

  it('blocked overwrite shows "Blocked from overwriting basename"', () => {
    expect(activitySummary('file_write_overwrite', 'config.json', false)).toBe('Blocked from overwriting config.json');
  });
});
