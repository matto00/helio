import { act, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { dash, makeTabsStore, tab } from "../../../../test/tabsTestStore";
import { CommandPaletteProvider } from "../../../commandPalette/CommandPaletteProvider";
import { useCommandPalette } from "../../../commandPalette/hooks";
import { DashboardTabBar } from "./DashboardTabBar";
import { DASHBOARD_TABPANEL_ID, dashboardTabDomId } from "./tabDomIds";

jest.mock("../tabsPersistence", () => ({
  ...jest.requireActual("../tabsPersistence"),
  scheduleTabsWrite: jest.fn(),
  cancelTabsWrite: jest.fn(),
}));
jest.mock("../dashboardChangesService", () => ({
  fetchDashboardChanges: jest
    .fn()
    .mockResolvedValue({ serverNow: "2026-01-01T00:00:00Z", items: [] }),
}));
jest.mock("../../../panels/services/panelService", () => ({
  fetchPanels: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../services/dashboardService", () => ({ fetchDashboards: jest.fn() }));

function PaletteProbe() {
  const { isOpen, intent } = useCommandPalette();
  return <output data-testid="palette">{isOpen ? (intent ?? "default") : "closed"}</output>;
}

function setup(options: Parameters<typeof makeTabsStore>[0] = {}) {
  const harness = makeTabsStore({
    dashboards: [dash("a", "Alpha"), dash("b", "Beta"), dash("c", "Gamma")],
    tabs: [tab("a"), tab("b"), tab("c")],
    activeId: "a",
    selected: "a",
    ...options,
  });
  render(
    <Provider store={harness.store}>
      <MemoryRouter>
        <CommandPaletteProvider>
          <DashboardTabBar />
          <PaletteProbe />
        </CommandPaletteProvider>
      </MemoryRouter>
    </Provider>,
  );
  return harness;
}

const tabIds = (getState: () => { dashboardTabs: { tabs: { id: string }[] } }) =>
  getState().dashboardTabs.tabs.map((t) => t.id);

describe("DashboardTabBar", () => {
  it("renders an accessible tablist with one tab per dashboard and exactly one selected", () => {
    setup();
    const list = screen.getByRole("tablist", { name: "Open dashboards" });
    const tabs = within(list).getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-label"))).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(tabs.filter((t) => t.getAttribute("aria-selected") === "true")).toHaveLength(1);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("aria-controls", DASHBOARD_TABPANEL_ID);
    expect(tabs[0].id).toBe(dashboardTabDomId("a"));
  });

  it("uses a roving tab stop: only the active tab is tabbable", () => {
    setup();
    const [alpha, beta, gamma] = screen.getAllByRole("tab");
    expect(alpha).toHaveAttribute("tabindex", "0");
    expect(beta).toHaveAttribute("tabindex", "-1");
    expect(gamma).toHaveAttribute("tabindex", "-1");
  });

  it("returns the tab stop to the active tab once focus leaves the tablist", () => {
    setup();
    const [alpha, beta] = screen.getAllByRole("tab");
    act(() => beta.focus());
    expect(beta).toHaveAttribute("tabindex", "0");
    expect(alpha).toHaveAttribute("tabindex", "-1");
    act(() => beta.blur());
    expect(alpha).toHaveAttribute("tabindex", "0");
    expect(beta).toHaveAttribute("tabindex", "-1");
  });

  it("moves focus with Arrow keys (wrapping), Home and End without activating", () => {
    const { getState } = setup();
    const [alpha, beta, gamma] = screen.getAllByRole("tab");
    act(() => alpha.focus());
    fireEvent.keyDown(alpha, { key: "ArrowRight" });
    expect(beta).toHaveFocus();
    fireEvent.keyDown(beta, { key: "End" });
    expect(gamma).toHaveFocus();
    fireEvent.keyDown(gamma, { key: "ArrowRight" });
    expect(alpha).toHaveFocus();
    fireEvent.keyDown(alpha, { key: "ArrowLeft" });
    expect(gamma).toHaveFocus();
    fireEvent.keyDown(gamma, { key: "Home" });
    expect(alpha).toHaveFocus();
    expect(getState().dashboardTabs.activeId).toBe("a");
  });

  it("activates the focused tab on click (native Enter/Space press fires click)", () => {
    const { getState } = setup();
    fireEvent.click(screen.getByRole("tab", { name: "Beta" }));
    expect(getState().dashboardTabs.activeId).toBe("b");
    expect(getState().dashboards.selectedDashboardId).toBe("b");
  });

  it("closes the focused tab with Delete and focuses the neighbour", () => {
    const { getState } = setup({ activeId: "c", selected: "c" });
    const gamma = screen.getByRole("tab", { name: "Gamma" });
    act(() => gamma.focus());
    fireEvent.keyDown(gamma, { key: "Delete" });
    expect(tabIds(getState)).toEqual(["a", "b"]);
    expect(getState().dashboardTabs.activeId).toBe("b");
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveFocus();
  });

  it("closes with Backspace too", () => {
    const { getState } = setup();
    const beta = screen.getByRole("tab", { name: "Beta" });
    fireEvent.keyDown(beta, { key: "Backspace" });
    expect(tabIds(getState)).toEqual(["a", "c"]);
  });

  it("reorders with Alt+Shift+Arrow and keeps focus on the moved tab", () => {
    const { getState } = setup();
    const beta = screen.getByRole("tab", { name: "Beta" });
    act(() => beta.focus());
    fireEvent.keyDown(beta, { key: "ArrowLeft", altKey: true, shiftKey: true });
    expect(tabIds(getState)).toEqual(["b", "a", "c"]);
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Beta" }), {
      key: "ArrowLeft",
      altKey: true,
      shiftKey: true,
    });
    expect(tabIds(getState)).toEqual(["b", "a", "c"]);
  });

  it("keeps the pointer close control out of the tab, the tab order and the accessibility tree", () => {
    const { getState } = setup();
    const alpha = screen.getByRole("tab", { name: "Alpha" });
    expect(alpha.getAttribute("aria-label")).not.toMatch(/close/i);
    expect(within(alpha).queryByTitle("Close Alpha")).toBeNull();
    const close = screen.getByTitle("Close Beta");
    expect(close).toHaveAttribute("aria-hidden", "true");
    expect(close).toHaveAttribute("tabindex", "-1");
    expect(close.parentElement).toHaveAttribute("role", "presentation");
    expect(close.parentElement).toContainElement(screen.getByRole("tab", { name: "Beta" }));
    expect(screen.queryByRole("button", { name: /Close/ })).toBeNull();
    fireEvent.click(close);
    expect(tabIds(getState)).toEqual(["a", "c"]);
  });

  it("advertises Delete as the close key and describes it", () => {
    setup();
    const alpha = screen.getByRole("tab", { name: "Alpha" });
    expect(alpha).toHaveAttribute("aria-keyshortcuts", "Delete");
    expect(alpha).toHaveAccessibleDescription("Press Delete to close");
  });

  it("reorders by dragging and drops once", () => {
    const { getState } = setup();
    const wrappers = screen.getAllByRole("tab").map((t) => t.parentElement!);
    const data: Record<string, string> = {};
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: (k: string, v: string) => (data[k] = v),
    };
    wrappers.forEach((w) =>
      jest.spyOn(w, "getBoundingClientRect").mockReturnValue({
        left: 0,
        width: 100,
        right: 100,
        top: 0,
        bottom: 40,
        height: 40,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    );
    fireEvent.dragStart(wrappers[2], { dataTransfer });
    // jsdom has no DragEvent, so the pointer position is attached to the generic event by hand.
    const over = createEvent.dragOver(wrappers[0], { dataTransfer });
    Object.defineProperty(over, "clientX", { value: 10 });
    fireEvent(wrappers[0], over);
    expect(wrappers[0]).toHaveClass("dashboard-tab--drop-before");
    fireEvent.drop(wrappers[0], { dataTransfer });
    expect(tabIds(getState)).toEqual(["c", "a", "b"]);
    expect(document.querySelector(".dashboard-tab--drop-before")).toBeNull();
  });

  it("marks a changed tab with a dot and a name suffix", () => {
    setup({
      tabs: [tab("a"), tab("b", "2026-01-01T00:00:00Z"), tab("c")],
      changeSignals: {
        b: {
          dashboardId: "b",
          contentUpdatedAt: "2026-01-02T00:00:00Z",
          dataUpdatedAt: null,
          outputs: [],
        },
      },
    });
    const beta = screen.getByRole("tab", { name: "Beta, changed since you last viewed" });
    expect(beta.querySelector(".dashboard-tab__dot")).not.toBeNull();
    expect(
      screen.getByRole("tab", { name: "Alpha" }).querySelector(".dashboard-tab__dot"),
    ).toBeNull();
  });

  it("opens the palette in open-tab mode from the + button", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Open a dashboard in a new tab" }));
    expect(screen.getByTestId("palette")).toHaveTextContent("open-tab");
  });

  it("opens the ordinary palette from the Search, jump, or ask box", () => {
    setup();
    const box = screen.getByRole("button", { name: "Search, jump, or ask" });
    expect(box).toHaveAttribute("aria-keyshortcuts", expect.stringMatching(/^(Control|Meta)\+K$/));
    expect(box.querySelector("kbd")).not.toBeNull();
    act(() => box.click());
    expect(screen.getByTestId("palette")).toHaveTextContent("default");
  });

  it("scrolls the active tab into view", () => {
    const spy = jest.fn();
    Element.prototype.scrollIntoView = spy;
    const { dispatch } = setup();
    spy.mockClear();
    act(() => {
      dispatch({ type: "dashboardTabs/activateTab", payload: "c" });
    });
    expect(spy).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
  });
});
