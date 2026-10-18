# ADR 0002: Expression evaluation

Status: Proposed · Date: 2026-10-18 · Scope: R1 (#1, #2), extended in R4 (#9)

## Context
We need +, −, ×, ÷, %, parentheses, at least 12 significant digits, and a clear error on divide by zero (#1). Failed calculations are saved (R3), so errors must be values, not exceptions. From R3 the server evaluates user-supplied strings, so evaluation is a security boundary.

## Options
1. `eval` / `new Function` on sanitized input.
2. A third-party expression library (e.g. mathjs).
3. **A hand-written tokenizer and recursive-descent parser over a closed grammar, using `decimal.js`.**
4. IEEE-754 doubles, rounded on display.

## Decision
Option 3. `packages/engine` exports only `evaluate(expr, { ans }): Evaluation` (total, never throws) and `format()`. `Evaluation` is a `success | error` discriminated union with a `CalcErrorCode`. Arithmetic uses decimal.js at precision 34 and displays 12 significant digits. Limits: 500 chars, nesting depth 100. The tokenizer normalizes `× ÷ −`. `%` is postfix `x ÷ 100`, so `200 + 10% = 200.1` (matches the Designer spec; pending PO). `Ans` is a grammar primary resolved from `ctx.ans` at evaluation.

The web editor is **token-based** (`Token` union: digit, point, operator, unary minus, `%`, bracket, Ans), per the Designer specs R1-1/R1-2. Input is guarded, so invalid keys are no-ops. Backspace pops one token, so Ans goes in one step. Implicit × and auto-closed `)` become real, visible tokens, and incomplete expressions show a hint instead of being evaluated. A single `toExpression(tokens)` serializer turns tokens into the engine string. The browser evaluates for display. The server re-evaluates on `POST /calculations` and stores its own result.

## Consequences
- + No code-injection surface. The grammar is about 30 lines and fully testable with golden tables.
- + Decimal math gives `0.1+0.2 = 0.3`, which doubles (option 4) do not.
- + The error union maps directly onto the history row (`status`, `error_code`, `error_message`).
- + R4 functions add one `primary` rule. `domain` is already an error code.
- − We maintain a parser. Option 2 lost on bundle size and because it is far larger than the attack surface we need. Option 1 is unsafe.
- + Tokens make backspace-by-token and the one-step Ans trivial, and keep the grammar free of implicit-× rules.
- − History stores `ans` next to the expression (`Ans × 2` alone can't be reproduced). The server takes `ans` from the client, which is fine because it is the user's own previous result.
- Open: `%` = ÷100 still needs PO confirmation. It is a single grammar rule.
