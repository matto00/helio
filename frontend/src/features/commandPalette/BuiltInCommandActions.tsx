import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { useTheme } from "../../theme/ThemeProvider";
import { useCommandActions } from "./hooks";
import {
  buildNavigationActions,
  buildOpenAssistantAction,
  buildThemeAction,
} from "./model/builtInActions";

interface BuiltInCommandActionsProps {
  onOpenQuickLauncher: () => void;
}

/** Registers the palette's seeded, always-available actions — navigation (derived from
 * `sections.ts`), theme toggle, and "Open assistant" (`command-palette-navigation-actions` spec).
 * Rendered unconditionally inside `AppShell` so these actions exist before any other feature
 * contributes to the registry. */
export function BuiltInCommandActions({ onOpenQuickLauncher }: BuiltInCommandActionsProps) {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  const actions = useMemo(
    () => [
      ...buildNavigationActions(navigate),
      buildThemeAction(theme, toggleTheme),
      buildOpenAssistantAction(onOpenQuickLauncher),
    ],
    [navigate, theme, toggleTheme, onOpenQuickLauncher],
  );

  useCommandActions(actions);

  return null;
}
