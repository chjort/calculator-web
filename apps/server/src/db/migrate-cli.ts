import { loadConfig } from "../config";
import { connect, runMigrations } from "./client";

const { db, pool } = connect(loadConfig().databaseUrl);
await runMigrations(db);
await pool.end();
console.log("migrations applied");
