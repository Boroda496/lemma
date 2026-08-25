# Lemma

Mathematics practice where the maths is actually verified.

Algebra and geometry through to calculus, one problem at a time, on a phone,
a tablet, or a desktop. Every answer is graded by a computer algebra engine
built for this app, every worked solution is a chain of individually
machine-checked steps, and every hint is a prefix of that chain — so a hint
cannot be wrong, because there is nothing in it that was written rather than
derived.

## The claim, and what backs it

"Rigorously verified" is the whole point, so here is exactly what it means.

**No language model touches the maths.** Not in generating problems, not in
grading, not in producing hints or explanations. The engine is deterministic
and works offline.

**Nothing is computed in floating point.** Numbers are exact rationals over
BigInt, so `0.1 + 0.2` is exactly `0.3` and `(1/3) × 3` is exactly `1`.

**Grading uses four methods, strongest first.** Two expressions are equal if
they are the same tree; failing that, if both evaluate to the same exact
rational; failing that, if their difference is exactly zero at twelve random
points in exact arithmetic (the Schwartz–Zippel test, which for the degrees
here puts a false positive below 1e-100); failing that, if they agree to 30
significant digits at twelve random points in 168-bit arithmetic. Each verdict
reports which method decided it, and the app will show you.

**Every step of every solution is checked before it exists.** Building a step
verifies that the line before and the line after denote the same thing — or,
for an equation, have the same solutions. A rule with a bug throws during
generation and fails the build. It cannot reach you as a plausible-looking
wrong step.

**Steps that change the statement say so.** Dividing `A = lw` by `l` to get
`w = A/l` is not an equivalence: the two disagree when `l` is zero. Rather
than assert something false, those steps are marked as narrowing the statement
and the assumption is written out.

**Every problem is verified before it is shown.** The generator's derivation
must validate step by step and its stated answer must agree with where that
derivation ended. A problem that fails is discarded and another seed is tried.

The test suite runs the engine against itself on randomised input: hundreds of
equations solved and substituted back into the original, expansions and
factorisations checked for value preservation, simulated learners run over
120 days.

## Using it

```
npm install
npm run dev      # http://localhost:5173
npm test         # 341 tests
npm run build    # production PWA
```

It is a PWA. On Android, open it in Chrome and use "Add to home screen"; it
then runs offline and full-screen like an installed app. The same URL is the
desktop and tablet app.

## What is in it

- **Practise** — the scheduler picks what to work on and how hard, aiming at
  about an 80% success rate. Hints ladder from a nudge to the full solution.
- **Map** — 68 skills across seven strands, with prerequisites, from signed
  numbers to definite integrals. All 68 have problems.
- **Scratchpad** — type any expression and see it simplified, expanded,
  factored, solved, and graphed, with the working.
- **History** — every problem answered, newest first, rebuilt from its id and
  reopenable. Filter to the ones you missed or needed help with.
- **Progress** — what is durable, what is due, how the last stretch went.

## Where your history lives

On the device, in the browser, per address. By default nothing is uploaded and
there is no account.

That matters more than it sounds: a browser keeps separate storage
for every origin, so `localhost:5173` and the deployed URL have **completely
separate histories**. The app names which copy you are looking at rather than
letting you find out the hard way, and Progress → *Copy transfer* / *Paste
transfer* moves everything from one to the other in two clicks.

Two things protect the data:

- **Durable storage** is requested on every load. Until it is granted, a
  browser may evict the database under storage pressure without warning.
  Installing the app grants it automatically, which is the main reason to
  install rather than use a tab.
- **A second copy** is written to localStorage every few problems. The two
  fail independently, so if the database is ever cleared the app restores
  itself on the next load and says so.

`./scripts/install-desktop.sh` adds it to the applications menu as its own
window.

## Sync across devices

Optional, off until you turn it on. Type the same passphrase on your phone,
tablet and desktop under Progress → *Sync across devices* and they share one
history: answer problems on any of them, in any order, offline included, and
progress merges both ways.

Merging is a union — attempts are matched on when they happened and which
problem they were, and per-skill progress keeps whichever record has more
attempts behind it — so no ordering of syncs can lose an answer. The other
side of that coin is that there is no deletion: clearing progress on one
device and syncing pulls it back from the others.

Your history is encrypted with the passphrase before it leaves the device.
The service that stores it holds ciphertext and cannot read it, and nobody can
reset a forgotten passphrase, because nothing capable of reversing it exists.

The server is [`worker/`](worker/) — about 130 lines on Cloudflare Workers and
KV, storing one opaque blob. Three devices produce a few dozen requests a day
against a free-tier limit of 100,000. See [`docs/sync.md`](docs/sync.md).

## Layout

```
src/engine/      the computer algebra system — no DOM, no dependencies
src/curriculum/  skills, problem generators, grading
src/mastery/     ratings, spaced repetition, the scheduler
src/store/       IndexedDB
src/sync/        optional cross-device sync: key derivation, encryption, merge
src/ui/          React
worker/          the sync server — one file, no app logic in it
tests/           371 tests, including property-based ones
docs/            deeper notes on each subsystem
```

`docs/engine.md` covers the parts of the engine that are load-bearing for the
correctness claim. `docs/sync.md` covers how devices merge and what the
passphrase does.
