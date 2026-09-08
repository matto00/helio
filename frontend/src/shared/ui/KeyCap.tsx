import "./KeyCap.css";

interface KeyCapProps {
  /** A single key-cap token (e.g. "⌘", "Shift", "Z") — pass one `KeyCap` per token from
   * `formatCombo`, not a whole combo string. */
  children: string;
}

/**
 * HEL-510 design.md Decision 5 — a NEW shared primitive for rendering one keyboard key/modifier
 * token, semantic `<kbd>`. NOT an overlay-local class, NOT a `StatusChip` variant: a key cap
 * communicates a literal key, not resource state. `grep -rn "kbd\|keycap\|key-cap"` over
 * `frontend/src` returned zero hits before this change — this is the first key-cap rendering in
 * the app, so it lives in `shared/ui` for HEL-516/519/503 to reuse rather than reinventing it.
 */
export function KeyCap({ children }: KeyCapProps) {
  return <kbd className="ui-keycap">{children}</kbd>;
}
