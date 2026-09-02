/**
 * A request body, read a chunk at a time and abandoned the moment it goes past
 * a cap.
 *
 * A route handler has no body limit of its own, and a self-hoster running this
 * on their own box has no platform limit in front of it either, so an
 * unbounded `req.text()` is a way to fill the server's memory from outside.
 * Both routes that read a raw body - the CSV import and the Plaid webhook -
 * need the same loop with a different number and a different refusal, so the
 * loop lives here and each route keeps its own status codes.
 *
 * Returns `null` rather than throwing when the body goes past `maxBytes`: the
 * two callers refuse in different shapes, and a sentinel keeps this from
 * having an opinion about either.
 */
export async function readCappedBody(req: Request, maxBytes: number): Promise<string | null> {
  if (!req.body) return '';

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = req.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) return null;
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {
      // The stream is already going away; nothing here depends on how.
    });
  }

  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * What the caller says it is about to send, as a number of bytes, or `null`
 * when it said nothing usable.
 *
 * Kept separate from the read so each route can decide what an unmeasured body
 * is worth: the CSV import refuses one outright (411), the webhook route lets
 * it through to the streaming cap, because Plaid is the only caller that
 * matters there and the cap is the real guard either way.
 */
export function declaredBodyBytes(req: Request): number | null {
  const declared = req.headers.get('content-length');
  if (declared === null) return null;

  // Digits only, not `Number()`: `Number('')` is 0 and `Number('1e3')` is
  // 1000, and neither is a Content-Length anyone sent on purpose.
  if (!/^\d+$/.test(declared.trim())) return null;
  return Number(declared);
}
