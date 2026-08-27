import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes as nodeRandomBytes,
} from 'node:crypto';

/**
 * Application-level encryption for bank access tokens (ADR 0002).
 *
 * A token is a long-lived credential that can pull someone's transaction
 * history, so reading one has to cost two independent compromises: the
 * database *and* the deployment environment that holds the key. Disk
 * encryption at the provider does nothing about a leaked `DATABASE_URL`, a
 * misdirected backup, or a preview deployment pointed at the wrong branch.
 *
 * Ciphertext format: `v1:<keyId>:<iv_b64>:<tag_b64>:<ct_b64>`. The key id
 * travels in the clear so a rotation can be rolled forward row by row, and the
 * AAD - the owning row's id - means a ciphertext copied into another row fails
 * to authenticate rather than decrypting into someone else's account.
 *
 * The key id is a **fingerprint of the key**, not a position in an ordering.
 * It used to be the constant `'k2'` for whatever `BANK_TOKEN_ENCRYPTION_KEY`
 * held and `'k1'` for whatever `..._PREVIOUS` held, which made rotation
 * impossible rather than merely awkward: every row ever written carried `k2`,
 * and a rotation moved the old key to `k1` - an id no row carried - while
 * handing `k2` to the *new* key, so every existing row then failed to
 * authenticate. An id derived from the key material follows its key wherever
 * it is configured, which is what lets a deployment tell a row it has already
 * re-encrypted from one it has not.
 */

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
/** 96 bits: the IV length AES-GCM is specified and fastest for. */
const IV_BYTES = 12;
/** The full 128-bit tag. Anything shorter lowers the forgery bar. */
const TAG_BYTES = 16;

/** Hex characters of the key fingerprint written into each ciphertext. */
const KEY_ID_LENGTH = 8;

/**
 * The id a key is known by: the first 8 hex characters of `sha256(key)`.
 *
 * A hash rather than the key itself, because this travels in the clear in
 * every row; short because it only has to tell one deployment's handful of
 * keys apart, and it is a lookup key, not a checksum.
 */
export function keyIdFor(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, KEY_ID_LENGTH);
}

export interface EncryptTokenOptions {
  /** Recorded in the ciphertext and in `bank_connections.encryption_key_id`. */
  keyId: string;
  key: Buffer;
  /** Additional authenticated data - the id of the row the token belongs to. */
  aad: string;
  /** Seam for the known-vector test. Production always uses node's CSPRNG. */
  randomBytes?: (size: number) => Buffer;
}

export interface DecryptTokenOptions {
  /** Every key that may still have written a row, by key id. */
  keys: Record<string, Buffer>;
  aad: string;
}

export interface TokenKeyring {
  /** The key new rows are written with. */
  current: { keyId: string; key: Buffer };
  /** Every key rows may be read with, including the current one. */
  keys: Record<string, Buffer>;
}

function assertKeyLength(key: Buffer, label: string): void {
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `${label} must be ${KEY_BYTES} bytes, got ${key.length}. ` +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
    );
  }
}

export function encryptToken(plaintext: string, options: EncryptTokenOptions): string {
  const { keyId, key, aad, randomBytes = nodeRandomBytes } = options;
  assertKeyLength(key, `Encryption key '${keyId}'`);

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return [
    VERSION,
    keyId,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export function decryptToken(ciphertext: string, options: DecryptTokenOptions): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 5) {
    throw new Error('Malformed encrypted token: expected v1:<keyId>:<iv>:<tag>:<ct>');
  }

  const [version, keyId, iv, tag, body] = parts;
  if (version !== VERSION) {
    throw new Error(`Unsupported encrypted token version '${version}'`);
  }

  const key = options.keys[keyId];
  if (!key) {
    throw new Error(
      `Unknown key id '${keyId}': no configured encryption key has that fingerprint. ` +
        'A row was written under a key this deployment no longer holds; restore it ' +
        'as BANK_TOKEN_ENCRYPTION_KEY_PREVIOUS.'
    );
  }
  assertKeyLength(key, `Encryption key '${keyId}'`);

  const ivBytes = Buffer.from(iv, 'base64');
  const tagBytes = Buffer.from(tag, 'base64');
  // GCM authenticates against however many tag bytes it is handed, so a
  // rewritten row carrying a 4-byte tag would be forgeable in 2^32 tries.
  // Both lengths are pinned before the cipher ever sees them, with the same
  // message as any other failed authentication - which is what a wrong
  // length is.
  if (ivBytes.length !== IV_BYTES || tagBytes.length !== TAG_BYTES) {
    throw new Error(
      'Encrypted token failed authentication: wrong key, wrong row, or tampered ciphertext'
    );
  }

  const decipher = createDecipheriv(ALGORITHM, key, ivBytes, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(options.aad, 'utf8'));
  decipher.setAuthTag(tagBytes);

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Node's message here is "Unsupported state or unable to authenticate
    // data", which does not say what a reader needs to know.
    throw new Error(
      'Encrypted token failed authentication: wrong key, wrong row, or tampered ciphertext'
    );
  }
}

function decodeKey(value: string, variable: string): Buffer {
  const key = Buffer.from(value, 'base64');
  assertKeyLength(key, variable);
  return key;
}

/**
 * Builds the keyring from the environment. `BANK_TOKEN_ENCRYPTION_KEY` writes;
 * `BANK_TOKEN_ENCRYPTION_KEY_PREVIOUS`, when a rotation is in flight, only
 * reads. Both are 32 random bytes, base64, and each is registered under its
 * own fingerprint - so which *variable* a key arrived in is a fact about this
 * deployment's configuration today, and never about the rows it wrote.
 */
export function loadKeysFromEnv(
  env: Record<string, string | undefined> = process.env
): TokenKeyring {
  const current = env.BANK_TOKEN_ENCRYPTION_KEY;
  if (!current) {
    throw new Error(
      'BANK_TOKEN_ENCRYPTION_KEY is not set. Bank tokens are never stored unencrypted; see .env.example.'
    );
  }

  const currentKey = decodeKey(current, 'BANK_TOKEN_ENCRYPTION_KEY');
  const keys: Record<string, Buffer> = { [keyIdFor(currentKey)]: currentKey };

  const previous = env.BANK_TOKEN_ENCRYPTION_KEY_PREVIOUS;
  if (previous) {
    // Naming the same key twice - a rotation half set up, or one finished
    // without clearing the variable - collapses to one entry rather than
    // being an error, because it describes a keyring that is exactly right.
    const previousKey = decodeKey(previous, 'BANK_TOKEN_ENCRYPTION_KEY_PREVIOUS');
    keys[keyIdFor(previousKey)] = previousKey;
  }

  return { current: { keyId: keyIdFor(currentKey), key: currentKey }, keys };
}
