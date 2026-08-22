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
