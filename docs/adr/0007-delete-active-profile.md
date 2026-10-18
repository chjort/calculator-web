# ADR 0007: Deleting the active profile

Status: Accepted (PO, 2026-10-18) · Scope: R2 (#4) · Supersedes the "active profile can't be deleted" part of [ADR 0006](0006-profile-limits-and-deletion.md)

## Context
The approved R2 UX spec (R2-4 DS6) allows deleting the active profile. The app then switches to the most recently used remaining profile, and the last profile still can't be deleted. ADR 0006 rejected this with 409 `profile_active`. The 12 h cap (ADR 0003) must not be extended by the switch.

## Options
1. Keep 409 and have the client switch first, then delete. That's two calls, and a failure in between leaves the user on an unexpected profile.
2. **The server does the delete and the switch in one transaction.**
3. Soft-delete, then switch lazily on the next request.

## Decision
Option 2. `DELETE /api/profiles/:id` always returns 200 `MeResponse`. If `:id` is the current session's profile, then in one transaction:
1. Lock the account row and check that it isn't the last profile (409 `last_profile`).
2. Pick the target: the remaining profile with the highest `session.last_seen_at`, or the oldest remaining profile if none has a session. This is the same rule as login (ADR 0003).
3. Insert a new session for the target with the **current `expires_at`**.
4. Delete the profile. That cascades its sessions, including the current one, and from R3 its history.

The response sets the new cookie. Deleting a non-active profile returns `MeResponse` without a new cookie. The error code `profile_active` is removed.

## Consequences
- + One atomic call. The client never sees a half-done state, and the 12 h cap is preserved.
- + Last-used and most-recently-used share one rule and one index, `session (account_id, last_seen_at DESC)`.
- − DELETE returns a body (200, not 204). That's accepted so all profile mutations give the client a fresh `MeResponse`.
