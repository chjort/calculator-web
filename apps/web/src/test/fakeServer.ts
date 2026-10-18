import type { MeResponse, ProfileDto } from "@calc/contracts";
import { vi } from "vitest";

// In-memory stand-in for the R2 API, enough to drive UI tests. The real API is tested against
// Postgres in apps/server; here we only check that the UI calls it and renders the results.

type Account = { id: string; email: string; password: string; profiles: ProfileDto[]; active: string };

export function fakeServer() {
  const accounts: Account[] = [];
  let current: Account | null = null;
  let n = 0;
  const calls: { method: string; path: string; body: unknown }[] = [];
  let offline = false;
  const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const session = { expiresAt: "2099-01-01T12:00:00.000Z", idleExpiresAt: "2099-01-01T00:30:00.000Z" };
  const profile = (name: string): ProfileDto => ({ id: uuid(), name, settings: { decimalPlaces: null, theme: "system" }, ans: null, createdAt: new Date(2026, 0, 1, 0, 0, n).toISOString() });
  const me = (a: Account): MeResponse => ({ account: { id: a.id, email: a.email }, activeProfileId: a.active, profiles: a.profiles, session,
    switchOnDeleteProfileId: a.profiles.length > 1 ? a.profiles.find((p) => p.id !== a.active)!.id : null });
  const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const err = (status: number, code: string, fields?: Record<string, string>) => json(status, { error: { code, message: code, ...(fields ? { fields } : {}) } });

  async function handle(path: string, method: string, body: Record<string, unknown> | undefined): Promise<Response> {
    if (path === "/api/auth/signup") {
      const email = String(body!.email).trim().toLowerCase();
      if (accounts.some((a) => a.email === email)) return err(409, "email_taken", { email: "taken" });
      const p = profile("Default");
      const a: Account = { id: uuid(), email, password: String(body!.password), profiles: [p], active: p.id };
      accounts.push(a);
      current = a;
      return json(201, me(a));
    }
    if (path === "/api/auth/login") {
      const a = accounts.find((x) => x.email === String(body!.email).trim().toLowerCase() && x.password === body!.password);
      if (!a) return err(401, "invalid_credentials");
      current = a;
      return json(200, me(a));
    }
    if (path === "/api/auth/logout") { current = null; return json(204); }
    if (!current) return err(401, "unauthenticated");
    const a = current;
    const active = () => a.profiles.find((p) => p.id === a.active)!;
    if (path === "/api/me") return json(200, me(a));
    if (path === "/api/session/touch") return json(200, session);
    if (path === "/api/profile/ans") { active().ans = body!.ans as ProfileDto["ans"]; return json(200, session); }
    if (path === "/api/profile/settings") { active().settings = { ...active().settings, ...body }; return json(200, active()); }
    if (path === "/api/profiles" && method === "POST") {
      const name = String(body!.name).trim();
      if (a.profiles.some((p) => p.name.toLowerCase() === name.toLowerCase())) return err(409, "profile_name_taken");
      if (a.profiles.length >= 10) return err(409, "profile_limit");
      const p = profile(name);
      a.profiles.push(p);
      a.active = p.id;
      return json(201, me(a));
    }
    const m = /^\/api\/profiles\/([^/]+)(\/activate)?$/.exec(path);
    const target = m && a.profiles.find((p) => p.id === m[1]);
    if (!m || !target) return err(404, "not_found");
    if (m[2]) { a.active = target.id; return json(200, me(a)); }
    if (method === "PATCH") {
      const name = String(body!.name).trim();
      if (a.profiles.some((p) => p !== target && p.name.toLowerCase() === name.toLowerCase())) return err(409, "profile_name_taken");
      target.name = name;
      return json(200, target);
    }
    if (a.profiles.length === 1) return err(409, "last_profile");
    a.profiles = a.profiles.filter((p) => p !== target);
    if (a.active === target.id) a.active = a.profiles[0]!.id;
    return json(200, me(a));
  }

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    if (offline) throw new TypeError("Failed to fetch");
    return handle(path, method, body);
  });

  return {
    fetchMock,
    calls,
    accounts,
    setOffline: (v: boolean) => { offline = v; },
    expireSession: () => { current = null; },
    seed(email: string, password: string, names: string[] = ["Default"]) {
      const profiles = names.map(profile);
      const a: Account = { id: uuid(), email, password, profiles, active: profiles[0]!.id };
      accounts.push(a);
      return a;
    },
  };
}
