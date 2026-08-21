import {
  createCipheriv,
  createDecipheriv,
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
 */

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
/** 96 bits: the IV length AES-GCM is specified and fastest for. */
const IV_BYTES = 12;

/** Key id written into every row this deployment encrypts today. */
export const CURRENT_KEY_ID = 'k2';
/** Key id rows carry when they were written before the last rotation. */
export const PREVIOUS_KEY_ID = 'k1';

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
      `No encryption key '${keyId}' is configured. A row was written under a key ` +
        'this deployment no longer holds; restore it as BANK_TOKEN_ENCRYPTION_KEY_PREVIOUS.'
    );
  }
  assertKeyLength(key, `Encryption key '${keyId}'`);

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAAD(Buffer.from(options.aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));

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
 * reads. Both are 32 random bytes, base64.
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

  const keys: Record<string, Buffer> = {
    [CURRENT_KEY_ID]: decodeKey(current, 'BANK_TOKEN_ENCRYPTION_KEY'),
  };

  const previous = env.BANK_TOKEN_ENCRYPTION_KEY_PREVIOUS;
  if (previous) {
    keys[PREVIOUS_KEY_ID] = decodeKey(previous, 'BANK_TOKEN_ENCRYPTION_KEY_PREVIOUS');
  }

  return { current: { keyId: CURRENT_KEY_ID, key: keys[CURRENT_KEY_ID] }, keys };
}
