import { readFileSync } from "node:fs";
import { loadConfig } from "./config";
import { connect, runMigrations } from "./db/client";
import { buildApp } from "./http/app";

const config = loadConfig();
const { db } = connect(config.databaseUrl);
await runMigrations(db);
const app = await buildApp({
  db,
  appOrigin: config.appOrigin,
  authRateLimit: config.authRateLimit,
  logger: true,
  ...(config.webDist ? { webDist: config.webDist } : {}),
  ...(config.tls ? { https: { cert: readFileSync(config.tls.certFile), key: readFileSync(config.tls.keyFile) } } : {}),
});
await app.listen({ port: config.port, host: config.host });
