# ADR 0005: Credential policy and login throttling

Status: Accepted (PO, 2026-10-18) · Date: 2026-10-18 · Scope: R2 (#3)

## Context
ARCHITECTURE §7 says passwords use argon2id and login is rate-limited, but the mechanism isn't defined. The server must be safe with N replicas (ADR 0004 already assumes that). Hard account lockout would let anyone lock a victim out just by knowing their email.

## Options
1. In-memory per-IP rate limit only (`@fastify/rate-limit`).
2. **Postgres-backed per-email failure throttle, plus a coarse in-memory per-IP limit.**
3. Hard lockout after N failures until reset by email.
4. Redis-backed limiter.

## Decision
Option 2.
- **Per email:** 5 failed logins per email in a 15-minute rolling window return 429 `rate_limited` with `Retry-After`. Failures are counted from `login_failure` rows, the count resets naturally as the window rolls, and there is no lockout.
- **Per IP:** a coarse in-memory limit of 30 requests per minute on `/api/auth/*`. It is only a backstop. The limit is configurable via the `AUTH_RATE_LIMIT` env (default 30), which is raised only for parallel e2e runs from one IP.
- **Timing:** unknown emails still run argon2 verify against a dummy hash, so timing doesn't reveal whether an account exists.
- **Hashing:** argon2id via `@node-rs/argon2`, m=19 MiB, t=2, p=1 (OWASP). The verifier re-hashes on login if the parameters change.
- **Passwords:** 12 to 128 characters (PO-confirmed), no composition rules, any Unicode, NFKC-normalised before hashing. The 128 cap bounds hashing cost.
- **Common/breached check:** sign-up rejects passwords found in a bundled offline list. The list is `apps/server/assets/common-passwords.txt`, a top-100k list from SecLists (MIT). At build time it is filtered to entries of 12 or more characters, since shorter ones already fail the length rule, and lower-cased. At startup it is loaded into a `Set`, and the check compares the normalised, lower-cased password against it. A hit returns 400 `password_too_common`. No network call, no new dependency. **Later option:** a HIBP Pwned Passwords k-anonymity range query (send only the first 5 SHA-1 hex characters), fail-open on timeout. It isn't adopted now because it adds a network dependency to sign-up.

## Consequences
- + Correct across replicas with no new infrastructure. The sweep removes failure rows older than 1 day.
- + No lockout to abuse. An attacker gets at most about 20 guesses per hour per email.
- − One extra indexed count query per login. The per-IP layer is per replica, which is acceptable for a backstop. Option 4 would add infrastructure; option 3 enables denial of service.
- + The common-list check costs one `Set` lookup and a few hundred KB of memory.
- − The offline list catches common passwords, not every breached one. HIBP stays the upgrade path.
- Accepted limitation (PO): R2 has no password reset or email verification. A Password reset story is on the Later horizon.
