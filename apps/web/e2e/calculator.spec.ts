import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const keypad = (page: Page) => page.getByRole("group", { name: "Keypad" });
const key = (page: Page, name: string) => keypad(page).getByRole("button", { name, exact: true });
const expression = (page: Page) => page.getByTestId("expression");
const result = (page: Page) => page.getByTestId("result");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Calculator");
});

test("#1: mouse/touch arithmetic, %, parentheses, divide by zero", async ({ page }) => {
  for (const k of ["1", "2", "Times", "(, open parenthesis", "3", "Minus", "1", "), close parenthesis", "=, equals"]) await key(page, k).click();
  await expect(expression(page)).toHaveText("12 × (3 − 1) =");
  await expect(result(page)).toHaveText("24");
  for (const k of ["2", "0", "0", "+, plus", "1", "0", "Percent", "=, equals"]) await key(page, k).click();
  await expect(result(page)).toHaveText("200.1");
  for (const k of ["8", "Divided by", "0", "=, equals"]) await key(page, k).click();
  await expect(result(page)).toHaveText("⚠ Error: Can't divide by zero");
});

test("#1: keyboard arithmetic and 12 significant digits", async ({ page }) => {
  await expect(page.getByRole("group", { name: "Calculator display" })).toBeFocused();
  await page.keyboard.type("1/3");
  await page.keyboard.press("Enter");
  await expect(result(page)).toHaveText("0.333333333333");
  await page.keyboard.type("0.1+0.2=");
  await expect(result(page)).toHaveText("0.3");
});

test("#2: clear, backspace and Ans with keyboard and mouse", async ({ page }) => {
  await page.keyboard.type("12+3");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("ans-row")).toHaveText("Ans = 15");
  await page.keyboard.press("Backspace");
  await expect(expression(page)).toHaveText("12 + 3");
  await key(page, "Backspace").click();
  await expect(expression(page)).toHaveText("12 +");
  // ⌫ is focused, so its tooltip is open: the first Esc only dismisses it (R1-2 §8.5)
  await page.keyboard.press("Escape");
  await expect(expression(page)).toHaveText("12 +");
  await page.keyboard.press("Escape");
  await expect(result(page)).toHaveText("0");
  await key(page, "Ans, previous answer").click();
  await page.keyboard.type("*2");
  await page.keyboard.press("Enter");
  await expect(expression(page)).toHaveText("Ans × 2 =");
  await expect(result(page)).toHaveText("30");
  await key(page, "C, clear").click();
  await key(page, "AC, all clear").click();
  await expect(page.getByTestId("ans-row")).toHaveText("");
  await expect(key(page, "Ans, previous answer")).toHaveAttribute("aria-disabled", "true");
});

test("a11y: no axe WCAG 2.2 AA violations (incl. contrast) in key states", async ({ page }) => {
  const check = async () => {
    const r = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
  };
  await check();
  await page.keyboard.type("8/0=");
  await check();
  await page.keyboard.type("3+=");
  await check();
});

test("reflow: 320px wide, no horizontal scroll, keys >= 56px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(sw).toBeLessThanOrEqual(320);
  const box = await key(page, "7").boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(56);
  expect(box!.width).toBeGreaterThanOrEqual(56);
});
