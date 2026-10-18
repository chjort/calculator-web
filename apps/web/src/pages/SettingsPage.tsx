import { MAX_PROFILES, type MeResponse, type ProfileSettings, type Theme } from "@calc/contracts";
import { format, toDecimalString } from "@calc/engine";
import { useEffect, useId } from "react";

const THEMES: { value: Theme; label: string; hint?: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System", hint: "Follows your device's light or dark mode" },
];
const TWO_THIRDS = toDecimalString("0.6666666666666666666666666666666667");

/** Profile settings screen (R2-4 §2.3, §3.2). Settings always belong to the active profile. */
export function SettingsPage(props: {
  me: MeResponse;
  status: string;
  onBack: () => void;
  onChangeSettings: (patch: Partial<ProfileSettings>) => void;
  onNewProfile: () => void;
  onSwitch: (id: string) => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { me } = props;
  const active = me.profiles.find((p) => p.id === me.activeProfileId)!;
  const { decimalPlaces, theme } = active.settings;
  const ids = { dp: useId(), dpHint: useId(), themeHint: useId(), limit: useId(), last: useId() };
  const atLimit = me.profiles.length >= MAX_PROFILES;
  const onlyOne = me.profiles.length === 1;
  const example = format(TWO_THIRDS, { decimalPlaces });
  useEffect(() => { document.title = "Profile settings – Calculator"; }, []);

  return (
    <div className="settings">
      <a href="/" className="back" onClick={(e) => { e.preventDefault(); props.onBack(); }}>
        <span aria-hidden="true">← </span>Back to calculator
      </a>
      <h1>Profile settings</h1>
      <div role="status" className="visually-hidden">{props.status}</div>

      <section className="panel" aria-labelledby="settings-for">
        <h2 id="settings-for">Settings for <bdi>{active.name}</bdi></h2>
        <p className="hint-text">These settings apply only to the profile you're using.</p>
        <div className="field">
          <label htmlFor={ids.dp}>Decimal places</label>
          <p id={ids.dpHint} className="hint-text">Applies to results and Ans in this profile.</p>
          <select
            id={ids.dp}
            aria-describedby={ids.dpHint}
            value={decimalPlaces === null ? "auto" : String(decimalPlaces)}
            onChange={(e) => props.onChangeSettings({ decimalPlaces: e.target.value === "auto" ? null : Number(e.target.value) })}
          >
            <option value="auto">Auto (up to 12 significant digits)</option>
            {Array.from({ length: 13 }, (_, i) => <option key={i} value={i}>{i}</option>)}
          </select>
          <p className="hint-text" data-testid="dp-example">Example: 2 ÷ 3 = {example}</p>
        </div>
        <fieldset className="field">
          <legend>Theme</legend>
          {THEMES.map((t) => (
            <div key={t.value} className="radio">
              <label className="radio-label">
              <input
                type="radio"
                name="theme"
                value={t.value}
                checked={theme === t.value}
                aria-describedby={t.hint ? ids.themeHint : undefined}
                onChange={() => props.onChangeSettings({ theme: t.value })}
              />
              <span className={`swatch swatch-${t.value}`} aria-hidden="true" />
              {t.label}
              </label>
              {t.hint && <span id={ids.themeHint} className="hint-text">{t.hint}</span>}
            </div>
          ))}
        </fieldset>
      </section>

      <section className="panel" aria-labelledby="your-profiles">
        <div className="panel-head">
          <h2 id="your-profiles">Your profiles ({me.profiles.length} of {MAX_PROFILES})</h2>
          <button
            type="button"
            className="secondary"
            aria-label="New profile"
            aria-disabled={atLimit ? "true" : undefined}
            aria-describedby={atLimit ? ids.limit : undefined}
            onClick={() => { if (!atLimit) props.onNewProfile(); }}
          >
            <span aria-hidden="true">+ </span>New profile
          </button>
        </div>
        {atLimit && <p id={ids.limit} className="hint-text">You've reached the limit of 10 profiles. Delete one to add another.</p>}
        <ul className="profile-list">
          {me.profiles.map((p) => {
            const isActive = p.id === me.activeProfileId;
            return (
              <li key={p.id} className="profile-row">
                <span className="profile-name"><bdi>{p.name}</bdi>{isActive && <span className="badge"><span aria-hidden="true">✓ </span>Active</span>}</span>
                <span className="row-actions">
                  {!isActive && <button type="button" className="secondary" aria-label={`Switch to ${p.name}`} onClick={() => props.onSwitch(p.id)}>Switch</button>}
                  <button type="button" className="secondary" aria-label={`Rename ${p.name}`} onClick={() => props.onRename(p.id)}>Rename</button>
                  <button
                    type="button"
                    className="secondary"
                    aria-label={`Delete ${p.name}`}
                    aria-disabled={onlyOne ? "true" : undefined}
                    aria-describedby={onlyOne ? ids.last : undefined}
                    onClick={() => { if (!onlyOne) props.onDelete(p.id); }}
                  >
                    Delete
                  </button>
                </span>
                {onlyOne && <p id={ids.last} className="hint-text">You need at least one profile, so this one can't be deleted.</p>}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
