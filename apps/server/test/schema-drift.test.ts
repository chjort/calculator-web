import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import * as schema from "../src/db/schema";
import { setupDb } from "./harness";

// Drift check: the hand-written migrations (drizzle/*.sql) are the source of truth for the DB;
// the Drizzle TS schema is what the code queries with. Apply the migrations to an empty database and
// compare every table and column (name, type, nullability, primary key) with the TS schema.

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await setupDb()));
afterAll(async () => close());

type Col = { table: string; column: string; type: string; notNull: boolean; pk: boolean };
const norm = (t: string) => t.toLowerCase().replace("timestamp with time zone", "timestamptz").replace(/^user-defined$/, "citext");

function fromSchema(): Col[] {
  const tables = (Object.values(schema) as unknown[]).filter((t): t is PgTable => typeof t === "object" && t !== null && Symbol.for("drizzle:IsDrizzleTable") in t);
  return tables.flatMap((t) => {
    const cfg = getTableConfig(t);
    return cfg.columns.map((c) => ({ table: cfg.name, column: c.name, type: norm(c.getSQLType()), notNull: c.notNull, pk: c.primary }));
  });
}

async function fromDb(): Promise<Col[]> {
  const r = await db.execute<{ table_name: string; column_name: string; data_type: string; udt_name: string; is_nullable: string; pk: boolean }>(sql`
    SELECT c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable,
      EXISTS (SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage k ON k.constraint_name = tc.constraint_name AND k.table_name = tc.table_name
        WHERE tc.table_name = c.table_name AND tc.constraint_type = 'PRIMARY KEY' AND k.column_name = c.column_name) AS pk
    FROM information_schema.columns c WHERE c.table_schema = 'public'`);
  return r.rows.map((x) => ({
    table: x.table_name,
    column: x.column_name,
    type: norm(x.data_type === "USER-DEFINED" ? x.udt_name : x.data_type),
    notNull: x.is_nullable === "NO",
    pk: x.pk,
  }));
}

const sortCols = (cs: Col[]) => [...cs].sort((a, b) => `${a.table}.${a.column}`.localeCompare(`${b.table}.${b.column}`));

describe("schema drift: drizzle/*.sql vs src/db/schema.ts", () => {
  it("every table and column matches (name, type, nullability, primary key)", async () => {
    expect(sortCols(fromSchema())).toEqual(sortCols(await fromDb()));
  });
});
