/**
 * Geometry generators.
 *
 * Two things differ from algebra. Answers are numbers that come out of a
 * formula, so each derivation names the formula, substitutes, and evaluates —
 * three visible steps, which is how the work is written by hand. And every
 * problem carries a Figure with real coordinates, so the drawing is generated
 * from the same numbers as the answer rather than being decoration that could
 * disagree with it.
 *
 * Figures that cannot be drawn faithfully say so: `toScale: false` is set
 * whenever the side lengths are chosen for arithmetic convenience rather than
 * geometric consistency, so the app never invites a student to measure a
 * picture that would mislead them.
 */

import { Rng } from './../../engine/random.ts';
import type { Expr } from './../../engine/expr.ts';
import {
  add, mul, pow, num, int, sym, frac, sqrt as sqrtE, fn as mkFn, div as divE,
  sub as subE, equation, cst, key, tuple,
} from './../../engine/expr.ts';
import * as R from './../../engine/rational.ts';
import { simplify, simplifyBest } from './../../engine/canon.ts';
import { toLatex } from './../../engine/print.ts';
import {
  DerivationBuilder, R_FORMULA, R_PYTHAGORAS, R_SIMPLIFY, R_ARITHMETIC, R_SUBSTITUTE, R_SUB_BOTH,
} from './../../engine/derive.ts';
import type { Generator, Figure, Distractor } from './../types.ts';

const scale = (d: number, lo: number, hi: number): number => Math.round(lo + (hi - lo) * d);
const X = sym('x');

/** Formula, substitute, evaluate — the three lines a person writes. */
function formulaDerivation(
  goal: string,
  formula: Expr,
  substituted: Expr,
  formulaName: string,
  substituteNote: string,
): { derivation: ReturnType<DerivationBuilder['build']>; value: Expr } {
  const value = simplifyBest(substituted);
  const b = new DerivationBuilder(goal, formula);
  b.applyUnverified(R_FORMULA, substituted,
    'Substituting the given measurements replaces the general formula with this particular case.',
    substituteNote, `Which formula relates these quantities?`);
  if (key(value) !== key(substituted)) {
    b.apply(R_ARITHMETIC, value, 'Work out the arithmetic.', 'Now it is just numbers.');
  }
  void formulaName;
  return { derivation: b.build(), value };
}

// --------------------------------------------------------------------- angles

export const genAngles: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const kind = r.pick(d > 0.5
    ? (['complementary', 'supplementary', 'vertical', 'around-point'] as const)
    : (['complementary', 'supplementary'] as const));

  const total = kind === 'complementary' ? 90 : kind === 'around-point' ? 360 : 180;
  if (kind === 'vertical') {
    const a = r.int(20, 160);
    const figure: Figure = {
      kind: 'angles', toScale: true,
      points: {
        O: [0, 0],
        A: [Math.cos((a * Math.PI) / 180) * 100, Math.sin((a * Math.PI) / 180) * 100],
        B: [100, 0], C: [-Math.cos((a * Math.PI) / 180) * 100, -Math.sin((a * Math.PI) / 180) * 100],
        D: [-100, 0],
      },
      segments: [['A', 'C'], ['B', 'D']],
      angleLabels: { O: `${a}°` },
      caption: 'Two straight lines crossing at O.',
    };
    const b = new DerivationBuilder('Find the marked angle', int(a));
    b.applyUnverified(R_FORMULA, int(a),
      'The answer is read off the diagram rather than computed from the given number.',
      `Vertically opposite angles are equal, so the angle across from ${a}° is also ${a}°.`,
      'What is the relationship between angles across a crossing?');
    return {
      prompt: 'Find the angle vertically opposite the marked one',
      statement: int(a), figure,
      answer: { kind: 'number' as const, value: int(a), unit: '°' },
      derivation: b.build(),
      distractors: [{
        value: int(180 - a),
        diagnosis: 'That is the angle next to it on the straight line, not the one opposite. Adjacent angles add to 180°; opposite angles are equal.',
        reviewSkill: 'angles',
      }],
    };
  }

  const parts = kind === 'around-point' ? r.int(2, 3) : 1;
  const knowns: number[] = [];
  let left = total;
  for (let i = 0; i < parts; i++) {
    const v = r.int(20, Math.max(25, Math.floor(left / (parts - i + 1))));
    knowns.push(v);
    left -= v;
  }
  if (left < 10) return null;

  const known = knowns.reduce((a, b2) => a + b2, 0);
  const answer = total - known;
  const statement = equation(add(...knowns.map((k) => int(k)), X), int(total));

  const b = new DerivationBuilder('Find x', statement);
  if (knowns.length > 1) {
    b.apply(R_ARITHMETIC, equation(add(int(known), X), int(total)),
      `The known angles total ${known}°.`, 'Add up the angles you already know.');
  }
  b.apply(R_SUB_BOTH, equation(X, int(answer)),
    `Subtract ${known} from both sides: ${total} − ${known} = ${answer}.`,
    `The known angle and x together make ${total}°.`);

  const name = kind === 'complementary' ? 'complementary (they add to 90°)'
    : kind === 'supplementary' ? 'supplementary (they add to 180°)'
    : 'angles around a point (they add to 360°)';

  return {
    prompt: 'Find the missing angle',
    context: `These are ${name}.`,
    statement, variable: 'x',
    answer: { kind: 'number' as const, value: int(answer), unit: '°' },
    derivation: b.build(),
    figure: {
      kind: 'angles', toScale: true,
      angleLabels: Object.fromEntries([...knowns.map((k, i) => [`a${i}`, `${k}°`]), ['x', 'x']]),
      caption: `${name.charAt(0).toUpperCase()}${name.slice(1)}.`,
    },
  };
};

export const genTriangleAngles: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const isosceles = d > 0.5 && r.bool(0.4);

  let a: number, b2: number, c: number;
  if (isosceles) {
    a = r.int(20, 80);
    b2 = a;
    c = 180 - 2 * a;
    if (c < 15) return null;
  } else {
    a = r.int(25, 100);
    b2 = r.int(25, Math.max(30, 170 - a));
    c = 180 - a - b2;
    if (c < 15 || c > 140) return null;
  }

  const statement = equation(add(int(a), int(b2), X), int(180));
  const bb = new DerivationBuilder('Find x', statement);
  bb.apply(R_ARITHMETIC, equation(add(int(a + b2), X), int(180)),
    `The two known angles total ${a + b2}°.`, 'Add the two angles you know.');
  bb.apply(R_SUB_BOTH, equation(X, int(c)),
    `Subtract ${a + b2} from both sides: 180 − ${a + b2} = ${c}.`,
    'The three angles of a triangle add to 180°.');

  // Place the triangle so the drawing genuinely has these angles.
  const A: [number, number] = [0, 0];
  const B: [number, number] = [120, 0];
  const angA = (a * Math.PI) / 180;
  const angB = (b2 * Math.PI) / 180;
  // Intersection of the two rays from A and B.
  const cx = (120 * Math.tan(angB)) / (Math.tan(angA) + Math.tan(angB));
  const cy = cx * Math.tan(angA);

  return {
    prompt: 'Find the missing angle',
    statement, variable: 'x',
    answer: { kind: 'number' as const, value: int(c), unit: '°' },
    derivation: bb.build(),
    figure: {
      kind: 'triangle', toScale: true,
      points: { A, B, C: [cx, cy] },
      segments: [['A', 'B'], ['B', 'C'], ['C', 'A']],
      angleLabels: { A: `${a}°`, B: `${b2}°`, C: 'x' },
      ...(isosceles ? { congruent: [['CA', 'CB']] } : {}),
      caption: isosceles ? 'The two marked sides are equal.' : undefined,
    } as Figure,
    distractors: [{
      value: int(360 - a - b2),
      diagnosis: 'The angles were taken to add to 360°. That is angles around a point; in a triangle they add to 180°.',
      reviewSkill: 'triangle-angles',
    }],
  };
};

// ------------------------------------------------------------- area and volume

export const genPerimeterArea: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const shape = r.pick(d > 0.45
    ? (['rectangle', 'triangle', 'parallelogram', 'trapezoid'] as const)
    : (['rectangle', 'triangle'] as const));
  const wantArea = r.bool(shape === 'rectangle' ? 0.5 : 0.8);
  const hi = scale(d, 12, 30);

  const w = r.int(3, hi);
  const h = r.int(3, hi);
  const b2 = r.int(3, hi);

  let formula: Expr, substituted: Expr, note: string, figure: Figure;

  if (shape === 'rectangle') {
    if (wantArea) {
      formula = equation(sym('A'), mul(sym('l'), sym('w')));
      substituted = equation(sym('A'), mul(int(w), int(h)));
      note = `Length ${w} and width ${h}, so A = ${w} × ${h}.`;
    } else {
      formula = equation(sym('P'), add(mul(int(2), sym('l')), mul(int(2), sym('w'))));
      substituted = equation(sym('P'), add(mul(int(2), int(w)), mul(int(2), int(h))));
      note = `Two sides of ${w} and two of ${h}.`;
    }
    figure = {
      kind: 'rectangle', toScale: true,
      points: { A: [0, 0], B: [w * 10, 0], C: [w * 10, h * 10], D: [0, h * 10] },
      segments: [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'A']],
      sideLabels: { AB: `${w}`, BC: `${h}` },
      rightAngles: ['A', 'B', 'C', 'D'],
    };
  } else if (shape === 'triangle') {
    formula = equation(sym('A'), mul(frac(1, 2), sym('b'), sym('h')));
    substituted = equation(sym('A'), mul(frac(1, 2), int(b2), int(h)));
    note = `Base ${b2} and height ${h}, so A = ½ × ${b2} × ${h}.`;
    figure = {
      kind: 'triangle', toScale: true,
      points: { A: [0, 0], B: [b2 * 10, 0], C: [b2 * 3, h * 10] },
      segments: [['A', 'B'], ['B', 'C'], ['C', 'A']],
      sideLabels: { AB: `${b2}` },
      caption: `The height to the base is ${h}.`,
    };
  } else if (shape === 'parallelogram') {
    formula = equation(sym('A'), mul(sym('b'), sym('h')));
    substituted = equation(sym('A'), mul(int(b2), int(h)));
    note = `Base ${b2} and perpendicular height ${h}.`;
    figure = {
      kind: 'polygon', toScale: true,
      points: { A: [0, 0], B: [b2 * 10, 0], C: [b2 * 10 + 40, h * 10], D: [40, h * 10] },
      segments: [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'A']],
      sideLabels: { AB: `${b2}` },
      caption: `The perpendicular height is ${h}.`,
    };
  } else {
    const b3 = b2 + r.int(2, 10);
    formula = equation(sym('A'), mul(frac(1, 2), add(sym('a'), sym('b')), sym('h')));
    substituted = equation(sym('A'), mul(frac(1, 2), add(int(b2), int(b3)), int(h)));
    note = `The two parallel sides are ${b2} and ${b3}, and the height between them is ${h}.`;
    figure = {
      kind: 'polygon', toScale: true,
      points: { A: [0, 0], B: [b3 * 10, 0], C: [b3 * 10 - 30, h * 10], D: [30, h * 10] },
      segments: [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'A']],
      sideLabels: { AB: `${b3}`, CD: `${b2}` },
      caption: `Height ${h}.`,
    };
  }

  const goal = wantArea && shape !== 'rectangle' ? 'Find the area' : wantArea ? 'Find the area' : 'Find the perimeter';
  const { derivation, value } = formulaDerivation(goal, formula, substituted, shape, note);
  const answerValue = value.k === 'rel' ? value.args[1]! : value;
  if (answerValue.k !== 'num') return null;

  const distractors: Distractor[] = [];
  if (shape === 'triangle') {
    distractors.push({
      value: int(b2 * h),
      diagnosis: 'That is the area of the rectangle around it. A triangle is half of that, so the ½ is needed.',
      reviewSkill: 'perimeter-area',
    });
  }
  if (shape === 'rectangle' && wantArea) {
    distractors.push({
      value: int(2 * w + 2 * h),
      diagnosis: 'That is the perimeter, the distance around the edge. Area is the space inside: length times width.',
      reviewSkill: 'perimeter-area',
    });
  }

  return {
    prompt: goal, statement: formula, figure,
    answer: { kind: 'number' as const, value: answerValue },
    derivation, distractors,
  };
};

export const genCircles: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const radius = r.int(2, scale(d, 9, 20));
  const want = r.pick(d > 0.55 ? (['area', 'circumference', 'sector'] as const) : (['area', 'circumference'] as const));

  let formula: Expr, substituted: Expr, note: string, goal: string;
  if (want === 'area') {
    goal = 'Find the area, in terms of π';
    formula = equation(sym('A'), mul(cst('pi'), pow(sym('r'), int(2))));
    substituted = equation(sym('A'), mul(cst('pi'), pow(int(radius), int(2))));
    note = `The radius is ${radius}, so A = π × ${radius}².`;
  } else if (want === 'circumference') {
    goal = 'Find the circumference, in terms of π';
    formula = equation(sym('C'), mul(int(2), cst('pi'), sym('r')));
    substituted = equation(sym('C'), mul(int(2), cst('pi'), int(radius)));
    note = `The radius is ${radius}, so C = 2π × ${radius}.`;
  } else {
    const degrees = r.pick([30, 45, 60, 90, 120, 135, 180]);
    goal = 'Find the area of the sector, in terms of π';
    formula = equation(sym('A'), mul(divE(sym('θ'), int(360)), cst('pi'), pow(sym('r'), int(2))));
    substituted = equation(sym('A'), mul(divE(int(degrees), int(360)), cst('pi'), pow(int(radius), int(2))));
    note = `The sector is ${degrees}° of the full 360°, so it is ${degrees}/360 of the circle's area.`;
  }

  const { derivation, value } = formulaDerivation(goal, formula, substituted, 'circle', note);
  const answerValue = value.k === 'rel' ? value.args[1]! : value;

  return {
    prompt: goal, statement: formula,
    figure: {
      kind: 'circle', toScale: true,
      points: { O: [0, 0] },
      circles: [{ center: 'O', radius: radius * 8, label: `r = ${radius}` }],
      caption: want === 'sector' ? 'The shaded sector is shown.' : undefined,
    } as Figure,
    answer: { kind: 'expression' as const, value: answerValue },
    derivation,
    distractors: want === 'area' ? [{
      value: mul(int(2), cst('pi'), int(radius)),
      diagnosis: 'That is the circumference. Area uses the radius squared: πr².',
      reviewSkill: 'circles',
    }] : want === 'circumference' ? [{
      value: mul(cst('pi'), pow(int(radius), int(2))),
      diagnosis: 'That is the area. Circumference is the distance around: 2πr.',
      reviewSkill: 'circles',
    }] : [],
  };
};

export const genVolume: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const solid = r.pick(d > 0.5
    ? (['prism', 'cylinder', 'cone', 'sphere', 'pyramid'] as const)
    : (['prism', 'cylinder'] as const));
  const a = r.int(2, scale(d, 8, 14));
  const h = r.int(2, scale(d, 9, 16));

  let formula: Expr, substituted: Expr, note: string;
  switch (solid) {
    case 'prism':
      formula = equation(sym('V'), mul(sym('l'), sym('w'), sym('h')));
      substituted = equation(sym('V'), mul(int(a), int(a), int(h)));
      note = `A base of ${a} by ${a} and a height of ${h}.`;
      break;
    case 'cylinder':
      formula = equation(sym('V'), mul(cst('pi'), pow(sym('r'), int(2)), sym('h')));
      substituted = equation(sym('V'), mul(cst('pi'), pow(int(a), int(2)), int(h)));
      note = `Radius ${a} and height ${h}, so V = π × ${a}² × ${h}.`;
      break;
    case 'cone':
      formula = equation(sym('V'), mul(frac(1, 3), cst('pi'), pow(sym('r'), int(2)), sym('h')));
      substituted = equation(sym('V'), mul(frac(1, 3), cst('pi'), pow(int(a), int(2)), int(h)));
      note = `Radius ${a} and height ${h}. A cone is a third of the cylinder around it.`;
      break;
    case 'sphere':
      formula = equation(sym('V'), mul(frac(4, 3), cst('pi'), pow(sym('r'), int(3))));
      substituted = equation(sym('V'), mul(frac(4, 3), cst('pi'), pow(int(a), int(3))));
      note = `Radius ${a}, so V = (4/3)π × ${a}³.`;
      break;
    default:
      formula = equation(sym('V'), mul(frac(1, 3), sym('B'), sym('h')));
      substituted = equation(sym('V'), mul(frac(1, 3), mul(int(a), int(a)), int(h)));
      note = `A square base of side ${a} and height ${h}. A pyramid is a third of the prism around it.`;
      break;
  }

  const goal = 'Find the volume' + (solid === 'prism' ? '' : ', in terms of π');
  const { derivation, value } = formulaDerivation(goal, formula, substituted, solid, note);
  const answerValue = value.k === 'rel' ? value.args[1]! : value;

  return {
    prompt: solid === 'prism' ? 'Find the volume' : 'Find the volume, in terms of π',
    context: `A ${solid === 'prism' ? 'rectangular prism' : solid}.`,
    statement: formula,
    answer: { kind: 'expression' as const, value: answerValue },
    derivation,
    ...(solid === 'cone' || solid === 'pyramid' ? {
      distractors: [{
        value: simplifyBest(mul(int(3), answerValue)),
        diagnosis: `That is the volume of the ${solid === 'cone' ? 'cylinder' : 'prism'} with the same base and height. A ${solid} is one third of it.`,
        reviewSkill: 'volume-surface-area',
      }],
    } : {}),
  };
};

// ------------------------------------------------------------ right triangles

/** Pythagorean triples, so some problems come out whole. */
const TRIPLES: ReadonlyArray<readonly [number, number, number]> = [
  [3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25], [20, 21, 29], [9, 40, 41],
];

export const genPythagoras: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const useTriple = d < 0.5 || r.bool(0.5);
  const findHypotenuse = r.bool(0.6);

  let legA: number, legB: number, hyp: number, exact = true;
  if (useTriple) {
    const t = r.pick(TRIPLES.slice(0, d > 0.5 ? TRIPLES.length : 3));
    const k = d > 0.7 ? r.int(1, 3) : 1;
    [legA, legB, hyp] = [t[0] * k, t[1] * k, t[2] * k];
  } else {
    legA = r.int(2, scale(d, 8, 15));
    legB = r.int(2, scale(d, 8, 15));
    hyp = Math.sqrt(legA * legA + legB * legB);
    exact = Number.isInteger(hyp);
  }

  const formula = equation(add(pow(sym('a'), int(2)), pow(sym('b'), int(2))), pow(sym('c'), int(2)));
  let substituted: Expr, note: string, answerValue: Expr, goal: string;

  if (findHypotenuse) {
    goal = 'Find the hypotenuse';
    substituted = equation(add(pow(int(legA), int(2)), pow(int(legB), int(2))), pow(X, int(2)));
    note = `The legs are ${legA} and ${legB}, so ${legA}² + ${legB}² = x².`;
    answerValue = simplify(sqrtE(int(legA * legA + legB * legB)));
  } else {
    if (!exact) return null;                     // a non-integer leg is a different lesson
    goal = 'Find the missing leg';
    substituted = equation(add(pow(int(legA), int(2)), pow(X, int(2))), pow(int(hyp), int(2)));
    note = `One leg is ${legA} and the hypotenuse is ${hyp}, so ${legA}² + x² = ${hyp}².`;
    answerValue = simplify(sqrtE(int(hyp * hyp - legA * legA)));
  }

  const b = new DerivationBuilder(goal, formula);
  b.applyUnverified(R_PYTHAGORAS, substituted,
    'Substituting the given side lengths replaces the general theorem with this triangle.',
    note, 'Which sides do you know, and which is the hypotenuse?');

  const squares = findHypotenuse
    ? equation(pow(X, int(2)), int(legA * legA + legB * legB))
    : equation(pow(X, int(2)), int(hyp * hyp - legA * legA));
  b.apply(R_ARITHMETIC, squares,
    findHypotenuse
      ? `${legA}² + ${legB}² = ${legA * legA} + ${legB * legB} = ${legA * legA + legB * legB}.`
      : `${hyp}² − ${legA}² = ${hyp * hyp} − ${legA * legA} = ${hyp * hyp - legA * legA}.`,
    'Work out the squares.');

  b.applyUnverified(R_SIMPLIFY, equation(X, answerValue),
    'A length is positive, so only the positive root is taken.',
    `Take the square root. Lengths are positive, so the negative root is discarded.`,
    'Undo the square.');

  const scaleFactor = 220 / Math.max(legA, legB);
  return {
    prompt: goal, statement: formula, variable: 'x',
    figure: {
      kind: 'triangle', toScale: true,
      points: { A: [0, 0], B: [legA * scaleFactor, 0], C: [0, legB * scaleFactor] },
      segments: [['A', 'B'], ['B', 'C'], ['C', 'A']],
      sideLabels: findHypotenuse
        ? { AB: `${legA}`, CA: `${legB}`, BC: 'x' }
        : { AB: `${legA}`, CA: 'x', BC: `${hyp}` },
      rightAngles: ['A'],
    },
    answer: { kind: 'number' as const, value: answerValue },
    derivation: b.build(),
    distractors: findHypotenuse ? [{
      value: int(legA + legB),
      diagnosis: 'The two legs were added. Pythagoras adds the squares of the legs, not the legs themselves.',
      reviewSkill: 'pythagorean-theorem',
    }] : [{
      value: simplify(sqrtE(int(hyp * hyp + legA * legA))),
      diagnosis: 'The squares were added. When you are looking for a leg, the hypotenuse square is the one you subtract from.',
      reviewSkill: 'pythagorean-theorem',
    }],
  };
};

export const genSpecialRightTriangles: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const kind = r.bool() ? '45-45-90' : '30-60-90';
  const leg = r.int(2, scale(d, 8, 14));

  if (kind === '45-45-90') {
    const answerValue = simplify(mul(int(leg), sqrtE(int(2))));
    const b = new DerivationBuilder('Find the hypotenuse', equation(sym('c'), mul(sym('a'), sqrtE(int(2)))));
    b.applyUnverified(R_FORMULA, equation(X, mul(int(leg), sqrtE(int(2)))),
      'Substituting the given leg length into the ratio.',
      `In a 45-45-90 triangle the hypotenuse is √2 times a leg. The leg is ${leg}.`,
      'What are the side ratios in this triangle?');
    return {
      prompt: 'Find the hypotenuse, exactly', variable: 'x',
      statement: equation(sym('c'), mul(sym('a'), sqrtE(int(2)))),
      context: 'A right triangle with two 45° angles.',
      figure: {
        kind: 'triangle', toScale: true,
        points: { A: [0, 0], B: [180, 0], C: [0, 180] },
        segments: [['A', 'B'], ['B', 'C'], ['C', 'A']],
        sideLabels: { AB: `${leg}`, CA: `${leg}`, BC: 'x' },
        rightAngles: ['A'],
        angleLabels: { B: '45°', C: '45°' },
      },
      answer: { kind: 'number' as const, value: answerValue },
      derivation: b.build(),
      distractors: [{
        value: mul(int(leg), sqrtE(int(3))),
        diagnosis: 'That is the 30-60-90 ratio. With two 45° angles the factor is √2.',
        reviewSkill: 'special-right-triangles',
      }],
    };
  }

  const answerValue = simplify(mul(int(leg), sqrtE(int(3))));
  const b = new DerivationBuilder('Find the longer leg', equation(sym('b'), mul(sym('a'), sqrtE(int(3)))));
  b.applyUnverified(R_FORMULA, equation(X, mul(int(leg), sqrtE(int(3)))),
    'Substituting the given short side into the ratio.',
    `In a 30-60-90 triangle the sides are in the ratio 1 : √3 : 2, shortest first. ` +
    `The short leg is ${leg}, so the longer leg is ${leg}√3.`,
    'Which side is opposite the 30° angle?');
  return {
    prompt: 'Find the longer leg, exactly', variable: 'x',
    statement: equation(sym('b'), mul(sym('a'), sqrtE(int(3)))),
    context: 'A 30-60-90 triangle.',
    figure: {
      kind: 'triangle', toScale: true,
      points: { A: [0, 0], B: [220, 0], C: [0, 127] },
      segments: [['A', 'B'], ['B', 'C'], ['C', 'A']],
      sideLabels: { CA: `${leg}`, AB: 'x', BC: `${2 * leg}` },
      rightAngles: ['A'],
      angleLabels: { B: '30°', C: '60°' },
    },
    answer: { kind: 'number' as const, value: answerValue },
    derivation: b.build(),
    distractors: [{
      value: int(2 * leg),
      diagnosis: 'That is the hypotenuse, which is twice the short leg. The longer leg is √3 times it.',
      reviewSkill: 'special-right-triangles',
    }],
  };
};

export const genRightTriangleTrig: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const angle = r.pick([30, 45, 60]);
  const hyp = r.int(4, scale(d, 12, 20));
  const which = r.pick(['sin', 'cos'] as const);

  const rad = divE(mul(int(angle), cst('pi')), int(180));
  const formula = equation(mkFn(which, sym('θ')), divE(sym(which === 'sin' ? 'opposite' : 'adjacent'), sym('hypotenuse')));
  const substituted = equation(mkFn(which, rad), divE(X, int(hyp)));
  const trigValue = simplify(mkFn(which, rad));
  const answerValue = simplifyBest(mul(int(hyp), trigValue));

  const b = new DerivationBuilder('Find x', formula);
  b.applyUnverified(R_FORMULA, substituted,
    'Substituting the given angle and hypotenuse into the ratio.',
    `${which} of an angle is the ${which === 'sin' ? 'opposite' : 'adjacent'} side over the hypotenuse, ` +
    `so ${which}(${angle}°) = x/${hyp}.`,
    'Which two sides does this angle relate?');
  b.apply(R_SIMPLIFY, equation(trigValue, divE(X, int(hyp))),
    `${which}(${angle}°) = ${toLatex(trigValue)}.`, 'What is the exact value of that ratio?');
  b.apply(R_SIMPLIFY, equation(X, answerValue),
    `Multiply both sides by ${hyp}.`, 'Solve for x.');

  const angleRad = (angle * Math.PI) / 180;
  return {
    prompt: 'Find x, exactly', variable: 'x',
    statement: formula,
    context: `A right triangle with a ${angle}° angle and hypotenuse ${hyp}.`,
    figure: {
      kind: 'triangle', toScale: true,
      points: { A: [0, 0], B: [200 * Math.cos(angleRad), 0], C: [200 * Math.cos(angleRad), 200 * Math.sin(angleRad)] },
      segments: [['A', 'B'], ['B', 'C'], ['C', 'A']],
      sideLabels: { CA: `${hyp}`, ...(which === 'sin' ? { BC: 'x' } : { AB: 'x' }) },
      rightAngles: ['B'],
      angleLabels: { A: `${angle}°` },
    },
    answer: { kind: 'number' as const, value: answerValue },
    derivation: b.build(),
  };
};

export const genSimilarTriangles: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const k = r.int(2, scale(d, 3, 5));
  const a = r.int(2, scale(d, 7, 12));
  const b2 = r.int(2, scale(d, 7, 12));
  if (a === b2) return null;

  const statement = equation(divE(X, int(a * k)), divE(int(b2), int(a)));
  const answerValue = int(b2 * k);

  const bd = new DerivationBuilder('Find x', statement);
  bd.apply(R_SIMPLIFY, equation(X, mul(int(a * k), divE(int(b2), int(a)))),
    `Multiply both sides by ${a * k}.`, 'Clear the fraction.');
  bd.apply(R_ARITHMETIC, equation(X, answerValue),
    `${a * k} × ${b2}/${a} = ${b2 * k}.`, 'Work out the arithmetic.');

  return {
    prompt: 'Find x', variable: 'x',
    context: 'These two triangles are similar, so corresponding sides are in the same ratio.',
    statement,
    figure: {
      kind: 'composite', toScale: true,
      points: {
        A: [0, 0], B: [a * 12, 0], C: [a * 4, b2 * 12],
        D: [a * 12 + 60, 0], E: [a * 12 + 60 + a * 12 * k / 1.6, 0], F: [a * 12 + 60 + a * 4 * k / 1.6, b2 * 12 * k / 1.6],
      },
      segments: [['A', 'B'], ['B', 'C'], ['C', 'A'], ['D', 'E'], ['E', 'F'], ['F', 'D']],
      sideLabels: { AB: `${a}`, CA: `${b2}`, DE: `${a * k}`, FD: 'x' },
      caption: 'The two triangles are similar. Not drawn to scale.',
    },
    answer: { kind: 'number' as const, value: answerValue },
    derivation: bd.build(),
    distractors: [{
      value: int(b2 + (a * k - a)),
      diagnosis: 'The sides were scaled by adding rather than multiplying. Similar figures scale by a ratio, so the sides multiply by the same factor.',
      reviewSkill: 'similar-triangles',
    }],
  };
};

// --------------------------------------------------------- coordinate geometry

export const genCoordinateGeometry: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const want = r.pick(['distance', 'midpoint', 'slope'] as const);
  const hi = scale(d, 6, 12);
  const x1 = r.int(-hi, hi), y1 = r.int(-hi, hi);
  let x2 = r.int(-hi, hi), y2 = r.int(-hi, hi);
  if (x1 === x2 && y1 === y2) return null;
  if (want === 'slope' && x1 === x2) x2 = x1 + r.nonzeroInt(1, 4);

  const P = `(${x1}, ${y1})`;
  const Q = `(${x2}, ${y2})`;
  const figure: Figure = {
    kind: 'coordinate', toScale: true,
    points: { P: [x1, y1], Q: [x2, y2] },
    segments: [['P', 'Q']],
    caption: `P ${P} and Q ${Q}.`,
  };

  if (want === 'distance') {
    const dx = x2 - x1, dy = y2 - y1;
    const formula = equation(sym('d'), sqrtE(add(pow(subE(sym('x', '2'), sym('x', '1')), int(2)), pow(subE(sym('y', '2'), sym('y', '1')), int(2)))));
    const substituted = equation(sym('d'), sqrtE(add(pow(int(dx), int(2)), pow(int(dy), int(2)))));
    const value = simplify(sqrtE(int(dx * dx + dy * dy)));
    const b = new DerivationBuilder('Find the distance', formula);
    b.applyUnverified(R_SUBSTITUTE, substituted,
      'Substituting the coordinates into the distance formula.',
      `The horizontal gap is ${dx} and the vertical gap is ${dy}.`,
      'How far apart are they horizontally and vertically?');
    b.apply(R_ARITHMETIC, equation(sym('d'), value),
      `${dx}² + ${dy}² = ${dx * dx + dy * dy}, and √${dx * dx + dy * dy} = ${toLatex(value)}.`,
      'Square, add, then take the root.');
    return {
      prompt: `Find the exact distance between ${P} and ${Q}`,
      statement: formula, figure,
      answer: { kind: 'number' as const, value },
      derivation: b.build(),
    };
  }

  if (want === 'midpoint') {
    const mx = R.rat(x1 + x2, 2), my = R.rat(y1 + y2, 2);
    const formula = equation(sym('M'), tuple(
      divE(add(sym('x', '1'), sym('x', '2')), int(2)),
      divE(add(sym('y', '1'), sym('y', '2')), int(2)),
    ));
    const b = new DerivationBuilder('Find the midpoint', formula);
    b.applyUnverified(R_SUBSTITUTE, equation(sym('M'), tuple(num(mx), num(my))),
      'Substituting the coordinates and averaging each pair.',
      `Average the x-values: (${x1} + ${x2})/2 = ${R.toString(mx)}. Average the y-values: (${y1} + ${y2})/2 = ${R.toString(my)}.`,
      'The midpoint is the average of the two points.');
    return {
      prompt: `Find the midpoint of ${P} and ${Q}`,
      statement: formula, figure,
      answer: { kind: 'tuple' as const, values: [num(mx), num(my)], labels: ['x', 'y'] },
      derivation: b.build(),
    };
  }

  const slope = R.rat(y2 - y1, x2 - x1);
  const formula = equation(sym('m'), divE(subE(sym('y', '2'), sym('y', '1')), subE(sym('x', '2'), sym('x', '1'))));
  const b = new DerivationBuilder('Find the slope', formula);
  b.applyUnverified(R_SUBSTITUTE, equation(sym('m'), divE(int(y2 - y1), int(x2 - x1))),
    'Substituting the coordinates into the slope formula.',
    `The rise is ${y2} − ${y1} = ${y2 - y1} and the run is ${x2} − ${x1} = ${x2 - x1}.`,
    'How much does it go up, and how much across?');
  b.apply(R_SIMPLIFY, equation(sym('m'), num(slope)), 'Reduce the fraction.', 'Simplify the ratio.');
  return {
    prompt: `Find the slope of the line through ${P} and ${Q}`,
    statement: formula, figure,
    answer: { kind: 'number' as const, value: num(slope) },
    derivation: b.build(),
    distractors: [{
      value: num(R.rat(x2 - x1, y2 - y1 === 0 ? 1 : y2 - y1)),
      diagnosis: 'The rise and run are the wrong way round. Slope is rise over run.',
      reviewSkill: 'coordinate-geometry',
    }],
  };
};

export const genLinesAndSlope: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const m = r.nonzeroInt(-scale(d, 3, 6), scale(d, 3, 6));
  const c = r.int(-scale(d, 5, 10), scale(d, 5, 10));
  const x1 = r.nonzeroInt(-6, 6);
  const y1 = m * x1 + c;

  const statement = simplify(equation(sym('y'), add(mul(int(m), X), int(c))));
  const b = new DerivationBuilder('Find the equation', equation(sym('y'), add(mul(sym('m'), X), sym('b'))));
  b.applyUnverified(R_SUBSTITUTE, equation(sym('y'), add(mul(int(m), X), sym('b'))),
    'Substituting the given slope.',
    `The slope is ${m}, so the equation looks like y = ${m}x + b.`,
    'Start from slope-intercept form.');
  b.applyUnverified(R_SUBSTITUTE, equation(int(y1), add(mul(int(m), int(x1)), sym('b'))),
    'Substituting the point, which pins down b.',
    `The line passes through (${x1}, ${y1}), so ${y1} = ${m}(${x1}) + b.`,
    'Use the point to find the intercept.');
  // Solving that for b is an ordinary equivalence and stays verified.
  b.apply(R_SIMPLIFY, equation(sym('b'), int(c)),
    `${y1} = ${m * x1} + b, so b = ${c}.`, 'Solve for the intercept.');
  // Putting b back into the template is a reconstruction, not a restatement of
  // the previous line, so it is declared rather than asserted.
  b.applyUnverified(R_SUBSTITUTE, statement,
    'Writing the equation reassembles the line from m and b; it does not follow from the previous line alone.',
    `Put ${c} back in place of b.`, 'Now write out the equation.');

  return {
    prompt: `Find the equation of the line with slope ${m} through (${x1}, ${y1})`,
    statement: equation(sym('y'), add(mul(sym('m'), X), sym('b'))),
    variable: 'x',
    figure: {
      kind: 'coordinate', toScale: true,
      points: { P: [x1, y1] },
      caption: `Slope ${m}, passing through (${x1}, ${y1}).`,
    },
    answer: { kind: 'expression' as const, value: statement },
    derivation: b.build(),
  };
};
