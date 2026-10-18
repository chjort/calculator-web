import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { App } from "./App";

function setup() {
  const user = userEvent.setup();
  render(<App />);
  const keypad = screen.getByRole("group", { name: "Keypad" });
  const key = (name: string) => within(keypad).getByRole("button", { name });
  const click = async (...names: string[]) => { for (const n of names) await user.click(key(n)); };
  const expression = () => screen.getByTestId("expression").textContent;
  const result = () => screen.getByTestId("result").textContent;
  const ansRow = () => screen.getByTestId("ans-row").textContent;
  const announced = () => screen.getByRole("status").textContent?.trim();
  return { user, key, click, expression, result, ansRow, announced };
}

describe("mouse input (#1 AC4, #2 AC4)", () => {
  it("computes with the on-screen keypad", async () => {
    const t = setup();
    await t.click("1", "2", "Times", "Open parenthesis", "3", "Minus", "1", "Close parenthesis", "Equals");
    expect(t.expression()).toBe("12 × (3 − 1) =");
    expect(t.result()).toBe("24");
    expect(t.ansRow()).toBe("Ans = 24");
    expect(t.announced()).toBe("12 times open parenthesis 3 minus 1 close parenthesis equals 24");
  });

  it("percent, divide by zero error, backspace, clear, Ans", async () => {
    const t = setup();
    await t.click("2", "0", "0", "Plus", "1", "0", "Percent", "Equals");
    expect(t.result()).toBe("200.1");
    await t.click("8", "Divided by", "0", "Equals");
    expect(t.result()).toBe("⚠ Error: Can't divide by zero");
    expect(t.announced()).toBe("Error: Can't divide by zero");
    await t.click("Backspace");
    expect(t.expression()).toBe("8 ÷ 0");
    await t.click("Clear");
    expect(t.result()).toBe("0");
    expect(t.ansRow()).toBe("Ans = 200.1");
    await t.click("Ans, insert last result", "Times", "1", "0", "Equals");
    expect(t.result()).toBe("2001");
    await t.click("Clear", "All clear");
    expect(t.ansRow()).toBe("");
  });

  it("C/AC label and name swap; Ans is aria-disabled when empty but focusable", async () => {
    const t = setup();
    expect(t.key("All clear")).toHaveTextContent("AC");
    const ans = t.key("Ans, insert last result");
    expect(ans).toHaveAttribute("aria-disabled", "true");
    expect(ans).not.toBeDisabled();
    await t.click("Ans, insert last result");
    expect(t.result()).toBe("ⓘ No previous result yet");
    await t.click("5");
    expect(t.key("Clear")).toHaveTextContent("C");
    await t.click("Equals");
    expect(t.key("Ans, insert last result")).not.toHaveAttribute("aria-disabled");
  });
});

describe("keyboard input (#1 AC4, #2 AC4)", () => {
  it("focuses the display on load", () => {
    setup();
    expect(screen.getByRole("group", { name: "Calculator display" })).toHaveFocus();
  });

  it("types an expression with the R1-1 §7.1 keymap", async () => {
    const t = setup();
    await t.user.keyboard("12*(3-1)/4x2+50%{Enter}");
    expect(t.expression()).toBe("12 × (3 − 1) ÷ 4 × 2 + 50% =");
    expect(t.result()).toBe("12.5");
    await t.user.keyboard("1,5=");
    expect(t.result()).toBe("1.5");
  });

  it("Backspace, Escape/Delete (C then AC) and A for Ans", async () => {
    const t = setup();
    await t.user.keyboard("12+3{Enter}");
    await t.user.keyboard("{Backspace}");
    expect(t.expression()).toBe("12 + 3");
    await t.user.keyboard("{Backspace}{Backspace}");
    expect(t.expression()).toBe("12");
    await t.user.keyboard("{Escape}");
    expect(t.result()).toBe("0");
    expect(t.ansRow()).toBe("Ans = 15");
    await t.user.keyboard("5a{Enter}");
    expect(t.expression()).toBe("5 × Ans =");
    expect(t.result()).toBe("75");
    await t.user.keyboard("{Delete}{Delete}");
    expect(t.ansRow()).toBe("");
  });

  it("Enter always evaluates, even with a key focused (D5); Space activates the key", async () => {
    const t = setup();
    await t.user.keyboard("2+");
    act(() => t.key("7").focus());
    await t.user.keyboard(" ");
    await t.user.keyboard("{Enter}");
    expect(t.expression()).toBe("2 + 7 =");
    expect(t.result()).toBe("9");
  });

  it("does not intercept Ctrl/Meta/Alt combinations", async () => {
    const t = setup();
    await t.user.keyboard("{Control>}a{/Control}{Meta>}1{/Meta}");
    expect(t.expression()).toBe("");
  });

  it("Tab order: display, then keys row by row, then shortcuts", async () => {
    const t = setup();
    await t.user.tab();
    expect(t.key("All clear")).toHaveFocus();
    await t.user.tab();
    expect(t.key("Open parenthesis")).toHaveFocus();
    for (let i = 0; i < 21; i++) await t.user.tab();
    expect(screen.getByText("Keyboard shortcuts")).toHaveFocus();
  });

  it("Esc closes the Backspace tooltip before clearing", async () => {
    const t = setup();
    await t.user.keyboard("12");
    act(() => t.key("Backspace").focus());
    expect(screen.getByRole("tooltip", { hidden: true })).toHaveTextContent("Backspace");
    await t.user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip", { hidden: true })).toBeNull();
    expect(t.expression()).toBe("12");
    await t.user.keyboard("{Escape}");
    expect(t.expression()).toBe("");
  });
});

describe("accessibility (WCAG 2.2 AA, axe)", () => {
  it.each([
    ["initial", ""],
    ["result", "12+3{Enter}"],
    ["error", "8/0{Enter}"],
    ["hint", "3+{Enter}"],
  ])("no axe violations: %s", async (_, keys) => {
    const t = setup();
    if (keys) await t.user.keyboard(keys);
    const r = await axe.run(document.body, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"], rules: { "color-contrast": { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });

  it("landmarks, single polite status region, native buttons", () => {
    setup();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Calculator" })).toBeInTheDocument();
    const status = screen.getAllByRole("status");
    expect(status).toHaveLength(1);
    expect(status[0]).toHaveAttribute("aria-live", "polite");
    expect(status[0]).toHaveAttribute("aria-atomic", "true");
    expect(within(screen.getByRole("group", { name: "Keypad" })).getAllByRole("button")).toHaveLength(22);
    for (const b of screen.getAllByRole("button")) expect(b).toHaveAttribute("type", "button");
  });
});
