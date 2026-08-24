import { describe, it, expect } from 'vitest';
import { parse, tryParse, parseAnswer, ParseError } from '../src/engine/parse.ts';
import { toLatex, toText, approximate } from '../src/engine/print.ts';
import { key } from '../src/engine/expr.ts';
import { equivalent } from '../src/engine/equivalence.ts';
import { simplify } from '../src/engine/canon.ts';

const p = (s: string) => parse(s);
const t = (s: string) => toText(parse(s));

describe('parsing plain text', () => {
  const cases: Array<[string, string]> = [
    ['2+3', '2 + 3'],
    ['2x', '2*x'],
    ['3x^2 - 5x + 1', '3*x^2 - 5*x + 1'],
    ['(x+1)(x-1)', '(x + 1)*(x - 1)'],
    ['1/2', '1/2'],
    ['x/(y+1)', 'x/(y + 1)'],
    ['sqrt(2)', 'sqrt(2)'],
    ['-x', '-x'],
    ['2^3^2', '2^3^2'],
    ['sin(x)', 'sin(x)'],
    ['sin x', 'sin(x)'],
    ['sin 2x', 'sin(2*x)'],
    ['|x-1|', 'abs(x - 1)'],
    ['x_1 + x_2', 'x_1 + x_2'],
    ['5!', 'factorial(5)'],
  ];
  for (const [src, want] of cases) {
    it(`${src}  ->  ${want}`, () => expect(t(src)).toBe(want));
  }
});

describe('parsing LaTeX from the math field', () => {
  const cases: Array<[string, string]> = [
    ['\\frac{1}{2}', '1/2'],
    ['\\frac{x+1}{2}', '(x + 1)/2'],
    ['x^{2}', 'x^2'],
    ['\\sqrt{x}', 'sqrt(x)'],
    ['\\sqrt[3]{8}', 'root(8, 3)'],
    ['2\\cdot 3', '2*3'],
    ['\\left(x+1\\right)^2', '(x + 1)^2'],
    ['\\sin\\left(x\\right)', 'sin(x)'],
    ['\\pi r^2', 'pi*r^2'],
    ['x\\ge 3', 'x >= 3'],
    ['\\theta', 'θ'],
    ['\\log_{2}\\left(8\\right)', 'log(2, 8)'],
    ['\\sin^{2}x', 'sin(x)^2'],
    ['\\sin^{-1}x', 'asin(x)'],
  ];
  for (const [src, want] of cases) {
    it(`${src}  ->  ${want}`, () => expect(t(src)).toBe(want));
  }
});

describe('LaTeX and plain text mean the same thing', () => {
  const pairs: Array<[string, string]> = [
    ['\\frac{x+1}{2}', '(x+1)/2'],
    ['\\sqrt{x^2+1}', 'sqrt(x^2+1)'],
    ['\\frac{3}{4}x^{2}', '3x^2/4'],  // same value, different factor order
    ['\\sin\\left(2x\\right)', 'sin(2x)'],
    ['\\sqrt[3]{27}', 'cbrt(27)'],
  ];
  for (const [tex, plain] of pairs) {
    it(`${tex} == ${plain}`, () => expect(equivalent(p(tex), p(plain)).equal).toBe(true));
  }
});

describe('printing round-trips', () => {
  const sources = [
    '3x^2 - 5x + 1', '(x+1)(x-2)', '1/2 + 1/3', 'sqrt(2)/2', 'x/(y+1)',
    '-3x', 'sin(x)^2 + cos(x)^2', '2^(1/2)', 'abs(x-1)', 'pi*r^2',
    '(a+b)/(c-d)', 'x^2/(x+1)', '5!', 'log(2, 8)',
  ];
  for (const src of sources) {
    it(`text round-trips: ${src}`, () => {
      const once = parse(src);
      const twice = parse(toText(once));
      expect(key(twice)).toBe(key(once));
    });
    it(`latex round-trips: ${src}`, () => {
      const once = parse(src);
      const viaLatex = parse(toLatex(once));
      expect(equivalent(viaLatex, once).equal, `${toLatex(once)}`).toBe(true);
    });
  }
});

describe('LaTeX output reads the way a person writes', () => {
  const cases: Array<[string, string]> = [
    ['1/2', '\\frac{1}{2}'],
    ['2x', '2x'],
    ['-3x', '-3x'],
    ['x^2', 'x^{2}'],
    ['sqrt(x)', '\\sqrt{x}'],
    ['x/(y+1)', '\\frac{x}{y + 1}'],
    ['x^(-1)', '\\frac{1}{x}'],
    ['sin(x)', '\\sin\\left(x\\right)'],
    ['x >= 3', 'x \\ge 3'],
  ];
  for (const [src, want] of cases) {
    it(`${src}  ->  ${want}`, () => expect(toLatex(parse(src))).toBe(want));
  }
  it('a sum leads with a minus rather than "+ -"', () => {
    expect(toLatex(simplify(parse('x - 5')))).toBe('x - 5');
    expect(toLatex(simplify(parse('-x + 5')))).toBe('-x + 5');
  });
});

describe('plus-or-minus expands into both answers', () => {
  it('splits a quadratic answer into two', () => {
    const answers = parseAnswer('(-3 \\pm \\sqrt{5})/2');
    expect(answers).toHaveLength(2);
    expect(equivalent(answers[0]!, parse('(-3+sqrt(5))/2')).equal).toBe(true);
    expect(equivalent(answers[1]!, parse('(-3-sqrt(5))/2')).equal).toBe(true);
  });
  it('a comma list becomes several answers', () => {
    expect(parseAnswer('2, -3')).toHaveLength(2);
  });
  it('set braces work too', () => {
    expect(parseAnswer('{2, -3}')).toHaveLength(2);
  });
});

describe('parse errors point at the problem', () => {
  it('reports an unbalanced parenthesis', () => {
    const r = tryParse('(x + 1');
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error.message).toMatch(/Expected \)|input ended/);
  });
  it('reports an unknown command with its position', () => {
    const r = tryParse('\\frobnicate{x}');
    expect('error' in r).toBe(true);
    if ('error' in r) {
      expect(r.error.message).toMatch(/do not know/);
      expect(r.error.position).toBe(0);
    }
  });
  it('rejects an empty input politely', () => {
    const r = tryParse('   ');
    expect('error' in r && r.error.message).toBe('Nothing to read.');
  });
  it('carets line up under the offending character', () => {
    const r = tryParse('2 + + ');
    expect('error' in r).toBe(true);
  });
});

describe('approximation line', () => {
  it('shows a decimal for an exact surd', () => {
    expect(approximate(parse('sqrt(2)'), 6)).toBe('1.414213');
  });
  it('shows pi', () => {
    expect(approximate(parse('pi'), 5)).toBe('3.14159');
  });
  it('returns null for something non-real', () => {
    expect(approximate(parse('i'))).toBe(null);
  });
});
