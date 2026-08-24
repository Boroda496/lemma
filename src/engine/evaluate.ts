/**
 * Evaluation, in two flavours.
 *
 * `evalExact` works in exact rationals and returns null the moment a value
 * cannot be represented that way (sqrt(2), sin(1), pi). A non-null result is
 * therefore trustworthy without qualification — it is the true value, not an
 * approximation of it.
 *
 * `evalNumeric` always produces an answer, in complex arbitrary precision. It
 * is what the prober uses when exactness is unavailable.
 *
 * Anything undefined at the requested point (division by zero, log of zero,
 * tan at a pole) throws `UndefinedAtPoint`, which callers treat as "pick a
 * different probe point" rather than as an error in the expression.
 */

import type { Expr } from './expr.ts';
import { symKey } from './expr.ts';
import type { Rat } from './rational.ts';
import * as R from './rational.ts';
import * as B from './bigfloat.ts';
import * as CX from './complex.ts';
import type { C } from './complex.ts';

export class UndefinedAtPoint extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'UndefinedAtPoint';
  }
}

export type ExactEnv = Record<string, Rat>;
export type NumericEnv = Record<string, C>;

// ------------------------------------------------------------------ exact path

/**
 * Exact rational value, or null when the expression is not rational at this
 * point. Returning null is a statement about representability, never about
 * correctness — callers fall back to the numeric path.
 */
export function evalExact(e: Expr, env: ExactEnv = {}): Rat | null {
  switch (e.k) {
    case 'num':
      return e.v;
    case 'const':
      return null; // pi, e, i are irrational or non-real by definition
    case 'sym': {
      const v = env[symKey(e)];
      return v === undefined ? null : v;
    }
    case 'add': {
      let acc = R.ZERO;
      for (const a of e.args) {
        const v = evalExact(a, env);
        if (v === null) return null;
        acc = R.add(acc, v);
      }
      return acc;
    }
    case 'mul': {
      let acc = R.ONE;
      for (const a of e.args) {
        const v = evalExact(a, env);
        if (v === null) return null;
        if (R.isZero(v)) return R.ZERO;
        acc = R.mul(acc, v);
      }
      return acc;
    }
    case 'pow': {
      const b = evalExact(e.base, env);
      const x = evalExact(e.exp, env);
      if (b === null || x === null) return null;
      if (R.isInt(x)) {
        if (R.isZero(b) && R.isNeg(x)) throw new UndefinedAtPoint('zero raised to a negative power');
        if (R.abs(x).n > 4096n) return null; // refuse to build absurd integers
        return R.powInt(b, x.n);
      }
      // Rational exponent: exact only when the root comes out rational.
      const denom = Number(x.d);
      if (denom > 64) return null;
      const root = R.exactRoot(b, denom);
      if (root === null) return null;
      if (R.abs(x).n > 4096n) return null;
      return R.powInt(root, x.n);
    }
    case 'fn':
      return evalExactFn(e.name, e.args, env);
    default:
      return null;
  }
}

function evalExactFn(name: string, args: readonly Expr[], env: ExactEnv): Rat | null {
  const vals: Rat[] = [];
  for (const a of args) {
    const v = evalExact(a, env);
    if (v === null) return null;
    vals.push(v);
  }
  const [a, b] = vals;
  switch (name) {
    case 'sqrt': {
      if (a === undefined) return null;
      if (R.isNeg(a)) return null;
      return R.exactRoot(a, 2);
    }
    case 'root': {
      if (a === undefined || b === undefined || !R.isInt(b)) return null;
      return R.exactRoot(a, Number(b.n));
    }
    case 'abs':
      return a === undefined ? null : R.abs(a);
    case 'sign':
      return a === undefined ? null : R.rat(R.sign(a));
    case 'floor':
      return a === undefined ? null : R.rat(R.floor(a));
    case 'ceil':
      return a === undefined ? null : R.rat(R.ceil(a));
    case 'min':
      return vals.reduce((x, y) => R.min(x, y));
    case 'max':
      return vals.reduce((x, y) => R.max(x, y));
    case 'mod': {
      if (a === undefined || b === undefined || R.isZero(b)) return null;
      return R.sub(a, R.mul(b, R.rat(R.floor(R.div(a, b)))));
    }
    case 'gcd': {
      if (!vals.every(R.isInt)) return null;
      let g = 0n;
      for (const v of vals) {
        let x = g < 0n ? -g : g;
        let y = v.n < 0n ? -v.n : v.n;
        while (y) { const t = x % y; x = y; y = t; }
        g = x;
      }
      return R.rat(g);
    }
    case 'lcm': {
      if (!vals.every(R.isInt)) return null;
      let l = 1n;
      for (const v of vals) {
        const n = v.n < 0n ? -v.n : v.n;
        if (n === 0n) return R.ZERO;
        let x = l, y = n;
        while (y) { const t = x % y; x = y; y = t; }
        l = (l / x) * n;
      }
      return R.rat(l);
    }
    case 'factorial': {
      if (a === undefined || !R.isInt(a) || R.isNeg(a) || a.n > 2000n) return null;
      let acc = 1n;
      for (let i = 2n; i <= a.n; i++) acc *= i;
      return R.rat(acc);
    }
    case 'binom': {
      if (a === undefined || b === undefined || !R.isInt(a) || !R.isInt(b)) return null;
      if (R.isNeg(b) || b.n > a.n || a.n > 5000n) return R.ZERO;
      let acc = 1n;
      const k = b.n > a.n - b.n ? a.n - b.n : b.n;
      for (let i = 0n; i < k; i++) acc = (acc * (a.n - i)) / (i + 1n);
      return R.rat(acc);
    }
    case 'ln':
      return a !== undefined && R.isOne(a) ? R.ZERO : null;
    case 'exp':
      return a !== undefined && R.isZero(a) ? R.ONE : null;
    case 'sin': case 'tan': case 'sinh': case 'tanh': case 'asin': case 'atan': case 'atanh':
      return a !== undefined && R.isZero(a) ? R.ZERO : null;
    case 'cos': case 'cosh':
      return a !== undefined && R.isZero(a) ? R.ONE : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------- numeric path

const PI_HALF_CACHE = new Map<number, B.BF>();
function halfPi(p: number): B.BF {
  const hit = PI_HALF_CACHE.get(p);
  if (hit) return hit;
  const v = B.div(B.pi(p), B.fromInt(2), p);
  PI_HALF_CACHE.set(p, v);
  return v;
}

/** Complex arbitrary-precision value. Throws UndefinedAtPoint at singularities. */
export function evalNumeric(e: Expr, env: NumericEnv = {}, prec: number = B.PREC): C {
  switch (e.k) {
    case 'num':
      return CX.fromRat(e.v, prec);
    case 'const':
      switch (e.name) {
        case 'pi': return CX.real(B.pi(prec));
        case 'e': return CX.real(B.e(prec));
        case 'i': return CX.C_I;
        case 'inf': throw new UndefinedAtPoint('infinity is not a numeric point');
        case 'nan': throw new UndefinedAtPoint('nan');
      }
    // eslint-disable-next-line no-fallthrough
    case 'sym': {
      const v = env[symKey(e)];
      if (v === undefined) throw new UndefinedAtPoint(`unbound symbol ${symKey(e)}`);
      return v;
    }
    case 'add': {
      let acc = CX.C_ZERO;
      for (const a of e.args) acc = CX.add(acc, evalNumeric(a, env, prec), prec);
      return acc;
    }
    case 'mul': {
      let acc = CX.C_ONE;
      for (const a of e.args) acc = CX.mul(acc, evalNumeric(a, env, prec), prec);
      return acc;
    }
    case 'pow': {
      const b = evalNumeric(e.base, env, prec);
      // An exact integer exponent avoids a branch-cut decision entirely.
      if (e.exp.k === 'num' && R.isInt(e.exp.v) && R.abs(e.exp.v).n < 4096n) {
        const n = Number(e.exp.v.n);
        if (CX.isZero(b) && n < 0) throw new UndefinedAtPoint('zero raised to a negative power');
        return CX.powInt(b, n, prec);
      }
      const x = evalNumeric(e.exp, env, prec);
      if (CX.isZero(b) && B.isNeg(x.re)) throw new UndefinedAtPoint('zero to a negative power');
      return CX.powC(b, x, prec);
    }
    case 'fn':
      return evalNumericFn(e.name, e.args.map((a) => evalNumeric(a, env, prec)), prec, e.args, env);
    case 'rel': {
      // A relation evaluates to the difference of its sides; zero means it holds.
      const [l, r] = e.args;
      if (!l || !r) throw new UndefinedAtPoint('malformed relation');
      return CX.sub(evalNumeric(l, env, prec), evalNumeric(r, env, prec), prec);
    }
    default:
      throw new UndefinedAtPoint(`cannot evaluate node of kind ${e.k}`);
  }
}

function evalNumericFn(
  name: string,
  v: C[],
  prec: number,
  rawArgs: readonly Expr[],
  env: NumericEnv,
): C {
  const a = v[0] ?? CX.C_ZERO;
  const b = v[1];
  const requireReal = (z: C, what: string): B.BF => {
    if (!CX.isReal(z)) throw new UndefinedAtPoint(`${what} of a non-real value`);
    return z.re;
  };
  switch (name) {
    case 'sqrt': return CX.sqrt(a, prec);
    case 'root': {
      if (!b) throw new UndefinedAtPoint('root needs a degree');
      const n = B.toNumber(b.re);
      if (!Number.isInteger(n) || n === 0) throw new UndefinedAtPoint('non-integer root degree');
      // Odd roots of negative reals take the real branch, matching convention.
      if (CX.isReal(a) && B.isNeg(a.re) && Math.abs(n) % 2 === 1) {
        const mag = B.pow(B.abs(a.re), B.div(B.fromInt(1), B.fromInt(n), prec), prec);
        return CX.real(B.negate(mag));
      }
      return CX.powC(a, CX.div(CX.C_ONE, b, prec), prec);
    }
    case 'abs': return CX.real(CX.abs(a, prec));
    case 'exp': return CX.exp(a, prec);
    case 'ln': {
      if (CX.isZero(a)) throw new UndefinedAtPoint('ln of zero');
      return CX.log(a, prec);
    }
    case 'log': {
      // log(x) is base 10; log(b, x) is base b.
      if (!b) {
        if (CX.isZero(a)) throw new UndefinedAtPoint('log of zero');
        return CX.div(CX.log(a, prec), CX.real(B.ln(B.fromInt(10), prec)), prec);
      }
      if (CX.isZero(a) || CX.isZero(b)) throw new UndefinedAtPoint('log of zero');
      return CX.div(CX.log(b, prec), CX.log(a, prec), prec);
    }
    case 'sin': return CX.sin(a, prec);
    case 'cos': return CX.cos(a, prec);
    case 'tan': return CX.tan(a, prec);
    case 'sec': {
      const c = CX.cos(a, prec);
      if (CX.isZero(c)) throw new UndefinedAtPoint('sec at a pole');
      return CX.div(CX.C_ONE, c, prec);
    }
    case 'csc': {
      const s = CX.sin(a, prec);
      if (CX.isZero(s)) throw new UndefinedAtPoint('csc at a pole');
      return CX.div(CX.C_ONE, s, prec);
    }
    case 'cot': {
      const s = CX.sin(a, prec);
      if (CX.isZero(s)) throw new UndefinedAtPoint('cot at a pole');
      return CX.div(CX.cos(a, prec), s, prec);
    }
    case 'asin': return CX.asin(a, prec);
    case 'acos': return CX.acos(a, prec);
    case 'atan': return CX.atan(a, prec);
    case 'asec': return CX.acos(CX.div(CX.C_ONE, a, prec), prec);
    case 'acsc': return CX.asin(CX.div(CX.C_ONE, a, prec), prec);
    case 'acot': return CX.sub(CX.real(halfPi(prec)), CX.atan(a, prec), prec);
    case 'atan2': {
      if (!b) throw new UndefinedAtPoint('atan2 needs two arguments');
      return CX.real(B.atan2(requireReal(a, 'atan2'), requireReal(b, 'atan2'), prec));
    }
    case 'sinh': return CX.sinh(a, prec);
    case 'cosh': return CX.cosh(a, prec);
    case 'tanh': return CX.tanh(a, prec);
    case 'asinh': return CX.log(CX.add(a, CX.sqrt(CX.add(CX.powInt(a, 2, prec), CX.C_ONE, prec), prec), prec), prec);
    case 'acosh': return CX.log(CX.add(a, CX.sqrt(CX.sub(CX.powInt(a, 2, prec), CX.C_ONE, prec), prec), prec), prec);
    case 'atanh': return CX.div(CX.log(CX.div(CX.add(CX.C_ONE, a, prec), CX.sub(CX.C_ONE, a, prec), prec), prec), CX.fromInt(2), prec);
    case 'floor': return CX.real(B.fromInt(Math.floor(B.toNumber(requireReal(a, 'floor')))));
    case 'ceil': return CX.real(B.fromInt(Math.ceil(B.toNumber(requireReal(a, 'ceil')))));
    case 'sign': {
      const r = requireReal(a, 'sign');
      return CX.fromInt(B.isZero(r) ? 0 : B.isNeg(r) ? -1 : 1);
    }
    case 'min': case 'max': {
      const reals = v.map((z) => requireReal(z, name));
      let best = reals[0]!;
      for (const r of reals.slice(1)) {
        const takeNew = name === 'min' ? B.cmp(r, best) < 0 : B.cmp(r, best) > 0;
        if (takeNew) best = r;
      }
      return CX.real(best);
    }
    case 'mod': {
      if (!b) throw new UndefinedAtPoint('mod needs two arguments');
      const x = B.toNumber(requireReal(a, 'mod'));
      const y = B.toNumber(requireReal(b, 'mod'));
      if (y === 0) throw new UndefinedAtPoint('mod by zero');
      return CX.real(B.fromNumber(x - y * Math.floor(x / y)));
    }
    case 'factorial': case 'binom': case 'gcd': case 'lcm': {
      // Integer-only functions: fall back to the exact path, which is the
      // only place they are meaningfully defined.
      const exactEnv: Record<string, Rat> = {};
      for (const [k, z] of Object.entries(env)) {
        if (!CX.isReal(z)) throw new UndefinedAtPoint(`${name} at a non-real point`);
        exactEnv[k] = R.bestRationalApprox(B.toNumber(z.re));
      }
      const r = evalExactFn(name, rawArgs, exactEnv);
      if (r === null) throw new UndefinedAtPoint(`${name} is undefined here`);
      return CX.fromRat(r, prec);
    }
    default:
      throw new UndefinedAtPoint(`no numeric rule for ${name}`);
  }
}

/** Convenience: real-valued double, for plotting only. Never for grading. */
export function evalPlot(e: Expr, env: Record<string, number>): number {
  const nenv: NumericEnv = {};
  for (const [k, x] of Object.entries(env)) nenv[k] = CX.real(B.fromNumber(x, 80));
  try {
    const z = evalNumeric(e, nenv, 80);
    if (!B.nearlyEqual(z.im, B.BF_ZERO, 40)) return NaN;
    return B.toNumber(z.re);
  } catch {
    return NaN;
  }
}
