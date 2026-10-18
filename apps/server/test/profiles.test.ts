import { MeResponse, ProfileDto, SessionInfo } from "@calc/contracts";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { client, errorCode, fakeClock, makeApp, setupDb, truncate } from "./harness";

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
const me = (res: { json: () => unknown }) => MeResponse.parse(res.json());
const names = (m: MeResponse) => m.profiles.map((p) => p.name);
const active = (m: MeResponse) => m.profiles.find((p) => p.id === m.activeProfileId)!;

async function signedUp() {
  const c = client(app);
  const first = await c.signup();
  clock.advance(MIN); // later profiles sort after Default (oldest first)
  return { c, first };
}

describe("#4 AC1: create, rename and delete profiles", () => {
  it("create: 201, the new profile becomes active with defaults, cookie rotates, expires_at kept", async () => {
    const { c, first } = await signedUp();
    const oldCookie = c.cookie;
    clock.advance(5 * MIN);
    const res = await c.call("POST", "/api/profiles", { name: "  Work " });
    expect(res.statusCode).toBe(201);
    const m = me(res);
    expect(names(m)).toEqual(["Default", "Work"]);
    expect(active(m)).toEqual(expect.objectContaining({ name: "Work", settings: { decimalPlaces: null, theme: "system" }, ans: null }));
    expect(c.cookie).not.toBe(oldCookie);
    expect(m.session.expiresAt).toBe(first.session.expiresAt);
    const stale = client(app);
    stale.cookie = oldCookie;
    expect((await stale.call("GET", "/api/me")).statusCode).toBe(401);
    const ends = await db.execute<{ end_reason: string | null }>(sql`SELECT end_reason FROM session ORDER BY started_at`);
    expect(ends.rows.map((r) => r.end_reason)).toEqual(["profile_switch", null]);
  });

  it("names are unique per account, case-insensitive; 1..40 characters", async () => {
    const { c } = await signedUp();
    const dup = await c.call("POST", "/api/profiles", { name: "default" });
    expect(dup.statusCode).toBe(409);
    expect(errorCode(dup)).toBe("profile_name_taken");
    expect((await c.call("POST", "/api/profiles", { name: "   " })).statusCode).toBe(400);
    expect((await c.call("POST", "/api/profiles", { name: "x".repeat(41) })).statusCode).toBe(400);
    // another account may use the same name
    await client(app).signup("bo@example.com");
    const bo = client(app);
    await bo.login("bo@example.com");
    expect((await bo.call("POST", "/api/profiles", { name: "Work" })).statusCode).toBe(201);
  });

  it("at most 10 profiles (ADR 0006)", async () => {
    const { c } = await signedUp();
    for (let i = 2; i <= 10; i++) expect((await c.call("POST", "/api/profiles", { name: `P${i}` })).statusCode).toBe(201);
    const res = await c.call("POST", "/api/profiles", { name: "P11" });
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe("profile_limit");
  });

  it("rename any own profile; duplicates rejected; own case change allowed", async () => {
    const { c, first } = await signedUp();
    await c.call("POST", "/api/profiles", { name: "Work" });
    const res = await c.call("PATCH", `/api/profiles/${first.activeProfileId}`, { name: "Homework" });
    expect(res.statusCode).toBe(200);
    expect(ProfileDto.parse(res.json()).name).toBe("Homework");
    expect(errorCode(await c.call("PATCH", `/api/profiles/${first.activeProfileId}`, { name: "WORK" }))).toBe("profile_name_taken");
    expect((await c.call("PATCH", `/api/profiles/${first.activeProfileId}`, { name: "homework" })).statusCode).toBe(200);
    expect(names(await c.me())).toEqual(["homework", "Work"]);
  });

  it("delete a non-active profile: 200 MeResponse, no cookie rotation", async () => {
    const { c, first } = await signedUp();
    await c.call("POST", "/api/profiles", { name: "Work" });
    const cookie = c.cookie;
    const res = await c.call("DELETE", `/api/profiles/${first.activeProfileId}`);
    expect(res.statusCode).toBe(200);
    expect(names(me(res))).toEqual(["Work"]);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(c.cookie).toBe(cookie);
  });

  it("delete the active profile: switches to the most recently used remaining one, keeps expires_at (ADR 0007)", async () => {
    const { c, first } = await signedUp();
    clock.advance(MIN);
    await c.call("POST", "/api/profiles", { name: "Work" });
    clock.advance(2 * MIN);
    const homework = me(await c.call("POST", "/api/profiles", { name: "Homework" }));
    const work = homework.profiles.find((p) => p.name === "Work")!;
    clock.advance(2 * MIN);
    await c.call("POST", `/api/profiles/${work.id}/activate`);
    clock.advance(2 * MIN);
    await c.call("POST", `/api/profiles/${homework.activeProfileId}/activate`);
    const before = c.cookie;
    const announced = await c.me();
    expect(announced.switchOnDeleteProfileId).toBe(work.id); // what the dialog names…
    const res = await c.call("DELETE", `/api/profiles/${homework.activeProfileId}`);
    expect(res.statusCode).toBe(200);
    const m = me(res);
    expect(active(m).name).toBe("Work"); // Work was used after Default
    expect(m.activeProfileId).toBe(announced.switchOnDeleteProfileId); // …is where the server switched
    expect(names(m)).toEqual(["Default", "Work"]);
    expect(m.session.expiresAt).toBe(first.session.expiresAt);
    expect(c.cookie).not.toBe(before);
    expect(active(await c.me()).name).toBe("Work");
  });

  it("switchOnDeleteProfileId is null with one profile and never the active profile", async () => {
    const { c, first } = await signedUp();
    expect((await c.me()).switchOnDeleteProfileId).toBeNull();
    const m = me(await c.call("POST", "/api/profiles", { name: "Work" }));
    expect(m.switchOnDeleteProfileId).toBe(first.activeProfileId);
  });

  it("delete-active picks the most recently used remaining profile even beyond the 50 newest sessions (ADR 0007)", async () => {
    const { c } = await signedUp(); // Default
    clock.advance(MIN);
    const work = me(await c.call("POST", "/api/profiles", { name: "Work" }));
    clock.advance(MIN);
    const homework = me(await c.call("POST", "/api/profiles", { name: "Homework" }));
    const workId = homework.profiles.find((p) => p.name === "Work")!.id;
    clock.advance(MIN);
    await c.call("POST", `/api/profiles/${workId}/activate`); // Work is now newer than Default
    clock.advance(MIN);
    await c.call("POST", `/api/profiles/${homework.activeProfileId}/activate`);
    // 55 newer (ended) sessions, all on Homework, e.g. from other devices
    await db.execute(sql`
      INSERT INTO session (account_id, profile_id, token_hash, started_at, last_seen_at, expires_at, ended_at, end_reason)
      SELECT ${homework.account.id}, ${homework.activeProfileId}, sha256(('t' || g)::bytea),
             now() + g * interval '1 minute', now() + g * interval '1 minute', now() + interval '1 day', now() + g * interval '1 minute', 'logout'
      FROM generate_series(1, 55) g`);
    const before = await c.me();
    expect(before.activeProfileId).toBe(homework.activeProfileId);
    expect(before.switchOnDeleteProfileId).toBe(work.activeProfileId);
    const res = await c.call("DELETE", `/api/profiles/${homework.activeProfileId}`);
    expect(me(res).activeProfileId).toBe(work.activeProfileId);
  });

  it("an upper-case id of the active profile still takes the delete-active path", async () => {
    const { c, first } = await signedUp();
    clock.advance(MIN);
    const work = me(await c.call("POST", "/api/profiles", { name: "Work" }));
    const res = await c.call("DELETE", `/api/profiles/${work.activeProfileId.toUpperCase()}`);
    expect(res.statusCode).toBe(200);
    expect(me(res).activeProfileId).toBe(first.activeProfileId);
    expect(res.headers["set-cookie"]).toBeDefined();
    expect((await c.me()).activeProfileId).toBe(first.activeProfileId);
    const act = await c.call("POST", `/api/profiles/${first.activeProfileId.toUpperCase()}/activate`);
    expect(act.headers["set-cookie"]).toBeUndefined(); // no-op on the active profile
  });

  it("the last profile can't be deleted", async () => {
    const { c, first } = await signedUp();
    const res = await c.call("DELETE", `/api/profiles/${first.activeProfileId}`);
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe("last_profile");
  });
});

describe("#4 AC2: switch the active profile at any time", () => {
  it("activate rotates the cookie, keeps expires_at, and is a no-op for the active profile", async () => {
    const { c, first } = await signedUp();
    await c.call("POST", "/api/profiles", { name: "Work" });
    clock.advance(10 * MIN);
    let cookie = c.cookie;
    const res = await c.call("POST", `/api/profiles/${first.activeProfileId}/activate`);
    expect(res.statusCode).toBe(200);
    expect(active(me(res)).name).toBe("Default");
    expect(me(res).session.expiresAt).toBe(first.session.expiresAt);
    expect(c.cookie).not.toBe(cookie);
    cookie = c.cookie;
    const same = await c.call("POST", `/api/profiles/${first.activeProfileId}/activate`);
    expect(same.statusCode).toBe(200);
    expect(same.headers["set-cookie"]).toBeUndefined();
    expect(c.cookie).toBe(cookie);
  });

  it("unknown or malformed id -> 404", async () => {
    const { c } = await signedUp();
    expect((await c.call("POST", "/api/profiles/00000000-0000-4000-8000-000000000000/activate")).statusCode).toBe(404);
    expect((await c.call("POST", "/api/profiles/nope/activate")).statusCode).toBe(404);
  });
});

describe("#4 AC3/AC4: each profile has its own settings; changes apply only to the active profile", () => {
  it("PATCH /api/profile/settings changes the active profile only", async () => {
    const { c } = await signedUp();
    const work = me(await c.call("POST", "/api/profiles", { name: "Work" }));
    const res = await c.call("PATCH", "/api/profile/settings", { theme: "dark", decimalPlaces: 2 });
    expect(res.statusCode).toBe(200);
    expect(ProfileDto.parse(res.json())).toEqual(expect.objectContaining({ id: work.activeProfileId, settings: { theme: "dark", decimalPlaces: 2 } }));
    const m = await c.me();
    expect(m.profiles.map((p) => [p.name, p.settings])).toEqual([
      ["Default", { decimalPlaces: null, theme: "system" }],
      ["Work", { decimalPlaces: 2, theme: "dark" }],
    ]);
    expect((await c.call("PATCH", "/api/profile/settings", { decimalPlaces: null })).json().settings).toEqual({ decimalPlaces: null, theme: "dark" });
  });

  it.each([{}, { theme: "blue" }, { decimalPlaces: 13 }, { decimalPlaces: 1.5 }, { theme: "dark", numberFormat: "comma" }])(
    "rejects %j",
    async (body) => {
      const { c } = await signedUp();
      expect((await c.call("PATCH", "/api/profile/settings", body)).statusCode).toBe(400);
    },
  );
});

describe("#4 AC5: profiles are not shareable between accounts", () => {
  it("another account's profile id is 404 for rename, delete and activate; /me lists only own profiles", async () => {
    const { c: ana } = await signedUp();
    clock.advance(MIN);
    const anaWork = me(await ana.call("POST", "/api/profiles", { name: "Work" }));
    const bo = client(app);
    const boMe = await bo.signup("bo@example.com");
    for (const [method, url, body] of [
      ["PATCH", `/api/profiles/${anaWork.activeProfileId}`, { name: "Mine" }],
      ["DELETE", `/api/profiles/${anaWork.activeProfileId}`, undefined],
      ["POST", `/api/profiles/${anaWork.activeProfileId}/activate`, undefined],
    ] as const) {
      const res = await bo.call(method, url, body);
      expect(res.statusCode).toBe(404);
      expect(errorCode(res)).toBe("not_found");
    }
    expect(names(await bo.me())).toEqual(["Default"]);
    expect(boMe.profiles.some((p) => p.id === anaWork.activeProfileId)).toBe(false);
    expect(names(await ana.me())).toEqual(["Default", "Work"]);
  });
});

describe("Ans per profile (P4, ADR 0008)", () => {
  it("stores canonical Ans for the active profile, survives switch and re-login, null clears", async () => {
    const { c, first } = await signedUp();
    const res = await c.call("PATCH", "/api/profile/ans", { ans: "1.5e-400" });
    expect(res.statusCode).toBe(200);
    SessionInfo.parse(res.json());
    const work = me(await c.call("POST", "/api/profiles", { name: "Work" }));
    expect(active(work).ans).toBeNull();
    await c.call("PATCH", "/api/profile/ans", { ans: "-3.333333333333333333333333333333333e+0" });
    clock.advance(MIN);
    const back = me(await c.call("POST", `/api/profiles/${first.activeProfileId}/activate`));
    expect(active(back).ans).toBe("1.5e-400");
    await c.call("POST", "/api/auth/logout");
    const again = me(await c.login());
    expect(active(again).ans).toBe("1.5e-400");
    expect(again.profiles.find((p) => p.name === "Work")!.ans).toBe("-3.333333333333333333333333333333333e+0");
    await c.call("PATCH", "/api/profile/ans", { ans: null });
    expect(active(await c.me()).ans).toBeNull();
  });

  it.each(["12.5", "1e+10000", "1." + "1".repeat(34) + "e+0", 5, "1.50e+0", "-0e+0"])("rejects non-canonical Ans %j", async (ans) => {
    const { c } = await signedUp();
    expect((await c.call("PATCH", "/api/profile/ans", { ans })).statusCode).toBe(400);
  });

  it("counts as activity (moves the idle deadline)", async () => {
    const { c } = await signedUp();
    clock.advance(20 * MIN);
    const info = SessionInfo.parse((await c.call("PATCH", "/api/profile/ans", { ans: "1e+0" })).json());
    expect(info.idleExpiresAt).toBe("2026-10-18T08:51:00.000Z");
  });
});
