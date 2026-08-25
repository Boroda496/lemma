/**
 * The passphrase is the whole account.
 *
 * From it we derive two independent keys by PBKDF2 with different salts:
 *
 *   access  — the address the blob lives at on the server. Sent in the URL.
 *   secret  — the AES-GCM key that encrypts the blob. Never sent anywhere.
 *
 * Different salts mean the access key reveals nothing about the secret key,
 * so the server can route a request without being able to read what it is
 * storing. Nothing here is sent to the server but the access key and
 * ciphertext; the passphrase never leaves the device, which is why there is
 * no way to recover it and why the app says so out loud.
 *
 * The iteration count is the honest cost. 300k is roughly a fifth of a second
 * on a phone, paid once when a device is linked and once per launch, and it
 * multiplies the work of anyone guessing passphrases by the same factor.
 */

const ITERATIONS = 300_000;
const ACCESS_SALT = 'lemma/sync/access/v1';
const SECRET_SALT = 'lemma/sync/secret/v1';

export interface DerivedKeys {
  /** base64url, 43 chars — the server's key shape. */
  readonly access: string;
  /** Raw AES-GCM key material, base64url, kept on the device. */
  readonly secret: string;
}

const enc = new TextEncoder();

async function pbkdf2(passphrase: string, salt: string): Promise<ArrayBuffer> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: ITERATIONS },
    base,
    256,
  );
}

/** Derive both keys. Slow on purpose; call it once and keep the result. */
export async function deriveKeys(passphrase: string): Promise<DerivedKeys> {
  const normalised = passphrase.normalize('NFKC').trim();
  if (normalised.length < 8) throw new Error('Use a passphrase of at least 8 characters.');
  const [access, secret] = await Promise.all([
    pbkdf2(normalised, ACCESS_SALT),
    pbkdf2(normalised, SECRET_SALT),
  ]);
  return { access: toBase64Url(access), secret: toBase64Url(secret) };
}

export interface Envelope {
  readonly v: 1;
  readonly iv: string;
  /** Whether `data` is gzipped beneath the encryption. */
  readonly gz: boolean;
  readonly data: string;
}

/**
 * Encrypt a payload for the server.
 *
 * Compression happens before encryption because ciphertext does not compress.
 * That leaks the rough size of the history, which for a practice log is not
 * worth the bandwidth of sending fifty kilobytes where eight will do.
 */
export async function seal(secret: string, payload: string): Promise<Envelope> {
  const key = await importSecret(secret);
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12))) as Bytes;
  const plain = bytesOf(enc.encode(payload));
  const gz = await gzip(plain);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, gz ?? plain);
  return { v: 1, iv: toBase64Url(iv), gz: gz !== null, data: toBase64Url(cipher) };
}

/**
 * Decrypt a payload from the server.
 *
 * A wrong passphrase fails here, in AES-GCM's authentication tag, rather than
 * producing plausible rubbish — which is what lets the app tell the
 * difference between "this passphrase is wrong" and "the network is down".
 */
export async function open(secret: string, envelope: Envelope): Promise<string> {
  if (envelope.v !== 1) throw new Error('That data was written by a newer version of the app.');
  const key = await importSecret(secret);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(envelope.iv) },
      key,
      fromBase64Url(envelope.data),
    );
  } catch {
    throw new WrongPassphrase();
  }
  const bytes = bytesOf(plain);
  const out = envelope.gz ? await gunzip(bytes) : bytes;
  return new TextDecoder().decode(out);
}

/** Thrown when the ciphertext will not authenticate under this key. */
export class WrongPassphrase extends Error {
  constructor() {
    super('That passphrase does not match the data already stored.');
    this.name = 'WrongPassphrase';
  }
}

function importSecret(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromBase64Url(secret), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// ------------------------------------------------------------------ compression

/**
 * Byte arrays backed by a plain ArrayBuffer.
 *
 * WebCrypto will not accept a view that might sit on a SharedArrayBuffer, and
 * the type system cannot tell the difference, so every buffer this module
 * hands to it is created here where the backing store is known.
 */
type Bytes = Uint8Array<ArrayBuffer>;

function bytesOf(source: ArrayBuffer | Uint8Array): Bytes {
  if (source instanceof ArrayBuffer) return new Uint8Array(source) as Bytes;
  const out = new Uint8Array(new ArrayBuffer(source.length)) as Bytes;
  out.set(source);
  return out;
}

/** Null when the browser has no CompressionStream; the caller sends plain bytes. */
async function gzip(bytes: Bytes): Promise<Bytes | null> {
  const CS = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream;
  if (!CS) return null;
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CS('gzip'));
    return bytesOf(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function gunzip(bytes: Bytes): Promise<Bytes> {
  const DS = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream;
  if (!DS) throw new Error('This browser cannot read compressed sync data.');
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DS('gzip'));
  return bytesOf(await new Response(stream).arrayBuffer());
}

// ---------------------------------------------------------------------- base64url

export function toBase64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] as number);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Bytes {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(bin.length)) as Bytes;
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
