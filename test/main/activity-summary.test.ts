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

  // --- Slice 3: mkdir, copy, move, delete ---

  it('allowed mkdir shows "Created directory basename"', () => {
    expect(activitySummary('file_mkdir', 'src/utils', true)).toBe('Created directory utils');
  });

  it('blocked mkdir shows "Blocked from creating directory basename"', () => {
    expect(activitySummary('file_mkdir', 'secret-dir', false)).toBe('Blocked from creating directory secret-dir');
  });

  it('allowed copy shows "Copied X to Y"', () => {
    expect(activitySummary('file_copy', 'notes.md', true, { destName: 'notes-backup.md' })).toBe('Copied notes.md to notes-backup.md');
  });

  it('blocked copy shows "Blocked from copying X"', () => {
    expect(activitySummary('file_copy', 'secret.key', false)).toBe('Blocked from copying secret.key');
  });

  it('allowed move shows "Moved X to Y"', () => {
    expect(activitySummary('file_move', 'old.txt', true, { destName: 'new.txt' })).toBe('Moved old.txt to new.txt');
  });

  it('blocked move shows "Blocked from moving X"', () => {
    expect(activitySummary('file_move', 'important.txt', false)).toBe('Blocked from moving important.txt');
  });

  it('allowed delete shows "Moved X to Trash"', () => {
    expect(activitySummary('file_delete', 'temp.log', true)).toBe('Moved temp.log to Trash');
  });

  it('blocked delete shows "Blocked from deleting X"', () => {
    expect(activitySummary('file_delete', 'keep-me.txt', false)).toBe('Blocked from deleting keep-me.txt');
  });

  // --- Patch ---

  it('allowed patch shows "Patched X (N hunks)" with plural', () => {
    expect(activitySummary('file_patch', 'config.json', true, { appliedHunks: 3 }))
      .toBe('Patched config.json (3 hunks)');
  });

  it('allowed patch with single hunk uses singular', () => {
    expect(activitySummary('file_patch', 'config.json', true, { appliedHunks: 1 }))
      .toBe('Patched config.json (1 hunk)');
  });

  it('blocked patch shows "Blocked from patching X"', () => {
    expect(activitySummary('file_patch', 'secret.key', false))
      .toBe('Blocked from patching secret.key');
  });

  // --- Search/grep ---

  it('allowed find shows "Found N files matching pattern in target"', () => {
    expect(activitySummary('file_find', 'src', true, { count: 12, pattern: '*.ts' }))
      .toBe('Found 12 files matching *.ts in src');
  });

  it('allowed find without pattern shows "Found N files in target"', () => {
    expect(activitySummary('file_find', '.', true, { count: 5 }))
      .toBe('Found 5 files in project');
  });

  it('blocked find shows "Blocked from searching target"', () => {
    expect(activitySummary('file_find', 'secret', false))
      .toBe('Blocked from searching secret');
  });

  it('allowed grep shows match count', () => {
    expect(activitySummary('file_grep', 'src', true, { query: 'TODO', matchCount: 7, fileCount: 3 }))
      .toBe("Searched for 'TODO' in src (7 matches in 3 files)");
  });

  it('blocked grep shows "Blocked from searching target"', () => {
    expect(activitySummary('file_grep', '.', false))
      .toBe('Blocked from searching project');
  });

  it('find singular file count', () => {
    expect(activitySummary('file_find', 'docs', true, { count: 1, pattern: 'README*' }))
      .toBe('Found 1 file matching README* in docs');
  });

  it('grep singular match count', () => {
    expect(activitySummary('file_grep', '.', true, { query: 'bug', matchCount: 1, fileCount: 1 }))
      .toBe("Searched for 'bug' in project (1 match in 1 file)");
  });
});
