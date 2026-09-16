import { createHash } from 'node:crypto';
import type { JWKPublicKey, WebhookVerificationKeyGetResponse } from 'plaid';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose';
import { beforeAll, describe, expect, it, vi, type Mock } from 'vitest';
import { WebhookVerificationError } from '../../src/plaid/errors';
import { PlaidProvider, type PlaidClientLike, type PlaidResponse } from '../../src/plaid/provider';

/**
 * `PlaidProvider.verifyAndParseWebhook`, against real ES256 JWTs.
 *
 * Plaid signs webhooks with a JWT in the `plaid-verification` header (spec
 * §2): `alg` must be `ES256` and nothing else, the key behind `kid` comes from
 * `/webhook_verification_key/get` and is cached per provider instance, the
 * signature has to check out, `iat` has to be recent, and the body hash claim
 * has to match the bytes that actually arrived. Every one of those is a way
 * a forged or replayed webhook could otherwise pass, so each gets its own
 * case here rather than being folded into "invalid webhook rejected".
 *
 * The keypair is generated once, in-process - there is no Plaid sandbox
 * behind these tests, only a fake key server that hands back whatever public
 * JWK this file minted.
 */

const KID = 'test-kid-1';

let privateKey: CryptoKey;
let publicJwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  privateKey = pair.privateKey;
  publicJwk = await exportJWK(pair.publicKey);
});

function bodyHashHex(rawBody: string): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

/** A real ES256 JWT, signed exactly the way Plaid signs a webhook envelope. */
async function signWebhookJwt(options: {
  rawBody: string;
  kid?: string;
  iat?: number;
  requestBodySha256?: string;
  alg?: 'ES256' | 'HS256' | 'none';
  key?: Uint8Array;
}): Promise<string> {
  const {
    rawBody,
    kid = KID,
    iat = Math.floor(Date.now() / 1000),
    requestBodySha256 = bodyHashHex(rawBody),
    alg = 'ES256',
  } = options;

  const jwt = new SignJWT({ request_body_sha256: requestBodySha256 })
    .setProtectedHeader({ alg, kid })
    .setIssuedAt(iat);

  if (alg === 'none') {
    // jose refuses to sign `alg: none` - it is not a real signing algorithm,
    // it is the classic downgrade attack. The header and payload are built by
    // hand instead, with an empty signature segment, which is exactly the
    // shape a forged webhook would arrive in.
    const header = Buffer.from(JSON.stringify({ alg: 'none', kid })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ request_body_sha256: requestBodySha256, iat })
    ).toString('base64url');
    return `${header}.${payload}.`;
  }

  if (alg === 'HS256') {
    return jwt.sign(options.key ?? new TextEncoder().encode('shared-secret'));
  }

  return jwt.sign(privateKey);
}

/** A `webhookVerificationKeyGet` response for the keypair this file generated. */
function keyResponse(overrides: Partial<JWKPublicKey> = {}): PlaidResponse<WebhookVerificationKeyGetResponse> {
  const key: JWKPublicKey = {
    alg: 'ES256',
    crv: publicJwk.crv as string,
    kid: KID,
    kty: publicJwk.kty as string,
    use: 'sig',
    x: publicJwk.x as string,
    y: publicJwk.y as string,
    created_at: Math.floor(Date.now() / 1000) - 3600,
    expired_at: null,
    ...overrides,
  };
  return { data: { key, request_id: 'req-key-1' } };
}

type FakeClient = { [K in keyof PlaidClientLike]: Mock<PlaidClientLike[K]> };

/** The one method these tests need; everything else throws if reached. */
function fakeClient(): FakeClient {
  const unused = vi.fn(async () => {
    throw new Error('unused in these tests');
  });
  return {
    linkTokenCreate: unused,
    itemPublicTokenExchange: unused,
    itemGet: unused,
    institutionsGetById: unused,
    accountsGet: unused,
    transactionsSync: unused,
    itemRemove: unused,
    webhookVerificationKeyGet: vi.fn(async () => keyResponse()),
  } as unknown as FakeClient;
}

function headers(jwt: string, name = 'plaid-verification'): Record<string, string> {
  return { [name]: jwt };
}

/**
 * A validly-signed ES256 JWT with an arbitrary payload - for the two claim
 * shapes `signWebhookJwt` cannot produce: a missing `request_body_sha256` and
 * a non-string one. Both have to be rejected *after* the signature checks
 * out, which is exactly what a hand-built payload proves: the claim, not the
 * signature, is what's wrong.
 */
async function signWithPayload(
  payload: Record<string, unknown>,
  options: { kid?: string; iat?: number } = {}
): Promise<string> {
  const { kid = KID, iat = Math.floor(Date.now() / 1000) } = options;
  return new SignJWT(payload).setProtectedHeader({ alg: 'ES256', kid }).setIssuedAt(iat).sign(privateKey);
}

describe('verifyAndParseWebhook', () => {
  it('verifies a real ES256 webhook and returns its parsed event', async () => {
    const rawBody = JSON.stringify({
      webhook_type: 'TRANSACTIONS',
      webhook_code: 'SYNC_UPDATES_AVAILABLE',
      item_id: 'item-1',
    });
    const client = fakeClient();
    const jwt = await signWebhookJwt({ rawBody });

    const event = await new PlaidProvider({ client }).verifyAndParseWebhook(
      rawBody,
      headers(jwt)
    );

    expect(event).toEqual({
      type: 'TRANSACTIONS',
      code: 'SYNC_UPDATES_AVAILABLE',
      itemId: 'item-1',
      bodyHash: bodyHashHex(rawBody),
      payload: {
        webhook_type: 'TRANSACTIONS',
        webhook_code: 'SYNC_UPDATES_AVAILABLE',
        item_id: 'item-1',
      },
    });
  });

  it('reads the header case-insensitively', async () => {
    const rawBody = JSON.stringify({ webhook_type: 'ITEM', webhook_code: null, item_id: null });
    const client = fakeClient();
    const jwt = await signWebhookJwt({ rawBody });

    const event = await new PlaidProvider({ client }).verifyAndParseWebhook(rawBody, {
      'Plaid-Verification': jwt,
    });

    expect(event.type).toBe('ITEM');
  });

  it('rejects a missing header without ever touching the client', async () => {
    const client = fakeClient();

    await expect(
      new PlaidProvider({ client }).verifyAndParseWebhook('{}', {})
    ).rejects.toBeInstanceOf(WebhookVerificationError);
    expect(client.webhookVerificationKeyGet).not.toHaveBeenCalled();
  });

  it('rejects alg:none before any key fetch or crypto', async () => {
    const rawBody = '{}';
    const client = fakeClient();
    const jwt = await signWebhookJwt({ rawBody, alg: 'none' });

    await expect(
      new PlaidProvider({ client }).verifyAndParseWebhook(rawBody, headers(jwt))
    ).rejects.toBeInstanceOf(WebhookVerificationError);
    expect(client.webhookVerificationKeyGet).not.toHaveBeenCalled();
  });

  it('rejects an HS256 downgrade before any key fetch or crypto', async () => {
    const rawBody = '{}';
    const client = fakeClient();
    const jwt = await signWebhookJwt({ rawBody, alg: 'HS256' });

    await expect(
      new PlaidProvider({ client }).verifyAndParseWebhook(rawBody, headers(jwt))
    ).rejects.toBeInstanceOf(WebhookVerificationError);
    expect(client.webhookVerificationKeyGet).not.toHaveBeenCalled();
  });

  it('rejects a stale iat, 301 seconds old', async () => {
    const rawBody = '{}';
    const client = fakeClient();
    const jwt = await signWebhookJwt({
      rawBody,
      iat: Math.floor(Date.now() / 1000) - 301,
    });

    await expect(
      new PlaidProvider({ client }).verifyAndParseWebhook(rawBody, headers(jwt))
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  it('accepts an iat at the edge of the window, 299 seconds old', async () => {
    const rawBody = '{}';
    const client = fakeClient();
    const jwt = await signWebhookJwt({
      rawBody,
      iat: Math.floor(Date.now() / 1000) - 299,
    });

    await expect(
      new PlaidProvider({ client }).verifyAndParseWebhook(rawBody, headers(jwt))
    ).resolves.toBeDefined();
  });

  /**
   * The staleness check alone only bounds the past: an `iat` dated far into
   * the future is never ">" 300 seconds old, so it would pass forever - the
   * exact scenario a freshness check exists to catch (spec §2's "within the
   * last 5 minutes" means a *window*, not just a floor). A 30-second skew
   * allowance keeps a legitimately slow clock from being refused.
   */
  it('rejects an iat 31 seconds in the future', async () => {
    const rawBody = '{}';
    const client = fakeClient();
    const jwt = await signWebhookJwt({
      rawBody,
      iat: Math.floor(Date.now() / 1000) + 31,
    });

    await expect(
      new PlaidProvider({ client }).verifyAndParseWebhook(rawBody, headers(jwt))
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  it('accepts an iat 29 seconds in the future, as clock skew', async () => {
    const rawBody = '{}';
    const client = fakeClient();
    const jwt = await signWebhookJwt({
      rawBody,
      iat: Math.floor(Date.now() / 1000) + 29,
    });

    await expect(
      new PlaidProvider({ client }).verifyAndParseWebhook(rawBody, headers(jwt))
    ).resolves.toBeDefined();
  });

  it('rejects a validly-signed JWT with no request_body_sha256 claim at all', async () => {
    const rawBody = '{}';
    const client = fakeClient();
    const jwt = await signWithPayload({});

    await expect(
      new PlaidProvider({ client }).verifyAndParseWebhook(rawBody, headers(jwt))
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  it('rejects a validly-signed JWT whose request_body_sha256 claim is not a string', async () => {
    const rawBody = '{}';
    const client = fakeClient();
    const jwt = await signWithPayload({ request_body_sha256: 12345 });

    await expect(
      new PlaidProvider({ client }).verifyAndParseWebhook(rawBody, headers(jwt))
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  it('rejects a body hash claim that does not match the bytes that arrived', async () => {
    const rawBody = JSON.stringify({ a: 1 });
    const client = fakeClient();
    const jwt = await signWebhookJwt({
      rawBody,
      requestBodySha256: bodyHashHex(JSON.stringify({ a: 2 })),
    });

    await expect(
      new PlaidProvider({ client }).verifyAndParseWebhook(rawBody, headers(jwt))
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  it('never puts the JWT or the raw body in the error message', async () => {
    const rawBody = JSON.stringify({ secret: 'do-not-leak-me' });
    const client = fakeClient();
    const jwt = await signWebhookJwt({
      rawBody,
      requestBodySha256: bodyHashHex('{}'),
    });

    const error = (await new PlaidProvider({ client })
      .verifyAndParseWebhook(rawBody, headers(jwt))
      .catch((e: unknown) => e)) as Error;

    expect(error.message).not.toContain('do-not-leak-me');
    expect(error.message).not.toContain(jwt);
  });

  it('refetches exactly once for an unknown kid, then rejects', async () => {
    const rawBody = '{}';
    const client = fakeClient();
    client.webhookVerificationKeyGet.mockRejectedValueOnce(new Error('no key for that kid'));
    const jwt = await signWebhookJwt({ rawBody, kid: 'kid-nobody-issued' });

    await expect(
      new PlaidProvider({ client }).verifyAndParseWebhook(rawBody, headers(jwt))
    ).rejects.toBeInstanceOf(WebhookVerificationError);
    expect(client.webhookVerificationKeyGet).toHaveBeenCalledTimes(1);
  });

  it('rejects a key the server marks expired, and does not cache it (Phase 5 audit)', async () => {
    // Plaid retires a signing key by setting `expired_at`; a verifier that
    // keeps trusting it keeps trusting whatever leaked with it.
    const rawBody = '{}';
    const client = fakeClient();
    client.webhookVerificationKeyGet.mockResolvedValue(
      keyResponse({ expired_at: Math.floor(Date.now() / 1000) - 60 })
    );
    const provider = new PlaidProvider({ client });
    const jwt = await signWebhookJwt({ rawBody });

    await expect(provider.verifyAndParseWebhook(rawBody, headers(jwt))).rejects.toBeInstanceOf(
      WebhookVerificationError
    );

    // Not cached: the next webhook asks the key server again, so a kid that
    // was expired in error recovers without a process restart.
    await expect(provider.verifyAndParseWebhook(rawBody, headers(jwt))).rejects.toBeInstanceOf(
      WebhookVerificationError
    );
    expect(client.webhookVerificationKeyGet).toHaveBeenCalledTimes(2);
  });

  it('caches the key by kid: a second webhook with the same kid does not refetch', async () => {
    const client = fakeClient();
    const provider = new PlaidProvider({ client });

    const first = JSON.stringify({ n: 1 });
    await provider.verifyAndParseWebhook(first, headers(await signWebhookJwt({ rawBody: first })));

    const second = JSON.stringify({ n: 2 });
    await provider.verifyAndParseWebhook(
      second,
      headers(await signWebhookJwt({ rawBody: second }))
    );

    expect(client.webhookVerificationKeyGet).toHaveBeenCalledTimes(1);
  });
});
