import { expect, type Page } from "@playwright/test";

export const ORIGIN = "https://localhost:41731"; // keep in sync with playwright.config.ts
export const PASSWORD = "correct horse battery";
export const uniqueEmail = (tag: string) => `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

/** Sign up through the API (same cookie jar as the page), then the page is signed in. */
export async function signUpViaApi(page: Page, email = uniqueEmail("e2e")) {
  const res = await page.request.post("/api/auth/signup", { data: { email, password: PASSWORD }, headers: { Origin: ORIGIN } });
  expect(res.status()).toBe(201);
  return email;
}
