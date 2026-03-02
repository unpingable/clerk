// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { FrameParser } from '../../src/main/rpc-client';

describe('FrameParser', () => {
  it('parses a single complete frame', () => {
    const parser = new FrameParser();
    const messages: unknown[] = [];
    parser.on('message', (msg: unknown) => messages.push(msg));

    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } });
    const frame = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    parser.feed(Buffer.from(frame));

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ jsonrpc: '2.0', id: 1, result: { ok: true } });
  });

  it('handles split frames across multiple feeds', () => {
    const parser = new FrameParser();
    const messages: unknown[] = [];
    parser.on('message', (msg: unknown) => messages.push(msg));

    const body = JSON.stringify({ jsonrpc: '2.0', id: 2, result: 'hello' });
    const frame = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    const buf = Buffer.from(frame);

    // Split in the middle
    parser.feed(buf.subarray(0, 10));
    expect(messages).toHaveLength(0);

    parser.feed(buf.subarray(10));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ jsonrpc: '2.0', id: 2, result: 'hello' });
  });

  it('handles multiple frames in one feed', () => {
    const parser = new FrameParser();
    const messages: unknown[] = [];
    parser.on('message', (msg: unknown) => messages.push(msg));

    const msg1 = JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'a' });
    const msg2 = JSON.stringify({ jsonrpc: '2.0', id: 2, result: 'b' });
    const frame = `Content-Length: ${Buffer.byteLength(msg1)}\r\n\r\n${msg1}Content-Length: ${Buffer.byteLength(msg2)}\r\n\r\n${msg2}`;
    parser.feed(Buffer.from(frame));

    expect(messages).toHaveLength(2);
  });

  it('handles notification messages (no id)', () => {
    const parser = new FrameParser();
    const messages: unknown[] = [];
    parser.on('message', (msg: unknown) => messages.push(msg));

    const body = JSON.stringify({ jsonrpc: '2.0', method: 'chat.delta', params: { content: 'hi' } });
    const frame = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    parser.feed(Buffer.from(frame));

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      jsonrpc: '2.0',
      method: 'chat.delta',
      params: { content: 'hi' },
    });
  });

  it('handles unicode content correctly', () => {
    const parser = new FrameParser();
    const messages: unknown[] = [];
    parser.on('message', (msg: unknown) => messages.push(msg));

    const body = JSON.stringify({ text: '\u{1F680} rocket' });
    const frame = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    parser.feed(Buffer.from(frame));

    expect(messages).toHaveLength(1);
    expect((messages[0] as { text: string }).text).toBe('\u{1F680} rocket');
  });

  it('emits error for malformed JSON', () => {
    const parser = new FrameParser();
    const errors: Error[] = [];
    parser.on('error', (err: Error) => errors.push(err));

    const body = 'not json';
    const frame = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    parser.feed(Buffer.from(frame));

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Failed to parse JSON');
  });

  it('skips malformed headers', () => {
    const parser = new FrameParser();
    const messages: unknown[] = [];
    parser.on('message', (msg: unknown) => messages.push(msg));

    // Malformed header followed by a valid frame
    const badHeader = `Bad-Header: something\r\n\r\n`;
    const body = JSON.stringify({ id: 1 });
    const good = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    parser.feed(Buffer.from(badHeader + good));

    expect(messages).toHaveLength(1);
  });
});
