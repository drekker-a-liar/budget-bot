import { describe, expect, it } from 'vitest';
import {
  CURRENT_KEY_ID,
  PREVIOUS_KEY_ID,
  decryptToken,
  encryptToken,
  loadKeysFromEnv,
} from '../src/crypto';

/**
 * ADR 0002: a bank access token is AES-256-GCM encrypted before it reaches the
 * database, with the row's id as additional authenticated data, so that a
 * database dump on its own is useless and a ciphertext cannot be moved from
 * one row to another.
 */

const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);
const ROW_ID = 'e3b0c442-98fc-1c14-9afb-f4c8996fb924';
const TOKEN = 'access-sandbox-0000-1111-2222-3333';

const keyring = (keys: Record<string, Buffer>) => ({ keys, aad: ROW_ID });

describe('encryptToken / decryptToken', () => {
  it('round-trips a token under the key and AAD it was written with', () => {
    const ciphertext = encryptToken(TOKEN, { keyId: 'k2', key: KEY, aad: ROW_ID });

    expect(decryptToken(ciphertext, keyring({ k2: KEY }))).toBe(TOKEN);
  });

  it('writes the versioned five-part format, key id in the clear', () => {
    const parts = encryptToken(TOKEN, { keyId: 'k2', key: KEY, aad: ROW_ID }).split(':');

    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe('v1');
    expect(parts[1]).toBe('k2');
  });

  it('produces a different ciphertext every time - the IV is random', () => {
    const first = encryptToken(TOKEN, { keyId: 'k2', key: KEY, aad: ROW_ID });
    const second = encryptToken(TOKEN, { keyId: 'k2', key: KEY, aad: ROW_ID });

    expect(first).not.toBe(second);
  });

  it('matches a known AES-256-GCM vector when the IV is fixed', () => {
    // Independently computed with node:crypto for key=0x07*32, iv=0x03*12.
    const ciphertext = encryptToken(TOKEN, {
      keyId: 'k2',
      key: KEY,
      aad: ROW_ID,
      randomBytes: (size) => Buffer.alloc(size, 3),
    });

    expect(ciphertext).toBe(
      'v1:k2:AwMDAwMDAwMDAwMD:u9fw+Io2e42PldgIEZackA==:RJ3AZilbczEbLic+hC/SPN0M0MKFpKVBAuy1g9HIc4uClA=='
    );
  });

  it('refuses a ciphertext presented with a different AAD - rows are not interchangeable', () => {
    const ciphertext = encryptToken(TOKEN, { keyId: 'k2', key: KEY, aad: ROW_ID });

    expect(() =>
      decryptToken(ciphertext, { keys: { k2: KEY }, aad: 'a-different-row-id' })
    ).toThrow(/authentication/i);
  });

  it('refuses a ciphertext whose tag has been tampered with', () => {
    const [version, keyId, iv, tag, ct] = encryptToken(TOKEN, {
      keyId: 'k2',
      key: KEY,
      aad: ROW_ID,
    }).split(':');
    const flipped = Buffer.from(tag, 'base64');
    flipped[0] ^= 0xff;
    const tampered = [version, keyId, iv, flipped.toString('base64'), ct].join(':');

    expect(() => decryptToken(tampered, keyring({ k2: KEY }))).toThrow(/authentication/i);
  });

  it('refuses a ciphertext whose body has been tampered with', () => {
    const [version, keyId, iv, tag, ct] = encryptToken(TOKEN, {
      keyId: 'k2',
      key: KEY,
      aad: ROW_ID,
    }).split(':');
    const flipped = Buffer.from(ct, 'base64');
    flipped[0] ^= 0xff;
    const tampered = [version, keyId, iv, tag, flipped.toString('base64')].join(':');

    expect(() => decryptToken(tampered, keyring({ k2: KEY }))).toThrow(/authentication/i);
  });

  it('names the missing key id when the keyring cannot decrypt a row', () => {
    const ciphertext = encryptToken(TOKEN, { keyId: 'k1', key: KEY, aad: ROW_ID });

    expect(() => decryptToken(ciphertext, keyring({ k2: OTHER_KEY }))).toThrow(/k1/);
  });

  it('decrypts a row written under the previous key during a rotation', () => {
    const written = encryptToken(TOKEN, { keyId: 'k1', key: OTHER_KEY, aad: ROW_ID });

    expect(decryptToken(written, keyring({ k2: KEY, k1: OTHER_KEY }))).toBe(TOKEN);
  });

  it('rejects an unknown ciphertext version rather than guessing at the layout', () => {
    const ciphertext = encryptToken(TOKEN, { keyId: 'k2', key: KEY, aad: ROW_ID });
    const future = `v2${ciphertext.slice(2)}`;

    expect(() => decryptToken(future, keyring({ k2: KEY }))).toThrow(/v2/);
  });

  it('rejects a malformed ciphertext', () => {
    expect(() => decryptToken('not-a-ciphertext', keyring({ k2: KEY }))).toThrow(
      /malformed/i
    );
  });

  it.each([
    ['too short', Buffer.alloc(16, 1)],
    ['too long', Buffer.alloc(64, 1)],
  ])('rejects a key that is %s rather than silently deriving one', (_label, key) => {
    expect(() => encryptToken(TOKEN, { keyId: 'k2', key, aad: ROW_ID })).toThrow(
      /32 bytes/
    );
  });
});

describe('loadKeysFromEnv', () => {
  const base64Key = KEY.toString('base64');
  const previousBase64Key = OTHER_KEY.toString('base64');

  it('reads the current key and offers it under the current key id', () => {
    const keyring = loadKeysFromEnv({ BANK_TOKEN_ENCRYPTION_KEY: base64Key });

    expect(keyring.current.keyId).toBe(CURRENT_KEY_ID);
    expect(keyring.current.key.equals(KEY)).toBe(true);
    expect(Object.keys(keyring.keys)).toEqual([CURRENT_KEY_ID]);
  });

  it('adds the previous key to the decryption keyring but never to `current`', () => {
    const keyring = loadKeysFromEnv({
      BANK_TOKEN_ENCRYPTION_KEY: base64Key,
      BANK_TOKEN_ENCRYPTION_KEY_PREVIOUS: previousBase64Key,
    });

    expect(keyring.current.keyId).toBe(CURRENT_KEY_ID);
    expect(keyring.keys[PREVIOUS_KEY_ID].equals(OTHER_KEY)).toBe(true);
  });

  it('round-trips through the keyring it builds', () => {
    const { current, keys } = loadKeysFromEnv({ BANK_TOKEN_ENCRYPTION_KEY: base64Key });
    const ciphertext = encryptToken(TOKEN, { ...current, aad: ROW_ID });

    expect(decryptToken(ciphertext, { keys, aad: ROW_ID })).toBe(TOKEN);
  });

  it('fails when the key is absent instead of running without encryption', () => {
    expect(() => loadKeysFromEnv({})).toThrow(/BANK_TOKEN_ENCRYPTION_KEY/);
  });

  it('fails when the key does not decode to 32 bytes', () => {
    expect(() => loadKeysFromEnv({ BANK_TOKEN_ENCRYPTION_KEY: 'c2hvcnQ=' })).toThrow(
      /32 bytes/
    );
  });

  it('names the previous key when it is the one that is wrong', () => {
    expect(() =>
      loadKeysFromEnv({
        BANK_TOKEN_ENCRYPTION_KEY: base64Key,
        BANK_TOKEN_ENCRYPTION_KEY_PREVIOUS: 'c2hvcnQ=',
      })
    ).toThrow(/BANK_TOKEN_ENCRYPTION_KEY_PREVIOUS/);
  });
});
