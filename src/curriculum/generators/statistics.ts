/**
 * Statistics and probability generators.
 *
 * Data sets are built so the answer is exact: means come out rational rather
 * than as a decimal that has to be rounded, and probabilities stay as
 * fractions. Rounding would put an approximation into the answer path, which
 * is the one thing this engine does not do.
 */

import { Rng } from './../../engine/random.ts';
import type { Expr } from './../../engine/expr.ts';
import { add, mul, num, int, frac, div as divE, sub as subE, fn as mkFn, tuple, set } from './../../engine/expr.ts';
import * as R from './../../engine/rational.ts';
import { simplify } from './../../engine/canon.ts';
import { DerivationBuilder, R_FORMULA, R_ARITHMETIC, R_SIMPLIFY } from './../../engine/derive.ts';
import type { Generator } from './../types.ts';

const scale = (d: number, lo: number, hi: number): number => Math.round(lo + (hi - lo) * d);

export const genCentreAndSpread: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const n = r.int(5, d > 0.5 ? 8 : 6);
  const data: number[] = [];
  for (let i = 0; i < n; i++) data.push(r.int(1, scale(d, 20, 60)));
  const want = r.pick(d > 0.4 ? (['mean', 'median', 'range', 'mode'] as const) : (['mean', 'median'] as const));

  const sorted = [...data].sort((a, b) => a - b);

  if (want === 'mode') {
    // A mode only exists if a value repeats; force one.
    const dup = r.pick(data);
    data[r.int(0, data.length - 1)] = dup;
    const counts = new Map<number, number>();
    for (const v of data) counts.set(v, (counts.get(v) ?? 0) + 1);
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (!best[0] || best[0][1] < 2) return null;
    if (best[1] && best[1][1] === best[0][1]) return null;   // ambiguous
    const b = new DerivationBuilder('Find the mode', set(...data.map((v) => int(v))));
    b.applyUnverified(R_FORMULA, int(best[0][0]),
      'Reading a statistic off a data set produces a number, not a restatement of the set.',
      `${best[0][0]} appears ${best[0][1]} times, more than any other value.`,
      'Which value shows up most often?');
    return {
      prompt: `Find the mode of: ${data.join(', ')}`,
      statement: set(...data.map((v) => int(v))),
      answer: { kind: 'number' as const, value: int(best[0][0]) },
      derivation: b.build(),
    };
  }

  const statement = set(...data.map((v) => int(v)));
  let value: Expr;
  let detail: string;
  let goal: string;

  if (want === 'mean') {
    const total = data.reduce((a, b) => a + b, 0);
    value = num(R.rat(total, n));
    detail = `Add them: ${data.join(' + ')} = ${total}. Then divide by ${n}.`;
    goal = 'Find the mean';
  } else if (want === 'median') {
    const mid = n % 2 === 1
      ? R.rat(sorted[(n - 1) / 2]!)
      : R.div(R.add(R.rat(sorted[n / 2 - 1]!), R.rat(sorted[n / 2]!)), R.rat(2));
    value = num(mid);
    detail = n % 2 === 1
      ? `In order: ${sorted.join(', ')}. With ${n} values the middle one is the ${(n + 1) / 2}th.`
      : `In order: ${sorted.join(', ')}. With ${n} values there is no single middle, so average the two middle ones.`;
    goal = 'Find the median';
  } else {
    value = int(sorted[n - 1]! - sorted[0]!);
    detail = `The largest is ${sorted[n - 1]} and the smallest is ${sorted[0]}.`;
    goal = 'Find the range';
  }

  const b = new DerivationBuilder(goal, statement);
  b.applyUnverified(R_FORMULA, value,
    'Reading a statistic off a data set produces a number, not a restatement of the set.',
    detail,
    want === 'mean' ? 'Total them up first.' : want === 'median' ? 'Put them in order first.' : 'Look at the two extremes.');

  return {
    prompt: `${goal} of: ${data.join(', ')}`,
    statement,
    answer: { kind: 'number' as const, value },
    derivation: b.build(),
    ...(want === 'median' ? {
      distractors: [{
        value: num(R.rat(data.reduce((a, c) => a + c, 0), n)),
        diagnosis: 'That is the mean. The median is the middle value once they are in order, which is a different thing when the data is lopsided.',
        reviewSkill: 'mean-median-mode',
      }],
    } : {}),
  };
};

export const genProbability: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const kind = r.pick(d > 0.45 ? (['single', 'complement', 'independent'] as const) : (['single', 'complement'] as const));

  const red = r.int(2, scale(d, 6, 12));
  const blue = r.int(2, scale(d, 6, 12));
  const green = d > 0.5 ? r.int(1, 5) : 0;
  const total = red + blue + green;
  const bag = green > 0
    ? `${red} red, ${blue} blue and ${green} green counters`
    : `${red} red and ${blue} blue counters`;

  if (kind === 'independent') {
    const p = R.mul(R.rat(red, total), R.rat(red - 1, total - 1));
    const statement = mul(frac(red, total), frac(red - 1, total - 1));
    const b = new DerivationBuilder('Find the probability', statement);
    b.apply(R_ARITHMETIC, num(p),
      `The first draw is ${red}/${total}. After removing one red there are ${red - 1} reds ` +
      `left out of ${total - 1}, so the second is ${red - 1}/${total - 1}. Multiply them.`,
      'What changes between the first draw and the second?');
    return {
      prompt: 'Give your answer as a fraction in lowest terms',
      context: `A bag holds ${bag}. Two are drawn without replacement.`,
      statement,
      answer: { kind: 'number' as const, value: num(p) },
      derivation: b.build(),
      distractors: [{
        value: num(R.mul(R.rat(red, total), R.rat(red, total))),
        diagnosis: 'The second draw was treated as if the first counter had been put back. Without replacement, both the count of reds and the total drop by one.',
        reviewSkill: 'probability-basics',
      }],
    };
  }

  const favourable = kind === 'single' ? red : total - red;
  const p = R.rat(favourable, total);
  const statement = frac(favourable, total);
  const b = new DerivationBuilder('Find the probability', statement);
  b.apply(R_SIMPLIFY, num(p),
    kind === 'single'
      ? `${red} of the ${total} counters are red, and the fraction reduces to ${R.toString(p)}.`
      : `Not red means the other ${favourable} of the ${total}, which reduces to ${R.toString(p)}.`,
    'How many outcomes do you want, out of how many altogether?');

  return {
    prompt: `What is the probability of drawing ${kind === 'single' ? 'a red' : 'a counter that is not red'}? Give a fraction in lowest terms.`,
    context: `A bag holds ${bag}.`,
    statement,
    answer: { kind: 'number' as const, value: num(p) },
    derivation: b.build(),
    ...(kind === 'complement' ? {
      distractors: [{
        value: num(R.rat(red, total)),
        diagnosis: 'That is the probability of drawing a red. The question asks for everything else, which is 1 minus that.',
        reviewSkill: 'probability-basics',
      }],
    } : {}),
  };
};

export const genCounting: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const kind = r.pick(d > 0.4 ? (['combination', 'permutation', 'product'] as const) : (['product', 'combination'] as const));

  if (kind === 'product') {
    const a = r.int(2, scale(d, 5, 9));
    const b2 = r.int(2, scale(d, 5, 9));
    const c = d > 0.5 ? r.int(2, 5) : 1;
    const statement = c > 1 ? mul(int(a), int(b2), int(c)) : mul(int(a), int(b2));
    const value = a * b2 * c;
    const b = new DerivationBuilder('Count the possibilities', statement);
    b.apply(R_ARITHMETIC, int(value),
      `Each independent choice multiplies the count: ${a} × ${b2}${c > 1 ? ` × ${c}` : ''} = ${value}.`,
      'Choices made independently multiply.');
    return {
      prompt: 'How many different outfits are possible?',
      context: c > 1
        ? `There are ${a} shirts, ${b2} pairs of trousers and ${c} pairs of shoes.`
        : `There are ${a} shirts and ${b2} pairs of trousers.`,
      statement,
      answer: { kind: 'number' as const, value: int(value) },
      derivation: b.build(),
      distractors: [{
        value: int(a + b2 * c),
        diagnosis: 'The choices were added. Independent choices multiply: each shirt can go with every pair of trousers.',
        reviewSkill: 'counting',
      }],
    };
  }

  const n = r.int(4, scale(d, 7, 10));
  const k = r.int(2, Math.min(4, n - 1));

  if (kind === 'combination') {
    const statement = mkFn('binom', int(n), int(k));
    const value = simplify(statement);
    if (value.k !== 'num') return null;
    const b = new DerivationBuilder('Count the selections', statement);
    b.apply(R_ARITHMETIC, value,
      `Choose ${k} from ${n} without caring about order: ${n}!/(${k}!·${n - k}!) = ${R.toString(value.v)}.`,
      'Does the order they are picked in matter?');
    return {
      prompt: `How many ways can a team of ${k} be chosen from ${n} people?`,
      statement,
      answer: { kind: 'number' as const, value },
      derivation: b.build(),
      distractors: [{
        value: int(permutations(n, k)),
        diagnosis: `That counts the orderings too. A team of ${k} is the same team whichever order they were picked in, so divide by the ${k}! orderings.`,
        reviewSkill: 'counting',
      }],
    };
  }

  const value = permutations(n, k);
  const statement = divE(mkFn('factorial', int(n)), mkFn('factorial', int(n - k)));
  const b = new DerivationBuilder('Count the arrangements', statement);
  b.apply(R_ARITHMETIC, int(value),
    `Order matters, so there are ${n} choices for the first place, ${n - 1} for the second, ` +
    `and so on for ${k} places: ${value}.`,
    'Does it matter who comes first?');
  return {
    prompt: `In how many ways can ${k} of ${n} runners finish in the first ${k} places?`,
    statement,
    answer: { kind: 'number' as const, value: int(value) },
    derivation: b.build(),
  };
};

function permutations(n: number, k: number): number {
  let acc = 1;
  for (let i = 0; i < k; i++) acc *= n - i;
  return acc;
}
