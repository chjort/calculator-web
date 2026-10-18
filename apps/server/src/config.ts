import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  APP_ORIGIN: z.url(),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default("127.0.0.1"),
  WEB_DIST: z.string().optional(),
});

export type Config = { databaseUrl: string; appOrigin: string; port: number; host: string; webDist?: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = Env.parse(env);
  return {
    databaseUrl: e.DATABASE_URL,
    appOrigin: new URL(e.APP_ORIGIN).origin,
    port: e.PORT,
    host: e.HOST,
    ...(e.WEB_DIST ? { webDist: e.WEB_DIST } : {}),
  };
}
