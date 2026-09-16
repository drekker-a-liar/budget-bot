import { describe, expect, it } from 'vitest';
import { declaredBodyBytes, readCappedBody } from '@/lib/readCappedBody';

/**
 * The one body-reading loop both raw-body routes share (Phase 5 audit). The
 * CSV import and the Plaid webhook each pin their own status codes in their
 * own route tests; this pins the loop itself - that the cap is enforced on the
 * bytes that arrive, not on what the caller declared, and that the stream is
 * let go the moment it is exceeded.
 */

/** A request whose body arrives in the given chunks, one per read. */
function chunkedRequest(chunks: string[], headers: Record<string, string> = {}): Request {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index++]));
    },
  });
  return new Request('https://budget-bot.test/anything', {
    method: 'POST',
    body,
    headers,
    // Node's fetch refuses a streaming body without this; the routes never
    // build requests themselves, so nothing in production hits it.
    duplex: 'half',
  } as RequestInit);
}

describe('readCappedBody', () => {
  it('returns the whole body as text when it fits under the cap', async () => {
    const request = chunkedRequest(['date,amount\n', '2026-01-02,12.34\n']);

    await expect(readCappedBody(request, 1024)).resolves.toBe('date,amount\n2026-01-02,12.34\n');
  });

  it('returns an empty string for a request with no body at all', async () => {
    const request = new Request('https://budget-bot.test/anything', { method: 'POST' });

    await expect(readCappedBody(request, 1024)).resolves.toBe('');
  });

  it('accepts a body of exactly the cap', async () => {
    const request = chunkedRequest(['abcd', 'efgh']);

    await expect(readCappedBody(request, 8)).resolves.toBe('abcdefgh');
  });

  it('returns null the moment the bytes read pass the cap, whatever the caller declared', async () => {
    // Content-Length says 4; the body is 12. The loop is the guard that does
    // not take the caller's word for it.
    const request = chunkedRequest(['abcd', 'efgh', 'ijkl'], { 'Content-Length': '4' });

    await expect(readCappedBody(request, 8)).resolves.toBeNull();
  });

  it('stops reading once the cap is passed rather than draining the stream', async () => {
    let pulls = 0;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        // An endless body: only the cap can end this read.
        controller.enqueue(encoder.encode('x'.repeat(1024)));
      },
    });
    const request = new Request('https://budget-bot.test/anything', {
      method: 'POST',
      body,
      duplex: 'half',
    } as RequestInit);

    await expect(readCappedBody(request, 2048)).resolves.toBeNull();
    // Three chunks trip a 2 KiB cap. The stream's own read-ahead may pull one
    // or two more before cancel lands; a drained stream would pull for ever.
    expect(pulls).toBeLessThan(8);
  });

  it('decodes multi-byte UTF-8 split across chunks', async () => {
    const euro = new TextEncoder().encode('€');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(euro.subarray(0, 1));
        controller.enqueue(euro.subarray(1));
        controller.close();
      },
    });
    const request = new Request('https://budget-bot.test/anything', {
      method: 'POST',
      body,
      duplex: 'half',
    } as RequestInit);

    await expect(readCappedBody(request, 16)).resolves.toBe('€');
  });
});

describe('declaredBodyBytes', () => {
  function withContentLength(value: string | null): Request {
    const headers: Record<string, string> = value === null ? {} : { 'Content-Length': value };
    return new Request('https://budget-bot.test/anything', { method: 'POST', headers });
  }

  it('reads a well-formed Content-Length as a byte count', () => {
    expect(declaredBodyBytes(withContentLength('4096'))).toBe(4096);
    expect(declaredBodyBytes(withContentLength('0'))).toBe(0);
    expect(declaredBodyBytes(withContentLength(' 12 '))).toBe(12);
  });

  it('returns null when the header is missing', () => {
    expect(declaredBodyBytes(withContentLength(null))).toBeNull();
  });

  it.each(['', 'abc', '-1', '1e3', '0x10', 'Infinity', 'NaN'])('returns null for the unusable value %j', (value) => {
    expect(declaredBodyBytes(withContentLength(value))).toBeNull();
  });
});
