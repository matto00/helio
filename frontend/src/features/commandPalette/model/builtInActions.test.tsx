import {
  buildNavigationActions,
  buildOpenAssistantAction,
  buildThemeAction,
} from "./builtInActions";
import { isNavSection, sections } from "../../../shared/chrome/sections";

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
});
