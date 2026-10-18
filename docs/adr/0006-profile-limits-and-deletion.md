# ADR 0006: Profile limits and deletion semantics

Status: Proposed · Date: 2026-10-18 · Scope: R2 (#4), affects R3

## Context
#4 needs create, rename, delete and switch. ARCHITECTURE §4 says every account has at least one profile. It doesn't say how many profiles are allowed, what deleting does to sessions and history, or whether the active profile can be deleted.

## Options
1. Unlimited profiles, soft delete (`deleted_at`).
2. **Limit of 10, hard delete with cascade, the active and the last profile can't be deleted.**
3. Delete of the active profile auto-switches to another one.

## Decision
Option 2.
- **Limit:** at most 10 profiles per account (409 `profile_limit`).
- **Names:** unique per account, case-insensitive (409 `profile_name_taken`), 1 to 40 characters, trimmed.
- **Delete:** `DELETE` is a hard delete that cascades to the profile's sessions and (R3) calculations. The last profile can't be deleted (409 `last_profile`), and neither can the profile active in the requesting session (409 `profile_active`).
- **Race safety:** the limit and last-profile checks run under `SELECT … FOR UPDATE` on the account row.
- **Other devices:** a session on another device that pointed at the deleted profile disappears with it, and that device gets 401 and logs in again into the last-used remaining profile.

## Consequences
- + No `deleted_at` filtering in every query. Retention and privacy are simple ("deleted means gone").
- + The current session never points at a missing profile, so `ProfileScope` stays valid.
- − Deletion can't be undone (the UI should confirm; question for Designer). Option 3 hides a profile switch inside a delete, which is two operations in one, and the Designer may still prefer it (R2.md question 6).
