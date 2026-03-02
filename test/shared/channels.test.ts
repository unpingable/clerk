// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { Channels } from '../../src/shared/channels';

describe('Channels', () => {
  it('has all chat channels', () => {
    expect(Channels.CHAT_SEND).toBe('clerk:chat:send');
    expect(Channels.CHAT_STREAM_START).toBe('clerk:chat:stream:start');
    expect(Channels.CHAT_STREAM_DELTA).toBe('clerk:chat:stream:delta');
    expect(Channels.CHAT_STREAM_END).toBe('clerk:chat:stream:end');
    expect(Channels.CHAT_MODELS).toBe('clerk:chat:models');
  });

  it('has governor channels', () => {
    expect(Channels.HEALTH).toBe('governor:health');
    expect(Channels.NOW).toBe('governor:now');
    expect(Channels.STATUS).toBe('governor:status');
  });

  it('has commit channels', () => {
    expect(Channels.COMMIT_PENDING).toBe('commit:pending');
    expect(Channels.COMMIT_FIX).toBe('commit:fix');
    expect(Channels.COMMIT_REVISE).toBe('commit:revise');
    expect(Channels.COMMIT_PROCEED).toBe('commit:proceed');
  });

  it('has template channels', () => {
    expect(Channels.TEMPLATES_LIST).toBe('templates:list');
    expect(Channels.TEMPLATES_CURRENT).toBe('templates:current');
    expect(Channels.TEMPLATES_APPLY).toBe('templates:apply');
  });

  it('all values are unique', () => {
    const values = Object.values(Channels);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});
