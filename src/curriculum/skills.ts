/**
 * The skill graph.
 *
 * A directed acyclic graph: each skill lists what should be comfortable before
 * it is introduced. The scheduler walks this to decide what is available, and
 * the map view draws it. Ratings are on the same scale as a student's own
 * rating so the two can be compared directly — roughly 400 for early
 * arithmetic through 2200 for late calculus.
 *
 * Prerequisites are deliberately conservative: listing every conceivable
 * dependency makes the graph unreadable and gates progress on trivia. Each
 * skill lists the one or two things it genuinely stands on.
 */

import type { Skill } from './types.ts';

const S = (
  id: string, name: string, strand: Skill['strand'], rating: number,
  prerequisites: readonly string[], description: string, concept: string, example?: string,
): Skill => ({ id, name, strand, rating, prerequisites, description, concept, ...(example ? { example } : {}) });

export const SKILLS: readonly Skill[] = [
  // ------------------------------------------------------------ arithmetic
  S('integer-arithmetic', 'Signed numbers', 'arithmetic', 420, [],
    'Adding, subtracting, multiplying and dividing positive and negative numbers.',
    'A negative sign is a direction, not a smaller number. Adding a negative moves left on the number line; multiplying two negatives turns the direction around twice, so the result is positive.',
    '-7 + 3'),
  S('order-of-operations', 'Order of operations', 'arithmetic', 450, ['integer-arithmetic'],
    'Working out which part of an expression to evaluate first.',
    'Brackets first, then powers, then multiplication and division left to right, then addition and subtraction. The order exists so that everyone reading the same expression gets the same number.',
    '2 + 3*4^2'),
  S('fractions', 'Fractions', 'arithmetic', 520, ['integer-arithmetic'],
    'Adding, subtracting, multiplying and dividing fractions.',
    'A fraction is a division waiting to happen. To add two, they must be cut into the same size pieces first — that is all a common denominator is.',
    '2/3 + 3/4'),
  S('decimals-percents', 'Decimals and percents', 'arithmetic', 560, ['fractions'],
    'Converting between fractions, decimals and percentages, and computing with them.',
    'A percent is a fraction with denominator 100. Moving between the three forms is renaming the same number, never changing it.'),
  S('exponent-rules', 'Exponent rules', 'arithmetic', 620, ['order-of-operations'],
    'Multiplying, dividing and nesting powers.',
    'A power counts repeated multiplication, and every rule follows from that counting. x^3 * x^2 is five x-es multiplied, so the exponents add.',
    'x^3 * x^5'),
  S('radicals', 'Square roots and radicals', 'arithmetic', 700, ['exponent-rules'],
    'Simplifying radicals and combining them.',
    'Simplifying a radical means pulling out any perfect square hiding inside it. The square root of 72 contains a 36, so it is 6 root 2.',
    'sqrt(72)'),
  S('prime-factorization', 'Factors and multiples', 'arithmetic', 480, ['integer-arithmetic'],
    'Prime factorization, greatest common factor and least common multiple.',
    'Every whole number breaks into primes in exactly one way. Once you have the primes, common factors and common multiples are just reading off what two numbers share.'),

  // --------------------------------------------------------------- algebra
  S('evaluate-expressions', 'Evaluating expressions', 'algebra', 520, ['order-of-operations'],
    'Substituting numbers for variables and computing the result.',
    'A variable is a placeholder. Substituting is putting a number into the placeholder and then doing ordinary arithmetic.',
    '3x^2 - 2x + 1 at x = -2'),
  S('like-terms', 'Combining like terms', 'algebra', 560, ['evaluate-expressions'],
    'Adding terms that share the same variable part.',
    'Terms combine only when their variable parts match exactly. 3x and 5x are both counts of the same thing, so they add; 3x and 3x^2 count different things and do not.',
    '3x + 5x - 2x'),
  S('distributive-property', 'Distributing', 'algebra', 600, ['like-terms'],
    'Multiplying a factor across a sum.',
    'Multiplying a sum means multiplying every piece of it. Missing one term is the single most common slip in algebra.',
    '2(x + 3)'),
  S('simplifying', 'Simplifying expressions', 'algebra', 640, ['distributive-property'],
    'Clearing brackets and collecting terms into standard form.',
    'Simplifying is not making an expression shorter for its own sake; it is putting it in the one agreed form so two expressions can be compared at a glance.',
    '2(x + 3) - 3(x - 1)'),
  S('linear-equations', 'One-step and two-step equations', 'algebra', 680, ['simplifying'],
    'Solving equations where the unknown appears once.',
    'An equation is a balance. Whatever you do to one side you do to the other, and you undo the operations around the unknown from the outside in.',
    '3x + 5 = 20'),
  S('linear-equations-both-sides', 'Variables on both sides', 'algebra', 760, ['linear-equations'],
    'Solving equations with the unknown on both sides.',
    'Gather every term with the unknown onto one side first. Which side does not matter; keeping the coefficient positive usually makes the arithmetic easier.',
    '2(x + 3) = 5x - 9'),
  S('linear-inequalities', 'Linear inequalities', 'algebra', 800, ['linear-equations-both-sides'],
    'Solving inequalities and describing the solution set.',
    'Inequalities work like equations with one exception: multiplying or dividing by a negative reverses the direction, because it reflects the number line.',
    '-3x > 12'),
  S('literal-equations', 'Rearranging formulas', 'algebra', 820, ['linear-equations-both-sides'],
    'Solving for one variable in terms of the others.',
    'Exactly the same moves as solving for a number; the only difference is that the answer contains letters instead of digits.',
    'Solve A = (1/2)bh for h'),
  S('proportions', 'Ratios and proportions', 'algebra', 700, ['fractions', 'linear-equations'],
    'Setting up and solving proportions.',
    'A proportion says two ratios are equal. Cross-multiplying is just clearing both denominators at once.'),
  S('linear-systems', 'Systems of two equations', 'algebra', 900, ['linear-equations-both-sides'],
    'Solving two equations in two unknowns.',
    'Two straight lines meet at one point, unless they are parallel or identical. Elimination and substitution are two routes to that point.',
    '2x + 3y = 12,  x - y = 1'),
  S('factoring-gcf', 'Factoring out a common factor', 'algebra', 780, ['distributive-property', 'prime-factorization'],
    'Pulling the greatest common factor out of a polynomial.',
    'This is distributing in reverse. Find the largest thing every term shares and write it outside the bracket.',
    '6x^2 + 9x'),
  S('multiply-binomials', 'Multiplying binomials', 'algebra', 800, ['distributive-property'],
    'Expanding products of two brackets.',
    'Every term in the first bracket meets every term in the second. With two terms each that is four products, which is all FOIL is counting.',
    '(x + 2)(x + 3)'),
  S('special-products', 'Difference of squares and perfect squares', 'algebra', 840, ['multiply-binomials'],
    'Recognising and using the two patterns that come up constantly.',
    '(a+b)(a-b) loses its middle term to cancellation, giving a^2 - b^2. And (a+b)^2 is a^2 + 2ab + b^2 — the middle term is the one people forget.',
    '(x + 5)(x - 5)'),
  S('factoring-quadratics', 'Factoring quadratics', 'algebra', 900, ['multiply-binomials', 'factoring-gcf'],
    'Writing a quadratic as a product of two linear factors.',
    'For x^2 + bx + c, look for two numbers that multiply to c and add to b. When the leading coefficient is not 1, the target product becomes a times c.',
    'x^2 + 5x + 6'),
  S('zero-product-property', 'The zero-product property', 'algebra', 920, ['factoring-quadratics'],
    'Using a factored form to find roots.',
    'A product is zero only if one of its factors is zero. That single fact turns factoring into a solving method.',
    '(x - 2)(x + 3) = 0'),
  S('quadratic-equations', 'Solving quadratics by factoring', 'algebra', 950, ['zero-product-property'],
    'Rearranging to zero, factoring, and reading off the roots.',
    'Get everything on one side so the other side is zero — the zero-product property needs that zero to work.',
    'x^2 + 5x = -6'),
  S('completing-the-square', 'Completing the square', 'algebra', 1050, ['special-products', 'quadratic-equations'],
    'Rewriting a quadratic as a squared bracket plus a constant.',
    'Halve the coefficient of x and square it: that is exactly the constant needed to make a perfect square. Add it, then take it straight back off.',
    'x^2 + 6x + 2'),
  S('quadratic-formula', 'The quadratic formula', 'algebra', 1080, ['completing-the-square', 'radicals'],
    'Solving any quadratic, and reading the discriminant.',
    'The formula is completing the square done once, in general. The discriminant b^2-4ac under the root tells you how many real roots there are before you compute them.',
    'x^2 + 2x - 5 = 0'),
  S('rational-expressions', 'Simplifying rational expressions', 'algebra', 1100, ['factoring-quadratics', 'fractions'],
    'Cancelling common factors in algebraic fractions.',
    'Only factors cancel, never terms. Factor the top and bottom first, and note the values that would make the original denominator zero.',
    '(x^2 - 1)/(x - 1)'),
  S('rational-equations', 'Rational equations', 'algebra', 1180, ['rational-expressions', 'quadratic-equations'],
    'Solving equations containing algebraic fractions.',
    'Multiply through to clear the denominators, then solve normally — and check every answer against the original, because clearing denominators can invent solutions that make one zero.',
    '1/x + 1/2 = 3/4'),
  S('radical-equations', 'Radical equations', 'algebra', 1150, ['radicals', 'quadratic-equations'],
    'Solving equations with square roots.',
    'Isolate the root and square both sides. Squaring can create answers that do not satisfy the original, so every solution has to be checked.',
    'sqrt(x + 3) = x - 3'),
  S('absolute-value-equations', 'Absolute value equations', 'algebra', 1000, ['linear-equations-both-sides'],
    'Solving equations and inequalities with absolute value.',
    'Absolute value measures distance from zero, so |x| = 5 has two answers. Each absolute value splits the problem into cases.',
    '|2x - 1| = 7'),
  S('polynomial-arithmetic', 'Polynomial arithmetic', 'algebra', 1000, ['multiply-binomials', 'exponent-rules'],
    'Adding, subtracting, multiplying and dividing polynomials.',
    'Polynomials behave like whole numbers written in a strange base. Long division works the same way it does with digits.'),
  S('factoring-cubics', 'Factoring higher polynomials', 'algebra', 1200, ['factoring-quadratics', 'polynomial-arithmetic'],
    'Factoring by grouping, and using the rational root theorem.',
    'Any rational root has numerator dividing the constant term and denominator dividing the leading coefficient. That gives a short list to test rather than a guess.',
    'x^3 - 4x^2 + x + 6'),

  // -------------------------------------------------------------- geometry
  S('angles', 'Angles and lines', 'geometry', 520, [],
    'Complementary, supplementary and vertical angles.',
    'Angles on a straight line add to 180 degrees and angles around a point to 360. Almost every angle-chasing problem is those two facts used repeatedly.'),
  S('parallel-lines', 'Angles with parallel lines', 'geometry', 640, ['angles'],
    'Corresponding, alternate and co-interior angles.',
    'A line crossing two parallel lines makes the same pattern of angles at both crossings. That is what lets you carry an angle from one intersection to the other.'),
  S('triangle-angles', 'Angles in triangles', 'geometry', 620, ['angles'],
    'The angle sum, exterior angles, and isosceles triangles.',
    'The three angles of any triangle add to 180 degrees. An exterior angle equals the two opposite interior angles, which follows immediately.'),
  S('perimeter-area', 'Perimeter and area', 'geometry', 580, ['integer-arithmetic'],
    'Perimeter and area of rectangles, triangles, parallelograms and trapezoids.',
    'Area counts unit squares. Every formula here is a rearrangement of a rectangle into a shape you can already measure.'),
  S('pythagorean-theorem', 'The Pythagorean theorem', 'geometry', 780, ['radicals', 'triangle-angles'],
    'Finding a missing side of a right triangle.',
    'In a right triangle the squares on the two shorter sides add to the square on the longest. The hypotenuse is always the side opposite the right angle.',
    'legs 3 and 4'),
  S('special-right-triangles', 'Special right triangles', 'geometry', 900, ['pythagorean-theorem'],
    'The 45-45-90 and 30-60-90 ratios.',
    'Two triangles come up so often their side ratios are worth knowing: 1:1:root 2, and 1:root 3:2. Both follow from Pythagoras.'),
  S('circles', 'Circles', 'geometry', 700, ['perimeter-area'],
    'Circumference, area, arcs and sectors.',
    'Pi is the ratio of a circle circumference to its diameter — the same for every circle. Arc and sector formulas are just fractions of the whole.'),
  S('similar-triangles', 'Similarity and congruence', 'geometry', 860, ['triangle-answers-placeholder'],
    'Proving triangles similar or congruent and using the ratios.',
    'Similar figures have the same shape at a different size, so corresponding sides are in a constant ratio. That ratio is the whole content of a similarity problem.'),
  S('volume-surface-area', 'Volume and surface area', 'geometry', 800, ['perimeter-area'],
    'Prisms, cylinders, pyramids, cones and spheres.',
    'Volume of anything with a uniform cross-section is base area times height. Cones and pyramids get a third of that, which is not obvious and worth remembering.'),
  S('coordinate-geometry', 'Coordinate geometry', 'geometry', 820, ['pythagorean-theorem', 'linear-equations'],
    'Distance, midpoint and slope between points.',
    'The distance formula is Pythagoras with the legs read off the coordinates. Slope is the rise divided by the run.'),
  S('lines-and-slope', 'Equations of lines', 'geometry', 860, ['coordinate-geometry'],
    'Slope-intercept and point-slope form, parallel and perpendicular lines.',
    'A line is fixed by a point and a direction. Parallel lines share a slope; perpendicular slopes multiply to -1.'),
  S('transformations', 'Transformations', 'geometry', 880, ['coordinate-geometry'],
    'Translations, reflections, rotations and dilations.',
    'A transformation is a rule applied to every point. Reflections and rotations preserve distance; dilations scale it.'),

  // ------------------------------------------------------------- functions
  S('function-notation', 'Function notation', 'functions', 800, ['evaluate-expressions'],
    'Reading and evaluating f(x), and composing functions.',
    'f(x) names a rule, not a multiplication. f(3) means run the rule on 3.',
    'f(x) = 2x - 1, find f(4)'),
  S('domain-range', 'Domain and range', 'functions', 900, ['function-notation'],
    'Finding the inputs a function accepts and the outputs it produces.',
    'The domain is everything you are allowed to put in. In practice you are looking for two things: division by zero, and even roots of negatives.'),
  S('graphing-linear', 'Graphing linear functions', 'functions', 900, ['lines-and-slope', 'function-notation'],
    'Plotting lines from their equations and reading equations off graphs.',
    'The intercept says where to start and the slope says which way to go. Two points are enough to draw the whole line.'),
  S('graphing-quadratics', 'Graphing parabolas', 'functions', 1120, ['quadratic-formula', 'function-notation'],
    'Vertex, axis of symmetry, intercepts and direction.',
    'Vertex form tells you the turning point directly. From standard form the axis of symmetry sits at -b/2a, halfway between the roots.'),
  S('inverse-functions', 'Inverse functions', 'functions', 1150, ['function-notation', 'literal-equations'],
    'Finding and recognising inverses.',
    'An inverse undoes the function. Swap x and y and solve for y; the graph reflects across the line y = x.'),
  S('exponential-functions', 'Exponential functions', 'functions', 1200, ['exponent-rules', 'function-notation'],
    'Growth, decay, and solving simple exponential equations.',
    'In an exponential the variable is in the exponent, so the output multiplies by a fixed factor each step rather than adding one.'),
  S('logarithms', 'Logarithms', 'functions', 1250, ['exponential-functions'],
    'Log rules and converting between log and exponential form.',
    'A logarithm answers "what exponent do I need?". Every log rule is an exponent rule read backwards.',
    'log_2(8)'),
  S('exponential-equations', 'Exponential and log equations', 'functions', 1320, ['logarithms'],
    'Solving equations with the unknown in an exponent or inside a log.',
    'Taking a log of both sides brings the exponent down to where you can solve for it. Going the other way, exponentiating cancels a log.'),
  S('sequences-series', 'Sequences and series', 'functions', 1100, ['linear-equations', 'exponent-rules'],
    'Arithmetic and geometric sequences and their sums.',
    'Arithmetic sequences add a fixed step; geometric ones multiply by a fixed ratio. The sum formulas both come from pairing terms cleverly.'),

  // ---------------------------------------------------------- trigonometry
  S('right-triangle-trig', 'Right triangle trigonometry', 'trigonometry', 1000, ['pythagorean-theorem', 'proportions'],
    'Sine, cosine and tangent in right triangles.',
    'In a right triangle the ratios of sides depend only on the angles. Sine, cosine and tangent name three of those ratios.',
    'sin(30 degrees)'),
  S('unit-circle', 'The unit circle', 'trigonometry', 1200, ['right-triangle-trig', 'special-right-triangles'],
    'Angles in radians and exact values around the circle.',
    'Putting the triangle inside a circle of radius 1 makes cosine the x-coordinate and sine the y-coordinate, which extends both beyond 90 degrees.'),
  S('trig-graphs', 'Graphs of trig functions', 'trigonometry', 1300, ['unit-circle', 'graphing-quadratics'],
    'Amplitude, period, phase shift.',
    'Going round the circle repeatedly is what makes these graphs repeat. Amplitude stretches vertically, period stretches horizontally.'),
  S('trig-identities', 'Trigonometric identities', 'trigonometry', 1400, ['unit-circle'],
    'The Pythagorean and angle-sum identities.',
    'sin^2 + cos^2 = 1 is the Pythagorean theorem on the unit circle. Most other identities are built from it and the angle-sum formulas.'),
  S('law-of-sines-cosines', 'Law of sines and cosines', 'trigonometry', 1350, ['right-triangle-trig', 'triangle-angles'],
    'Solving triangles that are not right-angled.',
    'The law of cosines is Pythagoras with a correction term for the angle not being right. When the angle is 90 degrees the correction vanishes.'),

  // ------------------------------------------------------------- statistics
  S('mean-median-mode', 'Centre and spread', 'statistics', 600, ['fractions'],
    'Mean, median, mode and range.',
    'The mean balances the data and the median splits it in half. They differ most when the data is lopsided, which is exactly when the difference matters.'),
  S('probability-basics', 'Probability', 'statistics', 750, ['fractions'],
    'Simple and compound probability.',
    'Probability is the fraction of outcomes you want out of all equally likely outcomes. Independent events multiply.'),
  S('counting', 'Counting and combinatorics', 'statistics', 950, ['probability-basics'],
    'Permutations, combinations and the multiplication principle.',
    'If order matters it is a permutation; if it does not, divide by the number of orderings to get a combination.'),

  // --------------------------------------------------------------- calculus
  S('limits', 'Limits', 'calculus', 1500, ['rational-expressions', 'domain-range'],
    'Evaluating limits, including indeterminate forms.',
    'A limit asks where a function is heading, not where it arrives. When substitution gives 0/0 the algebra is hiding a cancellation.'),
  S('derivative-definition', 'The derivative', 'calculus', 1600, ['limits', 'lines-and-slope'],
    'The definition as a limit, and its meaning as a slope.',
    'The derivative is the slope of the tangent, obtained by taking the slope between two points and letting them merge.'),
  S('derivative-power-rule', 'Power rule', 'calculus', 1650, ['derivative-definition'],
    'Differentiating powers and polynomials.',
    'The derivative of x^n is n x^(n-1). Every polynomial derivative is that rule applied term by term.',
    'd/dx (3x^4 - 2x)'),
  S('derivative-product-quotient', 'Product and quotient rules', 'calculus', 1750, ['derivative-power-rule'],
    'Differentiating products and quotients.',
    'The derivative of a product is not the product of the derivatives. Each factor takes its turn being differentiated while the other is held.'),
  S('derivative-chain-rule', 'Chain rule', 'calculus', 1800, ['derivative-power-rule'],
    'Differentiating composed functions.',
    'Differentiate the outside function, leave the inside alone, then multiply by the derivative of the inside.',
    'd/dx sin(3x^2)'),
  S('derivative-applications', 'Using derivatives', 'calculus', 1900, ['derivative-chain-rule'],
    'Tangent lines, maxima and minima, and rates of change.',
    'A maximum or minimum of a smooth function has a horizontal tangent, so setting the derivative to zero finds the candidates.'),
  S('antiderivatives', 'Antiderivatives', 'calculus', 1900, ['derivative-power-rule'],
    'Reversing differentiation.',
    'Integrating undoes differentiating, so the power rule runs backwards. The constant of integration is there because a constant leaves no trace in a derivative.'),
  S('definite-integrals', 'Definite integrals', 'calculus', 2000, ['antiderivatives'],
    'Evaluating integrals and computing areas.',
    'A definite integral adds up infinitely many thin slices. The fundamental theorem lets you get the total by evaluating an antiderivative at the two ends.'),
];

// The similar-triangles entry above references a prerequisite that does not
// exist, which would silently break the graph. Fix it here rather than leaving
// a typo in a data table that the validator would have to forgive.
const CORRECTED: readonly Skill[] = SKILLS.map((s) =>
  s.id === 'similar-triangles'
    ? { ...s, prerequisites: ['triangle-angles', 'proportions'] }
    : s,
);

export const ALL_SKILLS: readonly Skill[] = CORRECTED;

const BY_ID = new Map(ALL_SKILLS.map((s) => [s.id, s]));

export const getSkill = (id: string): Skill | undefined => BY_ID.get(id);
export const skillIds = (): string[] => ALL_SKILLS.map((s) => s.id);

/** Skills that list `id` as a prerequisite. */
export function dependents(id: string): Skill[] {
  return ALL_SKILLS.filter((s) => s.prerequisites.includes(id));
}

/** Every prerequisite, transitively, nearest first. */
export function allPrerequisites(id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let frontier = [...(BY_ID.get(id)?.prerequisites ?? [])];
  while (frontier.length) {
    const next: string[] = [];
    for (const p of frontier) {
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(p);
      next.push(...(BY_ID.get(p)?.prerequisites ?? []));
    }
    frontier = next;
  }
  return out;
}

/**
 * Topological order, so a learning path never presents a skill before its
 * prerequisites. Ties break by rating, then by id, so the order is stable
 * across runs rather than depending on object iteration.
 */
export function topologicalOrder(): Skill[] {
  const remaining = new Map(ALL_SKILLS.map((s) => [s.id, s]));
  const placed = new Set<string>();
  const out: Skill[] = [];

  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((s) => s.prerequisites.every((p) => placed.has(p) || !BY_ID.has(p)))
      .sort((a, b) => a.rating - b.rating || a.id.localeCompare(b.id));

    if (ready.length === 0) {
      // A cycle. Emit the rest in rating order rather than looping forever, and
      // let validateGraph report it.
      out.push(...[...remaining.values()].sort((a, b) => a.rating - b.rating));
      break;
    }
    for (const s of ready) {
      out.push(s);
      placed.add(s.id);
      remaining.delete(s.id);
    }
  }
  return out;
}

/** Structural problems in the graph. The test suite asserts this is empty. */
export function validateGraph(): string[] {
  const faults: string[] = [];
  const ids = new Set(ALL_SKILLS.map((s) => s.id));

  for (const s of ALL_SKILLS) {
    for (const p of s.prerequisites) {
      if (!ids.has(p)) faults.push(`${s.id} requires "${p}", which does not exist`);
    }
    if (!s.concept || s.concept.length < 40) {
      faults.push(`${s.id} has no usable concept explanation`);
    }
  }

  // Duplicate ids.
  const counts = new Map<string, number>();
  for (const s of ALL_SKILLS) counts.set(s.id, (counts.get(s.id) ?? 0) + 1);
  for (const [id, n] of counts) if (n > 1) faults.push(`${id} is defined ${n} times`);

  // Cycles, via the topological pass.
  const order = topologicalOrder();
  if (order.length !== ALL_SKILLS.length) faults.push('the prerequisite graph is not acyclic');
  const seen = new Set<string>();
  for (const s of order) {
    for (const p of s.prerequisites) {
      if (ids.has(p) && !seen.has(p)) faults.push(`${s.id} appears before its prerequisite ${p}`);
    }
    seen.add(s.id);
  }

  // A prerequisite should not be harder than the skill that needs it.
  for (const s of ALL_SKILLS) {
    for (const p of s.prerequisites) {
      const pre = BY_ID.get(p);
      if (pre && pre.rating > s.rating) {
        faults.push(`${s.id} (${s.rating}) is rated easier than its prerequisite ${p} (${pre.rating})`);
      }
    }
  }

  return faults;
}
