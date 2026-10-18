import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

// Dedicated port, never shared with `pnpm preview` (4173). reuseExistingServer: false means e2e always
// runs against a fresh build of this checkout. From R2 the real server (Fastify + Postgres) serves the
// built SPA and the API on one origin, exactly as in production (ADR 0001).
// HTTPS with a throwaway self-signed cert: the session cookie is `__Host-sid; Secure` (R2.md §4), and
// WebKit (Safari) does not store Secure cookies on http://localhost, unlike Chromium and Firefox.
const PORT = 41731;
const ORIGIN = `https://localhost:${PORT}`;
const WEB_DIST = fileURLToPath(new URL("./dist", import.meta.url));
const TLS = fileURLToPath(new URL("./.e2e-tls", import.meta.url));
const CERT = `mkdir -p ${TLS} && openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj /CN=localhost -addext subjectAltName=DNS:localhost -keyout ${TLS}/key.pem -out ${TLS}/cert.pem 2>/dev/null`;

export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: ORIGIN, ignoreHTTPSErrors: true, trace: "retain-on-failure" },
  webServer: {
    command: `${CERT} && pnpm build && pnpm --filter @calc/server start`,
    url: `${ORIGIN}/login`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL_E2E ?? "postgres://calc@localhost:5432/calc_e2e",
      APP_ORIGIN: ORIGIN,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      WEB_DIST,
      AUTH_RATE_LIMIT: "10000",
      TLS_CERT_FILE: `${TLS}/cert.pem`,
      TLS_KEY_FILE: `${TLS}/key.pem`,
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 13"] } },
  ],
});
