// SPDX-License-Identifier: Apache-2.0
/** Formatting utilities for dates, hashes, verdicts. */

export function formatTimestamp(ts: number): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function formatRelative(ts: number): string {
  const ms = Date.now() - ts;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function truncateHash(hash: string, len: number = 8): string {
  if (!hash) return '';
  // Strip common prefixes
  const clean = hash.replace(/^sha256:/, '');
  return clean.slice(0, len);
}

export function verdictColor(verdict: string): string {
  switch (verdict?.toLowerCase()) {
    case 'pass':
    case 'allow': return 'var(--clerk-pass)';
    case 'warn': return 'var(--clerk-warn)';
    case 'block': return 'var(--clerk-block)';
    default: return 'var(--clerk-text-muted)';
  }
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '\u2026' : s;
}
