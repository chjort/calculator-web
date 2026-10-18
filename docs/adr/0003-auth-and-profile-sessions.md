# ADR 0003: Accounts, sessions and profile scoping

Status: Accepted · Date: 2026-10-18 · Scope: R2 (#3, #4), R3 (#5)

## Context
Accounts are required. Each account has several private profiles. "Sessions" (#5) start on login, are tracked per profile, end on logout or after 30 min of inactivity, and switching profile starts a new one. Calculations are grouped by session. No profile can see another profile's data.

## Options
1. JWT for auth, plus a separate "profile session" table for grouping.
2. A server-side auth session, plus a separate profile-session table.
3. **One server-side `session` row per (login × active profile), used for both auth and grouping.**

## Decision
Option 3. Each `session` row has `account_id`, `profile_id`, `started_at`, `last_seen_at`, `ended_at` and `end_reason`. The cookie `__Host-sid` holds an opaque 256-bit token, and only its SHA-256 is stored. Idle for more than 30 min means the session ends (`timeout`) and the user gets a 401 and must log in again (PO-confirmed). Login opens the last-used profile, which is the profile of the account's session with the latest `last_seen_at`, falling back to the oldest profile. `last_seen_at` is written at most once a minute. Switching profile ends the session (`profile_switch`), opens a new one and rotates the cookie. **Amended for R2 (PO, 2026-10-18):** there is also an absolute lifetime of 12 h. `expires_at` is set at login and copied to the new session on a profile switch, so switching can't extend it. Reaching it ends the session (`expired`) and forces a fresh login. The cap is an essential security limit under the WCAG 2.2.1 exception. `MeResponse.session.expiresAt` drives a client notice 10 minutes ahead, and unsaved input is restored after re-login to the same account in the same tab (sessionStorage, never sent to the server). The web app keeps active users logged in with `POST /api/session/touch`, sent only after real input and at most once a minute (R2.md §4). Passwords use argon2id. Middleware turns the cookie into a module-private `ProfileScope`, and every repository call needs one. History endpoints never take a profile id.

## Consequences
- + One owner for "who is active where". #5 comes for free once R2 is in.
- + Logout and revocation are immediate, which JWT (option 1) can't do without a denylist.
- + IDOR on history is structurally impossible, and a composite FK `(session_id, profile_id)` stops a calculation from landing in another profile.
- − A DB read on every request, which is fine at this scale. Idle timeout forces a re-login, which is accepted by the PO.
