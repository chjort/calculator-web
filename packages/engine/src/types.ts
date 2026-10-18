type Brand<T, B extends string> = T & { readonly __brand: B };

/** Canonical decimal string, e.g. "-12.5". Never exponent form, never "-0". */
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
