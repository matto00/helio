import {
  buildCreateActions,
  buildNavigationActions,
  buildOpenAssistantAction,
  buildShortcutsHelpAction,
  buildThemeAction,
} from "./builtInActions";
import { isNavSection, sections } from "../../../shared/chrome/sections";
import type { CreateActionResult } from "../../dashboards/hooks/useCreateDashboardAction";

describe("buildNavigationActions", () => {
  it("returns one action per nav-visible section using its own label", () => {
    const navigate = jest.fn();
    const actions = buildNavigationActions(navigate);
    const navSections = sections.filter(isNavSection);

    expect(actions).toHaveLength(navSections.length);
    for (const section of navSections) {
      const action = actions.find((a) => a.title === `Go to ${section.label}`);
      expect(action).toBeDefined();
    }
  });

  it("navigates client-side (no reload) when run", () => {
    const navigate = jest.fn();
    const actions = buildNavigationActions(navigate);
    const dashboardsAction = actions.find((a) => a.title.includes("Dashboards"))!;

    dashboardsAction.run();

    expect(navigate).toHaveBeenCalledWith("/");
  });
});

describe("buildThemeAction", () => {
  it("labels itself for the theme it will switch TO", () => {
    const toggle = jest.fn();
    expect(buildThemeAction("light", toggle).title).toBe("Switch to dark theme");
    expect(buildThemeAction("dark", toggle).title).toBe("Switch to light theme");
  });

  it("calls toggleTheme when run", () => {
    const toggle = jest.fn();
    buildThemeAction("light", toggle).run();
    expect(toggle).toHaveBeenCalled();
  });

  it("is findable by an alternative term", () => {
    const action = buildThemeAction("light", jest.fn());
    expect(action.keywords).toEqual(expect.arrayContaining(["dark"]));
  });
});

describe("buildOpenAssistantAction", () => {
  it("opens the quick-launcher when run", () => {
    const openQuickLauncher = jest.fn();
    buildOpenAssistantAction(openQuickLauncher).run();
    expect(openQuickLauncher).toHaveBeenCalled();
  });

  it("is findable by chat/assistant keywords", () => {
    const action = buildOpenAssistantAction(jest.fn());
    expect(action.keywords).toEqual(expect.arrayContaining(["assistant", "chat"]));
  });

  // HEL-516 task 4.3/CR8 — LITERAL expected tokens, not
  // `formatCombo(shortcuts.find(...).combo)`: deriving both sides of the assertion from the
  // same source can never fail. Editing the `quick-launcher` declaration in shortcuts.ts must
  // turn this red.
  it("carries the quick-launcher's declared combo (Ctrl/Cmd+J), not a re-typed literal", () => {
    const action = buildOpenAssistantAction(jest.fn());
    expect(action.shortcut).toEqual({ key: "j", mod: true });
  });
});

describe("buildShortcutsHelpAction", () => {
  it("exists with the expected title", () => {
    const action = buildShortcutsHelpAction(jest.fn());
    expect(action.title).toBe("Keyboard shortcuts");
  });

  it("opens the help overlay when run", () => {
    const openHelpOverlay = jest.fn();
    buildShortcutsHelpAction(openHelpOverlay).run();
    expect(openHelpOverlay).toHaveBeenCalled();
  });

  it("is findable by shortcuts/keyboard keywords", () => {
    const action = buildShortcutsHelpAction(jest.fn());
    expect(action.keywords).toEqual(expect.arrayContaining(["shortcuts", "keyboard"]));
  });
});

function makeResult(onClick: () => void, disabled = false): CreateActionResult {
  return {
    cta: { label: "label", icon: null, disabled, onClick },
    error: null,
    isPending: false,
  };
}

describe("buildCreateActions", () => {
  it("writes no creation logic — each action's run is exactly the seam's own cta.onClick", () => {
    const dashboardClick = jest.fn();
    const sourceClick = jest.fn();
    const pipelineClick = jest.fn();
    const panelClick = jest.fn();
    const actions = buildCreateActions(
      makeResult(dashboardClick),
      makeResult(sourceClick),
      makeResult(pipelineClick),
      makeResult(panelClick),
    );

    actions.find((a) => a.id === "create.dashboard")!.run();
    actions.find((a) => a.id === "create.source")!.run();
    actions.find((a) => a.id === "create.pipeline")!.run();
    actions.find((a) => a.id === "create.panel")!.run();

    expect(dashboardClick).toHaveBeenCalledTimes(1);
    expect(sourceClick).toHaveBeenCalledTimes(1);
    expect(pipelineClick).toHaveBeenCalledTimes(1);
    expect(panelClick).toHaveBeenCalledTimes(1);
  });

  it("all four share the Create section", () => {
    const actions = buildCreateActions(
      makeResult(jest.fn()),
      makeResult(jest.fn()),
      makeResult(jest.fn()),
      makeResult(jest.fn()),
    );
    expect(actions.every((a) => a.section === "Create")).toBe(true);
  });

  it("omits the panel action entirely — not merely disabled — when the seam reports disabled, so running the missing action can create nothing (task 2.3, no second source of truth for the availability rule)", () => {
    const panelClick = jest.fn();
    const actions = buildCreateActions(
      makeResult(jest.fn()),
      makeResult(jest.fn()),
      makeResult(jest.fn()),
      makeResult(panelClick, true),
    );

    expect(actions.find((a) => a.id === "create.panel")).toBeUndefined();
    expect(panelClick).not.toHaveBeenCalled();
  });

  it("includes the panel action when the seam reports it enabled", () => {
    const actions = buildCreateActions(
      makeResult(jest.fn()),
      makeResult(jest.fn()),
      makeResult(jest.fn()),
      makeResult(jest.fn(), false),
    );
    expect(actions.find((a) => a.id === "create.panel")).toBeDefined();
  });
});
