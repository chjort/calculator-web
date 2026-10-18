import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { fakeServer } from "./test/fakeServer";

let server: ReturnType<typeof fakeServer>;
const PASSWORD = "correct horse battery";

beforeEach(() => {
  server = fakeServer();
  vi.stubGlobal("fetch", server.fetchMock);
  window.history.replaceState(null, "", "/");
});
afterEach(() => vi.unstubAllGlobals());

async function start(path = "/") {
  window.history.replaceState(null, "", path);
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { level: 1 });
  return user;
}

const field = (name: RegExp | string) => screen.getByLabelText(name, { selector: "input" });
const keypad = () => screen.getByRole("group", { name: "Keypad" });
const key = (name: string) => within(keypad()).getByRole("button", { name });
const result = () => screen.getByTestId("result").textContent;
const ansRow = () => screen.getByTestId("ans-row").textContent;

async function axeClean() {
  const r = await axe.run(document.body, {
    runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
    rules: { "color-contrast": { enabled: false } },
  });
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);
}

async function signUp(user: ReturnType<typeof userEvent.setup>, email = "ana@example.com") {
  await user.click(screen.getByRole("link", { name: "Create an account" }));
  await user.type(field("Email"), email);
  await user.type(field("Password"), PASSWORD);
  await user.click(screen.getByRole("button", { name: "Create account" }));
  await screen.findByRole("group", { name: "Keypad" });
}

async function openSwitcher(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /, switch profile$/ }));
  return screen.getByRole("menu");
}

describe("#3 AC1: an account is always required", () => {
  it("redirects a visitor to Log in and never renders the calculator", async () => {
    await start("/");
    expect(window.location.pathname).toBe("/login");
    expect(document.title).toBe("Log in – Calculator");
    expect(screen.getByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Keypad" })).toBeNull();
    expect(field("Email")).toHaveFocus();
    expect(screen.queryByText(/forgot/i)).toBeNull(); // no password reset in R2 (P5)
    await axeClean();
  });

  it("returns to the requested app path after logging in", async () => {
    server.seed("ana@example.com", PASSWORD);
    const user = await start("/settings");
    expect(window.location.pathname).toBe("/login");
    await user.type(field("Email"), "ana@example.com");
    await user.type(field("Password"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Log in" }));
    await screen.findByRole("heading", { level: 1, name: "Profile settings" });
    expect(window.location.pathname).toBe("/settings");
  });

  it("shows a 'Can't connect' screen with Try again when the server is unreachable", async () => {
    server.setOffline(true);
    window.history.replaceState(null, "", "/");
    const user = userEvent.setup();
    render(<App />);
    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(screen.getByRole("alert")).toHaveTextContent("Can't connect to Calculator.");
    server.setOffline(false);
    await user.click(retry);
    await screen.findByRole("heading", { level: 1, name: "Log in" });
  });
});

describe("#3 AC2: sign up with email and password", () => {
  it("validates on submit: inline errors linked to fields, focus on the first invalid field", async () => {
    const user = await start("/signup");
    expect(document.title).toBe("Create account – Calculator");
    expect(field("Password")).toHaveAccessibleDescription("At least 12 characters");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(field("Email")).toHaveAttribute("aria-invalid", "true");
    expect(field("Email")).toHaveAccessibleDescription("Enter your email address");
    expect(field("Email")).toHaveFocus();
    await user.type(field("Email"), "ana@example");
    await user.type(field("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(field("Email")).toHaveAccessibleDescription("Enter an email address in the format name@example.com");
    await user.clear(field("Email"));
    await user.type(field("Email"), "ana@example.com");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(field("Password")).toHaveAccessibleDescription("At least 12 characters Password must be at least 12 characters");
    expect(field("Password")).toHaveFocus();
    expect(server.calls.filter((c) => c.path === "/api/auth/signup")).toHaveLength(0);
    await axeClean();
  });

  it("creates the account and opens the calculator on profile Default with a welcome banner", async () => {
    const user = await start("/signup");
    await user.type(field("Email"), "  Ana@Example.com");
    await user.type(field("Password"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await screen.findByRole("group", { name: "Keypad" });
    expect(window.location.pathname).toBe("/");
    expect(server.calls.find((c) => c.path === "/api/auth/signup")!.body).toEqual({ email: "Ana@Example.com", password: PASSWORD });
    expect(screen.getByRole("button", { name: "Default, switch profile" })).toBeInTheDocument();
    expect(screen.getByText(/Account created\. Your first profile is called "Default"\./)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Account created. Your first profile is called Default.");
    await axeClean();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("button", { name: "Rename profile" })).toBeNull();
  });

  it("Show/Hide toggles the password; name starts with the visible label (D13)", async () => {
    const user = await start("/signup");
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveTextContent("Show");
    await user.click(toggle);
    expect(field("Password")).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveTextContent("Hide");
    expect(screen.getByText("Password shown")).toBeInTheDocument();
  });
});

describe("#3 AC3: duplicate sign-up shows a clear error", () => {
  it("shows 'There's already an account with this email.' on the Email field and keeps the password", async () => {
    server.seed("ana@example.com", PASSWORD);
    const user = await start("/signup");
    await user.type(field("Email"), "ana@example.com");
    await user.type(field("Password"), "another long password");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(field("Email")).toHaveAttribute("aria-invalid", "true"));
    expect(field("Email")).toHaveAccessibleDescription(/There's already an account with this email\. Log in instead, or use a different email\./);
    expect(field("Password")).toHaveValue("another long password");
    await axeClean();
  });
});

describe("log in (#3)", () => {
  it("wrong credentials: generic alert gets focus, password cleared, email kept", async () => {
    server.seed("ana@example.com", PASSWORD);
    const user = await start("/login");
    await user.type(field("Email"), "ana@example.com");
    await user.type(field("Password"), "wrong password");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Email or password is incorrect.");
    expect(alert).toHaveFocus();
    expect(field("Password")).toHaveValue("");
    expect(field("Email")).toHaveValue("ana@example.com");
    await axeClean();
  });

  it("network error keeps all input including the password", async () => {
    const user = await start("/login");
    await user.type(field("Email"), "ana@example.com");
    await user.type(field("Password"), PASSWORD);
    server.setOffline(true);
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't connect. Check your connection and try again.");
    expect(field("Password")).toHaveValue(PASSWORD);
  });
});

describe("#3 AC5: log out ends the authenticated session", () => {
  it("Account menu → Log out: ends the session on the server and shows the log-in page", async () => {
    const user = await start("/login");
    await signUp(user);
    await user.click(screen.getByRole("button", { name: "Account" }));
    const menu = screen.getByRole("menu", { name: "Account" });
    expect(menu).toHaveTextContent("ana@example.com");
    await axeClean();
    await user.click(within(menu).getByRole("menuitem", { name: "Log out" }));
    await screen.findByRole("heading", { level: 1, name: "Log in" });
    expect(server.calls.some((c) => c.method === "POST" && c.path === "/api/auth/logout")).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent("You're logged out.");
    expect(screen.queryByRole("group", { name: "Keypad" })).toBeNull();
  });

  it("a 401 session_expired mid-use goes to Log in with the idle banner", async () => {
    const user = await start("/login");
    await signUp(user);
    server.expireSession();
    server.fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: { code: "session_expired", message: "x" } }), { status: 401 }));
    await user.click(key("1"));
    await user.click(key("Equals"));
    await screen.findByRole("heading", { level: 1, name: "Log in" });
    expect(screen.getByRole("status")).toHaveTextContent("You were logged out after 30 minutes of inactivity.");
  });
});

describe("#4 AC1: create, rename and delete profiles", () => {
  it("creates a profile from the switcher; it becomes active; duplicate and empty names get field errors", async () => {
    const user = await start("/login");
    await signUp(user);
    const menu = await openSwitcher(user);
    expect(within(menu).getByRole("menuitemradio", { name: "Default" })).toHaveAttribute("aria-checked", "true");
    await axeClean();
    await user.click(within(menu).getByRole("menuitem", { name: "New profile…" }));
    const dialog = screen.getByRole("dialog", { name: "New profile" });
    expect(field("Profile name")).toHaveFocus();
    await user.click(within(dialog).getByRole("button", { name: "Create profile" }));
    expect(field("Profile name")).toHaveAccessibleDescription("Up to 40 characters Enter a profile name");
    await user.type(field("Profile name"), "default");
    await user.click(within(dialog).getByRole("button", { name: "Create profile" }));
    await waitFor(() => expect(field("Profile name")).toHaveAccessibleDescription(/You already have a profile called "default"/));
    await axeClean();
    await user.clear(field("Profile name"));
    await user.type(field("Profile name"), "Work{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Work, switch profile" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Created and switched to Work.");
  });

  it("renames and deletes profiles on the settings screen; the last one can't be deleted", async () => {
    server.seed("ana@example.com", PASSWORD, ["Default", "Work"]);
    const user = await start("/login");
    await user.type(field("Email"), "ana@example.com");
    await user.type(field("Password"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Log in" }));
    await screen.findByRole("group", { name: "Keypad" });
    await user.click(within(await openSwitcher(user)).getByRole("menuitem", { name: "Profile settings" }));
    await screen.findByRole("heading", { level: 1, name: "Profile settings" });
    expect(screen.getByRole("heading", { level: 2, name: "Your profiles (2 of 10)" })).toBeInTheDocument();
    await axeClean();

    await user.click(screen.getByRole("button", { name: "Rename Work" }));
    expect(field("Profile name")).toHaveValue("Work");
    await user.clear(field("Profile name"));
    await user.type(field("Profile name"), "Homework");
    await user.click(screen.getByRole("button", { name: "Save name" }));
    await screen.findByRole("button", { name: "Rename Homework" });
    expect(screen.getByRole("status")).toHaveTextContent("Renamed to Homework.");

    await user.click(screen.getByRole("button", { name: "Delete Default" }));
    const confirm = screen.getByRole("alertdialog", { name: 'Delete "Default"?' });
    expect(within(confirm).getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(confirm).toHaveAccessibleDescription(/permanently deletes the profile "Default"/);
    await axeClean();
    await user.click(within(confirm).getByRole("button", { name: "Delete profile" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByRole("status")).toHaveTextContent("Deleted Default. Switched to Homework.");
    const del = screen.getByRole("button", { name: "Delete Homework" });
    expect(del).toHaveAttribute("aria-disabled", "true");
    expect(del).toHaveAccessibleDescription("You need at least one profile, so this one can't be deleted.");
    await user.click(del);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("#4 AC2: switch the active profile at any time", () => {
  it("switching clears the display and shows that profile's own Ans (P4)", async () => {
    const a = server.seed("ana@example.com", PASSWORD, ["Default", "Work"]);
    a.profiles[1]!.ans = "4.2e+1" as never;
    const user = await start("/login");
    await user.type(field("Email"), "ana@example.com");
    await user.type(field("Password"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Log in" }));
    await screen.findByRole("group", { name: "Keypad" });
    await user.click(key("7"));
    await user.click(within(await openSwitcher(user)).getByRole("menuitemradio", { name: "Work" }));
    await screen.findByRole("button", { name: "Work, switch profile" });
    expect(result()).toBe("0");
    expect(ansRow()).toBe("Ans = 42");
    expect(screen.getByRole("status")).toHaveTextContent("Switched to Work.");
  });
});

describe("#4 AC3/AC4: own settings per profile, applied to the active profile only", () => {
  it("decimal places and theme apply immediately and are saved for the active profile", async () => {
    server.seed("ana@example.com", PASSWORD, ["Default", "Work"]);
    const user = await start("/login");
    await user.type(field("Email"), "ana@example.com");
    await user.type(field("Password"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Log in" }));
    await screen.findByRole("group", { name: "Keypad" });
    await user.click(key("2")); await user.click(key("Divided by")); await user.click(key("3")); await user.click(key("Equals"));
    expect(result()).toBe("0.666666666667");

    await user.click(within(await openSwitcher(user)).getByRole("menuitem", { name: "Profile settings" }));
    expect(screen.getByRole("heading", { level: 2, name: "Settings for Default" })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Decimal places"), "2");
    expect(screen.getByTestId("dp-example")).toHaveTextContent("Example: 2 ÷ 3 = 0.67");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    await waitFor(() => expect(server.calls.filter((c) => c.path === "/api/profile/settings").map((c) => c.body)).toEqual([{ decimalPlaces: 2 }, { theme: "dark" }]));
    await axeClean();

    await user.click(screen.getByRole("link", { name: "Back to calculator" }));
    await screen.findByRole("group", { name: "Keypad" });
    expect(ansRow()).toBe("Ans = 0.67");

    // the other profile keeps its own settings
    await user.click(within(await openSwitcher(user)).getByRole("menuitemradio", { name: "Work" }));
    await screen.findByRole("button", { name: "Work, switch profile" });
    expect(document.documentElement.dataset.theme).toBe("system");
    expect(server.accounts[0]!.profiles.map((p) => [p.name, p.settings])).toEqual([
      ["Default", { decimalPlaces: 2, theme: "dark" }],
      ["Work", { decimalPlaces: null, theme: "system" }],
    ]);
  });

  it("a failed save reverts the control and shows an alert", async () => {
    const user = await start("/login");
    await signUp(user);
    await user.click(within(await openSwitcher(user)).getByRole("menuitem", { name: "Profile settings" }));
    server.setOffline(true);
    await user.click(screen.getByRole("radio", { name: "Light" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save your change.");
    expect(screen.getByRole("radio", { name: /System/ })).toBeChecked();
  });
});

describe("Ans sync (P4, ADR 0008)", () => {
  it("sends the canonical full-precision Ans after '=' and null on AC", async () => {
    const user = await start("/login");
    await signUp(user);
    await user.click(key("1")); await user.click(key("Divided by")); await user.click(key("3")); await user.click(key("Equals"));
    await waitFor(() => expect(server.calls.filter((c) => c.path === "/api/profile/ans").map((c) => c.body)).toEqual([
      { ans: "3.333333333333333333333333333333333e-1" },
    ]));
    await user.click(key("C, clear"));
    await user.click(key("AC, all clear"));
    await waitFor(() => expect(server.calls.filter((c) => c.path === "/api/profile/ans").at(-1)!.body).toEqual({ ans: null }));
  });
});
