import { MAX_PROFILES, type MeResponse, type ProfileDto, type SessionInfo, type SettingsPatch } from "@calc/contracts";
import { and, count, eq, sql } from "drizzle-orm";
import type { Db, Tx } from "../db/client";
import { isUniqueViolation } from "../db/errors";
import { account, profile, session } from "../db/schema";
import { ApiError, notFound } from "../domain/errors";
import { sessionInfo } from "../auth/session-rules";
import { endSession, getSession, lastUsedProfile, openSession } from "../auth/sessions";
import type { AccountScope, Clock, DecimalString, ProfileId, ProfileScope, SessionToken } from "../domain/types";
import { loadMe, toProfileDto } from "../me";

// The profiles module owns the `profile` table (R2.md §1).

const nameTaken = (name: string) => {
  const msg = `You already have a profile called "${name}". Choose a different name.`;
  return new ApiError(409, "profile_name_taken", msg, { fields: { name: msg } });
};

async function withNameCheck<T>(name: string, f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (isUniqueViolation(e, "profile_name_uq")) throw nameTaken(name);
    throw e;
  }
}

/** Serialises create/delete per account so the limit and last-profile checks can't race (ADR 0006). */
async function lockAccount(tx: Tx, scope: AccountScope) {
  await tx.execute(sql`SELECT 1 FROM ${account} WHERE ${account.id} = ${scope.accountId} FOR UPDATE`);
}

async function profileCount(tx: Tx, scope: AccountScope) {
  const [r] = await tx.select({ n: count() }).from(profile).where(eq(profile.accountId, scope.accountId));
  return r!.n;
}

export function createProfiles(db: Db, now: Clock) {
  return {
    /** Create and switch to the new profile atomically, keeping the original expires_at (R2-4 Q1). */
    create(scope: ProfileScope, name: string): Promise<{ me: MeResponse; token: SessionToken }> {
      return withNameCheck(name, () => db.transaction(async (tx) => {
        await lockAccount(tx, scope);
        if ((await profileCount(tx, scope)) >= MAX_PROFILES) {
          throw new ApiError(409, "profile_limit", `You've reached the limit of ${MAX_PROFILES} profiles.`);
        }
        const t = now();
        const [p] = await tx.insert(profile).values({ accountId: scope.accountId, name, createdAt: t }).returning({ id: profile.id });
        const current = await getSession(tx, scope.sessionId);
        await endSession(tx, scope.sessionId, t, "profile_switch");
        const { token, row } = await openSession(tx, { accountId: scope.accountId, profileId: p!.id as ProfileId, now: t, expiresAt: current.expiresAt });
        return { me: await loadMe(tx, scope.accountId, row), token };
      }));
    },

    async rename(scope: AccountScope, id: ProfileId, name: string): Promise<ProfileDto> {
      const [p] = await withNameCheck(name, () =>
        db.update(profile).set({ name }).where(and(eq(profile.id, id), eq(profile.accountId, scope.accountId))).returning());
      if (!p) throw notFound();
      return toProfileDto(p);
    },

    /** Hard delete. Deleting the active profile switches to the most recently used remaining one (ADR 0007). */
    remove(scope: ProfileScope, id: ProfileId): Promise<{ me: MeResponse; token?: SessionToken }> {
      return db.transaction(async (tx) => {
        await lockAccount(tx, scope);
        const [p] = await tx.select({ id: profile.id }).from(profile).where(and(eq(profile.id, id), eq(profile.accountId, scope.accountId)));
        if (!p) throw notFound();
        if ((await profileCount(tx, scope)) <= 1) {
          throw new ApiError(409, "last_profile", "You need at least one profile, so this one can't be deleted.");
        }
        const current = await getSession(tx, scope.sessionId);
        if (id !== scope.profileId) {
          await tx.delete(profile).where(eq(profile.id, id));
          return { me: await loadMe(tx, scope.accountId, current) };
        }
        const target = await lastUsedProfile(tx, scope.accountId, id);
        const { token, row } = await openSession(tx, { accountId: scope.accountId, profileId: target, now: now(), expiresAt: current.expiresAt });
        await tx.delete(profile).where(eq(profile.id, id)); // cascades its sessions, incl. the current one
        return { me: await loadMe(tx, scope.accountId, row), token };
      });
    },

    /** Store Ans for the active profile; counts as activity. */
    async setAns(scope: ProfileScope, ans: DecimalString | null): Promise<SessionInfo> {
      return db.transaction(async (tx) => {
        await tx.update(profile).set({ ans }).where(and(eq(profile.id, scope.profileId), eq(profile.accountId, scope.accountId)));
        const [s] = await tx.update(session).set({ lastSeenAt: now() }).where(eq(session.id, scope.sessionId)).returning();
        return sessionInfo(s!);
      });
    },

    /** Settings apply to the active profile only (#4). */
    async updateSettings(scope: ProfileScope, patch: SettingsPatch): Promise<ProfileDto> {
      const [p] = await db
        .update(profile)
        .set(patch)
        .where(and(eq(profile.id, scope.profileId), eq(profile.accountId, scope.accountId)))
        .returning();
      return toProfileDto(p!);
    },
  };
}

export type Profiles = ReturnType<typeof createProfiles>;
