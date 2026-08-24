/**
 * The scratchpad.
 *
 * Type any expression and see everything the engine can say about it at once:
 * simplified, expanded, factored, solved, evaluated. This is where the app
 * stops being a set of problems and becomes something to poke at — which is
 * how most of the intuition actually gets built.
 *
 * Every result carries the same guarantee as the graded ones, because it comes
 * from the same code. Nothing here is approximated unless it says so.
 */

import { useDeferredValue, useMemo, useState } from 'react';
import { tryParse } from './../engine/parse.ts';
import { toLatex, approximate } from './../engine/print.ts';
import { simplify, simplifyBest, factor, cancelFraction } from './../engine/canon.ts';
import { expand } from './../engine/polynomial.ts';
import { symbols, isRelation, key, type Expr } from './../engine/expr.ts';
import { evalPlot } from './../engine/evaluate.ts';
import { solveLinear } from './../engine/solve/linear.ts';
import { solveQuadratic, isQuadraticIn } from './../engine/solve/quadratic.ts';
import { simplifyDerivation } from './../engine/solve/steps.ts';
import { MathView } from './MathView.tsx';
import { MathInput } from './MathInput.tsx';
import { Plot } from './Plot.tsx';

interface Result {
  label: string;
  latex: string;
  note?: string;
}

const EXAMPLES = [
  '(x+2)(x-3)',
  'x^2 - 5x + 6 = 0',
  '\\frac{x^2-1}{x-1}',
  '\\sqrt{72}',
  '\\frac{1}{2}+\\frac{1}{3}',
  '2(x+3) = 5x - 9',
];

export function Sandbox() {
  const [input, setInput] = useState('');
  const deferred = useDeferredValue(input);

  const state = useMemo(() => analyse(deferred), [deferred]);

  return (
    <div className="page">
      <h1>Scratchpad</h1>
      <p className="subtitle">
        Type anything. Every answer below is computed exactly, the same way the practice
        problems are graded.
      </p>

      <div className="card">
        <MathInput
          value={input}
          onChange={setInput}
          flavour="full"
          placeholder="e.g. (x+2)(x-3)"
        />
        <div className="row row--wrap" style={{ marginTop: 11, gap: 7 }}>
          {EXAMPLES.map((e) => (
            <button key={e} className="btn btn--sm" onClick={() => setInput(e)}>
              <MathView latex={e} size="sm" />
            </button>
          ))}
        </div>
      </div>

      {state.kind === 'error' && input.trim() !== '' && (
        <div className="card">
          <div className="sandbox__err">{state.message}</div>
          {state.caret && (
            <pre className="small faint" style={{ margin: '8px 0 0', fontFamily: 'var(--mono)' }}>
              {input}{'\n'}{state.caret}
            </pre>
          )}
        </div>
      )}

      {state.kind === 'ok' && (
        <>
          <div className="card">
            <h2>Results</h2>
            {state.results.map((r) => (
              <div className="sandbox__op" key={r.label}>
                <div className="sandbox__oplabel">{r.label}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <MathView latex={r.latex} />
                  {r.note && <div className="small faint">{r.note}</div>}
                </div>
              </div>
            ))}
          </div>

          {state.steps.length > 0 && (
            <div className="card">
              <h2>Step by step</h2>
              <div className="steps">
                {state.steps.map((s, i) => (
                  <div className="step" key={i}>
                    <div className="step__n">{i + 1}</div>
                    <div>
                      <div className="step__title">{s.title}</div>
                      <div className="step__detail">{s.detail}</div>
                      <div className="step__math"><MathView latex={s.latex} /></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {state.plottable && (
            <div className="card">
              <h2>Graph</h2>
              <Plot expr={state.plottable.expr} variable={state.plottable.variable} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

type Analysis =
  | { kind: 'idle' }
  | { kind: 'error'; message: string; caret?: string }
  | {
      kind: 'ok';
      results: Result[];
      steps: Array<{ title: string; detail: string; latex: string }>;
      plottable: { expr: Expr; variable: string } | null;
    };

function analyse(src: string): Analysis {
  if (src.trim() === '') return { kind: 'idle' };

  const parsed = tryParse(src);
  if ('error' in parsed) {
    return { kind: 'error', message: parsed.error.message, caret: parsed.error.caret };
  }

  const e = parsed.expr;
  const vars = symbols(e);
  const results: Result[] = [];
  const steps: Array<{ title: string; detail: string; latex: string }> = [];

  const add = (label: string, value: Expr, note?: string) => {
    const latex = toLatex(value);
    // Skip anything that just restates a line already shown.
    if (results.some((r) => r.latex === latex)) return;
    results.push({ label, latex, ...(note ? { note } : {}) });
  };

  try {
    if (isRelation(e)) {
      const variable = vars[0];
      if (variable) {
        if (isQuadraticIn(e, variable)) {
          const solved = solveQuadratic(e, variable);
          if (solved.solutions.length) {
            add('Solutions', { k: 'set', args: solved.solutions });
          }
          for (const s of solved.derivation.steps) {
            steps.push({ title: s.title, detail: s.detail, latex: toLatex(s.to) });
          }
        } else {
          const solved = solveLinear(e, variable);
          if (solved.special === 'all-reals') {
            results.push({ label: 'Solutions', latex: '\\text{every value}', note: 'This is an identity.' });
          } else if (solved.special === 'no-solution') {
            results.push({ label: 'Solutions', latex: '\\varnothing', note: 'No value satisfies it.' });
          } else if (solved.solutions.length) {
            add('Solution', solved.solutions[0]!);
          }
          for (const s of solved.derivation.steps) {
            steps.push({ title: s.title, detail: s.detail, latex: toLatex(s.to) });
          }
        }
      }
      return { kind: 'ok', results, steps, plottable: null };
    }

    const s = simplify(e);
    add('Simplified', simplifyBest(e));
    if (key(s) !== key(e)) add('Exact value', s);

    const expanded = simplify(expand(e));
    if (key(expanded) !== key(simplifyBest(e))) add('Expanded', expanded);

    if (vars.length === 1) {
      const f = factor(e);
      if (key(f) !== key(expanded)) add('Factored', f);
      const c = cancelFraction(e);
      if (key(c) !== key(s)) add('Cancelled', c);
    }

    if (vars.length === 0) {
      const approx = approximate(e, 12);
      if (approx) {
        const exactLatex = toLatex(simplifyBest(e));
        if (approx !== exactLatex) results.push({ label: 'Decimal', latex: approx, note: 'To 12 places.' });
      }
    }

    for (const st of simplifyDerivation(e).steps) {
      steps.push({ title: st.title, detail: st.detail, latex: toLatex(st.to) });
    }

    const plottable = vars.length === 1 && isPlottable(e, vars[0]!)
      ? { expr: e, variable: vars[0]! }
      : null;

    return { kind: 'ok', results, steps, plottable };
  } catch (err) {
    return { kind: 'error', message: (err as Error).message };
  }
}

/** Cheap sanity check before handing an expression to the plotter. */
function isPlottable(e: Expr, v: string): boolean {
  try {
    let finite = 0;
    for (let i = -8; i <= 8; i++) {
      const y = evalPlot(e, { [v]: i + 0.37 });
      if (Number.isFinite(y)) finite++;
    }
    return finite >= 6;
  } catch {
    return false;
  }
}
