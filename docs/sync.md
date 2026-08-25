# Sync

Three devices, one history, no export step. This describes how that works and
what it costs.

## The shape of it

The device is still the source of truth. Everything the app does — practising,
grading, scheduling — reads and writes IndexedDB exactly as it did before sync
existed, and works with the network switched off. Sync is a background errand
that runs beside it:

1. **Pull** the shared copy from the server.
2. **Merge** it into the local database.
3. **Push** the result back.

Because step 2 leaves the local database holding both sides, what gets pushed
in step 3 is the merge. There is no second merge and no server-side logic; the
server never sees anything but ciphertext.

Sync runs on launch, when the app returns to the foreground, when the network
comes back, and six seconds after the last answer of a burst. A ten-problem
session is one upload, not ten.

## Merging

`planMerge` in [`src/store/db.ts`](../src/store/db.ts) decides what a merge
changes. Two rules:

- **Attempts** are identified by `(at, problemId)`. Anything not already
  present is added. Importing the same backup twice adds nothing the second
  time.
- **Skill states** are running summaries, not logs, so they cannot be merged
  field by field — the two sides are alternative histories of the same skill.
  Whichever has more attempts behind it wins outright.

The consequence worth stating plainly: **the union can only gain.** No ordering
of syncs across any number of devices loses an answer, which is why two devices
used in the same hour end up with the sum of both rather than one clobbering
the other.

The price of that is **there is no deletion.** Clearing progress on one device
and then syncing pulls it all back from the others. "Reset everything" is
therefore a local operation, and wiping genuinely everywhere means unlinking
first — which is what the UI offers, in that order.

## Conflicts

Cloudflare KV has no transactions, so the worker keeps a revision counter in
each value's metadata and exposes it as an ETag. A client sends the revision it
merged against in `If-Match`; a write against a stale revision gets `412`, and
the client pulls, merges again, and retries (up to three times).

Without this, two devices syncing in the same second would have one overwrite
the other's merge. With it, the loser folds its work into the winner's copy.

## The passphrase is the account

There are no accounts. [`src/sync/crypto.ts`](../src/sync/crypto.ts) derives two
keys from the passphrase by PBKDF2-SHA256, 300,000 iterations, using two
different salts:

- **access** — the URL the blob lives at. Sent to the server.
- **secret** — the AES-GCM key. Never sent anywhere.

Different salts mean the server can route a request without being able to read
what it stores. The passphrase itself is dropped after derivation; only the
derived keys are kept in `localStorage`, so the passphrase is not sitting in
browser storage to be read back and tried elsewhere.

A wrong passphrase fails in AES-GCM's authentication tag rather than producing
plausible rubbish, which is what lets the app distinguish "wrong passphrase"
from "network is down".

**The honest trade:** a weak passphrase is a weak system, because guessing it is
the whole attack. And nobody can reset it — nothing capable of reversing the
derivation exists. A forgotten passphrase means the stored copy is permanently
unreadable and you restart from whatever is on your devices. The UI says this
before you commit.

## The server

[`worker/src/index.ts`](../worker/src/index.ts), about 130 lines, is the entire
server. It stores one opaque blob per key and hands it back. `GET`, `PUT`,
`DELETE` on `/v1/<43-char base64url key>`.

It validates the key shape, caps bodies at 4 MB, and refuses anything that is
not a recognised envelope — a truncated upload that still parsed would
otherwise overwrite good history with a broken copy.

It defines the four KV methods it uses rather than importing
`@cloudflare/workers-types`, so the app's own test suite can import it and drive
it against a fake store. See `tests/sync.test.ts`.

CORS is open to any origin. The blob is encrypted and the key is the secret, so
the origin is not what protects it; allowing any origin keeps dev servers on
arbitrary ports working without a list to maintain.

## Cost

Cloudflare's free tier is 100,000 worker requests and 1,000 KV writes per day.
Three devices belonging to one person, used normally, produce a few dozen
requests a day. The compressed payload for a full history is single-digit
kilobytes against a 25 MB value limit.

Nothing about this design approaches a paid tier, and there is no card on the
account to charge if it did.

## Deploying

```sh
cd worker
npx wrangler login                      # once, browser OAuth
npx wrangler kv namespace create LEMMA  # prints an id for wrangler.toml
npx wrangler deploy
```

Then put the deployed URL in `DEFAULT_ENDPOINT` in
[`src/sync/endpoint.ts`](../src/sync/endpoint.ts) so linking a device is a
passphrase and nothing else, and rebuild the app.
