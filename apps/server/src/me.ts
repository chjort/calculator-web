import type { MeResponse, ProfileDto } from "@calc/contracts";
import { eq } from "drizzle-orm";
import type { Executor } from "./db/client";
import { account, profile } from "./db/schema";
import { sessionInfo } from "./auth/session-rules";
import { lastUsedProfile, type SessionRow } from "./auth/sessions";
import type { AccountId, ProfileId } from "./domain/types";

export type ProfileRow = typeof profile.$inferSelect;

/** Row -> DTO at the boundary. Ans is stored in canonical form, validated by the contract on write. */
export function toProfileDto(p: ProfileRow): ProfileDto {
  return {
    id: p.id,
    name: p.name,
    settings: { decimalPlaces: p.decimalPlaces, theme: p.theme },
    ans: p.ans as ProfileDto["ans"],
    createdAt: p.createdAt.toISOString(),
  };
}

export async function loadMe(ex: Executor, accountId: AccountId, s: SessionRow): Promise<MeResponse> {
  const [acc] = await ex.select({ id: account.id, email: account.email }).from(account).where(eq(account.id, accountId));
  const profiles = await ex.select().from(profile).where(eq(profile.accountId, accountId)).orderBy(profile.createdAt, profile.id);
  return {
    account: { id: acc!.id, email: acc!.email },
    activeProfileId: s.profileId,
    profiles: profiles.map(toProfileDto),
    session: sessionInfo(s),
    // Same function profiles.remove uses, so the dialog and the actual switch share one rule.
    switchOnDeleteProfileId: profiles.length > 1 ? await lastUsedProfile(ex, accountId, s.profileId as ProfileId) : null,
  };
}
