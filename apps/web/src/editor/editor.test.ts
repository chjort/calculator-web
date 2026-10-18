import { format, type DecimalString } from "@calc/engine";
import { describe, expect, it } from "vitest";
import { COPY, initialEditor, reduce, toExpression, type Editor } from "./editor";
import { KEYS } from "./keys";

/** Press keys by their visible label, space-separated, e.g. "1 2 + 3 =". "C" = the clear key, "⌫" = backspace. */
function press(seq: string, from: Editor = initialEditor): Editor {
  return seq.split(" ").filter(Boolean).reduce((e, label) => {
    const k = label === "C" ? KEYS[0]! : KEYS.find((x) => x.label === label);
    if (!k) throw new Error(`no key ${label}`);
    return reduce(e, k.action);
  }, from);
}

/** What the user sees: [expression line, result line, Ans status row]. */
function view(e: Editor): [string, string, string] {
  const s = e.state;
  const expr = s.mode === "empty" ? "" : toExpression(s.tokens) + (s.mode === "result" || s.mode === "error" ? " =" : "");
  let result = "";
  if (e.notice) result = e.notice === "ans_empty" ? COPY.ansEmpty : COPY.maxLength;
  else if (s.mode === "empty") result = "0";
  else if (s.mode === "hint") result = COPY.incomplete;
  else if (s.mode === "result") result = format(s.value);
  else if (s.mode === "error") result = `Error: ${s.error.message}`;
  return [expr, result, e.ans === null ? "" : `Ans = ${format(e.ans)}`];
}
const shows = (seq: string, from?: Editor) => view(press(seq, from)).slice(0, 2);

describe("#1 AC1: +, −, ×, ÷, % and parentheses", () => {
  it.each([
    ["1 2 + 3 =", "12 + 3 =", "15"],
    ["9 − 4 =", "9 − 4 =", "5"],
    ["6 × 7 =", "6 × 7 =", "42"],
    ["8 ÷ 2 =", "8 ÷ 2 =", "4"],
    ["5 0 % =", "50% =", "0.5"],
    ["2 0 0 + 1 0 % =", "200 + 10% =", "200.1"],
    ["1 2 × ( 3 − 1 ) =", "12 × (3 − 1) =", "24"],
    ["2 + 3 × 4 =", "2 + 3 × 4 =", "14"],
    ["3 × − 2 =", "3 × −2 =", "−6"],
    ["− 0 × 5 =", "−0 × 5 =", "0"],
  ])("%s", (seq, expr, result) => {
    expect(shows(seq)).toEqual([expr, result]);
  });

  it("S10: auto-closes missing parentheses and shows them", () => {
    expect(shows("2 × ( 3 + 4 =")).toEqual(["2 × (3 + 4) =", "14"]);
    expect(shows("( 1 + 2 =")).toEqual(["(1 + 2) =", "3"]);
  });

  it.each([
    ["3 + ×", "3 ×"],
    ["3 × −", "3 × −"],
    ["3 × − +", "3 +"],
    ["3 + −", "3 −"],
    ["×", ""],
    ["+", ""],
    ["0 0 7", "7"],
    [". 5", "0.5"],
    ["1 . 2 .", "1.2"],
    ["( 2 ) .", "(2) × 0."],
    ["2 (", "2 × ("],
    ["( 2 ) 3", "(2) × 3"],
    [")", ""],
    ["( )", "("],
    ["5 0 % %", "50%"],
    ["5 + %", "5 +"],
    ["( −", "(−"],
    ["3 × − −", "3 × −"],
  ])("input guard: %s -> %s", (seq, expr) => {
    expect(shows(seq)[0]).toBe(expr);
  });

  it("S2/S3 announcements", () => {
    expect(press("1 2 +").announcement).toBe("plus");
    expect(press("2 (").announcement).toBe("times, open parenthesis");
    expect(press("1 2 + 3 =").announcement).toBe("12 plus 3 equals 15");
  });

  it("S7: = on an incomplete expression shows the hint and keeps it editable", () => {
    const e = press("3 + =");
    expect(view(e).slice(0, 2)).toEqual(["3 +", "Finish the expression"]);
    expect(e.announcement).toBe("Finish the expression");
    expect(shows("4 =", e)).toEqual(["3 + 4 =", "7"]);
  });

  it("= on empty is a no-op; repeated = is a no-op (D4)", () => {
    expect(press("=")).toEqual(initialEditor);
    const r = press("2 + 3 =");
    const again = press("=", r);
    expect(again.state).toBe(r.state);
    expect(again.announcement).toBeNull();
  });

  it("S9: max length 100 chars", () => {
    const e = press("1 ".repeat(101));
    expect(view(e)).toEqual(["1".repeat(100), COPY.maxLength, ""]);
    expect(e.announcement).toBe("Maximum length reached");
  });

  it("result then digit starts a new expression; result then operator chains with Ans (S4)", () => {
    const r = press("1 2 + 3 =");
    expect(shows("7", r)).toEqual(["7", ""]);
    const chained = press("× 2 =", r);
    expect(view(chained)).toEqual(["Ans × 2 =", "30", "Ans = 30"]);
    expect(chained.announcement).toBe("Ans times 2 equals 30");
    expect(shows("%", r)).toEqual(["12 + 3 =", "15"]);
  });
});

describe("#1 AC2: results accurate to 12 significant digits", () => {
  it.each([
    ["0 . 1 + 0 . 2 =", "0.3"],
    ["1 ÷ 3 =", "0.333333333333"],
    ["2 ÷ 3 =", "0.666666666667"],
    ["1 ÷ 3 × 3 =", "1"],
    ["1 ÷ 3 0 0 0 0 0 0 0 0 0 =", "3.33333333333e-10"],
    ["9 9 9 9 9 9 9 9 9 9 9 9 + 1 =", "1e+12"],
    ["1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 =", "1.23456789012e+15"],
  ])("%s -> %s", (seq, result) => {
    expect(shows(seq)[1]).toBe(result);
  });

  it("Ans keeps full precision: (1 ÷ 3) then Ans × 3 = 1", () => {
    expect(shows("1 ÷ 3 = × 3 =")[1]).toBe("1");
  });

  it("S6: overflow shows Number too large (beyond 9.99…e9999, ADR 0008)", () => {
    let e = press("9 9 9 9 9 9 9 9 9 9 9 9 =");
    for (let i = 0; i < 9; i++) e = press("× 9 9 9 9 9 9 9 9 9 9 9 9 =", e);
    expect(view(e)[1]).toBe("9.9999999999e+119");
    e = press("Ans × 1 0 =", { ...initialEditor, ans: "9e+9999" as DecimalString });
    expect(view(e)[1]).toBe("Error: Number too large");
  });
});

describe("#1 AC3: dividing by zero shows a clear error instead of crashing", () => {
  it.each(["8 ÷ 0 =", "0 ÷ 0 =", "5 ÷ ( 2 − 2 ) ="])("%s", (seq) => {
    const e = press(seq);
    expect(view(e)[1]).toBe("Error: Can't divide by zero");
    expect(e.announcement).toBe("Error: Can't divide by zero");
  });

  it("recovers: digit starts new, operator chains from Ans if set, else no-op", () => {
    const err = press("8 ÷ 0 =");
    expect(shows("7", err)).toEqual(["7", ""]);
    expect(shows("+", err)).toEqual(["8 ÷ 0 =", "Error: Can't divide by zero"]);
    const withAns = press("1 5 = 8 ÷ 0 =");
    expect(view(withAns)[2]).toBe("Ans = 15");
    expect(shows("+", withAns)).toEqual(["Ans +", ""]);
  });
});

describe("#2 AC1: C/AC resets the current expression", () => {
  it("C clears the display and keeps Ans; AC then forgets Ans (D8)", () => {
    const r = press("1 2 + 3 =");
    const c = press("C", r);
    expect(view(c)).toEqual(["", "0", "Ans = 15"]);
    expect(c.announcement).toBe("Cleared");
    const ac = press("C", c);
    expect(view(ac)).toEqual(["", "0", ""]);
    expect(ac.announcement).toBe("All cleared. Last result removed.");
    expect(press("C", ac)).toEqual({ ...initialEditor });
  });

  it.each(["1 2 +", "3 + =", "8 ÷ 0 ="])("C in %s -> Empty", (seq) => {
    expect(view(press(`${seq} C`))).toEqual(["", "0", ""]);
  });
});

describe("#2 AC2: Backspace removes the last entered character", () => {
  it("multi-digit: 123 -> 12 -> 1 -> Empty", () => {
    expect(shows("1 2 3 ⌫")[0]).toBe("12");
    expect(shows("1 2 3 ⌫ ⌫")[0]).toBe("1");
    const e = press("1 2 3 ⌫ ⌫ ⌫");
    expect(view(e)).toEqual(["", "0", ""]);
    expect(e.announcement).toBe("Deleted 1. Empty.");
  });
  it.each([
    ["1 2 + ⌫", "12", "Deleted plus"],
    ["2 ( ⌫", "2 ×", "Deleted open parenthesis"],
    ["2 ( ⌫ ⌫", "2", "Deleted times"],
    [". ⌫", "0", "Deleted point"],
    ["3 + = ⌫", "3", "Deleted plus"],
  ])("%s -> %s", (seq, expr, said) => {
    const e = press(seq);
    expect(view(e).slice(0, 2)).toEqual([expr, ""]);
    expect(e.announcement).toBe(said);
  });
  it("removes Ans as one token (D9)", () => {
    const e = press("1 5 = 5 × Ans ⌫");
    expect(view(e)[0]).toBe("5 ×");
    expect(e.announcement).toBe("Deleted Ans");
  });
  it("after a result: undo = and keep Ans (D10)", () => {
    const e = press("1 2 + 3 = ⌫");
    expect(view(e)).toEqual(["12 + 3", "", "Ans = 15"]);
    expect(e.announcement).toBe("Editing 12 plus 3");
    expect(shows("⌫", e)[0]).toBe("12 +");
  });
  it("after auto-closed parens: the ) stays", () => {
    expect(shows("( 1 + 2 = ⌫")[0]).toBe("(1 + 2)");
  });
  it("after an error: back to editing the failed expression", () => {
    expect(shows("8 ÷ 0 = ⌫")).toEqual(["8 ÷ 0", ""]);
  });
  it("on empty: no-op", () => {
    expect(press("⌫")).toEqual(initialEditor);
  });
});

describe("#2 AC3: the last result can be inserted (Ans)", () => {
  it("Ans updates on success, never on error", () => {
    expect(view(press("1 2 + 3 ="))[2]).toBe("Ans = 15");
    expect(view(press("1 2 + 3 = 8 ÷ 0 ="))[2]).toBe("Ans = 15");
    expect(view(press("1 2 + 3 = 3 + ="))[2]).toBe("Ans = 15");
  });
  it("Ans key inserts Ans; implicit × around it", () => {
    const r = press("1 5 =");
    expect(shows("Ans", r)[0]).toBe("Ans");
    expect(shows("Ans × 2 =", r)).toEqual(["Ans × 2 =", "30"]);
    expect(shows("5 Ans", r)[0]).toBe("5 × Ans");
    expect(shows("Ans Ans", r)[0]).toBe("Ans × Ans");
    expect(shows("Ans 5", r)[0]).toBe("Ans × 5");
    expect(shows("Ans (", r)[0]).toBe("Ans × (");
    expect(shows("Ans .", r)[0]).toBe("Ans × 0.");
    expect(press("5 Ans", r).announcement).toBe("times, Ans");
  });
  it("negative Ans: 5 − Ans = 12 when Ans = −7", () => {
    const r = press("0 − 7 =");
    expect(view(r)[2]).toBe("Ans = −7");
    expect(shows("5 − Ans =", r)[1]).toBe("12");
    const typed = press("5 − Ans", r).state;
    expect(typed.mode === "typing" && toExpression(typed.tokens, { substituteAns: r.ans! })).toBe("5 − (-7e+0)"); // canonical Ans in the D12 save form (ADR 0008)
  });
  it("Ans when empty: no-op + hint until next key", () => {
    const e = press("Ans");
    expect(view(e)).toEqual(["", COPY.ansEmpty, ""]);
    expect(e.announcement).toBe("No previous result yet");
    expect(view(press("7", e))).toEqual(["7", "", ""]);
  });
});
