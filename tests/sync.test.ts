/**
 * Sync, tested where it can actually go wrong.
 *
 * Three separate things have to hold, and none of them is obvious by reading
 * the code: the passphrase must be the only way to read the data, merging
 * must never lose an attempt however the syncs are ordered, and two devices
 * writing at once must not let one silently overwrite the other.
 */

import { describe, it, expect } from 'vitest';
import { deriveKeys, seal, open, WrongPassphrase, toBase64Url, fromBase64Url } from './../src/sync/crypto.ts';
import { planMerge, type Backup } from './../src/store/db.ts';
import type { SkillState, Attempt } from './../src/mastery/model.ts';
import worker, { type Env, type Metadata } from './../worker/src/index.ts';

// ------------------------------------------------------------------- crypto

describe('key derivation', () => {
  it('is deterministic, so a second device reaches the same data', async () => {
    const a = await deriveKeys('correct horse battery staple');
    const b = await deriveKeys('correct horse battery staple');
    expect(b).toEqual(a);
  });

  it('gives the server an address that reveals nothing about the key', async () => {
    const { access, secret } = await deriveKeys('correct horse battery staple');
    expect(access).not.toEqual(secret);
    expect(access).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('ignores surrounding whitespace, which phone keyboards add', async () => {
    expect(await deriveKeys('  a good passphrase ')).toEqual(await deriveKeys('a good passphrase'));
  });

  it('separates passphrases that differ by one character', async () => {
    const a = await deriveKeys('a good passphrase');
    const b = await deriveKeys('a good passphrasf');
    expect(a.access).not.toEqual(b.access);
  });

  it('refuses a passphrase too short to be worth encrypting with', async () => {
    await expect(deriveKeys('short')).rejects.toThrow();
  });
});

describe('sealing', () => {
  it('round-trips a payload', async () => {
    const { secret } = await deriveKeys('a good passphrase');
    const payload = JSON.stringify({ hello: 'world', n: 42 });
    expect(await open(secret, await seal(secret, payload))).toBe(payload);
  });

  it('round-trips a realistic history, unicode and all', async () => {
    const { secret } = await deriveKeys('a good passphrase');
    const payload = JSON.stringify({
      skillStates: Array.from({ length: 68 }, (_, i) => ({ skillId: `skill-${i}`, rating: 400 + i })),
      note: 'π ≈ 3.14159, √2, ∫ x dx — “quoted”',
    });
    expect(await open(secret, await seal(secret, payload))).toBe(payload);
  });

  it('produces a different ciphertext each time, so repeats are not detectable', async () => {
    const { secret } = await deriveKeys('a good passphrase');
    const one = await seal(secret, 'same');
    const two = await seal(secret, 'same');
    expect(one.data).not.toEqual(two.data);
    expect(one.iv).not.toEqual(two.iv);
  });

  it('fails loudly under the wrong passphrase rather than returning rubbish', async () => {
    const right = await deriveKeys('a good passphrase');
    const wrong = await deriveKeys('another passphrase');
    const envelope = await seal(right.secret, 'private');
    await expect(open(wrong.secret, envelope)).rejects.toBeInstanceOf(WrongPassphrase);
  });

  it('rejects a tampered payload', async () => {
    const { secret } = await deriveKeys('a good passphrase');
    const envelope = await seal(secret, 'private');
    const flipped = { ...envelope, data: envelope.data.slice(0, -1) + (envelope.data.endsWith('A') ? 'B' : 'A') };
    await expect(open(secret, flipped)).rejects.toThrow();
  });

  it('shrinks a repetitive history rather than sending it whole', async () => {
    const { secret } = await deriveKeys('a good passphrase');
    const payload = JSON.stringify(Array.from({ length: 400 }, (_, i) => ({
      skillId: 'algebra-linear-equations', problemId: `algebra-linear-equations:${i}:3`, correct: true,
    })));
    const envelope = await seal(secret, payload);
    expect(envelope.gz).toBe(true);
    expect(envelope.data.length).toBeLessThan(payload.length / 2);
  });
});

describe('base64url', () => {
  it('round-trips every byte value', () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    expect(Array.from(fromBase64Url(toBase64Url(bytes)))).toEqual(Array.from(bytes));
  });

  it('stays url-safe', () => {
    const bytes = new Uint8Array([251, 255, 190, 239, 0, 1, 2]);
    expect(toBase64Url(bytes)).not.toMatch(/[+/=]/);
  });
});

// -------------------------------------------------------------------- merging

const state = (skillId: string, attempts: number): SkillState => ({
  skillId, rating: 400 + attempts, confidence: 0.5, attempts, correct: attempts,
  streak: 0, stability: 1, difficulty: 5, lastSeen: attempts, dueAt: null, introduced: true,
});

const attempt = (at: number, problemId = `p${at}`): Attempt => ({
  skillId: 'algebra-linear-equations', problemId, correct: true,
  hintLevel: -1, wrongTries: 0, seconds: 10, at, problemRating: 400,
});

const backup = (skillStates: SkillState[], attempts: Attempt[]): Backup => ({
  version: 1, exportedAt: new Date().toISOString(), skillStates, attempts,
  settings: { sessionLength: 10, showApproximations: true, reducedMotion: false, theme: 'system', seenIntro: true },
});

describe('merging two devices', () => {
  it('takes attempts the device has not seen', () => {
    const plan = planMerge({}, [attempt(1)], backup([], [attempt(1), attempt(2)]));
    expect(plan.attempts.map((a) => a.at)).toEqual([2]);
  });

  it('is idempotent: syncing twice adds nothing the second time', () => {
    const incoming = backup([state('s', 3)], [attempt(1), attempt(2)]);
    const first = planMerge({}, [], incoming);
    const after = Object.fromEntries(first.skillStates.map((s) => [s.skillId, s]));
    const second = planMerge(after, first.attempts, incoming);
    expect(second.attempts).toEqual([]);
    expect(second.skillStates).toEqual([]);
  });

  it('never overwrites a further-along skill with a stale one', () => {
    const plan = planMerge({ s: state('s', 20) }, [], backup([state('s', 5)], []));
    expect(plan.skillStates).toEqual([]);
  });

  it('accepts a skill the other device has taken further', () => {
    const plan = planMerge({ s: state('s', 5) }, [], backup([state('s', 20)], []));
    expect(plan.skillStates.map((s) => s.attempts)).toEqual([20]);
  });

  it('does not double-count an attempt repeated inside one backup', () => {
    const plan = planMerge({}, [], backup([], [attempt(7), attempt(7)]));
    expect(plan.attempts).toHaveLength(1);
  });

  it('separates attempts made at the same moment on different problems', () => {
    const plan = planMerge({}, [attempt(9, 'a')], backup([], [attempt(9, 'b')]));
    expect(plan.attempts.map((a) => a.problemId)).toEqual(['b']);
  });

  it('reaches the same history whichever device syncs first', () => {
    const phone = [attempt(1), attempt(2)];
    const desktop = [attempt(3), attempt(4)];

    const phoneFirst = [
      ...phone,
      ...planMerge({}, phone, backup([], desktop)).attempts,
    ].map((a) => a.at).sort();
    const desktopFirst = [
      ...desktop,
      ...planMerge({}, desktop, backup([], phone)).attempts,
    ].map((a) => a.at).sort();

    expect(phoneFirst).toEqual(desktopFirst);
    expect(phoneFirst).toEqual([1, 2, 3, 4]);
  });
});

// --------------------------------------------------------------------- worker

function fakeStore(): Env {
  const data = new Map<string, { value: string; metadata: Metadata | null }>();
  return {
    LEMMA: {
      async getWithMetadata(key: string) {
        const hit = data.get(key);
        return hit ? { value: hit.value, metadata: hit.metadata } : { value: null, metadata: null };
      },
      async put(key: string, value: string, options?: { metadata?: Metadata }) {
        data.set(key, { value, metadata: options?.metadata ?? null });
      },
      async delete(key: string) { data.delete(key); },
    },
  };
}

const KEY = 'A'.repeat(43);
const body = JSON.stringify({ v: 1, iv: 'aaaa', gz: false, data: 'payload' });
const url = (key = KEY) => `https://sync.test/v1/${key}`;

const put = (env: Env, value = body, headers: Record<string, string> = {}) =>
  worker.fetch(new Request(url(), { method: 'PUT', body: value, headers }), env);

describe('the sync service', () => {
  it('says nothing is there before anything is stored', async () => {
    expect((await worker.fetch(new Request(url()), fakeStore())).status).toBe(404);
  });

  it('gives back exactly what was stored', async () => {
    const env = fakeStore();
    await put(env);
    const res = await worker.fetch(new Request(url()), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
  });

  it('refuses a key that is not one of ours', async () => {
    expect((await worker.fetch(new Request(url('short')), fakeStore())).status).toBe(400);
    expect((await worker.fetch(new Request(url('../etc/passwd')), fakeStore())).status).toBe(404);
  });

  it('refuses a body it could not hand back intact', async () => {
    const env = fakeStore();
    expect((await put(env, 'not json at all')).status).toBe(400);
    expect((await put(env, JSON.stringify({ v: 2, data: 'x' }))).status).toBe(400);
    expect((await put(env, JSON.stringify({ v: 1 }))).status).toBe(400);
  });

  it('counts revisions so a device can tell whether it is current', async () => {
    const env = fakeStore();
    expect((await put(env)).headers.get('etag')).toBe('"1"');
    expect((await put(env)).headers.get('etag')).toBe('"2"');
    expect((await worker.fetch(new Request(url()), env)).headers.get('etag')).toBe('"2"');
  });

  it('stops one device overwriting another that wrote in between', async () => {
    const env = fakeStore();
    await put(env);                       // both devices now hold rev 1
    const second = await put(env, body, { 'if-match': '"1"' });
    expect(second.status).toBe(200);      // the first to write wins
    const late = await put(env, body, { 'if-match': '"1"' });
    expect(late.status).toBe(412);        // the second is told to merge again
  });

  it('lets a first write through without a revision to match', async () => {
    expect((await put(fakeStore(), body, { 'if-match': '*' })).status).toBe(200);
  });

  it('forgets a copy on request', async () => {
    const env = fakeStore();
    await put(env);
    await worker.fetch(new Request(url(), { method: 'DELETE' }), env);
    expect((await worker.fetch(new Request(url()), env)).status).toBe(404);
  });

  it('answers the preflight every browser sends first', async () => {
    const res = await worker.fetch(new Request(url(), { method: 'OPTIONS' }), fakeStore());
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('tells a person who opens the address what it is', async () => {
    const res = await worker.fetch(new Request('https://sync.test/'), fakeStore());
    expect(await res.json()).toMatchObject({ service: 'lemma-sync' });
  });
});
