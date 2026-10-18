import { MAX_PROFILES, type MeResponse } from "@calc/contracts";
import { useId } from "react";
import { MenuButton, type MenuItem } from "./Menu";

/** Header right slot when signed in: profile switcher (R2-4 §2.1) and account menu (R2-3 §2.4). */
export function SignedInHeader(props: {
  me: MeResponse;
  onSwitch: (id: string) => void;
  onNewProfile: () => void;
  onSettings: () => void;
  onLogout: () => void;
}) {
  const { me } = props;
  const active = me.profiles.find((p) => p.id === me.activeProfileId)!;
  const atLimit = me.profiles.length >= MAX_PROFILES;
  const limitId = useId();
  const profileItems: MenuItem[] = [
    { kind: "label", text: "Profiles" },
    ...me.profiles.map((p): MenuItem => ({
      kind: "item",
      radio: true,
      checked: p.id === me.activeProfileId,
      label: <><span className="check" aria-hidden="true">{p.id === me.activeProfileId ? "✓" : ""}</span><bdi>{p.name}</bdi></>,
      name: p.name,
      onSelect: () => { if (p.id !== me.activeProfileId) props.onSwitch(p.id); },
    })),
    { kind: "separator" },
    {
      kind: "item",
      label: <><span aria-hidden="true">+ </span>New profile…{atLimit && <span id={limitId} className="menu-reason">Limit of 10 reached</span>}</>,
      name: "New profile…",
      disabled: atLimit,
      ...(atLimit ? { describedBy: limitId } : {}),
      onSelect: props.onNewProfile,
    },
    { kind: "item", label: <><span aria-hidden="true">⚙ </span>Profile settings</>, onSelect: props.onSettings },
  ];
  return (
    <>
      <MenuButton
        className="switcher"
        name={`${active.name}, switch profile`}
        label={<><span aria-hidden="true">◉ </span><bdi className="switcher-name">{active.name}</bdi><span aria-hidden="true"> ▾</span></>}
        items={profileItems}
      />
      <MenuButton
        className="account"
        name="Account"
        label={<><span aria-hidden="true">👤 </span><span className="account-text">Account</span><span aria-hidden="true"> ▾</span></>}
        items={[
          { kind: "text", text: me.account.email },
          { kind: "separator" },
          { kind: "item", label: "Log out", onSelect: props.onLogout },
        ]}
      />
    </>
  );
}
