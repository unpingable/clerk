// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import {
  friendlyTool,
  friendlyProfile,
  friendlyError,
  friendlyVerdict,
  KNOWN_TOOLS,
  KNOWN_ERRORS,
  KNOWN_PROFILES,
  KNOWN_VERDICTS,
} from '../../src/renderer/lib/jargon';

describe('friendlyTool', () => {
  it('maps known tools in friendly mode', () => {
    expect(friendlyTool('file_write_overwrite', true)).toEqual({
      label: 'Edit file',
      tooltip: 'file_write_overwrite',
    });
    expect(friendlyTool('file_read', true)).toEqual({
      label: 'Read file',
      tooltip: 'file_read',
    });
  });

  it('returns raw when friendly=false', () => {
    expect(friendlyTool('file_read', false)).toEqual({
      label: 'file_read',
      tooltip: 'file_read',
    });
  });

  it('prettifies unknown tools', () => {
    expect(friendlyTool('some_new_tool', true)).toEqual({
      label: 'Some New Tool',
      tooltip: 'some_new_tool',
    });
  });

  it('every known tool has an explicit mapping', () => {
    for (const tool of KNOWN_TOOLS) {
      const result = friendlyTool(tool, true);
      expect(result.label).not.toBe(tool);
      expect(result.tooltip).toBe(tool);
    }
  });
});

describe('friendlyProfile', () => {
  it('maps known profiles', () => {
    expect(friendlyProfile('production', true)).toEqual({
      label: 'standard',
      tooltip: 'production',
    });
  });

  it('returns raw when friendly=false', () => {
    expect(friendlyProfile('production', false)).toEqual({
      label: 'production',
      tooltip: 'production',
    });
  });

  it('prettifies unknown profiles', () => {
    expect(friendlyProfile('custom-profile', true)).toEqual({
      label: 'Custom Profile',
      tooltip: 'custom-profile',
    });
  });

  it('every known profile has an explicit mapping', () => {
    for (const p of KNOWN_PROFILES) {
      const result = friendlyProfile(p, true);
      expect(result.label).not.toBe(p);
    }
  });
});

describe('friendlyError', () => {
  it('maps known errors', () => {
    expect(friendlyError('HASH_MISMATCH', true)).toEqual({
      label: 'File changed',
      tooltip: 'HASH_MISMATCH',
    });
  });

  it('returns raw when friendly=false', () => {
    expect(friendlyError('HASH_MISMATCH', false)).toEqual({
      label: 'HASH_MISMATCH',
      tooltip: 'HASH_MISMATCH',
    });
  });

  it('prettifies unknown errors', () => {
    expect(friendlyError('WEIRD_ERROR', true)).toEqual({
      label: 'Weird Error',
      tooltip: 'WEIRD_ERROR',
    });
  });

  it('every known error code has an explicit mapping', () => {
    for (const e of KNOWN_ERRORS) {
      const result = friendlyError(e, true);
      expect(result.label).not.toBe(e);
    }
  });
});

describe('friendlyVerdict', () => {
  it('maps known verdicts', () => {
    expect(friendlyVerdict('block', true)).toEqual({
      label: 'stopped',
      tooltip: 'block',
    });
    expect(friendlyVerdict('pass', true)).toEqual({
      label: 'approved',
      tooltip: 'pass',
    });
  });

  it('returns raw when friendly=false', () => {
    expect(friendlyVerdict('block', false)).toEqual({
      label: 'block',
      tooltip: 'block',
    });
  });

  it('every known verdict has an explicit mapping', () => {
    for (const v of KNOWN_VERDICTS) {
      const result = friendlyVerdict(v, true);
      expect(result.label).not.toBe(v);
    }
  });
});
