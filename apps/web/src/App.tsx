import type { MeResponse, ProfileSettings, SessionInfo } from "@calc/contracts";
import { parseDecimalString, type DecimalString } from "@calc/engine";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiFailure, setActivityHandler, setUnauthorizedHandler } from "./api/client";
import { Calculator } from "./Calculator";
import { SignedInHeader } from "./components/Header";
import { Layout } from "./components/Layout";
import { DeleteProfileDialog, ProfileNameDialog } from "./components/ProfileDialogs";
import { AuthPage, type AuthBanner } from "./pages/AuthPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useRouter, type Path } from "./router";
import { createKeepAlive } from "./session/keepAlive";

type State =
  | { s: "loading" }
  | { s: "offline" }
  | { s: "anon"; banner: AuthBanner }
  | { s: "authed"; me: MeResponse; welcome: boolean };

type Dialog = { kind: "create" } | { kind: "rename"; id: string } | { kind: "delete"; id: string } | null;

const SWITCH_FAILED = "Couldn't switch profile. Check your connection and try again.";
const SAVE_FAILED = "Couldn't save your change. Check your connection and try again.";

/** Which banner the log-in page shows after a 401 session_expired (DS9), from the last SessionInfo. */
function expiredBanner(info: SessionInfo | null): AuthBanner {
  return info && Date.now() >= Date.parse(info.expiresAt) ? "max_session" : "idle";
}

export function App() {
  const { path, navigate } = useRouter();
  const [state, setState] = useState<State>({ s: "loading" });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [message, setMessage] = useState<{ text: string; id: number } | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [settingsStatus, setSettingsStatus] = useState("");
  const returnTo = useRef<Path>("/");
  const lastSession = useRef<SessionInfo | null>(null);
  const keepAlive = useMemo(() => createKeepAlive(), []);

  const announce = useCallback((text: string) => {
    setMessage((m) => ({ text, id: (m?.id ?? 0) + 1 }));
    setSettingsStatus(text);
  }, []);

  const signedIn = useCallback((me: MeResponse, welcome = false) => {
    lastSession.current = me.session;
    keepAlive.noteActivity();
    setState({ s: "authed", me, welcome });
  }, [keepAlive]);

  const load = useCallback(() => {
    api.me().then(
      (me) => signedIn(me),
      (e) => setState(e instanceof ApiFailure && e.kind === "http" ? { s: "anon", banner: null } : { s: "offline" }),
    );
  }, [signedIn]);

  useEffect(load, [load]);
  useEffect(() => {
    setUnauthorizedHandler((code) => {
      setDialog(null);
      setState({ s: "anon", banner: code === "session_expired" ? expiredBanner(lastSession.current) : null });
    });
    setActivityHandler((info) => { lastSession.current = info; keepAlive.noteActivity(); });
  }, [keepAlive]);

  // Route guard: no calculator without a session; auth pages are for signed-out users only.
  useEffect(() => {
    if (state.s === "anon" && path !== "/login" && path !== "/signup") {
      returnTo.current = path;
      navigate("/login", { replace: true });
    } else if (state.s === "authed" && (path === "/login" || path === "/signup")) {
      navigate(returnTo.current, { replace: true });
      returnTo.current = "/";
    }
  }, [state.s, path, navigate]);

  const me = state.s === "authed" ? state.me : null;
  const active = me?.profiles.find((p) => p.id === me.activeProfileId) ?? null;
  useEffect(() => { document.documentElement.dataset.theme = active?.settings.theme ?? "system"; }, [active?.settings.theme]);
  useEffect(() => { if (path === "/" && state.s === "authed") document.title = "Calculator"; }, [path, state.s]);

  const storedAns = active?.ans ?? null;
  // Read when the Calculator mounts (login, switch, back from settings); it owns Ans while mounted.
  const initialAns = useMemo(() => (storedAns ? parseDecimalString(storedAns) : null), [storedAns]);
  const onAnsChange = useCallback((ans: DecimalString | null) => {
    api.setAns(ans).catch(() => {}); // 401 handled centrally; Ans stays usable locally
    setState((s) => s.s !== "authed" ? s : {
      ...s,
      me: { ...s.me, profiles: s.me.profiles.map((p) => p.id === s.me.activeProfileId ? { ...p, ans: ans as typeof p.ans } : p) },
    });
  }, []);

  if (state.s === "loading") {
    return <Layout><p role="status" className="loading">Loading…</p></Layout>;
  }
  if (state.s === "offline") {
    return (
      <Layout>
        <div className="card" role="alert">
          <p>Can't connect to Calculator. Check your connection and try again.</p>
          <button type="button" className="primary" autoFocus onClick={() => { setState({ s: "loading" }); load(); }}>Try again</button>
        </div>
      </Layout>
    );
  }
  if (state.s === "anon") {
    if (path !== "/login" && path !== "/signup") return null;
    const mode = path === "/signup" ? "signup" : "login";
    return (
      <AuthPage
        key={mode}
        mode={mode}
        banner={state.banner}
        onSwitch={() => navigate(mode === "login" ? "/signup" : "/login")}
        onAuthed={(m, how) => {
          signedIn(m, how === "signup");
          const name = m.profiles.find((p) => p.id === m.activeProfileId)!.name;
          announce(how === "signup" ? "Account created. Your first profile is called Default." : `Logged in. Profile: ${name}.`);
        }}
      />
    );
  }

  const authed = state;
  const authedMe = state.me;
  const profileName = (id: string) => authedMe.profiles.find((p) => p.id === id)?.name ?? "";
  const withMe = (f: (m: MeResponse) => MeResponse) =>
    setState((s) => (s.s !== "authed" ? s : { ...s, me: f(s.me) }));

  async function logout() {
    await api.logout().catch(() => {});
    setDialog(null);
    setState({ s: "anon", banner: "logged_out" });
    navigate("/login");
  }
  async function switchTo(id: string) {
    setAlert(null);
    try {
      signedIn(await api.activateProfile(id));
      announce(`Switched to ${profileName(id)}.`);
    } catch (e) {
      if (!(e instanceof ApiFailure && e.status === 401)) setAlert(SWITCH_FAILED);
    }
  }
  async function changeSettings(patch: Partial<ProfileSettings>) {
    const before = authedMe;
    setAlert(null);
    setSettingsStatus("");
    // Applied immediately (that is the preview), reverted if saving fails (R2-4 §1.5).
    withMe((m) => ({ ...m, profiles: m.profiles.map((p) => p.id === m.activeProfileId ? { ...p, settings: { ...p.settings, ...patch } } : p) }));
    try {
      const saved = await api.updateSettings(patch);
      withMe((m) => ({ ...m, profiles: m.profiles.map((p) => p.id === saved.id ? saved : p) }));
      setSettingsStatus("Saved");
    } catch (e) {
      withMe(() => before);
      if (!(e instanceof ApiFailure && e.status === 401)) setAlert(SAVE_FAILED);
    }
  }

  const header = (
    <SignedInHeader
      me={authedMe}
      onSwitch={switchTo}
      onNewProfile={() => setDialog({ kind: "create" })}
      onSettings={() => navigate("/settings")}
      onLogout={logout}
    />
  );

  let dialogEl = null;
  if (dialog?.kind === "create") {
    dialogEl = (
      <ProfileNameDialog
        mode="create"
        onClose={() => setDialog(null)}
        onSubmit={async (name) => { signedIn(await api.createProfile(name)); setDialog(null); announce(`Created and switched to ${name}.`); }}
      />
    );
  } else if (dialog?.kind === "rename") {
    const id = dialog.id;
    dialogEl = (
      <ProfileNameDialog
        mode="rename"
        initial={profileName(id)}
        onClose={() => setDialog(null)}
        onSubmit={async (name) => {
          const p = await api.renameProfile(id, name);
          setState((s) => s.s !== "authed" ? s : { ...s, welcome: false, me: { ...s.me, profiles: s.me.profiles.map((x) => x.id === p.id ? p : x) } });
          setDialog(null);
          announce(`Renamed to ${name}.`);
        }}
      />
    );
  } else if (dialog?.kind === "delete") {
    const id = dialog.id;
    dialogEl = (
      <DeleteProfileDialog
        profile={authedMe.profiles.find((p) => p.id === id)!}
        activeId={authedMe.activeProfileId}
        nextName={authedMe.switchOnDeleteProfileId ? profileName(authedMe.switchOnDeleteProfileId) : null}
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          const name = profileName(id);
          const wasActive = id === authedMe.activeProfileId;
          const next = await api.deleteProfile(id);
          signedIn(next);
          setDialog(null);
          const now = next.profiles.find((p) => p.id === next.activeProfileId)!.name;
          announce(wasActive ? `Deleted ${name}. Switched to ${now}.` : `Deleted ${name}.`);
        }}
      />
    );
  }

  return (
    <div onKeyDownCapture={(e) => keepAlive.onInput(e.nativeEvent)} onPointerDownCapture={(e) => keepAlive.onInput(e.nativeEvent)}>
      <Layout headerRight={header}>
        {alert && <div role="alert" className="banner error-box page-alert"><span aria-hidden="true">⚠ </span>{alert}</div>}
        {path === "/settings" ? (
          <SettingsPage
            me={authedMe}
            status={settingsStatus}
            onBack={() => navigate("/")}
            onChangeSettings={changeSettings}
            onNewProfile={() => setDialog({ kind: "create" })}
            onSwitch={switchTo}
            onRename={(id) => setDialog({ kind: "rename", id })}
            onDelete={async (id) => {
              // Re-read so the named fallback reflects the server's current last-used order.
              if (id === authedMe.activeProfileId) await api.me().then((m) => withMe(() => m), () => {});
              setDialog({ kind: "delete", id });
            }}
          />
        ) : (
          <div className="calc-page">
            <h1 className="visually-hidden">Calculator</h1>
            {authed.welcome && (
              <div className="banner info welcome">
                <p><span aria-hidden="true">ⓘ </span>Account created. Your first profile is called "Default".</p>
                <button type="button" className="link-button" onClick={() => setDialog({ kind: "rename", id: authedMe.activeProfileId })}>Rename profile</button>
                <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => setState({ ...authed, welcome: false })}><span aria-hidden="true">✕</span></button>
              </div>
            )}
            <Calculator
              key={authedMe.activeProfileId}
              initialAns={initialAns}
              decimalPlaces={active!.settings.decimalPlaces}
              onAnsChange={onAnsChange}
              message={message}
            />
          </div>
        )}
      </Layout>
      {dialogEl}
    </div>
  );
}
