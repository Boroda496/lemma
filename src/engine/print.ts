/**
 * Rendering expressions back out, as LaTeX for display and as plain text for
 * tests and debugging.
 *
 * The tree stores subtraction as "plus a negative" and division as "to the
 * minus one". Nobody wants to read that, so the printer's real job is undoing
 * the internal representation: pulling negative terms back into minus signs,
 * gathering negative exponents back into a fraction bar, and inserting only
 * the parentheses that are actually needed.
 */

import type { Expr, FnName } from './expr.ts';
import { splitCoeff, numerDenom, factors, isOneE, isZeroE, key } from './expr.ts';
import type { Rat } from './rational.ts';
import * as R from './rational.ts';
import { numericValueOf } from './parse.ts';
import { evalNumeric } from './evaluate.ts';
import { toDecimalString as bfDecimal, isZero as bfIsZero } from './bigfloat.ts';

export interface PrintOptions {
  /** Render a/b as a fraction bar rather than a solidus. Default true. */
  readonly fractionBars?: boolean;
  /** Use \cdot between numbers rather than juxtaposition. Default true. */
  readonly explicitTimes?: boolean;
  /** Decimal places when showing a numeric approximation. */
  readonly decimals?: number;
}

// Binding powers, used only to decide parentheses.
const enum P { Rel = 1, Add = 2, Mul = 3, Neg = 4, Pow = 5, Atom = 6 }

function precedence(e: Expr): P {
  switch (e.k) {
    case 'rel': case 'and': case 'or': return P.Rel;
    case 'add': return P.Add;
    case 'mul': return P.Mul;
    case 'pow': return P.Pow;
    default: return P.Atom;
  }
}

const GREEK_TO_TEX: Record<string, string> = {
  'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta', 'ε': '\\epsilon',
  'ζ': '\\zeta', 'η': '\\eta', 'θ': '\\theta', 'ι': '\\iota', 'κ': '\\kappa',
  'λ': '\\lambda', 'μ': '\\mu', 'ν': '\\nu', 'ξ': '\\xi', 'ρ': '\\rho',
  'σ': '\\sigma', 'τ': '\\tau', 'υ': '\\upsilon', 'φ': '\\phi', 'χ': '\\chi',
  'ψ': '\\psi', 'ω': '\\omega', 'Γ': '\\Gamma', 'Δ': '\\Delta', 'Θ': '\\Theta',
  'Λ': '\\Lambda', 'Ξ': '\\Xi', 'Σ': '\\Sigma', 'Φ': '\\Phi', 'Ψ': '\\Psi', 'Ω': '\\Omega',
};

const FN_TEX: Partial<Record<FnName, string>> = {
  sin: '\\sin', cos: '\\cos', tan: '\\tan', sec: '\\sec', csc: '\\csc', cot: '\\cot',
  asin: '\\arcsin', acos: '\\arccos', atan: '\\arctan',
  sinh: '\\sinh', cosh: '\\cosh', tanh: '\\tanh',
  ln: '\\ln', log: '\\log', exp: '\\exp',
  min: '\\min', max: '\\max', gcd: '\\gcd',
  floor: '\\operatorname{floor}', ceil: '\\operatorname{ceil}', sign: '\\operatorname{sign}',
  asec: '\\operatorname{arcsec}', acsc: '\\operatorname{arccsc}', acot: '\\operatorname{arccot}',
  asinh: '\\operatorname{arsinh}', acosh: '\\operatorname{arcosh}', atanh: '\\operatorname{artanh}',
  lcm: '\\operatorname{lcm}', mod: '\\bmod',
};

// ------------------------------------------------------------------- LaTeX

export function toLatex(e: Expr, opts: PrintOptions = {}): string {
  return render(e, P.Rel, { fractionBars: true, explicitTimes: true, ...opts });
}

type Opts = Required<Pick<PrintOptions, 'fractionBars' | 'explicitTimes'>> & PrintOptions;

function wrap(s: string, need: boolean): string {
  return need ? `\\left(${s}\\right)` : s;
}

function render(e: Expr, parentPrec: P, o: Opts): string {
  const s = renderRaw(e, o);
  return wrap(s, precedence(e) < parentPrec);
}

function renderRaw(e: Expr, o: Opts): string {
  switch (e.k) {
    case 'num': return renderRat(e.v, o);
    case 'const': return renderConst(e.name);
    case 'sym': {
      const base = GREEK_TO_TEX[e.name] ?? e.name;
      return e.sub ? `${base}_{${e.sub}}` : base;
    }
    case 'add': return renderAdd(e.args, o);
    case 'mul': return renderMul(e, o);
    case 'pow': return renderPow(e.base, e.exp, o);
    case 'fn': return renderFn(e.name, e.args, o);
    case 'rel': return renderRel(e.op, e.args, o);
    case 'and': return e.args.map((a) => render(a, P.Rel, o)).join(' \\quad\\text{and}\\quad ');
    case 'or': return e.args.map((a) => render(a, P.Rel, o)).join(' \\quad\\text{or}\\quad ');
    case 'tuple': return e.args.map((a) => render(a, P.Rel, o)).join(',\; ');
    case 'set': return `\\left\\{${e.args.map((a) => render(a, P.Rel, o)).join(',\; ')}\\right\\}`;
    case 'interval':
      return `${e.loOpen ? '\\left(' : '\\left['}${render(e.lo, P.Rel, o)}, ${render(e.hi, P.Rel, o)}${e.hiOpen ? '\\right)' : '\\right]'}`;
  }
}

function renderRat(v: Rat, o: Opts): string {
  if (v.d === 1n) return v.n.toString();
  const sign = v.n < 0n ? '-' : '';
  const n = v.n < 0n ? -v.n : v.n;
  return o.fractionBars ? `${sign}\\frac{${n}}{${v.d}}` : `${sign}${n}/${v.d}`;
}

function renderConst(name: string): string {
  switch (name) {
    case 'pi': return '\\pi';
    case 'e': return 'e';
    case 'i': return 'i';
    case 'inf': return '\\infty';
    default: return '\\text{undefined}';
  }
}

/** Negative terms become minus signs instead of "+ -3x". */
function renderAdd(args: readonly Expr[], o: Opts): string {
  let out = '';
  args.forEach((term, idx) => {
    const [coeff, body] = splitCoeff(term);
    const negative = R.isNeg(coeff);
    const shown = negative
      ? (isOneE(body) ? { k: 'num' as const, v: R.neg(coeff) } : rebuild(R.neg(coeff), body))
      : term;
    let piece = render(shown, P.Add, o);
    let minus = negative;

    // The coefficient is not always the whole story: a term like (-1)*4*(-5)
    // has a positive coefficient but renders as "-4 * (-5)". Reading the sign
    // off the rendered text as well avoids emitting "+ -4".
    if (!minus && piece.startsWith('-')) {
      minus = true;
      piece = piece.slice(1);
    }

    if (idx === 0) out += minus ? `-${piece}` : piece;
    else out += ` ${minus ? '-' : '+'} ${piece}`;
  });
  return out;
}

function rebuild(coeff: Rat, body: Expr): Expr {
  if (R.isOne(coeff)) return body;
  return { k: 'mul', args: [{ k: 'num', v: coeff }, body] };
}

/** Gather negative exponents into a fraction bar. */
function renderMul(e: Expr, o: Opts): string {
  const [n, d] = numerDenom(e);
  if (!isOneE(d) && o.fractionBars) {
    const top = renderInsideFraction(n, o);
    const bottom = renderInsideFraction(d, o);
    // Hoisting a leading minus outside the bar is only valid when the whole
    // numerator is negative. For a sum it changes the meaning: -(2+sqrt 24)/2
    // is not (-2+sqrt 24)/2, and the second is what the tree says.
    const numeratorIsSum = stripUnits(n).some((f) => f.k === 'add')
      || (n.k === 'add');
    const negative = top.startsWith('-') && !numeratorIsSum;
    return `${negative ? '-' : ''}\\frac{${negative ? top.slice(1) : top}}{${bottom}}`;
  }
  return renderProduct(factors(e), o);
}

/** Factors that actually contribute, with the invisible 1s dropped. */
function stripUnits(e: Expr): Expr[] {
  return factors(e).filter((f) => !isOneE(f));
}

/**
 * A fraction bar already groups its contents, so nothing inside needs
 * brackets. The unit factors have to go first: numerDenom leaves a 1 behind
 * when it splits a rational coefficient, and a product of "1 and a sum" would
 * otherwise be bracketed as though it were a real product.
 */
function renderInsideFraction(e: Expr, o: Opts): string {
  const tidied = distributeNegatedSum(e);
  if (tidied.k === 'add') return render(tidied, P.Rel, o);
  const parts = stripUnits(tidied);
  if (parts.length === 0) return '1';
  if (parts.length === 1) return render(parts[0]!, P.Rel, o);
  return renderProduct(parts, o);
}

/**
 * Tidy a fraction's numerator for display.
 *
 * Two rewrites, both confined to the inside of a fraction bar:
 *   -(u - v)     becomes  v - u
 *   -5(-F + 32)  becomes  5F - 160
 * and a sum opening with a minus is rotated so a positive term leads.
 *
 * Only a numeric factor times a single sum is touched. Expanding numerators in
 * general would rewrite what the author wrote, turning a deliberate
 * (x+1)(x+2) in a derivation step into x^2+3x+2 and making the step look like
 * it did something it did not.
 */
function distributeNegatedSum(e: Expr): Expr {
  if (e.k === 'add') return positiveFirst(e);
  if (e.k !== 'mul') return e;
  const parts = stripUnits(e);
  if (parts.length !== 2) return e;
  const numIdx = parts.findIndex((f) => f.k === 'num' && R.isNeg(f.v));
  if (numIdx === -1) return e;
  const factor = parts[numIdx] as Extract<Expr, { k: 'num' }>;
  const sum = parts[1 - numIdx];
  if (!sum || sum.k !== 'add') return e;
  return positiveFirst({ k: 'add', args: sum.args.map((t) => scaleTerm(t, factor.v)) });
}

/** Multiply a term by a constant, folding it into the term's own coefficient. */
function scaleTerm(t: Expr, k: Rat): Expr {
  if (t.k === 'num') return { k: 'num', v: R.mul(t.v, k) };
  const [coeff, body] = splitCoeff(t);
  const scaled = R.mul(coeff, k);
  if (R.isOne(scaled)) return body;
  return { k: 'mul', args: [{ k: 'num', v: scaled }, body] };
}

/** Rotate a sum so it does not open with a minus sign, when it can. */
function positiveFirst(e: Expr): Expr {
  if (e.k !== 'add' || e.args.length < 2) return e;
  const leads = (t: Expr): boolean => !R.isNeg(splitCoeff(t)[0]);
  if (leads(e.args[0]!)) return e;
  const idx = e.args.findIndex(leads);
  if (idx <= 0) return e;
  return { k: 'add', args: [e.args[idx]!, ...e.args.filter((_, i) => i !== idx)] };
}

/**
 * Conventional factor order for display: numbers, then constants, symbols,
 * powers, and brackets last. Multiplication commutes, so reordering is always
 * safe, and without it a distribution step prints "x3" and "(x+3)x" instead of
 * "3x" and "x(x+3)". Equal ranks keep their original relative order, so a step
 * that genuinely rearranged factors still reads as a change.
 */
function displayOrder(fs: readonly Expr[]): Expr[] {
  const rank = (e: Expr): number => {
    switch (e.k) {
      case 'num': return 0;
      case 'const': return 1;
      case 'sym': return 2;
      case 'pow': return 3;
      case 'fn': return 4;
      case 'add': return 6;
      default: return 5;
    }
  };
  return fs.map((f, i) => ({ f, i })).sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i).map((x) => x.f);
}

function renderProduct(input: readonly Expr[], o: Opts): string {
  const fs = displayOrder(input);
  const parts = fs.filter((f) => !isOneE(f));
  if (parts.length === 0) return '1';
  if (parts.length === 1) return render(parts[0]!, P.Mul, o);

  // -1 in front prints as a bare minus.
  const rest = [...parts];
  let prefix = '';
  const negIdx = rest.findIndex((f) => f.k === 'num' && f.v.n === -1n && f.v.d === 1n);
  if (negIdx >= 0) {
    prefix = '-';
    rest.splice(negIdx, 1);
    if (rest.length === 0) return '-1';
    if (rest.length === 1) return `-${render(rest[0]!, P.Mul, o)}`;
  }

  const pieces = rest.map((f) => render(f, P.Mul, o));
  let out = pieces[0]!;
  for (let i = 1; i < pieces.length; i++) {
    // A number followed by a number needs a visible dot; 2x does not.
    // A dot is needed between two numbers, and between repeated factors where
    // juxtaposition would read as a single squared symbol ("xx").
    const repeated = key(rest[i]!) === key(rest[i - 1]!);
    const cur = rest[i]!;
    // A negative number after the first factor gets brackets, so that
    // 4 * (-5) does not print as "4-5", which reads as a subtraction.
    let piece = pieces[i]!;
    if (cur.k === 'num' && R.isNeg(cur.v)) piece = `\\left(${piece}\\right)`;
    const needsDot = o.explicitTimes
      && (repeated || piece.startsWith('\\left(') || (startsWithDigit(piece) && endsWithDigit(out)));
    out = needsDot ? `${out} \\cdot ${piece}` : joinTex(out, piece);
  }
  return prefix + out;
}

/**
 * Would juxtaposing this fragment after a number read as one longer number?
 * A digit or a fraction would; a named constant like \\pi would not, and
 * "2\\pi" is how anyone writes it.
 */
const startsWithDigit = (s: string) => /^[0-9]/.test(s) || /^\\[dt]?frac/.test(s);
const endsWithDigit = (s: string) => /[0-9}]$/.test(s);

/**
 * Concatenate two LaTeX fragments safely.
 * A control word swallows the letters that follow it, so "\pi" next to "r"
 * would render as the unknown command "\pir". A single space ends the word
 * and is invisible in the output.
 */
function joinTex(left: string, right: string): string {
  const endsInControlWord = /\\[a-zA-Z]+$/.test(left);
  return endsInControlWord && /^[a-zA-Z]/.test(right) ? `${left} ${right}` : left + right;
}

function renderPow(base: Expr, exp: Expr, o: Opts): string {
  const expVal = numericValueOf(exp);
  // Negative exponent: show a reciprocal instead.
  if (expVal !== null && R.isNeg(expVal) && o.fractionBars) {
    const positive: Expr = { k: 'pow', base, exp: { k: 'num', v: R.neg(expVal) } };
    const inner = R.isOne(R.neg(expVal)) ? render(base, P.Rel, o) : renderRaw(positive, o);
    return `\\frac{1}{${inner}}`;
  }
  // A half exponent is a square root.
  if (expVal !== null && expVal.n === 1n && expVal.d === 2n) {
    return `\\sqrt{${render(base, P.Rel, o)}}`;
  }
  // sin(x)^2 conventionally prints as \sin^2 x.
  if (base.k === 'fn' && FN_TEX[base.name] && base.args.length === 1) {
    const trig = ['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'sinh', 'cosh', 'tanh'];
    if (trig.includes(base.name)) {
      return `${FN_TEX[base.name]}^{${render(exp, P.Rel, o)}}\\left(${render(base.args[0]!, P.Rel, o)}\\right)`;
    }
  }
  return `${render(base, P.Atom, o)}^{${render(exp, P.Rel, o)}}`;
}

function renderFn(name: FnName, args: readonly Expr[], o: Opts): string {
  const inner = args.map((a) => render(a, P.Rel, o));

  switch (name) {
    case 'sqrt': return `\\sqrt{${inner[0]}}`;
    case 'root': return `\\sqrt[${inner[1]}]{${inner[0]}}`;
    case 'abs': return `\\left|${inner[0]}\\right|`;
    case 'factorial': return `${render(args[0]!, P.Atom, o)}!`;
    case 'binom': return `\\binom{${inner[0]}}{${inner[1]}}`;
    case 'pm': return `\\pm ${inner[0]}`;
    case 'exp': return `e^{${inner[0]}}`;
    case 'log':
      return args.length === 2
        ? `\\log_{${inner[0]}}\\left(${inner[1]}\\right)`
        : `\\log\\left(${inner[0]}\\right)`;
    case 'deriv':
      return `\\frac{d}{d${inner[1] ?? 'x'}}\\left(${inner[0]}\\right)`;
    case 'integral':
      return `\\int ${inner[0]}\\,d${inner[1] ?? 'x'}`;
    default: {
      const tex = FN_TEX[name] ?? `\\operatorname{${name}}`;
      return `${tex}\\left(${inner.join(', ')}\\right)`;
    }
  }
}

function renderRel(op: string, args: readonly Expr[], o: Opts): string {
  const sym: Record<string, string> = {
    '=': '=', '<': '<', '>': '>', '<=': '\\le', '>=': '\\ge', '!=': '\\ne', 'approx': '\\approx',
  };
  return args.map((a) => render(a, P.Add, o)).join(` ${sym[op] ?? op} `);
}

// -------------------------------------------------------------- plain text

/** Unambiguous ASCII. Round-trips through `parse`, which the tests check. */
export function toText(e: Expr): string {
  return plain(e, P.Rel);
}

function plain(e: Expr, parentPrec: P): string {
  const s = plainRaw(e);
  return precedence(e) < parentPrec ? `(${s})` : s;
}

function plainRaw(e: Expr): string {
  switch (e.k) {
    case 'num': return R.toString(e.v);
    case 'const':
      return e.name === 'pi' ? 'pi' : e.name === 'inf' ? 'oo' : e.name;
    case 'sym': return e.sub ? `${e.name}_${e.sub}` : e.name;
    case 'add': {
      let out = '';
      e.args.forEach((t, i) => {
        const [c, body] = splitCoeff(t);
        const negative = R.isNeg(c);
        const shown = negative ? (isOneE(body) ? { k: 'num' as const, v: R.neg(c) } : rebuild(R.neg(c), body)) : t;
        const piece = plain(shown, P.Add);
        if (i === 0) out += negative ? `-${piece}` : piece;
        else out += negative ? ` - ${piece}` : ` + ${piece}`;
      });
      return out;
    }
    case 'mul': {
      const [n, d] = numerDenom(e);
      if (!isOneE(d)) return `${plain(n, P.Mul)}/${plain(d, P.Neg)}`;
      const fs = displayOrder(factors(e)).filter((f) => !isOneE(f));
      const negIdx = fs.findIndex((f) => f.k === 'num' && f.v.n === -1n && f.v.d === 1n);
      if (negIdx >= 0) {
        const rest = fs.filter((_, i) => i !== negIdx);
        if (rest.length === 0) return '-1';
        return `-${rest.map((f) => plain(f, P.Mul)).join('*')}`;
      }
      return fs.map((f) => plain(f, P.Mul)).join('*') || '1';
    }
    case 'pow': return `${plain(e.base, P.Atom)}^${plain(e.exp, P.Neg)}`;
    case 'fn': return `${e.name}(${e.args.map((a) => plain(a, P.Rel)).join(', ')})`;
    case 'rel': return e.args.map((a) => plain(a, P.Add)).join(` ${e.op} `);
    case 'and': return e.args.map((a) => plain(a, P.Rel)).join(' and ');
    case 'or': return e.args.map((a) => plain(a, P.Rel)).join(' or ');
    case 'tuple': return e.args.map((a) => plain(a, P.Rel)).join(', ');
    case 'set': return `{${e.args.map((a) => plain(a, P.Rel)).join(', ')}}`;
    case 'interval':
      return `${e.loOpen ? '(' : '['}${plain(e.lo, P.Rel)}, ${plain(e.hi, P.Rel)}${e.hiOpen ? ')' : ']'}`;
  }
}

/** A decimal approximation for the "or about..." line under an exact answer. */
export function approximate(e: Expr, decimals = 4): string | null {
  try {
    const z = evalNumeric(e, {}, 96);
    if (!bfIsZero(z.im)) return null;
    const s = bfDecimal(z.re, decimals + 2);
    const dot = s.indexOf('.');
    if (dot === -1) return s;
    const cut = s.slice(0, dot + decimals + 1);
    return cut.includes('.') ? cut.replace(/0+$/, '').replace(/\.$/, '') : cut;
  } catch {
    return null;
  }
}
