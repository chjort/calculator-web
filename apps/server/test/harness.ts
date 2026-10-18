import { MeResponse } from "@calc/contracts";
import { sql } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { expect } from "vitest";
import { connect, runMigrations, type Db } from "../src/db/client";
import { buildApp, COOKIE } from "../src/http/app";

// API tests run against a real Postgres 16+ (CI: service container; locally: DATABASE_URL_TEST).
export const DATABASE_URL = process.env.DATABASE_URL_TEST ?? "postgres://calc@localhost:5432/calc_test";
export const ORIGIN = "http://app.test";

export async function setupDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const { db, pool } = connect(DATABASE_URL);
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;`);
  await runMigrations(db);
  return { db, close: () => pool.end() };
}

export async function truncate(db: Db) {
  await db.execute(sql`TRUNCATE account, login_failure RESTART IDENTITY CASCADE`);
}

/** A controllable clock. */
export function fakeClock(start = new Date("2026-10-18T08:00:00Z")) {
  let t = start.getTime();
  const now = () => new Date(t);
  return { now, advance: (ms: number) => { t += ms; } };
}

export async function makeApp(db: Db, now: () => Date) {
  return buildApp({ db, appOrigin: ORIGIN, now }); // production default: 30 auth requests/min per IP
}

type App = Awaited<ReturnType<typeof makeApp>>;

/** A browser-like client: keeps the session cookie, sends a same-origin Origin header. */
export function client(app: App) {
  let cookie: string | undefined;
  async function call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await app.inject({
      method,
      url,
      headers: { origin: ORIGIN, ...(cookie ? { cookie: `${COOKIE}=${cookie}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
    const set = res.cookies.find((c) => c.name === COOKIE);
    if (set) cookie = set.value || undefined;
    return res;
  }
  return {
    call,
    get cookie() { return cookie; },
    set cookie(v: string | undefined) { cookie = v; },
    async signup(email = "ana@example.com", password = "correct horse battery") {
      const res = await call("POST", "/api/auth/signup", { email, password });
      expect(res.statusCode).toBe(201);
      return MeResponse.parse(res.json());
    },
    async login(email = "ana@example.com", password = "correct horse battery") {
      return call("POST", "/api/auth/login", { email, password });
    },
    async me() {
      const res = await call("GET", "/api/me");
      expect(res.statusCode).toBe(200);
      return MeResponse.parse(res.json());
    },
  };
}

export const errorCode = (res: LightMyRequestResponse) => (res.json() as { error: { code: string } }).error.code;
