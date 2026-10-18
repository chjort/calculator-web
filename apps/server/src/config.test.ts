import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

const base = { DATABASE_URL: "postgres://x", APP_ORIGIN: "http://localhost:3000" };

describe("config", () => {
  it("AUTH_RATE_LIMIT defaults to 30 per minute (ADR 0005)", () => {
    expect(loadConfig(base).authRateLimit).toBe(30);
    expect(loadConfig({ ...base, AUTH_RATE_LIMIT: "10000" }).authRateLimit).toBe(10000);
  });
  it("TLS is optional and needs both files", () => {
    expect(loadConfig(base).tls).toBeUndefined();
    expect(loadConfig({ ...base, TLS_CERT_FILE: "c.pem" }).tls).toBeUndefined();
    expect(loadConfig({ ...base, TLS_CERT_FILE: "c.pem", TLS_KEY_FILE: "k.pem" }).tls).toEqual({ certFile: "c.pem", keyFile: "k.pem" });
  });
});
