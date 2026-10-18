import { z } from "zod";
import { connect, runMigrations } from "./client";

// Migrations only need the database; the server-only settings (APP_ORIGIN, PORT, …) aren't required here.
const { DATABASE_URL } = z.object({ DATABASE_URL: z.string().min(1) }).parse(process.env);
const { db, pool } = connect(DATABASE_URL);
await runMigrations(db);
await pool.end();
console.log("migrations applied");
