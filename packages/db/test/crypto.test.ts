import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken, keyIdFor, loadKeysFromEnv } from '../src/crypto';

/**
 * ADR 0002: a bank access token is AES-256-GCM encrypted before it reaches the
 * database, with the row's id as additional authenticated data, so that a
 * database dump on its own is useless and a ciphertext cannot be moved from
 * one row to another.
 *
 * The key id in the ciphertext is a **fingerprint of the key itself**, not a
 * position in an ordering. It used to be the constant `'k2'` for whatever
 * `BANK_TOKEN_ENCRYPTION_KEY` held and `'k1'` for whatever the `_PREVIOUS`
 * variable held, which meant a rotation moved the old key to an id no row had
 * ever carried while the new key inherited the id every row *did* carry - so
 * every existing row failed to authenticate. The rotation tests below go
 * through `loadKeysFromEnv` on both sides for exactly that reason: the old
 * suite passed because it hand-built the `'k1'` ciphertext that
 * `loadKeysFromEnv` could never have produced.
 */

const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);
const KEY_ID = keyIdFor(KEY);
const OTHER_KEY_ID = keyIdFor(OTHER_KEY);
const ROW_ID = 'e3b0c442-98fc-1c14-9afb-f4c8996fb924';
const TOKEN = 'access-sandbox-0000-1111-2222-3333';

const keyring = (keys: Record<string, Buffer>) => ({ keys, aad: ROW_ID });

describe('keyIdFor', () => {
  it('is eight hex characters of the key’s own fingerprint', () => {
    expect(KEY_ID).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is the same for the same key, whatever variable it arrived in', () => {
    expect(keyIdFor(Buffer.alloc(32, 7))).toBe(KEY_ID);
  });

  it('differs for a different key', () => {
    expect(OTHER_KEY_ID).not.toBe(KEY_ID);
  });

  it('is a hash, so the id in the clear says nothing about the key', () => {
    expect(KEY.toString('hex')).not.toContain(KEY_ID);
    expect(KEY.toString('base64')).not.toContain(KEY_ID);
  });
});

describe('encryptToken / decryptToken', () => {
  it('round-trips a token under the key and AAD it was written with', () => {
    const ciphertext = encryptToken(TOKEN, { keyId: KEY_ID, key: KEY, aad: ROW_ID });

    expect(decryptToken(ciphertext, keyring({ [KEY_ID]: KEY }))).toBe(TOKEN);
  });

  it('writes the versioned five-part format, key id in the clear', () => {
    const parts = encryptToken(TOKEN, { keyId: KEY_ID, key: KEY, aad: ROW_ID }).split(':');

    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe('v1');
    expect(parts[1]).toBe(KEY_ID);
  });

  it('produces a different ciphertext every time - the IV is random', () => {
    const first = encryptToken(TOKEN, { keyId: KEY_ID, key: KEY, aad: ROW_ID });
    const second = encryptToken(TOKEN, { keyId: KEY_ID, key: KEY, aad: ROW_ID });

    expect(first).not.toBe(second);
  });

  it('matches a known AES-256-GCM vector when the IV is fixed', () => {
    // Independently computed with node:crypto for key=0x07*32, iv=0x03*12.
    // The key id is a label written beside the ciphertext and is not an input
    // to the cipher, so this vector uses a literal one rather than a
    // fingerprint - what it pins is the encryption, not the naming.
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
    const ciphertext = encryptToken(TOKEN, { keyId: KEY_ID, key: KEY, aad: ROW_ID });

    expect(() =>
      decryptToken(ciphertext, { keys: { [KEY_ID]: KEY }, aad: 'a-different-row-id' })
    ).toThrow(/authentication/i);
  });

  it('refuses a ciphertext whose tag has been tampered with', () => {
    const [version, keyId, iv, tag, ct] = encryptToken(TOKEN, {
      keyId: KEY_ID,
      key: KEY,
      aad: ROW_ID,
    }).split(':');
    const flipped = Buffer.from(tag, 'base64');
    flipped[0] ^= 0xff;
    const tampered = [version, keyId, iv, flipped.toString('base64'), ct].join(':');

    expect(() => decryptToken(tampered, keyring({ [KEY_ID]: KEY }))).toThrow(
      /authentication/i
    );
  });

  it('refuses a ciphertext whose body has been tampered with', () => {
    const [version, keyId, iv, tag, ct] = encryptToken(TOKEN, {
      keyId: KEY_ID,
      key: KEY,
      aad: ROW_ID,
    }).split(':');
    const flipped = Buffer.from(ct, 'base64');
    flipped[0] ^= 0xff;
    const tampered = [version, keyId, iv, tag, flipped.toString('base64')].join(':');

    expect(() => decryptToken(tampered, keyring({ [KEY_ID]: KEY }))).toThrow(
      /authentication/i
    );
  });

  it('names the missing key id when the keyring cannot decrypt a row', () => {
    const ciphertext = encryptToken(TOKEN, { keyId: OTHER_KEY_ID, key: OTHER_KEY, aad: ROW_ID });

    expect(() => decryptToken(ciphertext, keyring({ [KEY_ID]: KEY }))).toThrow(
      new RegExp(`unknown key id.*${OTHER_KEY_ID}`, 'i')
    );
  });

  it('rejects an unknown ciphertext version rather than guessing at the layout', () => {
    const ciphertext = encryptToken(TOKEN, { keyId: KEY_ID, key: KEY, aad: ROW_ID });
    const future = `v2${ciphertext.slice(2)}`;

    expect(() => decryptToken(future, keyring({ [KEY_ID]: KEY }))).toThrow(/v2/);
  });

  it('rejects a malformed ciphertext', () => {
    expect(() => decryptToken('not-a-ciphertext', keyring({ [KEY_ID]: KEY }))).toThrow(
      /malformed/i
    );
  });

  it.each([
    ['too short', Buffer.alloc(16, 1)],
    ['too long', Buffer.alloc(64, 1)],
  ])('rejects a key that is %s rather than silently deriving one', (_label, key) => {
    expect(() => encryptToken(TOKEN, { keyId: KEY_ID, key, aad: ROW_ID })).toThrow(
      /32 bytes/
    );
  });
});

describe('loadKeysFromEnv', () => {
  const base64Key = KEY.toString('base64');
  const previousBase64Key = OTHER_KEY.toString('base64');

  it('offers the current key under its own fingerprint', () => {
    const keyring = loadKeysFromEnv({ BANK_TOKEN_ENCRYPTION_KEY: base64Key });

    expect(keyring.current.keyId).toBe(KEY_ID);
    expect(keyring.current.key.equals(KEY)).toBe(true);
    expect(Object.keys(keyring.keys)).toEqual([KEY_ID]);
  });

  it('adds the previous key to the decryption keyring but never to `current`', () => {
    const keyring = loadKeysFromEnv({
      BANK_TOKEN_ENCRYPTION_KEY: base64Key,
      BANK_TOKEN_ENCRYPTION_KEY_PREVIOUS: previousBase64Key,
    });

    expect(keyring.current.keyId).toBe(KEY_ID);
    expect(keyring.keys[OTHER_KEY_ID].equals(OTHER_KEY)).toBe(true);
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

  /**
   * A rotation, done the way the operator is told to do it, with every step
   * going through `loadKeysFromEnv`. Nothing here constructs a key id by hand,
   * because the defect this replaces was in how the ids were assigned and a
   * hand-built ciphertext cannot see it.
   */
  describe('a rotation', () => {
    const before = { BANK_TOKEN_ENCRYPTION_KEY: previousBase64Key };
    const after = {
      BANK_TOKEN_ENCRYPTION_KEY: base64Key,
      BANK_TOKEN_ENCRYPTION_KEY_PREVIOUS: previousBase64Key,
    };

    /** A row written before the rotation, by the deployment as it then was. */
    function rowWrittenBefore(): string {
      const { current } = loadKeysFromEnv(before);
      return encryptToken(TOKEN, { ...current, aad: ROW_ID });
    }

    it('still reads a row written under the old key', () => {
      const row = rowWrittenBefore();
      const { keys } = loadKeysFromEnv(after);

      expect(decryptToken(row, { keys, aad: ROW_ID })).toBe(TOKEN);
    });

    it('writes new rows under the new key', () => {
      const { current } = loadKeysFromEnv(after);
      const row = encryptToken(TOKEN, { ...current, aad: ROW_ID });

      expect(row.split(':')[1]).toBe(KEY_ID);
      expect(current.key.equals(KEY)).toBe(true);
    });

    it('leaves a row written before the rotation carrying the old id', () => {
      // The property that makes rolling forward row by row possible at all: an
      // id follows its key, so a row can be recognised as not yet re-encrypted.
      expect(rowWrittenBefore().split(':')[1]).toBe(OTHER_KEY_ID);
    });

    it('says which key id is missing once the old key is dropped', () => {
      const row = rowWrittenBefore();
      const { keys } = loadKeysFromEnv({ BANK_TOKEN_ENCRYPTION_KEY: base64Key });

      expect(() => decryptToken(row, { keys, aad: ROW_ID })).toThrow(
        new RegExp(`unknown key id.*${OTHER_KEY_ID}`, 'i')
      );
      expect(() => decryptToken(row, { keys, aad: ROW_ID })).toThrow(
        /BANK_TOKEN_ENCRYPTION_KEY_PREVIOUS/
      );
    });

    it('is a no-op when the same key is named twice', () => {
      // Half-finished rotations happen. Registering one key under one id twice
      // is not an error, and must not turn into two entries or a lost key.
      const { current, keys } = loadKeysFromEnv({
        BANK_TOKEN_ENCRYPTION_KEY: base64Key,
        BANK_TOKEN_ENCRYPTION_KEY_PREVIOUS: base64Key,
      });

      expect(Object.keys(keys)).toEqual([KEY_ID]);
      expect(current.keyId).toBe(KEY_ID);
    });
  });
});
