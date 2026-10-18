import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export type MenuItem =
  | { kind: "item"; label: ReactNode; name?: string; onSelect: () => void; disabled?: boolean; describedBy?: string; checked?: boolean; radio?: boolean }
  | { kind: "text"; text: string }
  | { kind: "separator" }
  | { kind: "label"; text: string };

/** APG menu button: Enter/Space/↓ opens on the first item, ↑/↓ move, Esc closes and returns focus, Tab closes. */
export function MenuButton(props: { label: ReactNode; name: string; items: MenuItem[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  const focusables = () => [...(menu.current?.querySelectorAll<HTMLElement>("[role^='menuitem']") ?? [])];
  useEffect(() => { if (open) focusables()[0]?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const close = (refocus = true) => { setOpen(false); if (refocus) button.current?.focus(); };

  function onMenuKey(e: React.KeyboardEvent) {
    const items = focusables();
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); items[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); items[items.length - 1]?.focus(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "Tab") setOpen(false);
  }

  return (
    <div className="menu-wrap">
      <button
        ref={button}
        type="button"
        className={`menu-button ${props.className ?? ""}`}
        aria-label={props.name}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); } }}
      >
        {props.label}
      </button>
      {open && (
        <div ref={menu} id={id} role="menu" aria-label={props.name} className="menu" onKeyDown={onMenuKey}>
          {props.items.map((it, k) => {
            if (it.kind === "separator") return <div key={k} role="separator" className="menu-sep" />;
            if (it.kind === "text" || it.kind === "label") return <div key={k} role="none" className={`menu-${it.kind}`}>{it.text}</div>;
            const select = () => {
              if (it.disabled) return;
              close(false);
              it.onSelect();
            };
            return (
              <div
                key={k}
                role={it.radio ? "menuitemradio" : "menuitem"}
                tabIndex={-1}
                className="menu-item"
                aria-checked={it.radio ? !!it.checked : undefined}
                aria-disabled={it.disabled ? "true" : undefined}
                aria-describedby={it.describedBy}
                aria-label={it.name}
                onClick={select}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); } }}
              >
                {it.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
