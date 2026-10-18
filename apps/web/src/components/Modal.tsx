import { useEffect, useId, useRef, type ReactNode } from "react";

const FOCUSABLE = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

/** Modal dialog (R2-4 §3.3): labelled by its h2, Tab trapped, Esc closes, focus returns on close. */
export function Modal(props: {
  title: string;
  role?: "dialog" | "alertdialog";
  description?: ReactNode;
  onClose: () => void;
  initialFocus?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const { onClose, initialFocus } = props;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = initialFocus ? ref.current?.querySelector<HTMLElement>(initialFocus) : ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => opener?.focus?.();
  }, [initialFocus]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
    if (e.key !== "Tab") return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (items.length === 0) return;
    const first = items[0]!, last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  return (
    <div className="overlay">
      <div
        ref={ref}
        className="dialog"
        role={props.role ?? "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={props.description ? descId : undefined}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId}>{props.title}</h2>
        {props.description && <div id={descId}>{props.description}</div>}
        {props.children}
      </div>
    </div>
  );
}
