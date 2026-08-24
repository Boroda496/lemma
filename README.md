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
npm test         # 281 tests
npm run build    # production PWA
```

It is a PWA. On Android, open it in Chrome and use "Add to home screen"; it
then runs offline and full-screen like an installed app. The same URL is the
desktop and tablet app.

## What is in it

- **Practise** — the scheduler picks what to work on and how hard, aiming at
  about an 80% success rate. Hints ladder from a nudge to the full solution.
- **Map** — 68 skills across seven strands, with prerequisites. 34 have
  problems today; the rest are shown as "Soon" rather than silently missing.
- **Scratchpad** — type any expression and see it simplified, expanded,
  factored, solved, and graphed, with the working.
- **Progress** — what is durable, what is due, how the last stretch went.

Everything is stored on the device. Nothing is uploaded, and there is no
account. Export a backup to move to another machine.

## Layout

```
src/engine/      the computer algebra system — no DOM, no dependencies
src/curriculum/  skills, problem generators, grading
src/mastery/     ratings, spaced repetition, the scheduler
src/store/       IndexedDB
src/ui/          React
tests/           281 tests, including property-based ones
docs/            deeper notes on each subsystem
```

`docs/engine.md` covers the parts of the engine that are load-bearing for the
correctness claim.
