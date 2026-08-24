/**
 * Expression AST.
 *
 * Shape follows the SymPy model: n-ary `add` and `mul`, binary `pow`.
 * Subtraction is add-with-a-negative, division is pow-with-exponent--1.
 * Collapsing those four operators into two removes a pile of special cases
 * from every rule downstream; the printer puts the minus signs and fraction
 * bars back for the student.
 *
 * DELIBERATE: constructors do not simplify. `add(num(2), num(3))` stays
 * `2 + 3` and does not become `5`. Step-by-step teaching requires holding an
 * unsimplified form as a first-class object — the moment constructors fold,
 * "combine like terms" has nothing to show. Normalization is opt-in, via
 * canon.ts. The only thing constructors do is flatten associativity, which is
 * invisible to a reader: nobody distinguishes (2+3)+4 from 2+3+4.
 */

import type { Rat } from './rational.ts';
import { rat, ZERO, ONE, NEG_ONE, isNeg, eq as ratEq, toString as ratToString } from './rational.ts';

export type ConstName = 'pi' | 'e' | 'i' | 'inf' | 'nan';

export type FnName =
  | 'sqrt' | 'root' | 'abs' | 'exp' | 'ln' | 'log'
  | 'sin' | 'cos' | 'tan' | 'sec' | 'csc' | 'cot'
  | 'asin' | 'acos' | 'atan' | 'asec' | 'acsc' | 'acot' | 'atan2'
  | 'sinh' | 'cosh' | 'tanh' | 'asinh' | 'acosh' | 'atanh'
  | 'floor' | 'ceil' | 'sign' | 'factorial' | 'binom'
  | 'gcd' | 'lcm' | 'min' | 'max' | 'mod'
  | 'deriv' | 'integral' | 'sum' | 'prod' | 'limit';

export type RelOp = '=' | '<' | '>' | '<=' | '>=' | '!=' | 'approx';

export type Expr =
  | { readonly k: 'num'; readonly v: Rat }
  | { readonly k: 'const'; readonly name: ConstName }
  | { readonly k: 'sym'; readonly name: string; readonly sub?: string }
  | { readonly k: 'add'; readonly args: readonly Expr[] }
  | { readonly k: 'mul'; readonly args: readonly Expr[] }
  | { readonly k: 'pow'; readonly base: Expr; readonly exp: Expr }
  | { readonly k: 'fn'; readonly name: FnName; readonly args: readonly Expr[] }
  | { readonly k: 'rel'; readonly op: RelOp; readonly args: readonly Expr[] }
  | { readonly k: 'and'; readonly args: readonly Expr[] }
  | { readonly k: 'or'; readonly args: readonly Expr[] }
  | { readonly k: 'tuple'; readonly args: readonly Expr[] }
  | { readonly k: 'set'; readonly args: readonly Expr[] }
  | { readonly k: 'interval'; readonly lo: Expr; readonly hi: Expr; readonly loOpen: boolean; readonly hiOpen: boolean };

// ---------------------------------------------------------------- constructors

export const num = (v: Rat | bigint | number): Expr => ({
  k: 'num',
  v: typeof v === 'object' ? v : rat(v as bigint | number),
});
export const int = (n: bigint | number): Expr => num(rat(n));
export const frac = (n: bigint | number, d: bigint | number): Expr => num(rat(n, d));
export const sym = (name: string, sub?: string): Expr => (sub ? { k: 'sym', name, sub } : { k: 'sym', name });
export const cst = (name: ConstName): Expr => ({ k: 'const', name });

export const E0 = num(ZERO);
export const E1 = num(ONE);
export const ENEG1 = num(NEG_ONE);
export const PI = cst('pi');
export const EULER = cst('e');
export const I = cst('i');

/** Flattens nested adds. Does not fold constants or collect like terms. */
export function add(...args: Expr[]): Expr {
  const flat: Expr[] = [];
  for (const a of args) {
    if (a.k === 'add') flat.push(...a.args);
    else flat.push(a);
  }
  if (flat.length === 0) return E0;
  if (flat.length === 1) return flat[0]!;
  return { k: 'add', args: flat };
}

/** Flattens nested muls. Does not fold constants or collect powers. */
export function mul(...args: Expr[]): Expr {
  const flat: Expr[] = [];
  for (const a of args) {
    if (a.k === 'mul') flat.push(...a.args);
    else flat.push(a);
  }
  if (flat.length === 0) return E1;
  if (flat.length === 1) return flat[0]!;
  return { k: 'mul', args: flat };
}

export const pow = (base: Expr, exp: Expr): Expr => ({ k: 'pow', base, exp });
export const neg = (a: Expr): Expr => mul(ENEG1, a);
export const sub = (a: Expr, b: Expr): Expr => add(a, neg(b));
export const div = (a: Expr, b: Expr): Expr => mul(a, pow(b, ENEG1));
export const fn = (name: FnName, ...args: Expr[]): Expr => ({ k: 'fn', name, args });
export const sqrt = (a: Expr): Expr => fn('sqrt', a);
export const rel = (op: RelOp, ...args: Expr[]): Expr => ({ k: 'rel', op, args });
export const equation = (lhs: Expr, rhs: Expr): Expr => rel('=', lhs, rhs);
export const and = (...args: Expr[]): Expr => (args.length === 1 ? args[0]! : { k: 'and', args });
export const or = (...args: Expr[]): Expr => (args.length === 1 ? args[0]! : { k: 'or', args });
export const tuple = (...args: Expr[]): Expr => ({ k: 'tuple', args });
export const set = (...args: Expr[]): Expr => ({ k: 'set', args });
export const interval = (lo: Expr, hi: Expr, loOpen = true, hiOpen = true): Expr => ({
  k: 'interval', lo, hi, loOpen, hiOpen,
});

// ------------------------------------------------------------------ predicates

export const isNum = (e: Expr): e is Extract<Expr, { k: 'num' }> => e.k === 'num';
export const isSym = (e: Expr): e is Extract<Expr, { k: 'sym' }> => e.k === 'sym';
export const isZeroE = (e: Expr): boolean => e.k === 'num' && e.v.n === 0n;
export const isOneE = (e: Expr): boolean => e.k === 'num' && e.v.n === 1n && e.v.d === 1n;
export const isNegOneE = (e: Expr): boolean => e.k === 'num' && e.v.n === -1n && e.v.d === 1n;
export const isInteger = (e: Expr): boolean => e.k === 'num' && e.v.d === 1n;
export const isRelation = (e: Expr): e is Extract<Expr, { k: 'rel' }> => e.k === 'rel';

/** True when the printed form leads with a minus, so the printer can emit "a - b". */
export function isNegative(e: Expr): boolean {
  if (e.k === 'num') return isNeg(e.v);
  if (e.k === 'mul') return e.args.some((a) => a.k === 'num' && isNeg(a.v)) &&
    e.args.filter((a) => a.k === 'num' && isNeg(a.v)).length % 2 === 1;
  return false;
}

// ------------------------------------------------------------------- traversal

export function children(e: Expr): readonly Expr[] {
  switch (e.k) {
    case 'add': case 'mul': case 'fn': case 'rel': case 'and': case 'or': case 'tuple': case 'set':
      return e.args;
    case 'pow': return [e.base, e.exp];
    case 'interval': return [e.lo, e.hi];
    default: return [];
  }
}

/** Rebuild a node with new children, preserving everything else. */
export function withChildren(e: Expr, kids: readonly Expr[]): Expr {
  switch (e.k) {
    case 'add': return { k: 'add', args: kids };
    case 'mul': return { k: 'mul', args: kids };
    case 'fn': return { k: 'fn', name: e.name, args: kids };
    case 'rel': return { k: 'rel', op: e.op, args: kids };
    case 'and': return { k: 'and', args: kids };
    case 'or': return { k: 'or', args: kids };
    case 'tuple': return { k: 'tuple', args: kids };
    case 'set': return { k: 'set', args: kids };
    case 'pow': return { k: 'pow', base: kids[0]!, exp: kids[1]! };
    case 'interval': return { ...e, lo: kids[0]!, hi: kids[1]! };
    default: return e;
  }
}

/** Bottom-up rewrite. `f` sees each node after its children are already rewritten. */
export function transform(e: Expr, f: (n: Expr) => Expr): Expr {
  const kids = children(e);
  if (kids.length === 0) return f(e);
  let changed = false;
  const next = kids.map((c) => {
    const r = transform(c, f);
    if (r !== c) changed = true;
    return r;
  });
  return f(changed ? withChildren(e, next) : e);
}

/** Top-down rewrite. `f` may rewrite a node before its children are visited; return null to descend. */
export function rewriteTopDown(e: Expr, f: (n: Expr) => Expr | null): Expr {
  const hit = f(e);
  if (hit !== null) return hit;
  const kids = children(e);
  if (kids.length === 0) return e;
  let changed = false;
  const next = kids.map((c) => {
    const r = rewriteTopDown(c, f);
    if (r !== c) changed = true;
    return r;
  });
  return changed ? withChildren(e, next) : e;
}

export function walk(e: Expr, visit: (n: Expr) => void): void {
  visit(e);
  for (const c of children(e)) walk(c, visit);
}

export function has(e: Expr, pred: (n: Expr) => boolean): boolean {
  let found = false;
  walk(e, (n) => { if (pred(n)) found = true; });
  return found;
}

export function count(e: Expr, pred: (n: Expr) => boolean): number {
  let n = 0;
  walk(e, (x) => { if (pred(x)) n++; });
  return n;
}

/** Node count — the tie-breaker for "which form is simpler". */
export function size(e: Expr): number {
  let n = 0;
  walk(e, () => n++);
  return n;
}

/** Every free symbol name, sorted, so callers get a deterministic variable order. */
export function symbols(e: Expr): string[] {
  const s = new Set<string>();
  walk(e, (n) => { if (n.k === 'sym') s.add(symKey(n)); });
  return [...s].sort();
}

export const symKey = (s: Extract<Expr, { k: 'sym' }>): string => (s.sub ? `${s.name}_${s.sub}` : s.name);

export function hasSymbol(e: Expr, name: string): boolean {
  return has(e, (n) => n.k === 'sym' && symKey(n) === name);
}

/** Substitute symbols by name. */
export function subst(e: Expr, map: Record<string, Expr>): Expr {
  return transform(e, (n) => (n.k === 'sym' && map[symKey(n)] ? map[symKey(n)]! : n));
}

/** Replace any subtree structurally equal to `from`. */
export function replace(e: Expr, from: Expr, to: Expr): Expr {
  const target = key(from);
  return transform(e, (n) => (key(n) === target ? to : n));
}

// -------------------------------------------------------- structural identity

/**
 * Canonical string for structural identity. Two expressions share a key iff
 * they are the same tree. This is NOT mathematical equality — `2+3` and `5`
 * have different keys on purpose. Mathematical equality lives in equivalence.ts.
 */
export function key(e: Expr): string {
  switch (e.k) {
    case 'num': return `#${ratToString(e.v)}`;
    case 'const': return `@${e.name}`;
    case 'sym': return `$${symKey(e)}`;
    case 'add': return `(+ ${e.args.map(key).join(' ')})`;
    case 'mul': return `(* ${e.args.map(key).join(' ')})`;
    case 'pow': return `(^ ${key(e.base)} ${key(e.exp)})`;
    case 'fn': return `(${e.name} ${e.args.map(key).join(' ')})`;
    case 'rel': return `(${e.op} ${e.args.map(key).join(' ')})`;
    case 'and': return `(and ${e.args.map(key).join(' ')})`;
    case 'or': return `(or ${e.args.map(key).join(' ')})`;
    case 'tuple': return `(tuple ${e.args.map(key).join(' ')})`;
    case 'set': return `(set ${[...e.args.map(key)].sort().join(' ')})`;
    case 'interval': return `(int ${e.loOpen ? '(' : '['}${key(e.lo)} ${key(e.hi)}${e.hiOpen ? ')' : ']'})`;
  }
}

export const structEq = (a: Expr, b: Expr): boolean => key(a) === key(b);

/**
 * Total order used to sort arguments into a stable printed order.
 * Numbers first, then constants, symbols, powers, products, sums, functions.
 */
const KIND_RANK: Record<Expr['k'], number> = {
  num: 0, const: 1, sym: 2, pow: 3, mul: 4, add: 5, fn: 6,
  rel: 7, and: 8, or: 9, tuple: 10, set: 11, interval: 12,
};

export function compareExpr(a: Expr, b: Expr): number {
  if (a.k !== b.k) return KIND_RANK[a.k] - KIND_RANK[b.k];
  switch (a.k) {
    case 'num': {
      const bb = b as typeof a;
      const l = a.v.n * bb.v.d;
      const r = bb.v.n * a.v.d;
      return l < r ? -1 : l > r ? 1 : 0;
    }
    case 'sym': return symKey(a).localeCompare(symKey(b as typeof a));
    case 'const': return a.name.localeCompare((b as typeof a).name);
    default: {
      const ka = key(a), kb = key(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    }
  }
}

// ---------------------------------------------------------------- destructuring

/**
 * Split a product into its rational coefficient and the rest.
 * 3*x*y -> [3, x*y];  x -> [1, x];  -x/2 -> [-1/2, x]
 * The workhorse behind collecting like terms.
 */
export function splitCoeff(e: Expr): [Rat, Expr] {
  if (e.k === 'num') return [e.v, E1];
  if (e.k !== 'mul') return [ONE, e];
  let c = ONE;
  const rest: Expr[] = [];
  for (const a of e.args) {
    if (a.k === 'num') c = { n: c.n * a.v.n, d: c.d * a.v.d };
    else rest.push(a);
  }
  const g = ((x: bigint, y: bigint) => { x = x < 0n ? -x : x; y = y < 0n ? -y : y; while (y) { const t = x % y; x = y; y = t; } return x || 1n; })(c.n, c.d);
  const coeff = c.d < 0n ? rat(-c.n / g, -c.d / g) : rat(c.n / g, c.d / g);
  return [coeff, rest.length === 0 ? E1 : rest.length === 1 ? rest[0]! : { k: 'mul', args: rest }];
}

/** Split a power into base and exponent. `x` -> [x, 1]. */
export function splitPow(e: Expr): [Expr, Expr] {
  return e.k === 'pow' ? [e.base, e.exp] : [e, E1];
}

/** The terms of a sum. A non-sum is a one-term sum. */
export const terms = (e: Expr): readonly Expr[] => (e.k === 'add' ? e.args : [e]);
/** The factors of a product. A non-product is a one-factor product. */
export const factors = (e: Expr): readonly Expr[] => (e.k === 'mul' ? e.args : [e]);

/** Numerator and denominator, reading negative exponents as division. */
export function numerDenom(e: Expr): [Expr, Expr] {
  const nums: Expr[] = [];
  const dens: Expr[] = [];
  for (const f of factors(e)) {
    if (f.k === 'num') {
      if (f.v.n !== 0n && f.v.d !== 1n) {
        nums.push(num(rat(f.v.n)));
        dens.push(num(rat(f.v.d)));
      } else nums.push(f);
      continue;
    }
    const [b, ex] = splitPow(f);
    if (ex.k === 'num' && isNeg(ex.v)) {
      dens.push(ratEq(ex.v, NEG_ONE) ? b : pow(b, num({ n: -ex.v.n, d: ex.v.d })));
    } else nums.push(f);
  }
  return [nums.length ? mul(...nums) : E1, dens.length ? mul(...dens) : E1];
}

export function isPolynomialIn(e: Expr, v: string): boolean {
  let ok = true;
  walk(e, (n) => {
    if (n.k === 'pow' && hasSymbol(n.base, v)) {
      if (!(n.exp.k === 'num' && n.exp.v.d === 1n && n.exp.v.n >= 0n)) ok = false;
    }
    if (n.k === 'fn' && hasSymbol(n, v) && n.name !== 'abs') ok = false;
  });
  return ok;
}

/** Deep-freeze guard used in tests to catch accidental mutation of shared nodes. */
export function deepFreeze(e: Expr): Expr {
  Object.freeze(e);
  for (const c of children(e)) deepFreeze(c);
  return e;
}
