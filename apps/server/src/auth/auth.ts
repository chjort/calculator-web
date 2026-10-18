import type { Email, MeResponse, SessionInfo } from "@calc/contracts";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { isUniqueViolation } from "../db/errors";
import { account, loginFailure, profile, session } from "../db/schema";
import { ApiError, notFound } from "../domain/errors";
import type { AccountId, AccountScope, Clock, ProfileId, ProfileScope, SessionId, SessionToken } from "../domain/types";
import { loadMe } from "../me";
import { dummyHash, hashPassword, isCommonPassword, needsRehash, verifyPassword } from "./password";
import { classifySession, FAILURE_WINDOW_MS, loginExpiry, retryAfterSeconds, sessionInfo } from "./session-rules";
import { endSession, getSession, lastUsedProfile, openSession, type SessionRow } from "./sessions";
import { hashToken } from "./token";

export type Issued = { me: MeResponse; token: SessionToken };
export type Resolved = { scope: ProfileScope; session: SessionRow };

/** The only place a scope is constructed (R2.md §5). */
function scopeOf(s: SessionRow): ProfileScope {
  return { accountId: s.accountId as AccountId, sessionId: s.id as SessionId, profileId: s.profileId as ProfileId } as ProfileScope;
}

const INVALID = () => new ApiError(401, "invalid_credentials", "Email or password is incorrect.");

export function createAuth(db: Db, now: Clock) {
  async function issue(accountId: AccountId, profileId: ProfileId): Promise<Issued> {
    const t = now();
    const { token, row } = await openSession(db, { accountId, profileId, now: t, expiresAt: loginExpiry(t) });
    return { me: await loadMe(db, accountId, row), token };
  }

  return {
    async signup(email: Email, password: string): Promise<Issued> {
      if (isCommonPassword(password)) {
        throw new ApiError(400, "password_too_common", "This password is too common. Choose a different one.", {
          fields: { password: "This password is too common. Choose a different one." },
        });
      }
      const passwordHash = await hashPassword(password);
      try {
        return await db.transaction(async (tx) => {
          const t = now();
          const [acc] = await tx.insert(account).values({ email, passwordHash, createdAt: t }).returning({ id: account.id });
          const accountId = acc!.id as AccountId;
          const [p] = await tx.insert(profile).values({ accountId, name: "Default", createdAt: t }).returning({ id: profile.id });
          const { token, row } = await openSession(tx, { accountId, profileId: p!.id as ProfileId, now: t, expiresAt: loginExpiry(t) });
          return { me: await loadMe(tx, accountId, row), token };
        });
      } catch (e) {
        if (isUniqueViolation(e, "account_email_key")) {
          throw new ApiError(409, "email_taken", "There's already an account with this email.", {
            fields: { email: "There's already an account with this email." },
          });
        }
        throw e;
      }
    },

    async login(email: Email, password: string, ip: string | null): Promise<Issued> {
      const t = now();
      const recent = await db
        .select({ at: loginFailure.at })
        .from(loginFailure)
        .where(and(eq(loginFailure.email, email), gt(loginFailure.at, new Date(t.getTime() - FAILURE_WINDOW_MS))));
      const retry = retryAfterSeconds(recent.map((r) => r.at), t);
      if (retry !== null) {
        throw new ApiError(429, "rate_limited", "Too many attempts. Wait a few minutes and try again.", { retryAfterSeconds: retry });
      }
      const [acc] = await db.select().from(account).where(eq(account.email, email));
      const ok = await verifyPassword(acc?.passwordHash ?? (await dummyHash()), password);
      if (!acc || !ok) {
        await db.insert(loginFailure).values({ email, ip, at: t });
        throw INVALID();
      }
      if (needsRehash(acc.passwordHash)) {
        await db.update(account).set({ passwordHash: await hashPassword(password) }).where(eq(account.id, acc.id));
      }
      const accountId = acc.id as AccountId;
      return issue(accountId, await lastUsedProfile(db, accountId));
    },

    async logout(token: string): Promise<void> {
      await db
        .update(session)
        .set({ endedAt: now(), endReason: "logout" })
        .where(and(eq(session.tokenHash, hashToken(token)), isNull(session.endedAt)));
    },

    async resolve(token: string): Promise<Resolved | "unauthenticated" | "session_expired"> {
      const [s] = await db.select().from(session).where(and(eq(session.tokenHash, hashToken(token)), isNull(session.endedAt)));
      if (!s) return "unauthenticated";
      const t = now();
      const v = classifySession(s, t);
      if (v.kind === "ended") {
        await endSession(db, s.id as SessionId, v.endedAt, v.reason);
        return "session_expired";
      }
      if (!v.touch) return { scope: scopeOf(s), session: s };
      const [touched] = await db.update(session).set({ lastSeenAt: t }).where(eq(session.id, s.id)).returning();
      return { scope: scopeOf(touched!), session: touched! };
    },

    /** Activity: last_seen_at = now, never expires_at. */
    async touch(scope: AccountScope): Promise<SessionInfo> {
      const [s] = await db.update(session).set({ lastSeenAt: now() }).where(eq(session.id, scope.sessionId)).returning();
      return sessionInfo(s!);
    },

    async me(scope: AccountScope, s: SessionRow): Promise<MeResponse> {
      return loadMe(db, scope.accountId, s);
    },

    /** Switch profile: end this session, open one for `id` with the same expires_at, rotate the cookie. */
    async activate(scope: ProfileScope, id: ProfileId): Promise<{ me: MeResponse; token?: SessionToken }> {
      if (id === scope.profileId) return { me: await loadMe(db, scope.accountId, await getSession(db, scope.sessionId)) };
      return db.transaction(async (tx) => {
        const [p] = await tx.select({ id: profile.id }).from(profile).where(and(eq(profile.id, id), eq(profile.accountId, scope.accountId)));
        if (!p) throw notFound();
        const current = await getSession(tx, scope.sessionId);
        const t = now();
        await endSession(tx, scope.sessionId, t, "profile_switch");
        const { token, row } = await openSession(tx, { accountId: scope.accountId, profileId: id, now: t, expiresAt: current.expiresAt });
        return { me: await loadMe(tx, scope.accountId, row), token };
      });
    },
  };
}

export type Auth = ReturnType<typeof createAuth>;
