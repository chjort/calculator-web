import { customType, index, pgTable, smallint, text, timestamp, uuid, bigint, inet, unique } from "drizzle-orm/pg-core";

// Mirrors drizzle/*.sql (the SQL files are the source of truth for constraints, R2.md §3).
const citext = customType<{ data: string }>({ dataType: () => "citext" });
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const account = pgTable("account", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: citext("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const profile = pgTable("profile", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => account.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  decimalPlaces: smallint("decimal_places"),
  theme: text("theme", { enum: ["light", "dark", "system"] }).notNull().default("system"),
  ans: text("ans"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [unique().on(t.id, t.accountId), index().on(t.accountId, t.createdAt)]);

export const session = pgTable("session", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull(),
  profileId: uuid("profile_id").notNull(),
  tokenHash: bytea("token_hash").notNull().unique(),
  startedAt: ts("started_at").notNull(),
  lastSeenAt: ts("last_seen_at").notNull(),
  expiresAt: ts("expires_at").notNull(),
  endedAt: ts("ended_at"),
  endReason: text("end_reason", { enum: ["logout", "timeout", "expired", "profile_switch"] }),
});

export const loginFailure = pgTable("login_failure", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  email: citext("email").notNull(),
  ip: inet("ip"),
  at: ts("at").notNull(),
});
