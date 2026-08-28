import { createElement } from "react";
import { MessageCircle, SunMoon } from "lucide-react";
import type { NavigateFunction } from "react-router-dom";

import { isNavSection, sections } from "../../../shared/chrome/sections";
import type { Theme } from "../../../theme/theme";
import type { CommandAction } from "./types";

const NAVIGATION_SECTION = "Navigation";
const GENERAL_SECTION = "General";

/**
 * The palette's seeded, always-available actions (`command-palette-navigation-actions` spec):
 * one navigation action per nav-visible entry in `sections.ts` (the single route→label/icon
 * registry — never a second hardcoded map), a theme toggle, and an "Open assistant" action that
 * keeps the quick-launcher reachable now that it no longer owns Cmd/Ctrl+K.
 */
export function buildNavigationActions(navigate: NavigateFunction): CommandAction[] {
  return sections.filter(isNavSection).map((section) => ({
    id: `nav.${section.pickerId}.${section.path}`,
    title: `Go to ${section.label}`,
    section: NAVIGATION_SECTION,
    keywords: [section.label],
    icon: createElement(section.icon),
    run: () => navigate(section.path),
  }));
}

export function buildThemeAction(theme: Theme, toggleTheme: () => void): CommandAction {
  const nextTheme: Theme = theme === "dark" ? "light" : "dark";
  return {
    id: "theme.toggle",
    title: `Switch to ${nextTheme} theme`,
    section: GENERAL_SECTION,
    keywords: ["theme", "dark", "light", "appearance"],
    icon: createElement(SunMoon),
    run: toggleTheme,
  };
}

export function buildOpenAssistantAction(openQuickLauncher: () => void): CommandAction {
  return {
    id: "assistant.open",
    title: "Open assistant",
    section: GENERAL_SECTION,
    keywords: ["assistant", "chat"],
    icon: createElement(MessageCircle),
    run: openQuickLauncher,
  };
}
