/**
 * Lemma sync: the entire server.
 *
 * It stores one opaque blob per key and hands it back. It cannot read the
 * blob — the client encrypts before sending — and it has no accounts, no
 * sessions and no database schema. The key in the URL is both the address and
 * the credential: it is derived from the passphrase by PBKDF2 on the device,
 * so knowing it is the only permission there is, and the passphrase itself
 * never leaves the browser.
 *
 * That is a deliberate trade. A weak passphrase is a weak system, because
 * guessing it is the whole attack. In exchange there is nothing to sign into
 * on a new device, nothing to revoke, nothing to leak from here, and the free
 * tier is never in danger: three devices belonging to one person generate a
 * few dozen requests a day against a limit of a hundred thousand.
 */

/**
 * The slice of Cloudflare's KV that this uses, written out rather than pulled
 * from `@cloudflare/workers-types`. Four methods is a small price for a file
 * the app's own test suite can import and drive against a fake store, which
 * is worth more here than the full type surface.
 */
export interface Metadata { rev: number; at: number }

export interface Store {
  getWithMetadata(key: string, type: 'text'): Promise<{ value: string | null; metadata: Metadata | null }>;
  put(key: string, value: string, options?: { metadata?: Metadata }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Env {
  LEMMA: Store;
}

/** 32 bytes, base64url, unpadded. Anything else is not one of our keys. */
const KEY_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** Room for far more history than this app can produce, and no more. */
const MAX_BODY = 4 * 1024 * 1024;

const CORS = {
  // The blob is encrypted and the key is the secret, so the origin is not
  // what protects it. Allowing any origin keeps dev servers on arbitrary
  // ports working without a list to maintain.
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, if-match',
  'access-control-max-age': '86400',
  'access-control-expose-headers': 'etag',
};

/** The number inside an ETag, however the edge has dressed it up. */
function revisionOf(header: string): number {
  const digits = /(\d+)/.exec(header.replace(/^W\//, ''));
  return digits ? Number(digits[1]) : NaN;
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS, ...extra },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    const match = /^\/v1\/([^/]+)$/.exec(url.pathname);

    if (!match) {
      // A human who opens the URL should learn what it is rather than see a 404.
      if (url.pathname === '/') {
        return json({ service: 'lemma-sync', ok: true });
      }
      return json({ error: 'not found' }, 404);
    }

    const key = match[1] ?? '';
    if (!KEY_SHAPE.test(key)) return json({ error: 'bad key' }, 400);

    if (request.method === 'GET') {
      const stored = await env.LEMMA.getWithMetadata(key, 'text');
      if (stored.value === null) return json({ error: 'empty' }, 404);
      return new Response(stored.value, {
        headers: {
          'content-type': 'application/json',
          etag: `"${stored.metadata?.rev ?? 0}"`,
          ...CORS,
        },
      });
    }

    if (request.method === 'PUT') {
      const body = await request.text();
      if (body.length > MAX_BODY) return json({ error: 'too large' }, 413);
      // Store only what we can hand back intact. A truncated upload that still
      // parsed would overwrite good history with a broken copy.
      try {
        const parsed = JSON.parse(body) as { v?: number; data?: string };
        if (parsed.v !== 1 || typeof parsed.data !== 'string') {
          return json({ error: 'unrecognised envelope' }, 400);
        }
      } catch {
        return json({ error: 'not json' }, 400);
      }

      const prev = await env.LEMMA.getWithMetadata(key, 'text');
      const rev = (prev.metadata?.rev ?? 0) + 1;

      // Optimistic concurrency, when the client asks for it. Two devices
      // syncing in the same second would otherwise have one overwrite the
      // other's merge; this makes the loser retry against the winner's copy.
      //
      // The comparison is on the revision itself rather than the header text,
      // because Cloudflare's edge marks responses as weak — a client echoes
      // back `W/"1"` for the `"1"` we set, and a literal comparison would
      // reject every write after the first.
      const expect = request.headers.get('if-match');
      const held = prev.metadata?.rev ?? 0;
      if (expect && expect !== '*' && revisionOf(expect) !== held) {
        return json({ error: 'stale', rev: held }, 412, { etag: `"${held}"` });
      }

      await env.LEMMA.put(key, body, { metadata: { rev, at: Date.now() } });
      return json({ ok: true, rev }, 200, { etag: `"${rev}"` });
    }

    if (request.method === 'DELETE') {
      await env.LEMMA.delete(key);
      return json({ ok: true });
    }

    return json({ error: 'method not allowed' }, 405);
  },
};
