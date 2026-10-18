import { describe, expect, it } from "vitest";
import { evaluate, format, parseDecimalString, toDecimalString, type DecimalString } from "./index";

const ok = (expr: string, ans: string | null = null) => {
  const r = evaluate(expr, { ans: ans as DecimalString | null });
  if (r.status !== "success") throw new Error(`${expr}: ${r.error.code}`);
  return format(r.value);
};
const err = (expr: string) => {
  const r = evaluate(expr, { ans: null });
  return r.status === "error" ? r.error : null;
};

describe("evaluate: operators and parentheses (#1 AC1)", () => {
  it.each([
    ["12 + 3", "15"],
    ["10 \u2212 4", "6"],
    ["10 - 14", "\u22124"],
    ["6 \u00d7 7", "42"],
    ["6 * 7", "42"],
    ["8 \u00f7 2", "4"],
    ["8 / 2", "4"],
    ["50%", "0.5"],
    ["200 + 10%", "200.1"],
    ["(2)%", "0.02"],
    ["12 \u00d7 (3 \u2212 1)", "24"],
    ["2 \u00d7 (3 + 4)", "14"],
    ["((1 + 2) \u00d7 (3 + 4))", "21"],
    ["2 + 3 \u00d7 4", "14"],
    ["3 \u00d7 \u22122", "\u22126"],
    ["\u22120 \u00d7 5", "0"],
    ["3.", "3"],
    ["Ans \u00d7 2", "30"],
  ])("%s = %s", (expr, want) => {
    expect(ok(expr, "15")).toBe(want);
  });
});

describe("evaluate: 12 significant digits (#1 AC2)", () => {
  it.each([
    ["0.1 + 0.2", "0.3"],
    ["1 \u00f7 3", "0.333333333333"],
    ["2 \u00f7 3", "0.666666666667"],
    ["1 \u00f7 3 \u00d7 3", "1"],
    ["1 \u00f7 3000000000", "3.33333333333e-10"],
    ["123456789012 + 1", "123456789013"],
    ["999999999999 + 1", "1e+12"],
    ["1234567890123456", "1.23456789012e+15"],
    ["0.00000042", "4.2e-7"],
    ["0.000001", "0.000001"],
    ["999999999999.6", "1e+12"],
  ])("%s -> %s", (expr, want) => {
    expect(ok(expr)).toBe(want);
  });

  it("keeps full precision internally (Ans is not pre-rounded)", () => {
    const r = evaluate("1 \u00f7 3", { ans: null });
    expect(r.status === "success" && r.value.length).toBeGreaterThan(30);
  });
});

describe("evaluate: errors are values, never thrown (#1 AC3)", () => {
  it.each(["8 \u00f7 0", "0 \u00f7 0", "5 \u00f7 (2 \u2212 2)", "1 \u00f7 0%"])("%s -> divide_by_zero", (expr) => {
    expect(err(expr)).toEqual(expect.objectContaining({ code: "divide_by_zero", message: "Can't divide by zero" }));
  });
  it("overflow only beyond 9.99…e9999 (ADR 0008)", () => {
    expect(err("1" + "0".repeat(99) + " \u00d7 10")).toBeNull();
    expect(err("1e9999 \u00d7 10")?.message).toBe("Number too large");
  });
  it.each(["3 +", "(", "2 \u00d7 (3 + 4", "\u2212"])("%s -> incomplete_expression", (expr) => {
    expect(err(expr)?.code).toBe("incomplete_expression");
  });
  it.each(["3 × × 2", ")", "1 2 (", "abc", "1..2", "Ans", "1e", "e5"])("%s -> syntax", (expr) => {
    expect(err(expr)?.code).toBe("syntax");
  });
  it("too long and too deep", () => {
    expect(err("1+".repeat(300) + "1")?.code).toBe("too_long");
    expect(err("(".repeat(101) + "1" + ")".repeat(101))?.code).toBe("too_long");
  });
});

describe("format", () => {
  it("handles -0 and negatives", () => {
    expect(format("-0" as DecimalString)).toBe("0");
    expect(format("-7" as DecimalString)).toBe("\u22127");
  });
});

const value = (expr: string, ans: string | null = null) => {
  const r = evaluate(expr, { ans: ans as DecimalString | null });
  return r.status === "success" ? r.value : r.error.code;
};

describe("ADR 0008 golden tests: canonical Ans and numeric range", () => {
  it("1e-400 stays 1e-400 (never silently 0)", () => {
    expect(value("1e-400")).toBe("1e-400");
    expect(value("1 \u00f7 1e400")).toBe("1e-400");
    expect(format(value("1e-400") as DecimalString)).toBe("1e-400");
  });
  it("1e-9999 stays", () => expect(value("1e-9999")).toBe("1e-9999"));
  it("1e-10000 becomes 0 (not representable)", () => {
    expect(value("1e-10000")).toBe("0e+0");
    expect(value("1e-9999 \u00f7 10")).toBe("0e+0");
  });
  it("1e10000 gives overflow", () => expect(value("1e10000")).toBe("overflow"));
  it("9.99…e9999 is still representable", () => expect(value("9.99e9999")).toBe("9.99e+9999"));
  it("canonical form is toExponential(), max 34 significant digits, at most 48 chars", () => {
    expect(value("12.5")).toBe("1.25e+1");
    expect(value("\u221210 \u00f7 3")).toBe("-3.333333333333333333333333333333333e+0");
    expect(value("0")).toBe("0e+0");
    expect(value("\u22120 \u00d7 5")).toBe("0e+0");
    expect(value("\u22121 \u00f7 3 \u00d7 1e-9990")!.length).toBeLessThanOrEqual(48);
  });
  it.each(["1.5e-400", "-3.333333333333333333333333333333333e+0", "1e+12", "0e+0", "9.99e+9999"])(
    "Ans round-trip %s: serialize, parse, equal",
    (s) => {
      const parsed = parseDecimalString(s);
      expect(parsed).toBe(s);
      expect(toDecimalString(parsed!)).toBe(s);
      expect(value("Ans", s)).toBe(s);
    },
  );
  it("rejects non-canonical strings", () => {
    for (const s of ["12.5", "1.50e+1", "1e+10000", "abc", "-0e+0", "1." + "1".repeat(34) + "e+0"]) {
      expect(parseDecimalString(s)).toBeNull();
    }
  });
  it("Ans keeps full precision: (1 ÷ 3) then Ans × 3 = 1", () => {
    expect(format(value("Ans \u00d7 3", value("1 \u00f7 3")) as DecimalString)).toBe("1");
  });
});

describe("format with decimal places (R2-4 §5.1)", () => {
  const f = (expr: string, n: number | null) => format(value(expr) as DecimalString, { decimalPlaces: n });
  it.each([
    ["2 \u00f7 3", null, "0.666666666667"],
    ["0.1 + 0.2", 2, "0.30"],
    ["2 \u00f7 3", 2, "0.67"],
    ["\u22122.345", 2, "\u22122.35"],
    ["2.5", 0, "3"],
    ["123456789.12345", 4, "123456789.123"],
    ["1e15 + 1", 2, "1e+15"],
    ["1 \u00f7 3000000000", 2, "3.33333333333e-10"],
    ["0.004", 2, "0.00"],
    ["\u22120.004", 2, "0.00"],
  ] as const)("%s at %s -> %s", (expr, n, want) => expect(f(expr, n)).toBe(want));
});
