import { NewPassword, type MeResponse } from "@calc/contracts";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { api, ApiFailure } from "../api/client";
import { Layout } from "../components/Layout";

export type AuthBanner = "logged_out" | "idle" | "max_session" | null;
type Mode = "login" | "signup";

export const AUTH_COPY = {
  banner: {
    logged_out: "You're logged out.",
    idle: "You were logged out after 30 minutes of inactivity. Log in to continue.",
    max_session: "Your session ended after 12 hours. Log in to continue.",
  },
  emailEmpty: "Enter your email address",
  emailInvalid: "Enter an email address in the format name@example.com",
  passwordEmpty: "Enter your password",
  passwordShort: "Password must be at least 12 characters",
  passwordLong: "Password must be 128 characters or fewer",
  passwordCommon: "This password is too common. Choose a different one.",
  wrong: "Email or password is incorrect.",
  taken: "There's already an account with this email.",
  rateLimited: "Too many attempts. Wait a few minutes and try again.",
  network: "Can't connect. Check your connection and try again.",
  server: "Something went wrong on our side. Try again in a moment.",
} as const;

type Errors = { email?: string; password?: string };

function validate(mode: Mode, email: string, password: string): Errors {
  const e: Errors = {};
  const em = email.trim();
  if (!em) e.email = AUTH_COPY.emailEmpty;
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) e.email = AUTH_COPY.emailInvalid;
  if (!password) e.password = AUTH_COPY.passwordEmpty;
  else if (mode === "signup") {
    const r = NewPassword.safeParse(password);
    if (!r.success) e.password = password.length < 12 ? AUTH_COPY.passwordShort : AUTH_COPY.passwordLong;
  }
  return e;
}

/** Log in and Create account (R2-3 §2–§7). */
export function AuthPage(props: { mode: Mode; banner: AuthBanner; onAuthed: (me: MeResponse, mode: Mode) => void; onSwitch: () => void }) {
  const { mode } = props;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toggleMsg, setToggleMsg] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const ids = { email: useId(), password: useId(), hint: useId(), emailErr: useId(), pwErr: useId() };
  const title = mode === "login" ? "Log in" : "Create account";

  useEffect(() => { document.title = `${title} – Calculator`; emailRef.current?.focus(); }, [title]);
  useEffect(() => { if (formError) alertRef.current?.focus(); }, [formError]);

  const revalidate = () => { if (submitted) setErrors(validate(mode, email, password)); };

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (busy) return;
    setSubmitted(true);
    setFormError(null);
    setEmailTaken(false);
    const errs = validate(mode, email, password);
    setErrors(errs);
    if (errs.email) { emailRef.current?.focus(); return; }
    if (errs.password) { passwordRef.current?.focus(); return; }
    setBusy(true);
    try {
      const me = mode === "login" ? await api.login(email, password) : await api.signup(email, password);
      props.onAuthed(me, mode);
    } catch (e) {
      setBusy(false);
      if (!(e instanceof ApiFailure)) throw e;
      if (e.kind === "network") return setFormError(AUTH_COPY.network);
      switch (e.code) {
        case "invalid_credentials": setPassword(""); return setFormError(AUTH_COPY.wrong);
        case "rate_limited": return setFormError(AUTH_COPY.rateLimited);
        case "email_taken": setEmailTaken(true); setErrors({ email: AUTH_COPY.taken }); emailRef.current?.focus(); return;
        case "password_too_common": setErrors({ password: AUTH_COPY.passwordCommon }); passwordRef.current?.focus(); return;
        case "validation_failed":
          setErrors({
            ...(e.fields.email ? { email: AUTH_COPY.emailInvalid } : {}),
            ...(e.fields.password ? { password: password.length < 12 ? AUTH_COPY.passwordShort : AUTH_COPY.passwordLong } : {}),
          });
          return;
        default: return setFormError(AUTH_COPY.server);
      }
    }
  }

  const describedBy = (...xs: (string | false | undefined)[]) => xs.filter(Boolean).join(" ") || undefined;

  return (
    <Layout>
      <div className="card auth-card">
        <div role="status" className="banner-region">
          {props.banner && <p className="banner info"><span aria-hidden="true">ⓘ </span>{AUTH_COPY.banner[props.banner]}</p>}
          <span className="visually-hidden">{toggleMsg}</span>
        </div>
        {formError && (
          <div ref={alertRef} role="alert" tabIndex={-1} className="banner error-box">
            <span aria-hidden="true">⚠ </span>{formError}
          </div>
        )}
        <h1>{title}</h1>
        <form noValidate onSubmit={onSubmit} aria-busy={busy}>
          <div className="field">
            <label htmlFor={ids.email}>Email</label>
            <input
              ref={emailRef}
              id={ids.email}
              type="email"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              aria-invalid={errors.email ? "true" : undefined}
              aria-describedby={describedBy(errors.email && ids.emailErr)}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={revalidate}
            />
            {errors.email && (
              <p id={ids.emailErr} className="field-error">
                <span aria-hidden="true">⚠ </span>{errors.email}
                {emailTaken && <> <a href="/login" onClick={(e) => { e.preventDefault(); props.onSwitch(); }}>Log in</a> instead, or use a different email.</>}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor={ids.password}>Password</label>
            {mode === "signup" && <p id={ids.hint} className="hint-text">At least 12 characters</p>}
            <div className="password-row">
              <input
                ref={passwordRef}
                id={ids.password}
                type={show ? "text" : "password"}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                aria-invalid={errors.password ? "true" : undefined}
                aria-describedby={describedBy(mode === "signup" && ids.hint, errors.password && ids.pwErr)}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={revalidate}
              />
              <button
                type="button"
                className="toggle"
                aria-label={show ? "Hide password" : "Show password"}
                onClick={() => { setShow(!show); setToggleMsg(show ? "Password hidden" : "Password shown"); }}
              >
                {show ? "Hide" : "Show"}
              </button>
            </div>
            {errors.password && <p id={ids.pwErr} className="field-error"><span aria-hidden="true">⚠ </span>{errors.password}</p>}
          </div>
          <button type="submit" className="primary" aria-disabled={busy ? "true" : undefined}>
            {busy ? (mode === "login" ? "Logging in…" : "Creating account…") : title}
          </button>
        </form>
        <p className="switch-link">
          {mode === "login" ? "New here? " : "Have an account? "}
          <a href={mode === "login" ? "/signup" : "/login"} onClick={(e) => { e.preventDefault(); props.onSwitch(); }}>
            {mode === "login" ? "Create an account" : "Log in"}
          </a>
        </p>
      </div>
    </Layout>
  );
}
