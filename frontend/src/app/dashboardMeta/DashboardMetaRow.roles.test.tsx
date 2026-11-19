// HEL-1773 D5: the dashboard meta row offers a role only what it may do. A viewer gets no editing control and no owner
// action; an editor edits but cannot share or ask; an owner is unchanged. The facts (Output metadata, pipeline summaries)
// are read for an owner only: a non-owner's row asks the hook for none.
import { act, screen } from "@testing-library/react";

import { useDashboardMeta } from "../../features/panels/hooks/useDashboardMeta";
import type { DashboardMeta } from "../../features/panels/state/dashboardMeta";
import { fetchPanels } from "../../features/panels/state/panelThunks";
import { setDesktopGridDashboardId } from "../../features/layout/state/layoutHistorySlice";
import { makeTextPanel } from "../../test/panelFixtures";
import { renderWithStore } from "../../test/renderWithStore";
import { DashboardMetaRow } from "./DashboardMetaRow";

jest.mock("../../features/panels/hooks/useDashboardMeta", () => ({ useDashboardMeta: jest.fn() }));
jest.mock("./useMetaRowTier", () => ({
  ...jest.requireActual("./useMetaRowTier"),
  useMetaRowTier: jest.fn(() => 0),
}));

const metaMock = jest.mocked(useDashboardMeta);
const facts: DashboardMeta = {
  panelCount: 0,
  refreshState: "unknown",
  refreshedAt: null,
  refreshIntent: null,
  sources: [],
  moreSources: 0,
};
const panels = ["a", "b"].map((id) => makeTextPanel({ id, dashboardId: "d1" }));

function setup(accessRole: "owner" | "editor" | "viewer") {
  metaMock.mockReturnValue({ ...facts, panelCount: 2 });
  const ctx = renderWithStore(
    <DashboardMetaRow
      onOpenAsk={jest.fn()}
      onOpenRefinement={jest.fn()}
      onOpenQuickLauncher={jest.fn()}
      setDraftAppearance={jest.fn()}
    />,
    {
      auth: { status: "authenticated", currentUser: { id: "me" } as never },
      dashboards: {
        items: [
          { id: "d1", name: "Board", accessRole, ownerId: accessRole === "owner" ? "me" : "other" },
        ],
        selectedDashboardId: "d1",
      },
    },
    "/dashboards",
  );
  act(() => {
    ctx.store.dispatch(fetchPanels.pending("r", "d1"));
    ctx.store.dispatch(fetchPanels.fulfilled(panels, "r", "d1"));
    ctx.store.dispatch(setDesktopGridDashboardId("d1"));
  });
  return ctx;
}

const present = (name: string) => screen.queryByRole("button", { name }) !== null;

describe("DashboardMetaRow by role", () => {
  it("an owner has every control", () => {
    setup("owner");
    for (const name of [
      "Edit layout",
      "Share dashboard",
      "Add panel",
      "Customize dashboard appearance",
      "Ask about this dashboard",
      "Dashboard actions",
    ]) {
      expect(present(name)).toBe(true);
    }
    expect(metaMock).toHaveBeenLastCalledWith("d1", expect.arrayContaining([expect.anything()]));
  });

  it("an editor edits but neither shares nor asks", () => {
    setup("editor");
    expect(present("Edit layout")).toBe(true);
    expect(present("Add panel")).toBe(true);
    expect(present("Customize dashboard appearance")).toBe(true);
    expect(present("Share dashboard")).toBe(false);
    expect(present("Ask about this dashboard")).toBe(false);
  });

  it("a viewer has no editing or owner control, and no dashboard actions menu", () => {
    setup("viewer");
    for (const name of [
      "Edit layout",
      "Add panel",
      "Customize dashboard appearance",
      "Share dashboard",
      "Ask about this dashboard",
      "Dashboard actions",
    ]) {
      expect(present(name)).toBe(false);
    }
    // The assistant entry is not a dashboard action, so it stays.
    expect(present("Open assistant")).toBe(true);
  });

  it("a non-owner's facts hook is given no panels, yet the panel count still shows", () => {
    setup("viewer");
    expect(metaMock).toHaveBeenLastCalledWith("d1", []);
    expect(screen.getByText("2 panels")).toBeInTheDocument();
  });
});
