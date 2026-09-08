import { createElement } from "react";
import type { ReactNode } from "react";
import { Keyboard, MessageCircle, SunMoon } from "lucide-react";
import type { NavigateFunction } from "react-router-dom";

import { isNavSection, sections } from "../../../shared/chrome/sections";
import { shortcuts } from "../../../shared/chrome/shortcuts";
import type { Theme } from "../../../theme/theme";
import type { CreateActionResult } from "../../dashboards/hooks/useCreateDashboardAction";
import type { CommandAction } from "./types";

const NAVIGATION_SECTION = "Navigation";
const GENERAL_SECTION = "General";
const CREATE_SECTION = "Create";

/** skeptic-final-1.md CR1 — the palette's top-level section order is DATA, declared once here,
 * rather than an emergent property of whichever registrant's mount effect happened to commit
 * last (`CommandPalette.tsx`'s `groupBySection` sorts by this array — see there for the
 * unlisted-section fallback). Defaults to plain registration order
 * (Navigation, General, Create) once every registrant's own registration is itself stable
 * (skeptic-final-1.md's HelpOverlay context-value fix); changing the palette's section order is
 * a one-line edit to this array, not a mount-order archaeology exercise. The owner has final say
 * on the actual order (escalated separately) — this is the mechanism, not the ruling. */
export const SECTION_DISPLAY_ORDER: readonly string[] = [
  NAVIGATION_SECTION,
  GENERAL_SECTION,
  CREATE_SECTION,
];

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
  // HEL-516 design.md Decision 5/task 4.3 — read BY ID from the single declaration table
  // (`shortcuts.ts`) rather than re-typing `{ key: "j", mod: true }` as a literal here, so the
  // cap shown in the palette can never drift from the binding that actually fires.
  const combo = shortcuts.find((s) => s.id === "quick-launcher")?.combo;
  return {
    id: "assistant.open",
    title: "Open assistant",
    section: GENERAL_SECTION,
    keywords: ["assistant", "chat"],
    icon: createElement(MessageCircle),
    shortcut: combo,
    run: openQuickLauncher,
  };
}

/** HEL-510 — makes the help overlay discoverable from the palette itself, not just the `?`
 * binding (`shortcuts.ts`'s `help-overlay` entry). */
export function buildShortcutsHelpAction(openHelpOverlay: () => void): CommandAction {
  return {
    id: "help.shortcuts",
    title: "Keyboard shortcuts",
    section: GENERAL_SECTION,
    keywords: ["shortcuts", "keyboard", "help", "hotkeys"],
    icon: createElement(Keyboard),
    run: openHelpOverlay,
  };
}

/** HEL-516 design.md Decision 4 — builds the palette's "Create" section straight off the four
 * HEL-548 seams' own `CreateActionResult`, writing no creation logic of its own: `label`/`icon`
 * come from `cta` unchanged, and `run` is exactly `cta.onClick`. The panel action is OMITTED
 * entirely (not rendered `disabled`, since `CommandAction` has no such field) whenever the seam
 * itself reports `cta.disabled` (no dashboard selected) — task 2.3: the availability rule lives
 * once, in the seam, and is read here rather than restated. */
export function buildCreateActions(
  dashboard: Pick<CreateActionResult, "cta">,
  source: Pick<CreateActionResult, "cta">,
  pipeline: Pick<CreateActionResult, "cta">,
  panel: Pick<CreateActionResult, "cta">,
): CommandAction[] {
  const actions: CommandAction[] = [
    {
      id: "create.dashboard",
      title: dashboard.cta.label,
      section: CREATE_SECTION,
      keywords: ["new", "create", "dashboard"],
      icon: dashboard.cta.icon as ReactNode,
      run: dashboard.cta.onClick,
    },
    {
      id: "create.source",
      title: source.cta.label,
      section: CREATE_SECTION,
      keywords: ["new", "create", "source", "data source"],
      icon: source.cta.icon as ReactNode,
      run: source.cta.onClick,
    },
    {
      id: "create.pipeline",
      title: pipeline.cta.label,
      section: CREATE_SECTION,
      keywords: ["new", "create", "pipeline"],
      icon: pipeline.cta.icon as ReactNode,
      run: pipeline.cta.onClick,
    },
  ];
  if (!panel.cta.disabled) {
    actions.push({
      id: "create.panel",
      title: panel.cta.label,
      section: CREATE_SECTION,
      keywords: ["new", "create", "panel"],
      icon: panel.cta.icon as ReactNode,
      run: panel.cta.onClick,
    });
  }
  return actions;
}
