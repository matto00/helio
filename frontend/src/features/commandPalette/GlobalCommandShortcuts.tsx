import { useShortcut } from "../../shared/chrome/useShortcut";
import { useCommandPalette } from "./hooks";

interface GlobalCommandShortcutsProps {
  onOpenQuickLauncher: () => void;
}

// `command-palette-shell` spec: the typing-target suppression doesn't apply while focus is
// inside the palette's own input, so the shortcut still behaves once the palette is open.
function isInsidePalette(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest(".command-palette") !== null;
}

/** Wires the two shell-global keyboard bindings declared in `shortcuts.ts`: Cmd/Ctrl+K opens the
 * command palette, Cmd/Ctrl+J opens the assistant quick-launcher (`keyboard-shortcut-declarations`
 * spec — palette owns K, quick-launcher moved to J per the `palette-takes-k-launcher-moves`
 * resolution). Mounted once inside `AppShell`, so it is authenticated-route-only.
 *
 * HEL-510 design.md Decision 3/4 — a pure `useShortcut` consumer; it owns no `window` listener of
 * its own. Neither binding sets `guardWhileOverlayOpen`: the palette renders AS a `Modal`, so
 * guarding it would kill Cmd/Ctrl+K while the palette is open (design.md Decision 4 table), and
 * the quick-launcher preserves its existing unguarded behavior exactly. */
export function GlobalCommandShortcuts({ onOpenQuickLauncher }: GlobalCommandShortcutsProps) {
  const { open: openPalette } = useCommandPalette();

  useShortcut(
    "command-palette",
    (event) => {
      event.preventDefault();
      openPalette();
    },
    { allowWhileTyping: isInsidePalette },
  );

  useShortcut("quick-launcher", (event) => {
    event.preventDefault();
    onOpenQuickLauncher();
  });

  return null;
}
