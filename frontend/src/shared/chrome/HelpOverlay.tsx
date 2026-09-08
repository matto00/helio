import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import "./HelpOverlay.css";
import { Modal } from "../ui/Modal";
import { KeyCap } from "../ui/KeyCap";
import { useOverlay } from "./OverlayProvider";
import { formatCombo, isMacPlatform, shortcuts } from "./shortcuts";
import { useShortcut } from "./useShortcut";

interface HelpOverlayContextValue {
  open: () => void;
}

const HelpOverlayContext = createContext<HelpOverlayContextValue | null>(null);

/** Exposes an imperative `open()` for the help overlay to callers outside `HelpOverlayHost`
 * (the palette's "Keyboard shortcuts" action, `builtInActions.ts`). Mirrors
 * `CommandPaletteProvider`'s open/close split — the overlay's own single-active-overlay
 * coordination (design.md Decision 4a) still goes through `useOverlay()` inside the host below. */
export function useHelpOverlay(): HelpOverlayContextValue {
  const ctx = useContext(HelpOverlayContext);
  if (!ctx) {
    throw new Error("useHelpOverlay must be used within a HelpOverlayHost");
  }
  return ctx;
}

interface HelpOverlayProps {
  open: boolean;
  onClose: () => void;
}

/**
 * HEL-510 — the keyboard-shortcut help overlay. Rows are derived from `shortcuts.ts` alone
 * (design.md Decision 1): the declaration is simultaneously the display source and the dispatch
 * source, so adding a declaration entry changes this render with no component edit needed. Built
 * on the shared `Modal` primitive (focus trap/restore/Escape inherited, not reimplemented).
 */
export function HelpOverlay({ open, onClose }: HelpOverlayProps) {
  const mac = isMacPlatform();

  const groups = new Map<string, typeof shortcuts>();
  for (const declaration of shortcuts) {
    const group = groups.get(declaration.group) ?? [];
    group.push(declaration);
    groups.set(declaration.group, group);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      size="sm"
      ariaLabel="Keyboard shortcuts"
      className="help-overlay"
    >
      <div className="help-overlay__list">
        {Array.from(groups.entries()).map(([group, declarations]) => (
          <div className="help-overlay__group" key={group}>
            <div className="eyebrow help-overlay__group-label">{group}</div>
            <ul className="help-overlay__rows">
              {declarations.map((declaration) => (
                <li className="help-overlay__row" key={declaration.id}>
                  <span className="help-overlay__row-label">{declaration.description}</span>
                  <span className="help-overlay__row-combo">
                    {formatCombo(declaration.combo, { mac }).map((token, index) => (
                      <KeyCap key={index}>{token}</KeyCap>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Modal>
  );
}

interface HelpOverlayHostProps {
  children: ReactNode;
}

/**
 * HEL-510 tasks.md 4.1a/4.3 — owns the overlay's open state and wires `?` to open it, mounted
 * once inside `AppShell` (authenticated-route-only), wrapping the rest of the shell so
 * `useHelpOverlay()` is reachable from `BuiltInCommandActions`. Registers with `useOverlay()`
 * (design.md Decision 4a), exactly as its sibling `CommandPalette` does, so it participates in
 * the app's single-active-overlay/Escape coordination — separate from, and not to be conflated
 * with, the `guardWhileOverlayOpen` guard below, which answers "is a modal open right now" rather
 * than "which overlay owns single-active semantics".
 */
export function HelpOverlayHost({ children }: HelpOverlayHostProps) {
  const overlay = useOverlay();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (isOpen) overlay.open();
    else overlay.close();
    // overlay.open/close are stable (useCallback).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && !overlay.isActive) setIsOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay.isActive]);

  useShortcut(
    "help-overlay",
    (event) => {
      event.preventDefault();
      setIsOpen(true);
    },
    { guardWhileOverlayOpen: true },
  );

  // HEL-516 skeptic-final-1.md CR1 — this was a fresh object literal every render (a real
  // defect shipped by HEL-510, found while investigating this ticket's palette section-order
  // artifact, not a HEL-516 authored bug): every consumer of `useHelpOverlay()` — currently only
  // `BuiltInCommandActions`, via `buildShortcutsHelpAction` — depends on this VALUE in its own
  // `useMemo`, so an unstable context value here churned `useCommandActions`'s register/dispose
  // cycle on every render, silently reordering the palette's registration (unrelated actions'
  // sections got pushed to the tail of `commandRegistry.ts`'s insertion-order `Map`). `setIsOpen`
  // is already a stable `useState` setter, so wrapping it is the entire fix — no new dependency.
  const contextValue = useMemo<HelpOverlayContextValue>(
    () => ({ open: () => setIsOpen(true) }),
    [],
  );

  return (
    <HelpOverlayContext.Provider value={contextValue}>
      {children}
      <HelpOverlay open={isOpen} onClose={() => setIsOpen(false)} />
    </HelpOverlayContext.Provider>
  );
}
