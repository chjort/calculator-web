import { MeResponse, SessionInfo } from "@calc/contracts";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { client, errorCode, fakeClock, makeApp, ORIGIN, setupDb, truncate } from "./harness";

let db: Db;
let close: () => Promise<void>;
let clock: ReturnType<typeof fakeClock>;
let app: Awaited<ReturnType<typeof makeApp>>;

beforeAll(async () => ({ db, close } = await setupDb()));
afterAll(async () => { await app?.close(); await close(); });
beforeEach(async () => {
  await truncate(db);
  clock = fakeClock();
  await app?.close();
  app = await makeApp(db, clock.now);
});

const MIN = 60_000;

describe("#3 AC1: an account is always required", () => {
  it.each([
    ["GET", "/api/me"],
    ["POST", "/api/session/touch"],
    ["PATCH", "/api/profile/ans"],
    ["PATCH", "/api/profile/settings"],
    ["POST", "/api/profiles"],
  ] as const)("%s %s without a session -> 401 unauthenticated", async (method, url) => {
    const res = await client(app).call(method, url, method === "PATCH" || url === "/api/profiles" ? { x: 1 } : undefined);
    expect(res.statusCode).toBe(401);
    expect(errorCode(res)).toBe("unauthenticated");
  });

  it("a forged cookie is rejected", async () => {
    const c = client(app);
    c.cookie = "forged";
    expect((await c.call("GET", "/api/me")).statusCode).toBe(401);
  });
});

describe("#3 AC2: sign-up with email and password", () => {
  it("creates the account with a Default profile, opens a session and sets a hardened cookie", async () => {
    const c = client(app);
    const res = await c.call("POST", "/api/auth/signup", { email: "  Ana@Example.com ", password: "correct horse battery" });
    expect(res.statusCode).toBe(201);
    const me = MeResponse.parse(res.json());
    expect(me.account.email).toBe("ana@example.com");
    expect(me.profiles.map((p) => [p.name, p.settings.theme, p.settings.decimalPlaces, p.ans])).toEqual([["Default", "system", null, null]]);
    expect(me.activeProfileId).toBe(me.profiles[0]!.id);
    expect(me.session.expiresAt).toBe("2026-10-18T20:00:00.000Z"); // login + 12 h
    expect(me.session.idleExpiresAt).toBe("2026-10-18T08:30:00.000Z");
    const header = String(res.headers["set-cookie"]);
    expect(header).toMatch(/^__Host-sid=[A-Za-z0-9_-]{43};/);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).not.toMatch(/Max-Age|Expires/i);
    expect((await c.me()).account.email).toBe("ana@example.com");
  });

  it.each([
    [{ email: "ana@example", password: "correct horse battery" }, "email"],
    [{ email: "ana@example.com", password: "short" }, "password"],
    [{ email: "ana@example.com", password: "x".repeat(129) }, "password"],
  ])("rejects invalid input %j with field errors", async (body, field) => {
    const res = await client(app).call("POST", "/api/auth/signup", body);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("validation_failed");
    expect(Object.keys(res.json().error.fields)).toEqual([field]);
  });

  it("rejects unknown body keys", async () => {
    const res = await client(app).call("POST", "/api/auth/signup", { email: "a@b.io", password: "correct horse battery", admin: true });
    expect(res.statusCode).toBe(400);
  });

  it("rejects passwords from the bundled common list (ADR 0005)", async () => {
    const res = await client(app).call("POST", "/api/auth/signup", { email: "a@b.io", password: "QwertyUiop123" });
    expect(res.statusCode).toBe(400);
    expect(errorCode(res)).toBe("password_too_common");
  });

  it("accepts any Unicode and keeps spaces", async () => {
    const c = client(app);
    await c.signup("u@b.io", "  pässwörd 🔑 ok  ");
    expect((await client(app).login("u@b.io", "  pässwörd 🔑 ok  ")).statusCode).toBe(200);
    expect((await client(app).login("u@b.io", "pässwörd 🔑 ok")).statusCode).toBe(401);
  });
});

describe("#3 AC3: email addresses are unique", () => {
  it("a duplicate sign-up (any case) gets a clear 409 email_taken", async () => {
    await client(app).signup("ana@example.com");
    const res = await client(app).call("POST", "/api/auth/signup", { email: "ANA@example.com", password: "another long password" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toEqual(expect.objectContaining({ code: "email_taken", fields: { email: expect.stringContaining("already an account") } }));
  });
});

describe("#3 AC4: passwords are stored hashed", () => {
  it("stores argon2id (m=19 MiB, t=2, p=1), never the password; tokens only as SHA-256", async () => {
    const c = client(app);
    await c.signup("ana@example.com", "correct horse battery");
    const rows = await db.execute<{ password_hash: string }>(sql`SELECT password_hash FROM account`);
    const stored = rows.rows[0]!.password_hash;
    expect(stored).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(stored).not.toContain("correct horse battery");
    const sessions = await db.execute<{ token_hash: Buffer }>(sql`SELECT token_hash FROM session`);
    expect(sessions.rows[0]!.token_hash.equals(createHash("sha256").update(c.cookie!).digest())).toBe(true);
    const dump = JSON.stringify((await db.execute(sql`SELECT * FROM account, session`)).rows);
    expect(dump).not.toContain("correct horse battery");
    expect(dump).not.toContain(c.cookie!);
  });
});

describe("log in (#3, ADR 0003/0005)", () => {
  it("logs in with the right password, case-insensitive email", async () => {
    await client(app).signup();
    const res = await client(app).login("ANA@example.com", "correct horse battery");
    expect(res.statusCode).toBe(200);
    MeResponse.parse(res.json());
  });

  it("wrong password and unknown email get the identical generic error", async () => {
    await client(app).signup();
    const a = await client(app).login("ana@example.com", "wrong password!!");
    const b = await client(app).login("nobody@example.com", "wrong password!!");
    expect([a.statusCode, b.statusCode]).toEqual([401, 401]);
    expect(a.json()).toEqual(b.json());
    expect(a.json().error).toEqual({ code: "invalid_credentials", message: "Email or password is incorrect." });
  });

  it("throttles after 5 failures per email in 15 minutes, then the window rolls (no lockout)", async () => {
    await client(app).signup();
    for (let i = 0; i < 5; i++) expect((await client(app).login("ana@example.com", "wrong")).statusCode).toBe(401);
    const blocked = await client(app).login();
    expect(blocked.statusCode).toBe(429);
    expect(errorCode(blocked)).toBe("rate_limited");
    expect(Number(blocked.headers["retry-after"])).toBe(15 * 60);
    clock.advance(15 * MIN + 1000);
    expect((await client(app).login()).statusCode).toBe(200);
  });

  it("opens the last-used profile", async () => {
    const c = client(app);
    await c.signup();
    const created = MeResponse.parse((await c.call("POST", "/api/profiles", { name: "Work" })).json());
    clock.advance(2 * MIN);
    await c.call("POST", "/api/session/touch");
    const res = await client(app).login();
    expect(MeResponse.parse(res.json()).activeProfileId).toBe(created.activeProfileId);
  });
});

describe("#3 AC5: log out ends the authenticated session", () => {
  it("ends the session server-side, clears the cookie, and the old token stops working", async () => {
    const c = client(app);
    await c.signup();
    const token = c.cookie!;
    const res = await c.call("POST", "/api/auth/logout");
    expect(res.statusCode).toBe(204);
    expect(String(res.headers["set-cookie"])).toMatch(/__Host-sid=;/);
    expect(c.cookie).toBeUndefined();
    c.cookie = token; // replay the old cookie
    const after = await c.call("GET", "/api/me");
    expect(after.statusCode).toBe(401);
    const rows = await db.execute<{ end_reason: string }>(sql`SELECT end_reason FROM session`);
    expect(rows.rows.map((r) => r.end_reason)).toEqual(["logout"]);
  });

  it("is idempotent", async () => {
    const c = client(app);
    expect((await c.call("POST", "/api/auth/logout")).statusCode).toBe(204);
  });
});

describe("session lifetime (ADR 0003 + R2 amendment)", () => {
  it("30 min idle -> 401 session_expired (timeout)", async () => {
    const c = client(app);
    await c.signup();
    clock.advance(30 * MIN + 1000);
    const res = await c.call("GET", "/api/me");
    expect(res.statusCode).toBe(401);
    expect(errorCode(res)).toBe("session_expired");
    const rows = await db.execute<{ end_reason: string; ended_at: Date }>(sql`SELECT end_reason, ended_at FROM session`);
    expect(rows.rows[0]!.end_reason).toBe("timeout");
    expect(new Date(rows.rows[0]!.ended_at).toISOString()).toBe("2026-10-18T08:30:00.000Z");
  });

  it("idle before the 12 h cap, first seen after it -> 401 session_expired, end_reason timeout", async () => {
    const c = client(app);
    await c.signup();
    clock.advance(13 * 60 * MIN);
    const res = await c.call("GET", "/api/me");
    expect(res.statusCode).toBe(401);
    expect(errorCode(res)).toBe("session_expired");
    const rows = await db.execute<{ end_reason: string; ended_at: Date }>(sql`SELECT end_reason, ended_at FROM session`);
    expect(rows.rows[0]!.end_reason).toBe("timeout");
    expect(new Date(rows.rows[0]!.ended_at).toISOString()).toBe("2026-10-18T08:30:00.000Z");
  });

  it("touch keeps an active user logged in but never extends the 12 h cap", async () => {
    const c = client(app);
    const me = await c.signup();
    for (let i = 0; i < 24; i++) {
      clock.advance(29 * MIN);
      const res = await c.call("POST", "/api/session/touch");
      if (res.statusCode !== 200) break;
      const info = SessionInfo.parse(res.json());
      expect(info.expiresAt).toBe(me.session.expiresAt);
    }
    // 24 × 29 min = 11 h 36 min: still alive; after 12 h it ends with `expired`
    clock.advance(25 * MIN);
    const res = await c.call("POST", "/api/session/touch");
    expect(res.statusCode).toBe(401);
    expect(errorCode(res)).toBe("session_expired");
    const rows = await db.execute<{ end_reason: string }>(sql`SELECT end_reason FROM session`);
    expect(rows.rows[0]!.end_reason).toBe("expired");
  });
});

describe("CSRF (ARCHITECTURE §7, R2.md §4)", () => {
  const signup = { email: "a@b.io", password: "correct horse battery" };
  it("rejects a cross-site Origin, a missing Origin without Sec-Fetch-Site, and non-JSON bodies", async () => {
    const c = client(app);
    expect(errorCode(await c.call("POST", "/api/auth/signup", signup, { origin: "https://evil.example" }))).toBe("csrf_rejected");
    const noOrigin = await app.inject({ method: "POST", url: "/api/auth/signup", headers: { "content-type": "application/json" }, payload: JSON.stringify(signup) });
    expect(noOrigin.statusCode).toBe(403);
    const form = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: ORIGIN, "content-type": "text/plain" }, payload: "email=a" });
    expect(form.statusCode).toBe(403);
  });

  it("accepts Sec-Fetch-Site: same-origin when Origin is absent", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/signup", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" }, payload: JSON.stringify(signup) });
    expect(res.statusCode).toBe(201);
  });
});
