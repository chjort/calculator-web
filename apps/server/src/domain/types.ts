import type { DecimalStringSchema, Email, ProfileSettings } from "@calc/contracts";
import type { z } from "zod";

type Brand<T, B extends string> = T & { readonly __brand: B };

export type AccountId = Brand<string, "AccountId">;
export type ProfileId = Brand<string, "ProfileId">;
export type SessionId = Brand<string, "SessionId">;
/** Opaque 256-bit cookie value (base64url). Only its SHA-256 is ever stored. */
export type SessionToken = Brand<string, "SessionToken">;
export type DecimalString = z.infer<typeof DecimalStringSchema>;
export type { Email, ProfileSettings };

/** Proof that the caller holds a live session for this account. Built only by `auth.resolve` (R2.md §5). */
export type AccountScope = Brand<{ readonly accountId: AccountId; readonly sessionId: SessionId }, "AccountScope">;
/** AccountScope plus the session's active profile. */
export type ProfileScope = AccountScope & { readonly profileId: ProfileId };

export type Clock = () => Date;
