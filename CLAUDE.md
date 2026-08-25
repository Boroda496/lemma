# Lemma — agent notes

Verified mathematics practice. Vite + React PWA, local-first, no server.

## Invariants

- **No language model in the maths path.** Problems, grading, hints and
  explanations are all deterministic engine output. Do not add an LLM call to
  any of it.
- **No floating point in an answer path.** Exact rationals over BigInt, or
  arbitrary-precision floats. `number` appears only in plotting and in layout.
- **Every step is verified before it exists.** `step()` in `engine/derive.ts`
  throws if `from` and `to` differ. If a solver produces a step the oracle
  rejects, the solver is wrong — do not reach for `applyUnverified` to silence
  it unless the move genuinely narrows the statement, and then say why.
- **Every problem is verified before it is shown.** `verifyProblem` runs on
  everything `generateProblem` produces. A failing draw is discarded.
- **Constructors in `expr.ts` never simplify.** Step-by-step teaching depends
  on holding `2x + 3x` as distinct from `5x`.
- Seeded randomness only, via `engine/random.ts`. `Math.random` is never called
  in engine or curriculum code.
- Problem ids encode skill, seed *and* difficulty. All three are needed to
  regenerate a problem.

## Map

| Path | What |
|---|---|
| `src/engine/` | The CAS. Pure, no DOM, no dependencies. |
| `src/engine/equivalence.ts` | The oracle. Everything the app claims goes through here. |
| `src/engine/derive.ts` | Verified steps, derivations, the hint ladder. |
| `src/curriculum/skills.ts` | The 68-skill prerequisite graph. |
| `src/curriculum/generators/` | Problem generators, one file per strand. |
| `src/curriculum/registry.ts` | skill → generators, and the verified generation pipeline. |
| `src/mastery/` | Elo rating, spaced retention, the scheduler. |
| `src/store/db.ts` | IndexedDB. `planMerge` is the rule for combining two devices. |
| `src/sync/` | Optional sync: PBKDF2 key derivation, AES-GCM, pull/merge/push. |
| `worker/src/index.ts` | The whole sync server. Stores ciphertext; contains no app logic. |
| `src/ui/` | React. One responsive layout, no device sniffing. |

`docs/sync.md` has the merge rules, the conflict handling, and the honest
limits of the passphrase-as-account design.

`docs/engine.md` has the reasoning behind the load-bearing engine decisions,
including several that were bugs first.

## Adding a skill

1. Add it to `ALL_SKILLS` in `curriculum/skills.ts` with real prerequisites and
   a rating above all of them. `validateGraph()` is asserted empty by the tests.
2. Write a generator that builds the problem, solves it with the engine, and
   takes the answer from the derivation's own result. Never state an answer
   computed separately — that is how an answer key drifts from its generator.
3. Register it in `curriculum/registry.ts`.
4. The curriculum test generates ten problems across the difficulty range and
   verifies every one. It will fail if the generator is unsound.

Return `null` from a generator when its draw is degenerate. That is normal, and
the caller redraws.

## Commands

```
npm run dev        vite, host-exposed for phone testing on the LAN
npm test           341 tests, including property-based and simulation ones
npm run typecheck
npm run build      production PWA
node scripts/make-icons.mjs   regenerate the launcher icons
```

## Coverage

All 68 skills have generators, arithmetic through definite integrals. 816
generated problems verify clean.

The differentiator is worth knowing about: `deriv` nodes evaluate numerically
by five-point finite difference at 300-bit precision, so the oracle checks
every symbolic differentiation step against a method sharing none of its code.
A wrong rule throws at generation time.
