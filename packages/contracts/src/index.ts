import { z } from "zod";

// Shared API contract (docs/architecture/R2.md §4). Server routes and the SPA both parse with these.

// ---------- primitives (validated once, branded) ----------
export const Email = z.string().trim().toLowerCase().pipe(z.email().max(254)).brand<"Email">();
export type Email = z.infer<typeof Email>;
export const NewPassword = z.string().min(12).max(128); // ADR 0005; login accepts any 1..128
export const ProfileName = z.string().trim().min(1).max(40);
export const Theme = z.enum(["light", "dark", "system"]);
export type Theme = z.infer<typeof Theme>;
export const ProfileSettings = z.object({
  decimalPlaces: z.number().int().min(0).max(12).nullable(), // null = auto (12 sig. digits, D2)
  theme: Theme,
});
export type ProfileSettings = z.infer<typeof ProfileSettings>;

// ---------- requests ----------
export const SignupRequest = z.object({ email: Email, password: NewPassword });
export const LoginRequest = z.object({ email: Email, password: z.string().min(1).max(128) });
export const ProfileNameRequest = z.object({ name: ProfileName }); // create and rename
export const SettingsPatch = ProfileSettings.partial().refine((o) => Object.keys(o).length > 0, "empty patch");
export type SettingsPatch = z.infer<typeof SettingsPatch>;

// ---------- responses ----------
export const DecimalStringSchema = z
  .string()
  .max(48)
  .regex(/^-?\d(\.\d{1,33})?e[+-]\d{1,4}$/)
  .brand<"DecimalString">(); // engine canonical form (ADR 0008)
export const AnsRequest = z.object({ ans: DecimalStringSchema.nullable() }); // null = AC
export const ProfileDto = z.object({
  id: z.uuid(),
  name: z.string(),
  settings: ProfileSettings,
  ans: DecimalStringSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type ProfileDto = z.infer<typeof ProfileDto>;
export const SessionInfo = z.object({
  expiresAt: z.iso.datetime(), // absolute cap (login + 12 h): 10-min notice
  idleExpiresAt: z.iso.datetime(), // last_seen_at + 30 min: 2-min idle warning (DS9)
});
export type SessionInfo = z.infer<typeof SessionInfo>;
export const MeResponse = z.object({
  account: z.object({ id: z.uuid(), email: z.string() }),
  activeProfileId: z.uuid(),
  profiles: z.array(ProfileDto), // oldest first
  session: SessionInfo,
  // Additive (PR #26): the profile DELETE of the active profile would switch to (ADR 0007 rule); null if it's the only one.
  switchOnDeleteProfileId: z.uuid().nullable(),
});
export type MeResponse = z.infer<typeof MeResponse>;
export const ErrorCode = z.enum([
  "validation_failed", "unauthenticated", "session_expired", "invalid_credentials",
  "csrf_rejected", "not_found", "email_taken", "password_too_common", "profile_name_taken",
  "profile_limit", "last_profile", "rate_limited", "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;
export const ErrorResponse = z.object({
  error: z.object({ code: ErrorCode, message: z.string(), fields: z.record(z.string(), z.string()).optional() }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export const MAX_PROFILES = 10; // ADR 0006
