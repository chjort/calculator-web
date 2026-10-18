import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, signUpViaApi, uniqueEmail } from "./helpers";

const keypad = (page: Page) => page.getByRole("group", { name: "Keypad" });
const key = (page: Page, name: string) => keypad(page).getByRole("button", { name, exact: true });
const ansRow = (page: Page) => page.getByTestId("ans-row");
const switcher = (page: Page) => page.getByRole("button", { name: /, switch profile$/ });

async function axeClean(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

async function press(page: Page, ...names: string[]) {
  for (const n of names) await key(page, n).click();
}

async function logIn(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(keypad(page)).toBeVisible();
}

async function switchTo(page: Page, name: string) {
  await switcher(page).click();
  await page.getByRole("menuitemradio", { name }).click();
  await expect(page.getByRole("button", { name: `${name}, switch profile` })).toBeVisible();
}

test("#3 + #4: sign up → calculate → create and switch profiles → log out → log in, Ans kept per profile", async ({ page }) => {
  const email = uniqueEmail("flow");
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/); // #3 AC1
  await expect(keypad(page)).toHaveCount(0);
  await axeClean(page);

  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page).toHaveTitle("Create account – Calculator");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(keypad(page)).toBeVisible(); // #3 AC2
  await expect(switcher(page)).toHaveAccessibleName("Default, switch profile");
  await expect(page.getByText('Account created. Your first profile is called "Default".')).toBeVisible();
  await axeClean(page);

  await press(page, "2", "Divided by", "3", "Equals");
  await expect(ansRow(page)).toHaveText("Ans = 0.666666666667");

  // #4: create (becomes active), with its own empty Ans
  await switcher(page).click();
  await page.getByRole("menuitem", { name: "New profile…" }).click();
  await page.getByLabel("Profile name").fill("Work");
  await page.getByRole("button", { name: "Create profile" }).click();
  await expect(switcher(page)).toHaveAccessibleName("Work, switch profile");
  await expect(ansRow(page)).toHaveText("");
  await press(page, "5", "Times", "5", "Equals");
  await expect(ansRow(page)).toHaveText("Ans = 25");

  await switchTo(page, "Default");
  await expect(ansRow(page)).toHaveText("Ans = 0.666666666667");
  await expect(page.getByTestId("result")).toHaveText("0"); // display cleared on switch

  // #3 AC5: log out ends the session
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("status")).toHaveText("ⓘ You're logged out.");
  expect((await page.request.get("/api/me")).status()).toBe(401);
  await page.goBack();
  await expect(keypad(page)).toHaveCount(0);

  // log in: last-used profile, Ans persisted per profile on the server
  await page.goto("/login");
  await logIn(page, email);
  await expect(switcher(page)).toHaveAccessibleName("Default, switch profile");
  await expect(ansRow(page)).toHaveText("Ans = 0.666666666667");
  await press(page, "Ans, previous answer", "Times", "3", "Equals");
  await expect(page.getByTestId("result")).toHaveText("2"); // full precision Ans (ADR 0008)
  await switchTo(page, "Work");
  await expect(ansRow(page)).toHaveText("Ans = 25");
});

test("#4: settings per profile, rename and delete (incl. the active one)", async ({ page }) => {
  await signUpViaApi(page);
  await page.goto("/");
  await switcher(page).click();
  await page.getByRole("menuitem", { name: "Profile settings" }).click();
  await expect(page).toHaveTitle("Profile settings – Calculator");
  const del = page.getByRole("button", { name: "Delete Default" });
  await expect(del).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText("You need at least one profile, so this one can't be deleted.")).toBeVisible();

  await page.getByRole("button", { name: "New profile" }).click();
  await page.getByLabel("Profile name").fill("Homework");
  await page.getByRole("button", { name: "Create profile" }).click();
  await expect(page.getByRole("heading", { name: "Settings for Homework" })).toBeVisible();

  // #4 AC3/AC4: settings change only the active profile
  await page.getByLabel("Decimal places").selectOption("2");
  await page.getByRole("radio", { name: "Dark" }).check();
  await expect(page.getByRole("status")).toHaveText("Saved");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await axeClean(page); // dark theme contrast
  await page.getByRole("link", { name: "Back to calculator" }).click();
  await press(page, "2", "Divided by", "3", "Equals");
  await expect(page.getByTestId("result")).toHaveText("0.67");
  await switchTo(page, "Default");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
  await press(page, "2", "Divided by", "3", "Equals");
  await expect(page.getByTestId("result")).toHaveText("0.666666666667");

  // rename, then delete the active profile → switches to the most recently used remaining one
  await switcher(page).click();
  await page.getByRole("menuitem", { name: "Profile settings" }).click();
  await page.getByRole("button", { name: "Rename Default" }).click();
  await page.getByLabel("Profile name").fill("Taxes");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("heading", { name: "Settings for Taxes" })).toBeVisible();
  await page.getByRole("button", { name: "Delete Taxes" }).click();
  const confirm = page.getByRole("alertdialog", { name: 'Delete "Taxes"?' });
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expect(confirm).toContainText(`You're using this profile. After deleting it you'll switch to "Homework".`);
  await axeClean(page);
  await confirm.getByRole("button", { name: "Delete profile" }).click();
  await expect(page.getByRole("heading", { name: "Settings for Homework" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your profiles (1 of 10)" })).toBeVisible();
  await expect(switcher(page)).toHaveAccessibleName("Homework, switch profile"); // actually switched to the named profile
});

test("#3: duplicate sign-up and wrong password show clear, generic errors", async ({ page }) => {
  const email = await signUpViaApi(page);
  await page.context().clearCookies();
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email.toUpperCase());
  await page.getByLabel("Password", { exact: true }).fill("another long password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("There's already an account with this email.")).toBeVisible(); // #3 AC3
  await axeClean(page);

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("wrong password!");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toHaveText("⚠ Email or password is incorrect.");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
});

test("#4 AC5: profiles are not shareable between accounts", async ({ page, browser }) => {
  await signUpViaApi(page);
  const me = await (await page.request.get("/api/me")).json();
  const other = await browser.newContext({ baseURL: "https://localhost:41731", ignoreHTTPSErrors: true });
  const otherPage = await other.newPage();
  await signUpViaApi(otherPage);
  const res = await otherPage.request.post(`/api/profiles/${me.activeProfileId}/activate`, { headers: { Origin: "https://localhost:41731" } });
  expect(res.status()).toBe(404);
  await other.close();
});

test("cookie is HttpOnly, Secure, SameSite=Lax, __Host- prefixed", async ({ page }) => {
  await signUpViaApi(page);
  const [c] = await page.context().cookies();
  expect(c).toEqual(expect.objectContaining({ name: "__Host-sid", httpOnly: true, secure: true, sameSite: "Lax", path: "/" }));
  await page.goto("/");
  expect(await page.evaluate(() => document.cookie)).toBe("");
});
