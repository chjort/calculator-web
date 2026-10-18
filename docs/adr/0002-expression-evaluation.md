# ADR 0002: Expression evaluation

Status: Accepted · Date: 2026-10-18 · Scope: R1 (#1, #2), extended in R4 (#9)

## Context
We need +, −, ×, ÷, %, parentheses, at least 12 significant digits, and a clear error on divide by zero (#1). Failed calculations are saved (R3), so errors must be values, not exceptions. From R3 the server evaluates user-supplied strings, so evaluation is a security boundary.

## Options
1. `eval` / `new Function` on sanitized input.
2. A third-party expression library (e.g. mathjs).
3. **A hand-written tokenizer and recursive-descent parser over a closed grammar, using `decimal.js`.**
4. IEEE-754 doubles, rounded on display.

## Decision
Option 3. `packages/engine` exports only `evaluate(expr, { ans }): Evaluation` (total, never throws) and `format()`. `Evaluation` is a `success | error` discriminated union with a `CalcErrorCode`. Arithmetic uses decimal.js at precision 34 and displays 12 significant digits. Limits: 500 chars, nesting depth 100. The tokenizer normalizes `× ÷ −`. `%` is postfix `x ÷ 100`, so `200 + 10% = 200.1` (D1, PO-confirmed). `Ans` is a grammar primary resolved from `ctx.ans` at evaluation.

**Amendment (ADR 0008, 2026-10-18):**
- The range is `Decimal.set({precision:34, minE:-9999, maxE:9999})`. Overflow returns `overflow`, and only values below 1e-9999 become 0.
- The canonical `DecimalString` is the normalized `toExponential()` form (≤ 48 chars).
- The number literal accepts an optional exponent `([eE] [+-]? digits)?`.
- Display is unchanged.

The web editor is **token-based** (`Token` union: digit, point, operator, unary minus, `%`, bracket, Ans), per the Designer specs R1-1/R1-2. Input is guarded, so invalid keys are no-ops. Backspace pops one token, so Ans goes in one step. Implicit × and auto-closed `)` become real, visible tokens, and an expression that ends where an operand is expected returns `incomplete_expression`: the UI shows the hint, and from R3 it is saved as an error entry (D3). A single `toExpression(tokens)` serializer turns tokens into the engine string. Its save form substitutes Ans with its value (D12), so stored entries are self-contained. The browser evaluates for display. The server re-evaluates on `POST /calculations` and stores its own result.

## Consequences
- + No code-injection surface. The grammar is about 30 lines and fully testable with golden tables.
- + Decimal math gives `0.1+0.2 = 0.3`, which doubles (option 4) do not.
- + The error union maps directly onto the history row (`status`, `error_code`, `error_message`).
- + R4 functions add one `primary` rule. `domain` is already an error code.
- − We maintain a parser. Option 2 lost on bundle size and because it is far larger than the attack surface we need. Option 1 is unsafe.
- + Tokens make backspace-by-token and the one-step Ans trivial, and keep the grammar free of implicit-× rules.
- + With Ans substituted (D12), the server never needs an Ans value and history needs no `ans` column. The save payload rejects `Ans`.
