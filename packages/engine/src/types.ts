type Brand<T, B extends string> = T & { readonly __brand: B };

/** Canonical decimal string (ADR 0008): decimal.js toExponential(), e.g. "-1.25e+1", "1.5e-400". Never "-0". */
export type DecimalString = Brand<string, "DecimalString">;

export type CalcErrorCode =
  | "syntax"
  | "incomplete_expression"
  | "divide_by_zero"
  | "overflow"
  | "domain"
  | "too_long";

export type CalcError = { code: CalcErrorCode; message: string; position?: number };

export type Evaluation =
  | { status: "success"; value: DecimalString }
  | { status: "error"; error: CalcError };
