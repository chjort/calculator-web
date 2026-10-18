import { buildApp } from "./http/app";
import { loadConfig } from "./config";
import { connect, runMigrations } from "./db/client";

const config = loadConfig();
const { db } = connect(config.databaseUrl);
await runMigrations(db);
const app = await buildApp({ db, appOrigin: config.appOrigin, logger: true, ...(config.webDist ? { webDist: config.webDist } : {}) });
await app.listen({ port: config.port, host: config.host });
