# The engine

Notes on the parts that carry the correctness claim, and on the decisions that
are easy to get wrong.

## Layers

```
rational.ts    exact rationals over BigInt
bigfloat.ts    arbitrary-precision binary floats, with real elementary functions
complex.ts     pairs of bigfloats, for probing off the real line
expr.ts        the AST
evaluate.ts    exact and numeric evaluation
equivalence.ts THE ORACLE — everything the app claims routes through here
polynomial.ts  expansion, gcd, squarefree decomposition, factoring over Q
canon.ts       simplification and presentation form
parse.ts       one parser for plain text and LaTeX
print.ts       LaTeX and plain text
derive.ts      verified steps, derivations, hints
solve/         step-by-step solvers
```

## Constructors do not simplify

`add(num(2), num(3))` stays `2 + 3`. This is deliberate and load-bearing: the
moment constructors fold, "combine like terms" has nothing to show. Holding an
unsimplified form as a first-class object is what makes step-by-step teaching
possible. Normalisation is opt-in, in `canon.ts`.

The consequence is that structural equality is not mathematical equality, and
never can be. That is what the oracle is for.

## Why arbitrary precision

Algebraic expressions are decided exactly. Transcendental ones have to be
evaluated, and a double gives about 15 digits with no error control — enough
for cancellation to produce a confident wrong answer. The engine evaluates at
about 50 digits and compares at 30, so the slack absorbs accumulated rounding
by an enormous margin while still separating genuinely different values. The
test suite checks it separates numbers differing at 1e-25.

## Real points before complex ones

The prober tries real points first. This is not an optimisation; it is a
correctness decision about what a student means.

`ln(ab) = ln a + ln b` is true for positive reals and false on the complex
plane, where the two sides can differ by 2πi across a branch cut. Grading a
student's log rule as wrong on that technicality would be correct and useless.
Complex probing remains as the fallback for expressions with no real domain —
the roots of a quadratic with negative discriminant, for instance.

## Equations do not compare like expressions

Two things follow from an equation's solution set being what matters.

Comparing two equations means comparing solution sets, so `2x = 6` and `x = 3`
are the same statement, and `x = 3` and `3 = x` likewise.

Measuring a student's *progress* through a derivation cannot use equivalence
at all, and this is subtle enough to have been a real bug. Solving preserves
the solution set, so every line of a correct derivation is equivalent to every
other one — including the untouched problem statement. Asking "is this line
equivalent to step 3" answers yes for a student who has written nothing. So
relations are matched on the shape of the two sides instead, tolerating a swap
(`15 = 3x` is the same line as `3x = 15`) but not a rescaling.

## Factoring

Rational roots come from the rational-root theorem, which is exhaustive over
its candidate list. What remains is split by Kronecker's method.

Yun squarefree decomposition runs first. Without it, a perfect power like
`(2x²+x+3)⁴` reaches Kronecker as a degree-8 polynomial with six-figure
coefficients and takes seconds; with it, a few gcds collapse it.

`polyGcd` returns *monic* results, so the scale accumulated while factoring is
not reliable. The overall constant is recovered by dividing the original by the
product of the factors, which verifies the whole factorization as a side
effect and refuses to return a product that does not multiply back.

When a coefficient grows past the trial-division limit, the search stops and
the result is marked `complete: false`. Reporting an irreducibility that was
never established is exactly the kind of confident wrongness this engine
exists to avoid.

## Steps that are not equivalences

Three kinds of legitimate move change the statement rather than preserving it,
and all three are declared rather than asserted:

- **Substitution.** Replacing `x` with `-2` narrows a claim about every `x` to
  one about a single point.
- **Case splitting.** The zero-product property replaces one equation with the
  separate cases it allows; taking a square root splits one equation into the
  two the ± stands for.
- **Dividing by something that might be zero.** `A = lw` and `w = A/l` disagree
  at `l = 0`.

`applyUnverified` records the reason, which the UI shows next to the step
rather than hiding.

## Printing

The tree stores subtraction as multiplication by −1 and division as a negative
exponent, so the printer's real job is undoing that. Two bugs worth
remembering:

A leading minus can only be hoisted out of a fraction when the *whole*
numerator is negative. For a sum it changes the value: `-(2+√24)/2` is not
`(-2+√24)/2`.

Steps with no visible change must be dropped. Folding `(-1)·9` into `-9`
changes the tree while the printed line stays `- 9`, producing a step that
looks like the app did nothing.
