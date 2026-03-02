// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { formatTimestamp, truncateHash, verdictColor, truncate } from '../../src/renderer/lib/format';

describe('format utilities', () => {
  describe('formatTimestamp', () => {
    it('formats a valid timestamp', () => {
      const ts = new Date('2026-03-02T14:30:00Z').getTime();
      const result = formatTimestamp(ts);
      // Should contain hour and minute
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });
  });

  describe('truncateHash', () => {
    it('truncates a hash to specified length', () => {
      expect(truncateHash('sha256:abcdef1234567890', 8)).toBe('abcdef12');
    });

    it('strips sha256: prefix', () => {
      expect(truncateHash('sha256:abc', 8)).toBe('abc');
    });

    it('returns empty for empty input', () => {
      expect(truncateHash('')).toBe('');
    });
  });

  describe('verdictColor', () => {
    it('returns pass color for pass', () => {
      expect(verdictColor('pass')).toBe('var(--clerk-pass)');
    });

    it('returns pass color for allow', () => {
      expect(verdictColor('allow')).toBe('var(--clerk-pass)');
    });

    it('returns block color for block', () => {
      expect(verdictColor('block')).toBe('var(--clerk-block)');
    });

    it('returns muted for unknown', () => {
      expect(verdictColor('unknown')).toBe('var(--clerk-text-muted)');
    });
  });

  describe('truncate', () => {
    it('leaves short strings unchanged', () => {
      expect(truncate('hello', 10)).toBe('hello');
    });

    it('truncates long strings with ellipsis', () => {
      expect(truncate('hello world', 8)).toBe('hello w\u2026');
    });
  });
});
