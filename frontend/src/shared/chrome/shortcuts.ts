/**
 * HEL-496 — the single enumerable declaration of every application-global keyboard binding.
 * `keyboard-shortcut-declarations` spec: no global binding may exist that isn't listed here, and
 * every global handler resolves its combination from this table rather than testing key
 * properties inline. HEL-510 (shortcut help overlay) enumerates the app's bindings straight off
 * this array — do not add a binding anywhere else.
 *
 * Planning escalation `palette-takes-k-launcher-moves` (2026-08-28): the command palette owns
 * Cmd/Ctrl+K; the assistant quick-launcher, which previously held it, moved to Cmd/Ctrl+J.
 *
 * HEL-510 design.md Decision 2 — `shift` is TRI-STATE, not boolean: `true` = must be held,
 * `false` = must not be held, **omitted = don't-care**. For a printable-symbol key whose `key`
 * value already encodes Shift (`?`, `+`, `:`), omit `shift` so layout independence is preserved.
 * State it only when two bindings share a `key` and must be told apart (undo/redo below).
 */
export interface ShortcutCombo {
  /** Case-insensitive `KeyboardEvent.key` this binding fires on. */
  key: string;
  /** Whether the platform modifier (Cmd on macOS, Ctrl elsewhere) must be held. Exactly matched:
   * an event holding the platform modifier never matches a combo that omits `mod`. */
  mod?: boolean;
  /** Tri-state — see the module doc comment above. */
  shift?: boolean;
}

export interface ShortcutDeclaration {
  id: string;
  label: string;
  /** Shown in the help overlay as the row's explanatory text. */
  description: string;
  /** Groups rows in the help overlay (e.g. "General", "Layout"). */
  group: string;
  combo: ShortcutCombo;
}

export const shortcuts: ShortcutDeclaration[] = [
  {
    id: "command-palette",
    label: "Open command palette",
    description: "Search and run any action.",
    group: "General",
    combo: { key: "k", mod: true },
  },
  {
    id: "quick-launcher",
    label: "Open assistant",
    description: "Open the assistant quick-launcher.",
    group: "General",
    combo: { key: "j", mod: true },
  },
  {
    id: "help-overlay",
    label: "Show keyboard shortcuts",
    description: "Show this list of keyboard shortcuts.",
    group: "General",
    // Decision 2 — `shift` deliberately OMITTED: `?` already encodes Shift in `event.key` on a US
    // layout, and on layouts where `?` needs no Shift, declaring `shift: true` would reject it.
    combo: { key: "?" },
  },
  {
    id: "layout-undo",
    label: "Undo layout change",
    description: "Undo the last dashboard layout change.",
    group: "Layout",
    // Decision 2 — `shift: false` is LOAD-BEARING: omitting it makes this don't-care and lets
    // mod+shift+z (redo) also match undo.
    combo: { key: "z", mod: true, shift: false },
  },
  {
    id: "layout-redo",
    label: "Redo layout change",
    description: "Redo the last undone dashboard layout change.",
    group: "Layout",
    combo: { key: "z", mod: true, shift: true },
  },
];

/** Resolves whether a `KeyboardEvent` matches a declared combo. `mod` matches either `metaKey`
 * (macOS Cmd) or `ctrlKey` (other platforms) being held, mirroring every existing global handler
 * in this codebase, and is exactly matched in both directions. `shift` is tri-state (see the
 * module doc comment): stated true/false is enforced exactly; omitted is don't-care. */
export function matchesCombo(event: KeyboardEvent, combo: ShortcutCombo): boolean {
  const modifierHeld = event.metaKey || event.ctrlKey;
  if (combo.mod && !modifierHeld) return false;
  if (!combo.mod && modifierHeld) return false;
  if (combo.shift === true && !event.shiftKey) return false;
  if (combo.shift === false && event.shiftKey) return false;
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

/**
 * HEL-510 design.md Decision 4 — is any modal surface currently open? Keys off the
 * accessibility contract every modal surface must satisfy, which is more durable than "is it a
 * `<dialog>`": `shared/ui/Modal.tsx` renders a native `<dialog>` (caught by `dialog[open]`), but
 * `shared/chrome/MobileNavSheet.tsx` and `features/dashboards/ui/RefinementChatDrawer.tsx` are
 * portalled `<div>`s (not native dialogs) that instead set `aria-modal="true"`. A future
 * portalled modal surface that forgets `aria-modal` is an a11y bug in its own right, independent
 * of this guard. Note (design.md Risks): `dialog[open]` would also match a non-modal `<dialog>`
 * shown via `show()` rather than `showModal()` — none exist in the tree today.
 */
export function isOverlayOpen(): boolean {
  return document.querySelector('dialog[open], [aria-modal="true"]') !== null;
}

/** Centralized, single-read platform detection (design.md Decision 7). */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = navigator.platform || "";
  return /Mac|iPhone|iPad|iPod/.test(platform);
}

/** Pure formatter: `combo` -> discrete key-cap tokens (design.md Decision 7), so both platforms
 * are unit-testable without stubbing `navigator` — the platform read happens once at the
 * component boundary and is passed in as `mac`. */
export function formatCombo(combo: ShortcutCombo, { mac }: { mac: boolean }): string[] {
  const tokens: string[] = [];
  if (combo.mod) tokens.push(mac ? "⌘" : "Ctrl");
  if (combo.shift === true) tokens.push(mac ? "⇧" : "Shift");
  tokens.push(
    combo.key === " " ? "Space" : combo.key.length === 1 ? combo.key.toUpperCase() : combo.key,
  );
  return tokens;
}
