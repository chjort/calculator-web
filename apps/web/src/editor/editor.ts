import { evaluate, format, type CalcError, type DecimalString } from "@calc/engine";

export type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
export type Op = "+" | "\u2212" | "\u00d7" | "\u00f7";
export type Token =
  | { kind: "digit"; d: Digit }
  | { kind: "point" }
  | { kind: "op"; op: Op }
  | { kind: "neg" }
  | { kind: "percent" }
  | { kind: "paren"; side: "(" | ")" }
  | { kind: "ans" };

export type EditorState =
  | { mode: "empty" }
  | { mode: "typing" | "hint"; tokens: readonly Token[] }
  | { mode: "result"; tokens: readonly Token[]; value: DecimalString }
  | { mode: "error"; tokens: readonly Token[]; error: CalcError };

/** Transient input feedback shown on the result line; cleared by the next action. */
export type Notice = "ans_empty" | "max_length";

export type Editor = {
  state: EditorState;
  ans: DecimalString | null;
  notice: Notice | null;
  /** Text for the polite status region; null = announce nothing (no-op). */
  announcement: string | null;
};

export type EditorAction =
  | { type: "input"; token: Token }
  | { type: "backspace" }
  | { type: "clear" }
  | { type: "evaluate" };

export const MAX_EXPRESSION_LENGTH = 100;
export const COPY = {
  incomplete: "Finish the expression",
  ansEmpty: "No previous result yet",
  maxLength: "Maximum length reached",
  cleared: "Cleared",
  allCleared: "All cleared. Last result removed.",
} as const;

export const initialEditor: Editor = { state: { mode: "empty" }, ans: null, notice: null, announcement: null };

const T = {
  times: { kind: "op", op: "\u00d7" } as Token,
  zero: { kind: "digit", d: "0" } as Token,
  close: { kind: "paren", side: ")" } as Token,
};

// ---------- serializer (the ONE token -> string function) ----------

function tokenText(t: Token, ans?: DecimalString): string {
  switch (t.kind) {
    case "digit": return t.d;
    case "point": return ".";
    case "op": return ` ${t.op} `;
    case "neg": return "\u2212";
    case "percent": return "%";
    case "paren": return t.side;
    case "ans":
      if (ans === undefined) return "Ans";
      return ans.startsWith("-") ? `(${ans})` : ans;
  }
}

/** Display/eval form "Ans × −2"; save form (R3, D12) substitutes Ans with its value. */
export function toExpression(tokens: readonly Token[], o?: { substituteAns: DecimalString }): string {
  return tokens.map((t) => tokenText(t, o?.substituteAns)).join("").trim();
}

// ---------- spoken forms (R1-1 §6/§7.3) ----------

const SPOKEN_OP: Record<Op, string> = { "+": "plus", "\u2212": "minus", "\u00d7": "times", "\u00f7": "divided by" };

export function spokenToken(t: Token): string {
  switch (t.kind) {
    case "digit": return t.d;
    case "point": return "point";
    case "op": return SPOKEN_OP[t.op];
    case "neg": return "negative";
    case "percent": return "percent";
    case "paren": return t.side === "(" ? "open parenthesis" : "close parenthesis";
    case "ans": return "Ans";
  }
}

export function spokenExpression(tokens: readonly Token[]): string {
  const words: string[] = [];
  let num = "";
  for (const t of tokens) {
    if (t.kind === "digit" || t.kind === "point") { num += t.kind === "digit" ? t.d : "."; continue; }
    if (num) { words.push(num); num = ""; }
    words.push(spokenToken(t));
  }
  if (num) words.push(num);
  return words.join(" ");
}

export function spokenNumber(display: string): string {
  const s = display.replace("\u2212", "minus ");
  const m = /^(.*)e([+-])(\d+)$/.exec(s);
  if (!m) return s;
  return `${m[1]} times 10 to the power ${m[2] === "-" ? "minus " : ""}${m[3]}`;
}

// ---------- input guard (R1-1 §1.3) ----------

const isNumberPart = (t: Token | undefined) => t?.kind === "digit" || t?.kind === "point";
const isOperandEnd = (t: Token | undefined) =>
  isNumberPart(t) || t?.kind === "percent" || t?.kind === "ans" || (t?.kind === "paren" && t.side === ")");
/** After ), Ans or %, a new operand needs an implicit ×. */
const needsTimes = (t: Token | undefined) =>
  t?.kind === "ans" || t?.kind === "percent" || (t?.kind === "paren" && t.side === ")");

function currentNumber(tokens: readonly Token[]): Token[] {
  let i = tokens.length;
  while (i > 0 && isNumberPart(tokens[i - 1])) i--;
  return tokens.slice(i);
}

function openParens(tokens: readonly Token[]): number {
  let n = 0;
  for (const t of tokens) if (t.kind === "paren") n += t.side === "(" ? 1 : -1;
  return n;
}

/** Tokens to append for `token`, or null for a no-op. May replace trailing tokens (returns new array). */
function applyInput(tokens: readonly Token[], token: Token, ans: DecimalString | null): Token[] | null {
  const last = tokens[tokens.length - 1];
  switch (token.kind) {
    case "digit": {
      const num = currentNumber(tokens);
      if (num.length === 1 && num[0]!.kind === "digit" && num[0]!.d === "0") return [...tokens.slice(0, -1), token];
      return [...tokens, ...(needsTimes(last) ? [T.times] : []), token];
    }
    case "point": {
      const num = currentNumber(tokens);
      if (num.some((t) => t.kind === "point")) return null;
      if (num.length > 0) return [...tokens, token];
      return [...tokens, ...(needsTimes(last) ? [T.times] : []), T.zero, token];
    }
    case "op": {
      if (token.op === "\u2212") {
        if (!last || last.kind === "paren" && last.side === "(" || last.kind === "op" && (last.op === "\u00d7" || last.op === "\u00f7")) {
          return [...tokens, { kind: "neg" }];
        }
        if (last.kind === "neg") return null;
        if (last.kind === "op") return [...tokens.slice(0, -1), token];
        return [...tokens, token];
      }
      if (isOperandEnd(last)) return [...tokens, token];
      // replace trailing operator(s), incl. a unary minus: "3 × −" + "+" -> "3 +"
      let i = tokens.length;
      while (i > 0 && (tokens[i - 1]!.kind === "op" || tokens[i - 1]!.kind === "neg")) i--;
      if (i === tokens.length || !isOperandEnd(tokens[i - 1])) return null;
      return [...tokens.slice(0, i), token];
    }
    case "percent":
      return isNumberPart(last) || last?.kind === "ans" || (last?.kind === "paren" && last.side === ")")
        ? [...tokens, token]
        : null;
    case "paren":
      if (token.side === "(") return [...tokens, ...(isOperandEnd(last) ? [T.times] : []), token];
      return openParens(tokens) > 0 && isOperandEnd(last) ? [...tokens, token] : null;
    case "ans":
      if (ans === null) return null;
      return [...tokens, ...(isOperandEnd(last) ? [T.times] : []), token];
    case "neg":
      return null; // produced by the guard only
  }
}

function tokensOf(s: EditorState): readonly Token[] {
  return s.mode === "empty" ? [] : s.tokens;
}

function announceAdded(added: readonly Token[]): string {
  // An auto-prefixed 0 before "." is not announced separately.
  return added
    .filter((t, i) => !(t.kind === "digit" && t.d === "0" && added[i + 1]?.kind === "point"))
    .map(spokenToken).join(", ");
}

function input(e: Editor, token: Token): Editor {
  const base: Editor = { ...e, notice: null, announcement: null };
  if (token.kind === "ans" && e.ans === null) {
    return { ...base, notice: "ans_empty", announcement: COPY.ansEmpty };
  }
  const s = e.state;
  let before: readonly Token[];
  if (s.mode === "result" || s.mode === "error") {
    if (token.kind === "op") {
      if (e.ans === null) return base;
      before = [{ kind: "ans" }];
    } else if (token.kind === "digit" || token.kind === "point" || token.kind === "ans" || (token.kind === "paren" && token.side === "(")) {
      before = [];
    } else {
      return base; // %, ) on a finished calculation: no-op
    }
  } else {
    before = tokensOf(s);
  }
  const next = applyInput(before, token, e.ans);
  if (!next) return base;
  if (toExpression(next).length > MAX_EXPRESSION_LENGTH) {
    return { ...base, notice: "max_length", announcement: COPY.maxLength };
  }
  // what changed, for the announcement: the common prefix is kept, the rest is new
  let k = 0;
  while (k < before.length && k < next.length && before[k] === next[k]) k++;
  const added = next.slice(k);
  const announcement = (s.mode === "result" || s.mode === "error") && token.kind === "op"
    ? `Ans ${spokenToken(token)}`
    : announceAdded(added);
  return { ...base, state: { mode: "typing", tokens: next }, announcement };
}

function evaluateEditor(e: Editor): Editor {
  const base: Editor = { ...e, notice: null, announcement: null };
  const s = e.state;
  if (s.mode !== "typing" && s.mode !== "hint") return base; // empty, or repeated "=" (D4)
  const last = s.tokens[s.tokens.length - 1];
  if (!isOperandEnd(last)) {
    return { ...base, state: { mode: "hint", tokens: s.tokens }, announcement: COPY.incomplete };
  }
  const tokens = [...s.tokens, ...Array<Token>(openParens(s.tokens)).fill(T.close)];
  const r = evaluate(toExpression(tokens), { ans: e.ans });
  if (r.status === "error") {
    if (r.error.code === "incomplete_expression") {
      return { ...base, state: { mode: "hint", tokens: s.tokens }, announcement: COPY.incomplete };
    }
    return { ...base, state: { mode: "error", tokens, error: r.error }, announcement: `Error: ${r.error.message}` };
  }
  return {
    ...base,
    state: { mode: "result", tokens, value: r.value },
    ans: r.value,
    announcement: `${spokenExpression(tokens)} equals ${spokenNumber(format(r.value))}`,
  };
}

function backspace(e: Editor): Editor {
  const base: Editor = { ...e, notice: null, announcement: null };
  const s = e.state;
  if (s.mode === "empty") return base;
  if (s.mode === "result" || s.mode === "error") {
    return { ...base, state: { mode: "typing", tokens: s.tokens }, announcement: `Editing ${spokenExpression(s.tokens)}` };
  }
  const removed = s.tokens[s.tokens.length - 1]!;
  const rest = s.tokens.slice(0, -1);
  const said = `Deleted ${spokenToken(removed)}`;
  if (rest.length === 0) return { ...base, state: { mode: "empty" }, announcement: `${said}. Empty.` };
  return { ...base, state: { mode: "typing", tokens: rest }, announcement: said };
}

function clear(e: Editor): Editor {
  if (e.state.mode !== "empty") {
    return { ...e, state: { mode: "empty" }, notice: null, announcement: COPY.cleared };
  }
  if (e.ans !== null) return { ...initialEditor, announcement: COPY.allCleared };
  return { ...e, notice: null, announcement: null };
}

export function reduce(e: Editor, a: EditorAction): Editor {
  switch (a.type) {
    case "input": return input(e, a.token);
    case "evaluate": return evaluateEditor(e);
    case "backspace": return backspace(e);
    case "clear": return clear(e);
  }
}
