import { format } from "@calc/engine";
import { useCallback, useEffect, useReducer, useRef, useState, type KeyboardEvent } from "react";
import { COPY, initialEditor, reduce, toExpression, type Editor, type EditorAction } from "./editor/editor";
import { KEY_BY_KEYBOARD, KEYS, type KeyDef } from "./editor/keys";

function resultSize(text: string): string {
  return text.length <= 12 ? "size-l" : text.length <= 16 ? "size-m" : "size-s";
}

function Display({ editor }: { editor: Editor }) {
  const { state, notice, ans } = editor;
  const expr = state.mode === "empty" ? "" : toExpression(state.tokens) + (state.mode === "result" || state.mode === "error" ? " =" : "");
  const final = state.mode === "result" || state.mode === "error";
  let result: React.ReactNode = null;
  if (notice) {
    result = <span className="hint"><span aria-hidden="true">ⓘ </span>{notice === "ans_empty" ? COPY.ansEmpty : COPY.maxLength}</span>;
  } else if (state.mode === "empty") {
    result = <span className="placeholder size-l">0</span>;
  } else if (state.mode === "hint") {
    result = <span className="hint"><span aria-hidden="true">ⓘ </span>{COPY.incomplete}</span>;
  } else if (state.mode === "result") {
    const text = format(state.value);
    result = <span className={`value ${resultSize(text)}`}>{text}</span>;
  } else if (state.mode === "error") {
    result = <span className="error"><span aria-hidden="true">⚠ </span>Error: {state.error.message}</span>;
  }
  return (
    <>
      <div className="status-row" data-testid="ans-row">{ans !== null ? `Ans = ${format(ans)}` : ""}</div>
      <div className={`expression${final ? " final" : ""}`} data-testid="expression">{expr}</div>
      <div className="result" data-testid="result">{result}</div>
    </>
  );
}

export function Calculator() {
  // `n` counts actions so an identical announcement is still re-read (alternating invisible suffix).
  const [{ editor, n }, dispatch] = useReducer(
    (s: { editor: Editor; n: number }, a: EditorAction) => ({ editor: reduce(s.editor, a), n: s.n + 1 }),
    { editor: initialEditor, n: 0 },
  );
  const [pressed, setPressed] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState(false);
  const displayRef = useRef<HTMLDivElement>(null);

  useEffect(() => displayRef.current?.focus(), []);

  const empty = editor.state.mode === "empty";
  const press = useCallback((k: KeyDef) => dispatch(k.action), []);

  function onKeyDown(ev: KeyboardEvent<HTMLDivElement>) {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key === "Escape" && tooltip) { setTooltip(false); ev.preventDefault(); return; }
    const k = KEY_BY_KEYBOARD.get(ev.key);
    if (!k) return;
    ev.preventDefault(); // Enter always means "=" (D5), even on a focused key
    dispatch(k.action);
    setPressed(k.id);
    window.setTimeout(() => setPressed((p) => (p === k.id ? null : p)), 100);
  }

  return (
    <div className="card" onKeyDown={onKeyDown}>
      <div ref={displayRef} className="display" role="group" aria-label="Calculator display" tabIndex={0}>
        <Display editor={editor} />
      </div>
      <div className="keypad" role="group" aria-label="Keypad">
        {KEYS.map((k) => {
          const isClear = k.id === "clear";
          const label = isClear ? (empty ? "AC" : "C") : k.label;
          const name = isClear ? (empty ? "All clear" : "Clear") : k.name;
          const disabled = k.id === "ans" && editor.ans === null;
          return (
            <button
              key={k.id}
              type="button"
              className={`key key-${k.kind}${k.wide ? " wide" : ""}${pressed === k.id ? " pressed" : ""}`}
              aria-label={name}
              aria-disabled={disabled ? "true" : undefined}
              data-key={k.id}
              onClick={() => press(k)}
              {...(k.id === "backspace" && {
                onMouseEnter: () => setTooltip(true),
                onMouseLeave: () => setTooltip(false),
                onFocus: () => setTooltip(true),
                onBlur: () => setTooltip(false),
              })}
            >
              {k.id === "backspace" ? (
                <>
                  <span aria-hidden="true">{label}</span>
                  {tooltip && <span className="tooltip" role="tooltip" aria-hidden="true">Backspace</span>}
                </>
              ) : label}
            </button>
          );
        })}
      </div>
      <details className="shortcuts">
        <summary>Keyboard shortcuts</summary>
        <ul>
          <li><kbd>0</kbd>–<kbd>9</kbd> digits · <kbd>.</kbd> or <kbd>,</kbd> decimal point</li>
          <li><kbd>+</kbd> <kbd>-</kbd> <kbd>*</kbd> or <kbd>x</kbd> <kbd>/</kbd> <kbd>%</kbd> <kbd>(</kbd> <kbd>)</kbd> operators</li>
          <li><kbd>Enter</kbd> or <kbd>=</kbd> equals</li>
          <li><kbd>Esc</kbd> / <kbd>Delete</kbd> Clear · <kbd>Backspace</kbd> Delete last · <kbd>A</kbd> Ans</li>
        </ul>
      </details>
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true" data-testid="announcer">
        {editor.announcement ? editor.announcement + (n % 2 ? "\u00a0" : "") : ""}
      </div>
    </div>
  );
}
