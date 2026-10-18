import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  APP_ORIGIN: z.url(),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default("127.0.0.1"),
  WEB_DIST: z.string().optional(),
  /** Per-IP backstop on /api/auth/* (ADR 0005: 30 per minute). Raised only for parallel e2e runs. */
  /** Optional TLS (PEM files). WebKit/Safari won't store Secure cookies on http://localhost, so e2e uses HTTPS. */
  TLS_CERT_FILE: z.string().optional(),
  TLS_KEY_FILE: z.string().optional(),
  AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(30),
});

export type Config = { databaseUrl: string; appOrigin: string; port: number; host: string; authRateLimit: number; webDist?: string; tls?: { certFile: string; keyFile: string } };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = Env.parse(env);
  return {
    databaseUrl: e.DATABASE_URL,
    appOrigin: new URL(e.APP_ORIGIN).origin,
    port: e.PORT,
    host: e.HOST,
    authRateLimit: e.AUTH_RATE_LIMIT,
    ...(e.WEB_DIST ? { webDist: e.WEB_DIST } : {}),
    ...(e.TLS_CERT_FILE && e.TLS_KEY_FILE ? { tls: { certFile: e.TLS_CERT_FILE, keyFile: e.TLS_KEY_FILE } } : {}),
  };
}
