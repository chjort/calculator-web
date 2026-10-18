# ADR 0008: Ans representation and numeric range

Status: Accepted (PO, 2026-10-18) · Scope: R1 engine, R2 (`profile.ans`), R3 (history) · Supersedes the 1024-character `ans` cap in [R2.md](../architecture/R2.md)

## Context
From R2, Ans is stored per profile on the server (ADR 0007, R2.md). The plain decimal form has no length bound: very small results expand to thousands of characters. PO requirement: a non-zero result never silently becomes 0 unless the engine can't represent it.

## Decision
- **Precision:** Ans is stored at full engine precision (34 significant digits), not as the 12-digit display string.
- **Canonical `DecimalString`:** decimal.js `toExponential()`, normalized with no trailing zeros, e.g. `1.5e-400`. The worst case is 42 characters.
- **Validation:**
  - Contracts: `z.string().max(48).regex(/^-?\d(\.\d{1,33})?e[+-]\d{1,4}$/)`.
  - DB: `CHECK (char_length(ans) <= 48)`.
- **Engine range:** `Decimal.set({precision:34, minE:-9999, maxE:9999})`.
  - Overflow returns the existing `overflow` error.
  - Non-zero values ≥ 1e-9999 are kept exactly.
  - Only values below 1e-9999, which can't be represented, become 0.
- **Grammar:** the number literal gains an optional exponent: `digits ('.' digits)? ([eE] [+-]? digits)?`.
  - The keypad never produces `e`.
  - The D12 save form substitutes Ans in canonical form (parenthesized if negative), which keeps saved expressions within 500 chars.
- **Display:** unchanged (12 significant digits; scientific at ≥ 1e12 or < 1e-6).
- **Golden tests:** `1e-400`, `1e-9999`, `1e-10000` → 0, `1e10000` → overflow, and an Ans round-trip.

**Amendment (2026-10-18):** the engine uses `Decimal.clone({precision:34, minE:-9999, maxE:9999, …})` instead of the global `Decimal.set(...)`. The settings are identical, and the engine never mutates global decimal.js state.

## Consequences
- + `ans` is bounded at 48 characters in contracts and the DB, and nothing representable is lost.
- + One canonical form serves Ans storage, the D12 save form and parsing.
- − The engine's canonical output changes from plain to exponent form, and the grammar accepts `e`. Both are covered by the golden tests.
