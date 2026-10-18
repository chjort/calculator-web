import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import {
  AnsRequest, LoginRequest, ProfileNameRequest, ProfileSettings, SignupRequest, type ErrorResponse,
} from "@calc/contracts";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import { createAuth, type Resolved } from "../auth/auth";
import type { Db } from "../db/client";
import { ApiError, notFound } from "../domain/errors";
import type { Clock, ProfileId, SessionToken } from "../domain/types";
import { createProfiles } from "../profiles/profiles";

export const COOKIE = "__Host-sid";
const COOKIE_OPTS = { httpOnly: true, secure: true, sameSite: "lax", path: "/" } as const; // no Max-Age: session cookie

export type AppOptions = {
  db: Db; appOrigin: string; now?: Clock; webDist?: string; logger?: boolean; authRateLimit?: number;
  https?: { key: Buffer; cert: Buffer };
};

declare module "fastify" {
  interface FastifyRequest { auth: Resolved | null }
}

// Route-level body schemas: unknown keys are rejected (R2.md §4).
const Bodies = {
  signup: z.strictObject(SignupRequest.shape),
  login: z.strictObject(LoginRequest.shape),
  name: z.strictObject(ProfileNameRequest.shape),
  ans: z.strictObject(AnsRequest.shape),
  settings: z.strictObject(ProfileSettings.partial().shape).refine((o) => Object.keys(o).length > 0, "empty patch"),
};
const IdParam = z.object({ id: z.uuid() });

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function fieldsOf(e: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const i of e.issues) fields[i.path.join(".") || "_"] ??= i.message;
  return fields;
}

function sendError(reply: FastifyReply, status: number, body: ErrorResponse["error"], retryAfter?: number) {
  if (retryAfter !== undefined) reply.header("Retry-After", String(retryAfter));
  if (status === 401) reply.clearCookie(COOKIE, COOKIE_OPTS);
  return reply.code(status).send({ error: body } satisfies ErrorResponse);
}

export async function buildApp(o: AppOptions) {
  const now = o.now ?? (() => new Date());
  const auth = createAuth(o.db, now);
  const profiles = createProfiles(o.db, now);
  const app = Fastify({ logger: o.logger ?? false, trustProxy: false, ...(o.https ? { https: o.https } : {}) }) as unknown as FastifyInstance;

  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, ctx) => {
      const e = new ApiError(429, "rate_limited", "Too many attempts. Wait a few minutes and try again.", {
        retryAfterSeconds: Math.ceil(ctx.ttl / 1000),
      });
      return Object.assign(e, { statusCode: 429 });
    },
  });
  app.decorateRequest("auth", null);

  // CSRF (ARCHITECTURE §7, R2.md §4): same Origin (or Sec-Fetch-Site same-origin) and JSON bodies only.
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/") || !UNSAFE.has(req.method)) return;
    const origin = req.headers.origin;
    const sameOrigin = origin ? origin === o.appOrigin : req.headers["sec-fetch-site"] === "same-origin";
    const hasBody = Number(req.headers["content-length"] ?? 0) > 0 || req.headers["transfer-encoding"] !== undefined;
    const json = /^application\/json(;|$)/i.test(req.headers["content-type"] ?? "");
    if (!sameOrigin || (hasBody && !json)) {
      return sendError(reply, 403, { code: "csrf_rejected", message: "Request rejected." });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      const body: ErrorResponse["error"] = { code: err.code, message: err.message };
      if (err.extra.fields) body.fields = err.extra.fields;
      return sendError(reply, err.status, body, err.extra.retryAfterSeconds);
    }
    if (err instanceof ZodError) {
      return sendError(reply, 400, { code: "validation_failed", message: "Check the highlighted fields.", fields: fieldsOf(err) });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return sendError(reply, 400, { code: "validation_failed", message: "Invalid request." });
    }
    req.log.error({ err }, "unhandled error");
    return sendError(reply, 500, { code: "internal", message: "Something went wrong on our side. Try again in a moment." });
  });

  const setSession = (reply: FastifyReply, token: SessionToken) => reply.setCookie(COOKIE, token, COOKIE_OPTS);

  async function requireSession(req: FastifyRequest) {
    const token = req.cookies[COOKIE];
    if (!token) throw new ApiError(401, "unauthenticated", "Log in to continue.");
    const r = await auth.resolve(token);
    if (r === "unauthenticated") throw new ApiError(401, "unauthenticated", "Log in to continue.");
    if (r === "session_expired") throw new ApiError(401, "session_expired", "Your session has ended. Log in to continue.");
    req.auth = r;
  }
  const authed = { preHandler: requireSession };
  const scope = (req: FastifyRequest) => req.auth!.scope;
  const profileId = (req: FastifyRequest) => {
    const p = IdParam.safeParse(req.params);
    if (!p.success) throw notFound();
    return p.data.id.toLowerCase() as ProfileId; // Postgres returns lower-case uuids; compare like with like
  };
  const authLimit = { config: { rateLimit: { max: o.authRateLimit ?? 30, timeWindow: "1 minute" } } };

  // ---------- auth ----------
  app.post("/api/auth/signup", authLimit, async (req, reply) => {
    const body = Bodies.signup.parse(req.body);
    const r = await auth.signup(body.email, body.password);
    setSession(reply, r.token);
    return reply.code(201).send(r.me);
  });
  app.post("/api/auth/login", authLimit, async (req, reply) => {
    const body = Bodies.login.parse(req.body);
    const r = await auth.login(body.email, body.password, req.ip ?? null);
    setSession(reply, r.token);
    return r.me;
  });
  app.post("/api/auth/logout", authLimit, async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) await auth.logout(token);
    reply.clearCookie(COOKIE, COOKIE_OPTS);
    return reply.code(204).send();
  });

  // ---------- session ----------
  app.get("/api/me", authed, async (req) => auth.me(scope(req), req.auth!.session));
  app.post("/api/session/touch", authed, async (req) => auth.touch(scope(req)));

  // ---------- active profile ----------
  app.patch("/api/profile/ans", authed, async (req) => profiles.setAns(scope(req), Bodies.ans.parse(req.body).ans));
  app.patch("/api/profile/settings", authed, async (req) => profiles.updateSettings(scope(req), Bodies.settings.parse(req.body)));

  // ---------- profiles ----------
  app.post("/api/profiles", authed, async (req, reply) => {
    const r = await profiles.create(scope(req), Bodies.name.parse(req.body).name);
    setSession(reply, r.token);
    return reply.code(201).send(r.me);
  });
  app.patch("/api/profiles/:id", authed, async (req) => {
    const id = profileId(req);
    return profiles.rename(scope(req), id, Bodies.name.parse(req.body).name);
  });
  app.delete("/api/profiles/:id", authed, async (req, reply) => {
    const r = await profiles.remove(scope(req), profileId(req));
    if (r.token) setSession(reply, r.token);
    return r.me;
  });
  app.post("/api/profiles/:id/activate", authed, async (req, reply) => {
    const r = await auth.activate(scope(req), profileId(req));
    if (r.token) setSession(reply, r.token);
    return r.me;
  });

  // ---------- SPA (every non-/api path) ----------
  if (o.webDist) {
    await app.register(fastifyStatic, { root: o.webDist, wildcard: false, index: false });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/") || !o.webDist || req.method !== "GET") {
      return sendError(reply, 404, { code: "not_found", message: "Not found." });
    }
    return reply.header("Cache-Control", "no-store").sendFile("index.html");
  });

  return app;
}
