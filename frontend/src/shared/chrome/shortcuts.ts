/**
 * HEL-496 — the single enumerable declaration of every application-global keyboard binding.
 * `keyboard-shortcut-declarations` spec: no global binding may exist that isn't listed here, and
 * every global handler resolves its combination from this table rather than testing key
 * properties inline. HEL-510 (shortcut help overlay) enumerates the app's bindings straight off
 * this array — do not add a binding anywhere else.
 *
 * Planning escalation `palette-takes-k-launcher-moves` (2026-08-28): the command palette owns
 * Cmd/Ctrl+K; the assistant quick-launcher, which previously held it, moved to Cmd/Ctrl+J.
 */
export interface ShortcutCombo {
  /** Case-insensitive `KeyboardEvent.key` this binding fires on. */
  key: string;
  /** Whether the platform modifier (Cmd on macOS, Ctrl elsewhere) must be held. */
  meta?: boolean;
}

export interface ShortcutDeclaration {
  id: string;
  label: string;
  combo: ShortcutCombo;
}

export const shortcuts: ShortcutDeclaration[] = [
  {
    id: "command-palette",
    label: "Open command palette",
    combo: { key: "k", meta: true },
  },
  {
    id: "quick-launcher",
    label: "Open assistant",
    combo: { key: "j", meta: true },
  },
];

/** Resolves whether a `KeyboardEvent` matches a declared combo. `meta` matches either `metaKey`
 * (macOS Cmd) or `ctrlKey` (other platforms) being held, mirroring every existing global handler
 * in this codebase. */
export function matchesCombo(event: KeyboardEvent, combo: ShortcutCombo): boolean {
  const modifierHeld = event.metaKey || event.ctrlKey;
  if (combo.meta && !modifierHeld) return false;
  if (!combo.meta && modifierHeld) return false;
  return event.key.toLowerCase() === combo.key.toLowerCase();
}

const TEXT_ENTRY_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** Shared guard: is `target` a text-entry context (input/textarea/select/contenteditable)? Every
 * global binding applies this instead of re-implementing its own, so the suppression rule can't
 * drift between bindings (`keyboard-shortcut-declarations` spec). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (TEXT_ENTRY_TAGS.has(target.tagName)) return true;
  // `isContentEditable` isn't implemented by jsdom (undefined there even when the attribute is
  // set), so check the attribute directly rather than relying on it alone.
  if (target.isContentEditable) return true;
  const attr = target.getAttribute("contenteditable");
  return attr === "" || attr === "true";
}
