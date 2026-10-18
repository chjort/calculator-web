import { and, desc, eq, isNull } from "drizzle-orm";
import type { Executor } from "../db/client";
import { profile, session } from "../db/schema";
import type { AccountId, ProfileId, SessionId, SessionToken } from "../domain/types";
import { hashToken, newToken } from "./token";

// The auth module owns the `session` table; profiles call these helpers for switch/create/delete.

export type SessionRow = typeof session.$inferSelect;

export async function openSession(
  ex: Executor,
  o: { accountId: AccountId; profileId: ProfileId; now: Date; expiresAt: Date },
): Promise<{ token: SessionToken; row: SessionRow }> {
  const token = newToken();
  const [row] = await ex
    .insert(session)
    .values({ accountId: o.accountId, profileId: o.profileId, tokenHash: hashToken(token), startedAt: o.now, lastSeenAt: o.now, expiresAt: o.expiresAt })
    .returning();
  return { token, row: row! };
}

export async function endSession(ex: Executor, id: SessionId, endedAt: Date, reason: NonNullable<SessionRow["endReason"]>) {
  await ex.update(session).set({ endedAt, endReason: reason }).where(and(eq(session.id, id), isNull(session.endedAt)));
}

export async function getSession(ex: Executor, id: SessionId): Promise<SessionRow> {
  const [row] = await ex.select().from(session).where(eq(session.id, id));
  if (!row) throw new Error("session vanished");
  return row;
}

/** Last-used rule (ADR 0003/0007): profile of the account's session with max(last_seen_at), else the oldest profile. */
export async function lastUsedProfile(ex: Executor, accountId: AccountId, excluding?: ProfileId): Promise<ProfileId> {
  const sessions = await ex
    .select({ profileId: session.profileId })
    .from(session)
    .where(eq(session.accountId, accountId))
    .orderBy(desc(session.lastSeenAt))
    .limit(excluding ? 50 : 1);
  const hit = sessions.find((s) => s.profileId !== excluding);
  if (hit) return hit.profileId as ProfileId;
  const profiles = await ex.select({ id: profile.id }).from(profile).where(eq(profile.accountId, accountId)).orderBy(profile.createdAt, profile.id);
  const oldest = profiles.find((p) => p.id !== excluding);
  if (!oldest) throw new Error("account has no profile");
  return oldest.id as ProfileId;
}
