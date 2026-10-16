import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, useLocation } from "react-router-dom";

import { dash, makeTabsStore, tab } from "../../../test/tabsTestStore";
import { OverlayProvider } from "../../../shared/chrome/OverlayProvider";
import { CommandPaletteProvider } from "../CommandPaletteProvider";
import { useCommandActions, useCommandPalette } from "../hooks";
import type { CommandAction } from "../model/types";
import { CommandPalette } from "./CommandPalette";
import { PaletteSearchBox } from "./PaletteSearchBox";

jest.mock("../../dashboards/tabs/tabsPersistence", () => ({
  ...jest.requireActual("../../dashboards/tabs/tabsPersistence"),
  scheduleTabsWrite: jest.fn(),
  cancelTabsWrite: jest.fn(),
}));
jest.mock("../../dashboards/tabs/dashboardChangesService", () => ({
  fetchDashboardChanges: jest
    .fn()
    .mockResolvedValue({ serverNow: "2026-01-01T00:00:00Z", items: [] }),
}));
jest.mock("../../panels/services/panelService", () => ({
  fetchPanels: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../dashboards/services/dashboardService", () => ({ fetchDashboards: jest.fn() }));

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

function Registrant({ actions }: { actions: CommandAction[] }) {
  useCommandActions(actions);
  return null;
}
function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}|{JSON.stringify(location.state)}
    </output>
  );
}
function OpenTabButton() {
  const { open } = useCommandPalette();
  return (
    <button type="button" onClick={() => open({ intent: "open-tab" })}>
      open-in-tab
    </button>
  );
}

function setup() {
  const harness = makeTabsStore({
    dashboards: [dash("a", "Alpha"), dash("b", "Beta Board"), dash("c", "Gamma")],
    tabs: [tab("a"), tab("b")],
    activeId: "a",
    selected: "a",
  });
  // `CommandPalette` also reads sources/pipelines/outputs, which the tabs harness store does not carry.
  const extra = {
    sources: { items: [], status: "succeeded" },
    pipelines: { items: [], status: "succeeded" },
    outputs: { allItems: [], allStatus: "succeeded" },
  };
  const getState = harness.store.getState;
  jest
    .spyOn(harness.store, "getState")
    .mockImplementation(() => ({ ...getState(), ...extra }) as never);
  render(
    <Provider store={harness.store}>
      <MemoryRouter initialEntries={["/home"]}>
        <OverlayProvider>
          <CommandPaletteProvider>
            <Registrant
              actions={[
                { id: "reg.one", title: "Alpha settings", section: "General", run: jest.fn() },
              ]}
            />
            <PaletteSearchBox />
            <OpenTabButton />
            <CommandPalette />
            <LocationProbe />
          </CommandPaletteProvider>
        </OverlayProvider>
      </MemoryRouter>
    </Provider>,
  );
  return harness;
}

describe("palette ask action and open-tab mode", () => {
  it("opens from the Search, jump, or ask box with focus in the field", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Search, jump, or ask" }));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Search commands" })).toHaveFocus(),
    );
  });

  it("offers no ask action for an empty or whitespace query", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Search, jump, or ask" }));
    const input = screen.getByRole("combobox", { name: "Search commands" });
    expect(screen.queryByText(/Ask the assistant/)).toBeNull();
    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.queryByText(/Ask the assistant/)).toBeNull();
  });

  it("offers Ask the assistant last, after matches, and hands the text to /chat", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Search, jump, or ask" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Search commands" }), {
      target: { value: "alpha" },
    });
    const options = screen.getAllByRole("option");
    expect(options[options.length - 1]).toHaveTextContent('Ask the assistant: "alpha"');
    expect(options.length).toBeGreaterThan(1);
    fireEvent.click(options[options.length - 1]);
    expect(screen.getByTestId("location")).toHaveTextContent(
      '/chat|{"draft":"alpha","autoSend":true}',
    );
  });

  it("open-tab mode lists every dashboard for an empty query and hides actions, recents and ask", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "open-in-tab" }));
    const input = screen.getByRole("combobox", { name: "Search dashboards" });
    expect(input).toHaveAttribute("placeholder", "Open a dashboard in a new tab");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Alpha",
      "Beta Board",
      "Gamma",
    ]);
    fireEvent.change(input, { target: { value: "alpha" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Alpha"]);
    expect(screen.queryByText(/Ask the assistant/)).toBeNull();
    expect(screen.queryByText("Alpha settings")).toBeNull();
  });

  it("choosing a dashboard in open-tab mode opens and activates a new tab after the active one", () => {
    const { getState } = setup();
    fireEvent.click(screen.getByRole("button", { name: "open-in-tab" }));
    fireEvent.click(screen.getByRole("option", { name: "Gamma" }));
    expect(getState().dashboardTabs.tabs.map((t) => t.id)).toEqual(["a", "c", "b"]);
    expect(getState().dashboardTabs.activeId).toBe("c");
    expect(getState().dashboards.selectedDashboardId).toBe("c");
  });

  it("returns to the ordinary palette after an open-tab session closes", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "open-in-tab" }));
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Search dashboards" }), {
      key: "Escape",
    });
    act(() => {
      screen.getByRole("button", { name: "Search, jump, or ask" }).click();
    });
    expect(await screen.findByRole("combobox", { name: "Search commands" })).toBeInTheDocument();
  });
});
