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
    if (idx === 0) out += render(shown, P.Add, o);
    else out += ` ${negative ? '-' : '+'} ${render(shown, P.Add, o)}`;
    if (idx === 0 && negative) out = `-${out}`;
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
    const negative = top.startsWith('-');
    return `${negative ? '-' : ''}\\frac{${negative ? top.slice(1) : top}}{${bottom}}`;
  }
  return renderProduct(factors(e), o);
}

/** A fraction bar already groups its contents, so nothing inside needs brackets. */
function renderInsideFraction(e: Expr, o: Opts): string {
  return e.k === 'mul' ? renderProduct(factors(e), o) : render(e, P.Rel, o);
}

function renderProduct(fs: readonly Expr[], o: Opts): string {
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
    const prev = rest[i - 1]!;
    const cur = rest[i]!;
    // A number followed by a number needs a visible dot; 2x does not.
    const needsDot = o.explicitTimes && startsWithDigit(pieces[i]!) && endsWithDigit(out);
    out = needsDot ? `${out} \\cdot ${pieces[i]}` : joinTex(out, pieces[i]!);
    void prev; void cur;
  }
  return prefix + out;
}

const startsWithDigit = (s: string) => /^[0-9\\]/.test(s) && !/^\\left/.test(s);
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
      const fs = factors(e).filter((f) => !isOneE(f));
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
