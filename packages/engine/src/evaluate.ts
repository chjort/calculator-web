import Decimal from "decimal.js";
import type { CalcError, CalcErrorCode, DecimalString, Evaluation } from "./types";

// ADR 0008: precision 34, range ±9999. Beyond maxE decimal.js yields ±Infinity (-> overflow);
// below minE it yields 0, the only case where a non-zero value becomes 0.
// A clone with the ADR's settings, so the engine never mutates the global Decimal other packages may use.
export const ENGINE_CONFIG = { precision: 34, minE: -9999, maxE: 9999 } as const;
const D = Decimal.clone({ ...ENGINE_CONFIG, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -9e15, toExpPos: 9e15 });

export const MAX_LENGTH = 500;
export const MAX_DEPTH = 100;

export const MESSAGES: Record<CalcErrorCode, string> = {
  syntax: "Invalid expression",
  incomplete_expression: "Finish the expression",
  divide_by_zero: "Can't divide by zero",
  overflow: "Number too large",
  domain: "Invalid input",
  too_long: "Expression too long",
};

type Tok =
  | { t: "num"; v: string; pos: number }
  | { t: "ans"; pos: number }
  | { t: "op"; v: "+" | "-" | "*" | "/"; pos: number }
  | { t: "%" | "(" | ")"; pos: number };

class Fail {
  constructor(readonly code: CalcErrorCode, readonly position?: number) {}
}

const OPS: Record<string, "+" | "-" | "*" | "/"> = {
  "+": "+", "-": "-", "\u2212": "-", "*": "*", "\u00d7": "*", "/": "/", "\u00f7": "/",
};

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === " ") { i++; continue; }
    const op = OPS[c];
    if (op) { out.push({ t: "op", v: op, pos: i }); i++; continue; }
    if (c === "%" || c === "(" || c === ")") { out.push({ t: c, pos: i }); i++; continue; }
    if (src.startsWith("Ans", i)) { out.push({ t: "ans", pos: i }); i += 3; continue; }
    const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
    if (m) { out.push({ t: "num", v: m[0], pos: i }); i += m[0].length; continue; }
    throw new Fail("syntax", i);
  }
  return out;
}

/** Recursive descent over the R1 grammar (docs/ARCHITECTURE.md §8). */
function parse(toks: Tok[], ans: Decimal | null): Decimal {
  let p = 0;
  let depth = 0;
  const peek = () => toks[p];
  const check = (x: Decimal, pos: number) => {
    if (!x.isFinite()) throw new Fail("overflow", pos);
    return x;
  };
  const operand = (): never => {
    const tok = peek();
    throw new Fail(tok ? "syntax" : "incomplete_expression", tok?.pos);
  };

  function expr(): Decimal {
    let v = term();
    for (let t = peek(); t?.t === "op" && (t.v === "+" || t.v === "-"); t = peek()) {
      p++;
      const r = term();
      v = check(t.v === "+" ? v.plus(r) : v.minus(r), t.pos);
    }
    return v;
  }
  function term(): Decimal {
    let v = unary();
    for (let t = peek(); t?.t === "op" && (t.v === "*" || t.v === "/"); t = peek()) {
      p++;
      const r = unary();
      if (t.v === "/" && r.isZero()) throw new Fail("divide_by_zero", t.pos);
      v = check(t.v === "*" ? v.times(r) : v.div(r), t.pos);
    }
    return v;
  }
  function unary(): Decimal {
    const t = peek();
    if (t?.t === "op" && (t.v === "-" || t.v === "+")) {
      p++;
      if (++depth > MAX_DEPTH) throw new Fail("too_long", t.pos);
      const v = unary();
      depth--;
      return t.v === "-" ? v.neg() : v;
    }
    return postfix();
  }
  function postfix(): Decimal {
    const v = primary();
    if (peek()?.t === "%") { p++; return v.div(100); } // may underflow to 0 only below 1e-9999
    return v;
  }
  function primary(): Decimal {
    const t = peek();
    if (!t) return operand();
    if (t.t === "num") { p++; return check(new D(t.v), t.pos); }
    if (t.t === "ans") {
      p++;
      if (!ans) throw new Fail("syntax", t.pos);
      return ans;
    }
    if (t.t === "(") {
      p++;
      if (++depth > MAX_DEPTH) throw new Fail("too_long", t.pos);
      const v = expr();
      depth--;
      const close = peek();
      if (!close) throw new Fail("incomplete_expression");
      if (close.t !== ")") throw new Fail("syntax", close.pos);
      p++;
      return v;
    }
    return operand();
  }

  const v = expr();
  const rest = peek();
  if (rest) throw new Fail("syntax", rest.pos);
  return v;
}

/** Canonical form (ADR 0008): decimal.js toExponential(), normalized, never "-0". */
export function toDecimalString(x: Decimal.Value): DecimalString {
  const d = new D(x);
  return (d.isZero() ? "0e+0" : d.toExponential()) as DecimalString;
}

const CANONICAL = /^-?\d(\.\d{1,33})?e[+-]\d{1,4}$/;

/** Parse a canonical DecimalString (e.g. stored Ans). Returns null if it is not canonical. */
export function parseDecimalString(s: string): DecimalString | null {
  if (s.length > 48 || !CANONICAL.test(s)) return null;
  const d = new D(s);
  return d.isFinite() && toDecimalString(d) === s ? (s as DecimalString) : null;
}

/** Evaluate an expression. Total: never throws. `Ans` resolves to `ctx.ans`. */
export function evaluate(expression: string, ctx: { ans: DecimalString | null }): Evaluation {
  try {
    if (expression.length > MAX_LENGTH) throw new Fail("too_long");
    const v = parse(tokenize(expression), ctx.ans === null ? null : new D(ctx.ans));
    return { status: "success", value: toDecimalString(v) };
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
    const error: CalcError = { code: e.code, message: MESSAGES[e.code] };
    if (e.position !== undefined) error.position = e.position;
    return { status: "error", error };
  }
}

/**
 * Display form (R1-1 §3.5): at most 12 significant digits, trailing zeros trimmed,
 * scientific at |x| >= 1e12 or 0 < |x| < 1e-6, minus as U+2212, never "-0".
 */
export function format(v: DecimalString, o: { decimalPlaces?: number | null } = {}): string {
  const raw = new D(v);
  const auto = raw.toSignificantDigits(12);
  const a = auto.abs();
  const scientific = !auto.isZero() && (a.gte("1e12") || a.lt("1e-6"));
  const n = o.decimalPlaces;
  if (n === undefined || n === null || scientific) {
    // Auto (D2), and the scientific range always wins over fixed decimals (R2-4 §5.1).
    if (auto.isZero()) return "0";
    return (auto.isNeg() ? "\u2212" : "") + (scientific ? a.toExponential() : a.toFixed());
  }
  // Fixed N: half away from zero, trailing zeros kept, never more than 12 significant digits.
  const intDigits = raw.abs().gte(1) ? raw.abs().trunc().toFixed().length : 0;
  const places = Math.max(0, Math.min(n, 12 - intDigits));
  const fixed = raw.toDecimalPlaces(places, Decimal.ROUND_HALF_UP);
  const s = fixed.abs().toFixed(places);
  return (fixed.isNeg() && !fixed.isZero() ? "\u2212" : "") + s;
}
