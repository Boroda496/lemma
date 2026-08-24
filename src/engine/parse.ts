/**
 * One parser for two input languages.
 *
 * The math field emits LaTeX (\frac{1}{2}, x^{2}, \sqrt[3]{x}); a physical
 * keyboard emits plain text (1/2, x^2, cbrt(x)). Rather than maintain two
 * front ends, the tokenizer recognises LaTeX control words as tokens and the
 * same Pratt parser handles both, so "\frac{x+1}{2}" and "(x+1)/2" land on
 * the identical tree.
 *
 * Variables are single letters, optionally subscripted (x_1) or Greek, because
 * "xy" has to mean x times y. Multi-letter identifiers are reserved for the
 * function names listed below.
 */

import type { Expr, FnName, RelOp } from './expr.ts';
import {
  add, mul, pow, num, int, sym, cst, fn as mkFn, neg, sub, div, rel, tuple,
  E0, E1, ENEG1,
} from './expr.ts';
import * as R from './rational.ts';

export class ParseError extends Error {
  constructor(message: string, readonly position: number, readonly source: string) {
    super(message);
    this.name = 'ParseError';
  }
  /** A caret line pointing at the offending character, for the input field. */
  get caret(): string {
    return ' '.repeat(Math.max(0, this.position)) + '^';
  }
}

export interface ParseOptions {
  /** Treat a bare `e` as Euler's number rather than a variable. Default true. */
  readonly eulerE?: boolean;
  /** Treat a bare `i` as the imaginary unit rather than a variable. Default true. */
  readonly imaginaryI?: boolean;
  /** Names to always read as variables, overriding the two flags above. */
  readonly variables?: readonly string[];
  /** Interpret bare numbers in trig arguments as degrees. Default false. */
  readonly degrees?: boolean;
}

// ------------------------------------------------------------------- tokenizer

type TokKind =
  | 'num' | 'name' | 'op' | 'lparen' | 'rparen' | 'lbrace' | 'rbrace'
  | 'lbracket' | 'rbracket' | 'bar' | 'comma' | 'cmd' | 'eof';

interface Tok {
  readonly kind: TokKind;
  readonly text: string;
  readonly pos: number;
}

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'θ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', rho: 'ρ', sigma: 'σ', tau: 'τ',
  upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Sigma: 'Σ',
  Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};

/** LaTeX commands that map onto a plain-text operator or name. */
const CMD_ALIAS: Record<string, string> = {
  cdot: '*', times: '*', div: '/', ast: '*',
  le: '<=', leq: '<=', ge: '>=', geq: '>=', ne: '!=', neq: '!=', approx: '~',
  lt: '<', gt: '>', pm: '±', mp: '∓',
  left: '', right: '', ',': '', ';': '', '!': '', ' ': '', quad: '', qquad: '',
  displaystyle: '', textstyle: '', limits: '', nolimits: '',
  lparen: '(', rparen: ')',
};

const FUNCTIONS: ReadonlySet<string> = new Set<string>([
  'sqrt', 'cbrt', 'root', 'abs', 'exp', 'ln', 'log', 'lg',
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
  'arcsin', 'arccos', 'arctan', 'arcsec', 'arccsc', 'arccot',
  'asin', 'acos', 'atan', 'asec', 'acsc', 'acot', 'atan2',
  'sinh', 'cosh', 'tanh', 'arcsinh', 'arccosh', 'arctanh', 'asinh', 'acosh', 'atanh',
  'floor', 'ceil', 'sign', 'min', 'max', 'gcd', 'lcm', 'mod', 'binom', 'choose',
  'factorial',
]);

/** Multi-letter words that name a constant rather than a product of letters. */
const CONSTANT_WORDS: Record<string, string> = {
  pi: 'π', tau: 'τ', theta: 'θ', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ',
  epsilon: 'ε', lambda: 'λ', mu: 'μ', sigma: 'σ', omega: 'ω', phi: 'φ',
  rho: 'ρ', infty: '∞', infinity: '∞', oo: '∞',
};

const FN_CANON: Record<string, FnName> = {
  cbrt: 'root', lg: 'log', arcsin: 'asin', arccos: 'acos', arctan: 'atan',
  arcsec: 'asec', arccsc: 'acsc', arccot: 'acot', arcsinh: 'asinh',
  arccosh: 'acosh', arctanh: 'atanh', choose: 'binom',
};

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;

  while (i < src.length) {
    const c = src[i]!;

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }

    // LaTeX control sequence
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+|.)/.exec(src.slice(i));
      if (!m) throw new ParseError('Stray backslash.', i, src);
      const word = m[1]!;
      const start = i;
      i += m[0].length;
      if (word in CMD_ALIAS) {
        const alias = CMD_ALIAS[word]!;
        if (alias === '') continue;             // spacing and \left/\right vanish
        out.push({ kind: 'op', text: alias, pos: start });
        continue;
      }
      if (word in GREEK) { out.push({ kind: 'name', text: GREEK[word]!, pos: start }); continue; }
      if (word === 'pi') { out.push({ kind: 'name', text: 'π', pos: start }); continue; }
      if (word === 'infty') { out.push({ kind: 'name', text: '∞', pos: start }); continue; }
      if (word === 'circ') { out.push({ kind: 'op', text: '°', pos: start }); continue; }
      if (word === '{' || word === '}') {
        out.push({ kind: word === '{' ? 'lparen' : 'rparen', text: word, pos: start });
        continue;
      }
      if (word === '|') { out.push({ kind: 'bar', text: '|', pos: start }); continue; }
      out.push({ kind: 'cmd', text: word, pos: start });
      continue;
    }

    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^[0-9]*\.?[0-9]+/.exec(src.slice(i))!;
      out.push({ kind: 'num', text: m[0], pos: i });
      i += m[0].length;
      continue;
    }

    if (/[a-zA-Z]/.test(c)) {
      // Longest matching function name wins; otherwise a single letter.
      const rest = src.slice(i);
      let constWord: string | null = null;
      for (const w of Object.keys(CONSTANT_WORDS)) {
        if (rest.startsWith(w) && !/[a-zA-Z]/.test(rest[w.length] ?? '')) {
          if (!constWord || w.length > constWord.length) constWord = w;
        }
      }
      if (constWord) {
        out.push({ kind: 'name', text: CONSTANT_WORDS[constWord]!, pos: i });
        i += constWord.length;
        continue;
      }
      let matched: string | null = null;
      for (const f of FUNCTIONS) {
        if (rest.startsWith(f) && !/[a-zA-Z]/.test(rest[f.length] ?? '')) {
          if (!matched || f.length > matched.length) matched = f;
        }
      }
      if (matched) {
        out.push({ kind: 'cmd', text: matched, pos: i });
        i += matched.length;
      } else {
        out.push({ kind: 'name', text: c, pos: i });
        i++;
      }
      continue;
    }

    switch (c) {
      case '(': out.push({ kind: 'lparen', text: c, pos: i }); i++; continue;
      case ')': out.push({ kind: 'rparen', text: c, pos: i }); i++; continue;
      case '{': out.push({ kind: 'lbrace', text: c, pos: i }); i++; continue;
      case '}': out.push({ kind: 'rbrace', text: c, pos: i }); i++; continue;
      case '[': out.push({ kind: 'lbracket', text: c, pos: i }); i++; continue;
      case ']': out.push({ kind: 'rbracket', text: c, pos: i }); i++; continue;
      case '|': out.push({ kind: 'bar', text: c, pos: i }); i++; continue;
      case ',': out.push({ kind: 'comma', text: c, pos: i }); i++; continue;
      default: break;
    }

    // Multi-character operators before single ones.
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '!=', '=='].includes(two)) {
      out.push({ kind: 'op', text: two === '==' ? '=' : two, pos: i });
      i += 2;
      continue;
    }
    if ('+-*/^=<>_!±∓°~'.includes(c)) {
      out.push({ kind: 'op', text: c, pos: i });
      i++;
      continue;
    }
    if (c === '·' || c === '×') { out.push({ kind: 'op', text: '*', pos: i }); i++; continue; }
    if (c === '÷') { out.push({ kind: 'op', text: '/', pos: i }); i++; continue; }
    if (c === '≤') { out.push({ kind: 'op', text: '<=', pos: i }); i++; continue; }
    if (c === '≥') { out.push({ kind: 'op', text: '>=', pos: i }); i++; continue; }
    if (c === '≠') { out.push({ kind: 'op', text: '!=', pos: i }); i++; continue; }
    if (c === 'π') { out.push({ kind: 'name', text: 'π', pos: i }); i++; continue; }
    if (c === '∞') { out.push({ kind: 'name', text: '∞', pos: i }); i++; continue; }
    if (c === '√') { out.push({ kind: 'cmd', text: 'sqrt', pos: i }); i++; continue; }

    throw new ParseError(`I do not recognise "${c}".`, i, src);
  }

  out.push({ kind: 'eof', text: '', pos: src.length });
  return out;
}

// ---------------------------------------------------------------------- parser

class Parser {
  private p = 0;
  /** Open |...| groups. While one is open, a bar closes rather than opens. */
  private barDepth = 0;

  constructor(
    private readonly toks: Tok[],
    private readonly src: string,
    private readonly opts: ParseOptions,
  ) {}

  private peek(k = 0): Tok { return this.toks[Math.min(this.p + k, this.toks.length - 1)]!; }
  private next(): Tok { return this.toks[this.p++] ?? this.toks[this.toks.length - 1]!; }
  private at(kind: TokKind, text?: string): boolean {
    const t = this.peek();
    return t.kind === kind && (text === undefined || t.text === text);
  }
  private eat(kind: TokKind, text?: string): boolean {
    if (this.at(kind, text)) { this.p++; return true; }
    return false;
  }
  private expect(kind: TokKind, text?: string): Tok {
    if (!this.at(kind, text)) {
      const t = this.peek();
      throw new ParseError(
        `Expected ${text ?? kind}${t.kind === 'eof' ? ' but the input ended' : ` but found "${t.text}"`}.`,
        t.pos, this.src,
      );
    }
    return this.next();
  }

  /** Top level: a relation chain, a comma list, or a bare expression. */
  parseTop(): Expr {
    const items: Expr[] = [this.parseRelation()];
    while (this.eat('comma')) items.push(this.parseRelation());
    if (this.peek().kind !== 'eof') {
      const t = this.peek();
      throw new ParseError(`Unexpected "${t.text}".`, t.pos, this.src);
    }
    return items.length === 1 ? items[0]! : tuple(...items);
  }

  /** Chained relations become an `and`: 1 < x < 5 is two statements. */
  private parseRelation(): Expr {
    let left = this.parseSum();
    const ops: RelOp[] = [];
    const sides: Expr[] = [left];
    while (this.at('op') && ['=', '<', '>', '<=', '>=', '!=', '~'].includes(this.peek().text)) {
      const t = this.next();
      ops.push((t.text === '~' ? 'approx' : t.text) as RelOp);
      sides.push(this.parseSum());
    }
    if (ops.length === 0) return left;
    if (ops.length === 1) return rel(ops[0]!, sides[0]!, sides[1]!);
    const parts = ops.map((op, i) => rel(op, sides[i]!, sides[i + 1]!));
    return { k: 'and', args: parts };
  }

  private parseSum(): Expr {
    let left = this.parseProduct();
    for (;;) {
      if (this.eat('op', '+')) left = add(left, this.parseProduct());
      else if (this.eat('op', '-')) left = sub(left, this.parseProduct());
      else if (this.at('op', '±')) { this.next(); left = add(left, mkFn('pm' as FnName, this.parseProduct())); }
      else return left;
    }
  }

  private parseProduct(): Expr {
    let left = this.parseUnary();
    for (;;) {
      if (this.eat('op', '*')) { left = mul(left, this.parseUnary()); continue; }
      if (this.eat('op', '/')) { left = div(left, this.parseUnary()); continue; }
      // Implicit multiplication: 2x, 3(x+1), x y, 2\sqrt3
      if (this.startsAtom()) { left = mul(left, this.parseUnary()); continue; }
      return left;
    }
  }

  /** Can the current token begin an atom? Drives implicit multiplication. */
  private startsAtom(): boolean {
    const t = this.peek();
    switch (t.kind) {
      case 'num': case 'name': case 'lparen': case 'lbrace': case 'cmd':
        return true;
      case 'bar':
        // Inside |...| the next bar is the closing one, not a new absolute value.
        return this.barDepth === 0;
      default:
        return false;
    }
  }

  private parseUnary(): Expr {
    if (this.eat('op', '-')) return neg(this.parseUnary());
    if (this.eat('op', '+')) return this.parseUnary();
    return this.parsePower();
  }

  /** Right-associative: 2^3^2 is 2^(3^2). Postfix ! and ° bind tightest. */
  private parsePower(): Expr {
    let base = this.parsePostfix();
    if (this.eat('op', '^')) {
      const exponent = this.parseUnary();   // unary so 2^-1 works
      return pow(base, exponent);
    }
    return base;
  }

  private parsePostfix(): Expr {
    let e = this.parseAtom();
    for (;;) {
      if (this.at('op', '!') ) { this.next(); e = mkFn('factorial', e); continue; }
      if (this.at('op', '°')) { this.next(); e = mul(e, div(cst('pi'), int(180))); continue; }
      if (this.at('op', '_')) {
        this.next();
        const idx = this.parseGroupText();
        if (e.k === 'sym') e = sym(e.name, idx);
        continue;
      }
      return e;
    }
  }

  /** A braced group read as literal text, for subscripts. */
  private parseGroupText(): string {
    if (this.eat('lbrace') || this.eat('lparen')) {
      let out = '';
      while (!this.at('rbrace') && !this.at('rparen') && !this.at('eof')) out += this.next().text;
      this.next();
      return out;
    }
    return this.next().text;
  }

  /** A brace group or a single token, which is how LaTeX arguments work. */
  private parseGroup(): Expr {
    if (this.at('lbrace')) {
      this.next();
      const e = this.parseSum();
      this.expect('rbrace');
      return e;
    }
    if (this.at('lparen')) {
      this.next();
      const e = this.parseSum();
      this.expect('rparen');
      return e;
    }
    // A bare token: \sqrt2, \frac12
    return this.parsePostfix();
  }

  private parseAtom(): Expr {
    const t = this.peek();

    switch (t.kind) {
      case 'num': {
        this.next();
        const v = R.parseRat(t.text);
        if (v === null) throw new ParseError(`"${t.text}" is not a number I can read.`, t.pos, this.src);
        return num(v);
      }

      case 'name': {
        this.next();
        return this.nameToExpr(t.text);
      }

      case 'lparen': {
        this.next();
        const e = this.parseSum();
        this.expect('rparen');
        return e;
      }

      case 'lbrace': {
        this.next();
        // A brace group at atom position is a set literal in answers: {2, -3}
        const items: Expr[] = [];
        if (!this.at('rbrace')) {
          items.push(this.parseSum());
          while (this.eat('comma')) items.push(this.parseSum());
        }
        this.expect('rbrace');
        return items.length === 1 ? items[0]! : { k: 'set', args: items };
      }

      case 'bar': {
        this.next();
        this.barDepth++;
        try {
          const inner = this.parseSum();
          this.expect('bar');
          return mkFn('abs', inner);
        } finally {
          this.barDepth--;
        }
      }

      case 'cmd':
        return this.parseCommand();

      default:
        throw new ParseError(
          t.kind === 'eof' ? 'The expression is incomplete.' : `Unexpected "${t.text}".`,
          t.pos, this.src,
        );
    }
  }

  private nameToExpr(name: string): Expr {
    if (name === 'π') return cst('pi');
    if (name === '∞') return cst('inf');
    const forced = this.opts.variables?.includes(name);
    if (!forced) {
      if (name === 'e' && (this.opts.eulerE ?? true)) return cst('e');
      if (name === 'i' && (this.opts.imaginaryI ?? true)) return cst('i');
    }
    return sym(name);
  }

  private parseCommand(): Expr {
    const t = this.next();
    const name = t.text;

    if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
      const n = this.parseGroup();
      const d = this.parseGroup();
      return div(n, d);
    }

    if (name === 'sqrt') {
      // \sqrt[3]{x} carries the index in brackets.
      if (this.eat('lbracket')) {
        const idx = this.parseSum();
        this.expect('rbracket');
        return mkFn('root', this.parseGroup(), idx);
      }
      return mkFn('sqrt', this.parseGroup());
    }

    if (name === 'cbrt') return mkFn('root', this.parseGroup(), int(3));

    if (name === 'binom' || name === 'choose' || name === 'dbinom') {
      return mkFn('binom', this.parseGroup(), this.parseGroup());
    }

    if (name === 'operatorname' || name === 'text' || name === 'mathrm') {
      const inner = this.parseGroupText();
      if (FUNCTIONS.has(inner)) return this.applyFunction(inner, t.pos);
      return sym(inner);
    }

    if (FUNCTIONS.has(name)) return this.applyFunction(name, t.pos);

    throw new ParseError(`I do not know the command "\\${name}".`, t.pos, this.src);
  }

  /**
   * Function application, including the "sin^2 x" convention where the
   * exponent lands on the result rather than on the argument.
   */
  private applyFunction(rawName: string, pos: number): Expr {
    const canonical = (FN_CANON[rawName] ?? rawName) as FnName;

    let exponent: Expr | null = null;
    if (this.at('op', '^')) {
      this.next();
      exponent = this.parseGroup();
    }

    const multiArg = ['log', 'root', 'min', 'max', 'gcd', 'lcm', 'mod', 'binom', 'atan2'];
    let args: Expr[];

    if (this.at('lparen')) {
      this.next();
      args = [this.parseSum()];
      while (this.eat('comma')) args.push(this.parseSum());
      this.expect('rparen');
    } else if (this.at('lbrace')) {
      args = [this.parseGroup()];
    } else if (rawName === 'log' || rawName === 'lg') {
      // log_2 x  →  log base 2 of x
      if (this.eat('op', '_')) {
        const base = this.parseGroup();
        args = [base, this.parseTightArgument()];
      } else {
        args = [this.parseTightArgument()];
      }
    } else {
      args = [this.parseTightArgument()];
    }

    if (rawName === 'cbrt') args = [args[0]!, int(3)];
    if (rawName === 'lg' && args.length === 1) args = [int(2), args[0]!];

    if (!multiArg.includes(canonical) && args.length > 1) {
      throw new ParseError(`${rawName} takes one argument.`, pos, this.src);
    }

    const call = mkFn(canonical, ...args);
    // sin^2 x means (sin x)^2, but sin^-1 x means arcsin x.
    if (exponent) {
      const expValue = numericValueOf(exponent);
      if (expValue !== null && expValue.n === -1n && expValue.d === 1n) {
        const inverse: Record<string, FnName> = {
          sin: 'asin', cos: 'acos', tan: 'atan', sec: 'asec', csc: 'acsc', cot: 'acot',
          sinh: 'asinh', cosh: 'acosh', tanh: 'atanh',
        };
        const inv = inverse[canonical];
        if (inv) return mkFn(inv, ...args);
      }
      return pow(call, exponent);
    }
    return call;
  }

  /**
   * The argument of a function written without parentheses binds tightly:
   * "sin 2x" is sin(2x), but "sin x + 1" is sin(x) + 1.
   */
  private parseTightArgument(): Expr {
    let e = this.parseUnary();
    // Absorb implicit multiplication so "sin 2x" keeps the x.
    while (this.at('name') || this.at('num')) {
      e = mul(e, this.parseUnary());
    }
    return e;
  }
}

/**
 * Constant-fold just enough to recognise a numeric literal that arrived as a
 * tree: unary minus builds mul(-1, x), so "-1" is not a `num` node yet.
 */
export function numericValueOf(e: Expr): R.Rat | null {
  switch (e.k) {
    case 'num': return e.v;
    case 'mul': {
      let acc = R.ONE;
      for (const a of e.args) {
        const v = numericValueOf(a);
        if (v === null) return null;
        acc = R.mul(acc, v);
      }
      return acc;
    }
    case 'add': {
      let acc = R.ZERO;
      for (const a of e.args) {
        const v = numericValueOf(a);
        if (v === null) return null;
        acc = R.add(acc, v);
      }
      return acc;
    }
    default: return null;
  }
}

// -------------------------------------------------------------------- entry points

/** Parse math text. Throws ParseError with a position on bad input. */
export function parse(src: string, opts: ParseOptions = {}): Expr {
  const trimmed = src.trim();
  if (trimmed === '') throw new ParseError('Nothing to read.', 0, src);
  const p = new Parser(tokenize(trimmed), trimmed, opts);
  const e = p.parseTop();
  return opts.degrees ? toDegrees(e) : e;
}

/** Parse, or return null instead of throwing. For live-as-you-type feedback. */
export function tryParse(src: string, opts: ParseOptions = {}): { expr: Expr } | { error: ParseError } {
  try {
    return { expr: parse(src, opts) };
  } catch (err) {
    if (err instanceof ParseError) return { error: err };
    return { error: new ParseError(String((err as Error).message ?? err), 0, src) };
  }
}

/** Reinterpret bare trig arguments as degrees. */
function toDegrees(e: Expr): Expr {
  const convert = (n: Expr): Expr => {
    if (n.k === 'fn' && ['sin', 'cos', 'tan', 'sec', 'csc', 'cot'].includes(n.name)) {
      return mkFn(n.name, mul(convert(n.args[0]!), div(cst('pi'), int(180))));
    }
    switch (n.k) {
      case 'add': return add(...n.args.map(convert));
      case 'mul': return mul(...n.args.map(convert));
      case 'pow': return pow(convert(n.base), convert(n.exp));
      case 'fn': return mkFn(n.name, ...n.args.map(convert));
      case 'rel': return rel(n.op, ...n.args.map(convert));
      default: return n;
    }
  };
  return convert(e);
}

/** Split a comma list into its parts, for solution-set answers. */
export function parseList(src: string, opts: ParseOptions = {}): Expr[] {
  const e = parse(src, opts);
  if (e.k === 'tuple' || e.k === 'set') return [...e.args];
  return [e];
}

/**
 * Expand the plus-or-minus marker into the separate answers it stands for.
 * "(-3 ± sqrt(5))/2" is how a student writes the pair of quadratic roots, and
 * grading it as one expression would reject a completely correct answer.
 * Each ± doubles the result, so n markers give 2^n branches.
 */
export function expandPlusMinus(e: Expr): Expr[] {
  const hasPm = (n: Expr): boolean => {
    if (n.k === 'fn' && n.name === 'pm') return true;
    switch (n.k) {
      case 'add': case 'mul': case 'fn': case 'rel': case 'and': case 'or': case 'tuple': case 'set':
        return n.args.some(hasPm);
      case 'pow': return hasPm(n.base) || hasPm(n.exp);
      default: return false;
    }
  };
  if (!hasPm(e)) return [e];

  const branch = (n: Expr, takePlus: boolean): Expr => {
    if (n.k === 'fn' && n.name === 'pm') {
      const inner = branch(n.args[0]!, takePlus);
      return takePlus ? inner : neg(inner);
    }
    switch (n.k) {
      case 'add': return add(...n.args.map((a) => branch(a, takePlus)));
      case 'mul': return mul(...n.args.map((a) => branch(a, takePlus)));
      case 'pow': return pow(branch(n.base, takePlus), branch(n.exp, takePlus));
      case 'fn': return mkFn(n.name, ...n.args.map((a) => branch(a, takePlus)));
      case 'rel': return rel(n.op, ...n.args.map((a) => branch(a, takePlus)));
      case 'tuple': return tuple(...n.args.map((a) => branch(a, takePlus)));
      case 'set': return { k: 'set', args: n.args.map((a) => branch(a, takePlus)) };
      default: return n;
    }
  };

  return [branch(e, true), branch(e, false)];
}

/**
 * Parse an answer the way a student writes it: possibly a comma list, possibly
 * containing ±, possibly a set. Returns every value the input denotes.
 */
export function parseAnswer(src: string, opts: ParseOptions = {}): Expr[] {
  const parsed = parse(src, opts);
  const items = parsed.k === 'tuple' || parsed.k === 'set' ? [...parsed.args] : [parsed];
  return items.flatMap(expandPlusMinus);
}
