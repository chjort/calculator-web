import Decimal from "decimal.js";
import type { CalcError, CalcErrorCode, DecimalString, Evaluation } from "./types";

const D = Decimal.clone({ precision: 34, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -9e15, toExpPos: 9e15 });

export const MAX_LENGTH = 500;
export const MAX_DEPTH = 100;
const OVERFLOW = new D("1e100");

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
    const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
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
    if (x.abs().gte(OVERFLOW)) throw new Fail("overflow", pos);
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
    if (peek()?.t === "%") { p++; return v.div(100); }
    return v;
  }
  function primary(): Decimal {
    const t = peek();
    if (!t) return operand();
    if (t.t === "num") { p++; return new D(t.v); }
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

function toDecimalString(x: Decimal): DecimalString {
  return (x.isZero() ? "0" : x.toFixed()) as DecimalString;
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
export function format(v: DecimalString, o: { decimalPlaces?: number } = {}): string {
  let x = new D(v);
  x = o.decimalPlaces === undefined ? x.toSignificantDigits(12) : x.toDecimalPlaces(o.decimalPlaces);
  if (x.isZero()) return "0";
  const a = x.abs();
  const s = a.gte("1e12") || a.lt("1e-6") ? a.toExponential() : a.toFixed();
  return (x.isNeg() ? "\u2212" : "") + s;
}
