# ADR 0004: History storage, retention and CSV export

Status: Proposed · Date: 2026-10-18 · Scope: R3 (#6–#8), R4 (#10)

## Context
Every calculation is saved, both success and error, with the expression, result or error, status, timestamp and session id. History is searchable, deletable and reusable. Entries and sessions older than 1 month are deleted automatically. The CSV export must respect the current filter.

## Options
1. Store in the browser (IndexedDB).
2. **A Postgres `calculation` table with a CHECK constraint on the success/error union, a read-time retention filter and a daily sweep.**
3. Postgres with monthly partitions, dropping old partitions.
4. An external scheduler (pg_cron or a platform cron) running the sweep.

## Decision
Option 2. `result` is stored as decimal text. `error_code`/`error_message` are non-null exactly when `status='error'` (DB CHECK, mirrored by the TS union). There is one `RETENTION = interval '1 month'` constant. Reads filter on it. A daily, advisory-locked, idempotent sweep inside the server (also run on boot) deletes old calculations, then old sessions, and closes stale open sessions. CSV streams from the same query function as the list endpoint, with RFC 4180 quoting and a CSV-injection guard on free-text columns.

## Consequences
- + Retention stays correct even when the job is late, because reads filter too. The job is safe with N replicas.
- + One query function means UI search and CSV can't disagree.
- + Volume is bounded at about 1 month per profile, so the `(profile_id, created_at DESC)` index is enough. No trigram index and no partitions (option 3 is premature).
- − The in-process scheduler needs at least one running instance a day. Option 4 stays available if we move to scale-to-zero. Option 1 fails "accounts required" and server-side retention.
