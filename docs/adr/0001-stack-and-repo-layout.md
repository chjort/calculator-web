# ADR 0001: Stack and repo layout

Status: Accepted · Date: 2026-10-18 · Scope: R1–R4

## Context
R1 needs a browser calculator only. R2–R4 add accounts, profiles, sessions, 1-month history and CSV. The evaluator has to run in the browser (instant feedback) and on the server (authoritative stored result). Small team, built mostly by agents, so we want one language and few moving parts.

## Options
1. **TS monorepo: React+Vite SPA, Fastify API, Postgres, one deployable.**
2. Next.js full-stack (RSC/server actions).
3. SPA plus a BaaS (Supabase/Firebase) for auth and storage.
4. Python/Django backend with a TS frontend.

## Decision
Option 1. pnpm workspaces: `packages/engine`, `apps/web` (R1), and `packages/contracts` (zod) plus `apps/server` (Fastify + Drizzle + Postgres 16) from R2. One Node container serves both the API and the built SPA.

## Consequences
- + One type system. Engine and contracts are shared without publishing. Types come from zod and Drizzle schemas, never written by hand twice.
- + R1 ships as static files. R2 adds the server without changing the R1 code.
- + Same origin, so no CORS. Cookies stay simple.
- − We own the auth code (ADR 0003) instead of renting it from a BaaS. 2 lost because its framework magic hides the data path. 3 lost because a custom 30-min per-profile session and composite-FK isolation fit badly in a BaaS. 4 lost because it would mean two languages and two copies of the evaluator.
