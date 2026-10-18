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
Option 3. `packages/engine` exports only `evaluate(expr): Evaluation` (total, never throws) and `format()`. `Evaluation` is a `success | error` discriminated union with a `CalcErrorCode`. Arithmetic uses decimal.js at precision 34 and displays 12 significant digits. Limits: 500 chars, nesting depth 100. The tokenizer normalizes `× ÷ −`. The browser evaluates for display. The server re-evaluates on `POST /calculations` and stores its own result.

## Consequences
- + No code-injection surface. The grammar is about 30 lines and fully testable with golden tables.
- + Decimal math gives `0.1+0.2 = 0.3`, which doubles (option 4) do not.
- + The error union maps directly onto the history row (`status`, `error_code`, `error_message`).
- + R4 functions add one `primary` rule. `domain` is already an error code.
- − We maintain a parser. Option 2 lost on bundle size and because it is far larger than the attack surface we need. Option 1 is unsafe.
- Open: the meaning of `%` (percent or modulo) is a single grammar rule and has to be decided before #1 is built.
