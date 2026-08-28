import { useEffect } from "react";

import { isTypingTarget, matchesCombo, shortcuts } from "../../shared/chrome/shortcuts";
import { useCommandPalette } from "./hooks";

const paletteShortcut = shortcuts.find((s) => s.id === "command-palette")!;
const quickLauncherShortcut = shortcuts.find((s) => s.id === "quick-launcher")!;

interface GlobalCommandShortcutsProps {
  onOpenQuickLauncher: () => void;
}

/** Wires the two shell-global keyboard bindings declared in `shortcuts.ts`: Cmd/Ctrl+K opens the
 * command palette, Cmd/Ctrl+J opens the assistant quick-launcher (`keyboard-shortcut-declarations`
 * spec — palette owns K, quick-launcher moved to J per the `palette-takes-k-launcher-moves`
 * resolution). Mounted once inside `AppShell`, so it is authenticated-route-only. */
export function GlobalCommandShortcuts({ onOpenQuickLauncher }: GlobalCommandShortcutsProps) {
  const { open: openPalette } = useCommandPalette();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // `command-palette-shell` spec: the typing-target suppression doesn't apply while focus is
      // inside the palette's own input, so the shortcut still behaves once the palette is open.
      const target = event.target;
      const isInsidePalette =
        target instanceof HTMLElement && target.closest(".command-palette") !== null;
      if (isTypingTarget(target) && !isInsidePalette) return;

      if (matchesCombo(event, paletteShortcut.combo)) {
        event.preventDefault();
        openPalette();
      } else if (matchesCombo(event, quickLauncherShortcut.combo)) {
        event.preventDefault();
        onOpenQuickLauncher();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openPalette, onOpenQuickLauncher]);

  return null;
}
