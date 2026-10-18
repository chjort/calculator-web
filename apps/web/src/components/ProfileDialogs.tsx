import { ProfileName, type ProfileDto } from "@calc/contracts";
import { useId, useState, type FormEvent } from "react";
import { ApiFailure } from "../api/client";
import { Modal } from "./Modal";

export const PROFILE_COPY = {
  nameEmpty: "Enter a profile name",
  nameLong: "Profile name must be 40 characters or fewer",
  nameTaken: (n: string) => `You already have a profile called "${n}". Choose a different name.`,
  limit: "You've reached the limit of 10 profiles.",
  limitLong: "You've reached the limit of 10 profiles. Delete one to add another.",
  lastProfile: "You need at least one profile, so this one can't be deleted.",
  failed: "Something went wrong. Check your connection and try again.",
} as const;

function nameError(raw: string): string | null {
  const r = ProfileName.safeParse(raw);
  if (r.success) return null;
  return raw.trim().length === 0 ? PROFILE_COPY.nameEmpty : PROFILE_COPY.nameLong;
}

/** New profile / Rename profile dialog (R2-4 §2.5, §3.3). */
export function ProfileNameDialog(props: {
  mode: "create" | "rename";
  initial?: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(props.initial ?? "");
  const [error, setError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { input: useId(), hint: useId(), err: useId() };
  const create = props.mode === "create";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setAlert(null);
    const err = nameError(name);
    setError(err);
    if (err) return;
    const trimmed = name.trim();
    if (!create && trimmed === props.initial) return props.onClose(); // unchanged: no request
    setBusy(true);
    try {
      await props.onSubmit(trimmed);
    } catch (x) {
      setBusy(false);
      if (x instanceof ApiFailure && x.code === "profile_name_taken") return setError(PROFILE_COPY.nameTaken(trimmed));
      if (x instanceof ApiFailure && x.code === "profile_limit") return setAlert(PROFILE_COPY.limit);
      setAlert(PROFILE_COPY.failed);
    }
  }

  return (
    <Modal title={create ? "New profile" : "Rename profile"} onClose={props.onClose} initialFocus="input">
      <form noValidate onSubmit={submit}>
        {alert && <div role="alert" className="banner error-box"><span aria-hidden="true">⚠ </span>{alert}</div>}
        <div className="field">
          <label htmlFor={ids.input}>Profile name</label>
          <p id={ids.hint} className="hint-text">Up to 40 characters</p>
          <input
            id={ids.input}
            autoComplete="off"
            value={name}
            onFocus={(e) => { if (!create) e.currentTarget.select(); }}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={[ids.hint, error ? ids.err : ""].join(" ").trim()}
          />
          {error && <p id={ids.err} className="field-error"><span aria-hidden="true">⚠ </span>{error}</p>}
        </div>
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={props.onClose}>Cancel</button>
          <button type="submit" className="primary" aria-disabled={busy ? "true" : undefined}>
            {create ? (busy ? "Creating…" : "Create profile") : busy ? "Saving…" : "Save name"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Delete confirmation (R2-4 §2.6, DS6): alertdialog, initial focus on Cancel. */
export function DeleteProfileDialog(props: {
  profile: ProfileDto;
  activeId: string;
  /** Name of MeResponse.switchOnDeleteProfileId: where the server will switch if this (active) profile is deleted. */
  nextName: string | null;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const isActive = props.profile.id === props.activeId;
  const n = props.profile.name;
  return (
    <Modal
      role="alertdialog"
      title={`Delete "${n}"?`}
      onClose={props.onClose}
      initialFocus="button.secondary"
      description={
        <>
          <p>This permanently deletes the profile "{n}" and its settings. This can't be undone.</p>
          {isActive && props.nextName && <p>You're using this profile. After deleting it you'll switch to "{props.nextName}".</p>}
        </>
      }
    >
      {alert && <div role="alert" className="banner error-box"><span aria-hidden="true">⚠ </span>{alert}</div>}
      <div className="dialog-actions">
        <button type="button" className="secondary" onClick={props.onClose}>Cancel</button>
        <button
          type="button"
          className="danger"
          aria-disabled={busy ? "true" : undefined}
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            try { await props.onConfirm(); } catch { setBusy(false); setAlert(PROFILE_COPY.failed); }
          }}
        >
          {busy ? "Deleting…" : "Delete profile"}
        </button>
      </div>
    </Modal>
  );
}
