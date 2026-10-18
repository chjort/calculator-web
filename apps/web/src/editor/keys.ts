import type { Digit, EditorAction, Token } from "./editor";

export type KeyKind = "digit" | "op" | "fn" | "eq";
export type KeyDef = {
  id: string;
  label: string;
  /** Accessible name (R1-1 §6, R1-2 §3). Clear's label/name are dynamic (C/AC). */
  name: string;
  kind: KeyKind;
  action: EditorAction;
  /** KeyboardEvent.key values (R1-1 §7.1, R1-2 §7). */
  keyboard: readonly string[];
  wide?: boolean;
};

const input = (token: Token): EditorAction => ({ type: "input", token });
const digit = (d: Digit): KeyDef => ({ id: `d${d}`, label: d, name: d, kind: "digit", action: input({ kind: "digit", d }), keyboard: [d] });
const op = (id: string, sym: "+" | "\u2212" | "\u00d7" | "\u00f7", name: string, keyboard: string[]): KeyDef =>
  ({ id, label: sym, name, kind: "op", action: input({ kind: "op", op: sym }), keyboard });

/** The ONE key table: renders the keypad (row by row, R1-1 §2.1) and builds the keydown map. */
export const KEYS: readonly KeyDef[] = [
  { id: "clear", label: "AC", name: "All clear", kind: "fn", action: { type: "clear" }, keyboard: ["Escape", "Delete"] },
  { id: "open", label: "(", name: "Open parenthesis", kind: "op", action: input({ kind: "paren", side: "(" }), keyboard: ["("] },
  { id: "close", label: ")", name: "Close parenthesis", kind: "op", action: input({ kind: "paren", side: ")" }), keyboard: [")"] },
  { id: "backspace", label: "\u232b", name: "Backspace", kind: "fn", action: { type: "backspace" }, keyboard: ["Backspace"] },
  digit("7"), digit("8"), digit("9"),
  op("divide", "\u00f7", "Divided by", ["/"]),
  digit("4"), digit("5"), digit("6"),
  op("times", "\u00d7", "Times", ["*", "x", "X"]),
  digit("1"), digit("2"), digit("3"),
  op("minus", "\u2212", "Minus", ["-"]),
  digit("0"),
  { id: "point", label: ".", name: "Decimal point", kind: "digit", action: input({ kind: "point" }), keyboard: [".", ","] },
  { id: "percent", label: "%", name: "Percent", kind: "op", action: input({ kind: "percent" }), keyboard: ["%"] },
  op("plus", "+", "Plus", ["+"]),
  { id: "ans", label: "Ans", name: "Ans, insert last result", kind: "fn", action: input({ kind: "ans" }), keyboard: ["a", "A"] },
  { id: "equals", label: "=", name: "Equals", kind: "eq", action: { type: "evaluate" }, keyboard: ["Enter", "="], wide: true },
];

/** Numpad keys report the same `key` values ("7", ".", "/", "Enter"), so they are covered above. */
export const KEY_BY_KEYBOARD: ReadonlyMap<string, KeyDef> = new Map(KEYS.flatMap((k) => k.keyboard.map((kb) => [kb, k] as const)));
