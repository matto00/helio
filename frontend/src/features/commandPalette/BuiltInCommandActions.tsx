import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { useTheme } from "../../theme/ThemeProvider";
import { useHelpOverlay } from "../../shared/chrome/HelpOverlay";
import { useCommandActions } from "./hooks";
import {
  buildNavigationActions,
  buildOpenAssistantAction,
  buildShortcutsHelpAction,
  buildThemeAction,
} from "./model/builtInActions";

interface BuiltInCommandActionsProps {
  onOpenQuickLauncher: () => void;
}

/** Registers the palette's seeded, always-available actions — navigation (derived from
 * `sections.ts`), theme toggle, "Open assistant", and "Keyboard shortcuts" (HEL-510)
 * (`command-palette-navigation-actions` spec). Rendered unconditionally inside `AppShell` so
 * these actions exist before any other feature contributes to the registry. Must be mounted
 * inside `HelpOverlayHost` for `useHelpOverlay()` to resolve. */
export function BuiltInCommandActions({ onOpenQuickLauncher }: BuiltInCommandActionsProps) {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { open: openHelpOverlay } = useHelpOverlay();

  const actions = useMemo(
    () => [
      ...buildNavigationActions(navigate),
      buildThemeAction(theme, toggleTheme),
      buildOpenAssistantAction(onOpenQuickLauncher),
      buildShortcutsHelpAction(openHelpOverlay),
    ],
    [navigate, theme, toggleTheme, onOpenQuickLauncher, openHelpOverlay],
  );

  useCommandActions(actions);

  return null;
}
