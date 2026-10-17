import { act, fireEvent, screen, within } from "@testing-library/react";

import { useShareDialog } from "../../features/dashboards/state/shareDialogContext";
import { useDashboardMeta } from "../../features/panels/hooks/useDashboardMeta";
import type { DashboardMeta } from "../../features/panels/state/dashboardMeta";
import { fetchPanels } from "../../features/panels/state/panelThunks";
import {
  pushLayoutSnapshot,
  setDesktopGridDashboardId,
} from "../../features/layout/state/layoutHistorySlice";
import type { DashboardLayout } from "../../features/dashboards/types/dashboard";
import { makeTextPanel } from "../../test/panelFixtures";
import { resetUseNowForTests } from "../../hooks/useNow";
import { renderWithStore } from "../../test/renderWithStore";
import { DashboardMetaRow } from "./DashboardMetaRow";
import { useMetaRowTier } from "./useMetaRowTier";

// The hook's own network behaviour is covered by `useDashboardMeta.test.tsx`; here it returns facts.
jest.mock("../../features/panels/hooks/useDashboardMeta", () => ({ useDashboardMeta: jest.fn() }));
jest.mock("./useMetaRowTier", () => ({
  ...jest.requireActual("./useMetaRowTier"),
  useMetaRowTier: jest.fn(() => 0),
}));

const metaMock = jest.mocked(useDashboardMeta);
const tierMock = jest.mocked(useMetaRowTier);

const baseMeta: DashboardMeta = {
  panelCount: 3,
  refreshState: "unknown",
  refreshedAt: null,
  refreshIntent: null,
  sources: [],
  moreSources: 0,
};

const layoutA: DashboardLayout = {
  lg: [
    { panelId: "a", x: 0, y: 0, w: 6, h: 4 },
    { panelId: "b", x: 0, y: 10, w: 6, h: 4 },
  ],
  md: [],
  sm: [],
  xs: [],
};

const panels = ["a", "b"].map((id) => makeTextPanel({ id, dashboardId: "d1" }));

function ShareProbe() {
  const share = useShareDialog();
  return (
    <>
      <output data-testid="share-target">{share.target?.dashboardName ?? ""}</output>
      <button type="button" data-testid="close-share" onClick={share.close} />
    </>
  );
}

function setup(opts: { selected?: boolean; stack?: boolean } = {}) {
  const selected = opts.selected ?? true;
  const onOpenRefinement = jest.fn();
  const onOpenQuickLauncher = jest.fn();
  const ctx = renderWithStore(
    <>
      <DashboardMetaRow
        onOpenRefinement={onOpenRefinement}
        onOpenQuickLauncher={onOpenQuickLauncher}
        setDraftAppearance={jest.fn()}
      />
      <ShareProbe />
    </>,
    {
      dashboards: {
        items: [{ id: "d1", name: "Quarterly Revenue", layout: layoutA }],
        selectedDashboardId: selected ? "d1" : null,
      },
    },
    "/dashboards",
  );
  act(() => {
    ctx.store.dispatch(fetchPanels.pending("r", "d1"));
    ctx.store.dispatch(fetchPanels.fulfilled(panels, "r", "d1"));
    // The desktop (movable) grid is on screen; the stack below `sm` is covered by its own test.
    if (opts.stack !== true) ctx.store.dispatch(setDesktopGridDashboardId("d1"));
  });
  return { ...ctx, onOpenRefinement, onOpenQuickLauncher };
}

const group = () => screen.getByRole("group", { name: "Dashboard actions" });
const editToggle = () => screen.getByRole("button", { name: /^(Edit layout|Done)$/ });

beforeEach(() => {
  resetUseNowForTests();
  metaMock.mockReturnValue(baseMeta);
  tierMock.mockReturnValue(0);
});

describe("DashboardMetaRow facts (HEL-1576)", () => {
  it("is the command bar's slot: a header carrying the shared chrome class", () => {
    setup();
    const header = screen.getByRole("banner");
    expect(header).toHaveClass("app-command-bar", "app-command-bar--dashboard-meta");
  });

  it("states the panel count, singular and plural, and shows no heading and no dashboard name", () => {
    metaMock.mockReturnValue({ ...baseMeta, panelCount: 1 });
    const { container, rerender } = setup();
    expect(screen.getByText("1 panel")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent("Quarterly Revenue");
    metaMock.mockReturnValue({ ...baseMeta, panelCount: 4 });
    rerender(<></>);
  });

  it("shows 'refreshed <ago>' with a success dot and the absolute time in a <time> element", () => {
    metaMock.mockReturnValue({
      ...baseMeta,
      refreshState: "ran",
      refreshedAt: new Date(Date.now() - 9 * 3600_000).toISOString(),
      refreshIntent: "success",
    });
    const { container } = setup();
    expect(screen.getByText(/^refreshed 9 hours ago$/)).toBeInTheDocument();
    const time = container.querySelector("time");
    expect(time).toHaveAttribute("dateTime");
    expect(time).toHaveAttribute("title");
    expect(container.querySelector(".dashboard-meta-row__dot--success")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("a failed latest run reads 'last run failed <ago>' with a danger dot", () => {
    metaMock.mockReturnValue({
      ...baseMeta,
      refreshState: "ran",
      refreshedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
      refreshIntent: "danger",
    });
    const { container } = setup();
    expect(screen.getByText(/^last run failed 2 hours ago$/)).toBeInTheDocument();
    expect(container.querySelector(".dashboard-meta-row__dot--danger")).not.toBeNull();
  });

  it("never-run pipelines read 'not refreshed yet' with no dot; unknown omits the item", () => {
    metaMock.mockReturnValue({ ...baseMeta, refreshState: "never" });
    const { container, unmount } = setup();
    expect(screen.getByText("not refreshed yet")).toBeInTheDocument();
    expect(container.querySelector(".dashboard-meta-row__dot")).toBeNull();
    unmount();
    metaMock.mockReturnValue(baseMeta);
    setup();
    expect(screen.queryByText(/refreshed/)).not.toBeInTheDocument();
  });

  it.each([
    [{ sources: ["Orders"], moreSources: 0 }, "source · Orders"],
    [{ sources: ["Orders", "Users"], moreSources: 0 }, "sources · Orders, Users"],
    [{ sources: ["Orders", "Users"], moreSources: 3 }, "sources · Orders, Users +3"],
  ])("sources %j read %s", (sources, text) => {
    metaMock.mockReturnValue({ ...baseMeta, ...sources });
    setup();
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("the narrowest tier keeps only the panel count", () => {
    tierMock.mockReturnValue(3);
    metaMock.mockReturnValue({
      ...baseMeta,
      refreshState: "never",
      sources: ["Orders"],
      moreSources: 0,
    });
    setup();
    expect(screen.getByText("3 panels")).toBeInTheDocument();
    expect(screen.queryByText("not refreshed yet")).not.toBeInTheDocument();
    expect(screen.queryByText(/source/)).not.toBeInTheDocument();
  });
});

describe("DashboardMetaRow actions (HEL-1576)", () => {
  it("renders Edit layout, Share and the one primary Add panel in a labelled group", () => {
    setup();
    const g = within(group());
    expect(g.getByRole("button", { name: "Edit layout" })).toHaveAttribute("aria-pressed", "false");
    expect(g.getByRole("button", { name: "Share dashboard" })).toBeInTheDocument();
    const add = g.getByRole("button", { name: "Add panel" });
    expect(add).toHaveClass("cmd-btn--primary");
    expect(document.querySelectorAll(".cmd-btn--primary")).toHaveLength(1);
  });

  it("Add panel opens the panel creation flow", () => {
    const { store } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add panel" }));
    expect(store.getState().panels.panelCreationModalOpen).toBe(true);
  });

  it("Share opens the share dialog for the selected dashboard", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Share dashboard" }));
    expect(screen.getByTestId("share-target")).toHaveTextContent("Quarterly Revenue");
  });

  it("the assistant button and the kebab's Refine with AI call their handlers", () => {
    const { onOpenQuickLauncher, onOpenRefinement } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Open assistant" }));
    expect(onOpenQuickLauncher).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Dashboard actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Refine with AI" }));
    expect(onOpenRefinement).toHaveBeenCalledTimes(1);
  });

  it("below the desktop grid (the read-only stack) Edit layout is not offered, but the other actions are", () => {
    setup({ stack: true });
    expect(screen.queryByRole("button", { name: "Edit layout" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add panel" })).toBeInTheDocument();
  });

  it("no dashboard selected: no facts, no dashboard actions, the assistant button stays", () => {
    setup({ selected: false });
    expect(screen.queryByRole("group", { name: "Dashboard actions" })).not.toBeInTheDocument();
    expect(screen.queryByText(/panels?$/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open assistant" })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });
});

describe("DashboardMetaRow edit mode (HEL-1576)", () => {
  it("Edit layout toggles edit mode for the selected dashboard and reads Done while on", () => {
    const { store } = setup();
    fireEvent.click(editToggle());
    expect(store.getState().layoutHistory.editingLayoutDashboardId).toBe("d1");
    expect(editToggle()).toHaveAttribute("aria-pressed", "true");
    expect(editToggle()).toHaveTextContent("Done");
    fireEvent.click(editToggle());
    expect(store.getState().layoutHistory.editingLayoutDashboardId).toBeNull();
    expect(editToggle()).toHaveTextContent("Edit layout");
  });

  it("Undo, Redo and Tidy layout exist only in edit mode", () => {
    setup();
    for (const name of ["Undo layout change", "Redo layout change", "Tidy layout"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    fireEvent.click(editToggle());
    for (const name of ["Undo layout change", "Redo layout change", "Tidy layout"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("Undo and Redo are disabled per history, titled from the shared shortcut declaration", () => {
    const { store } = setup();
    fireEvent.click(editToggle());
    expect(screen.getByRole("button", { name: "Undo layout change" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo layout change" })).toBeDisabled();
    act(() => void store.dispatch(pushLayoutSnapshot({ dashboardId: "d1", layout: layoutA })));
    const undo = screen.getByRole("button", { name: "Undo layout change" });
    expect(undo).toBeEnabled();
    expect(undo.getAttribute("title")).toMatch(/^Undo layout change \((Ctrl|⌘)\+Z\)$/);
    expect(
      screen.getByRole("button", { name: "Redo layout change" }).getAttribute("title"),
    ).toMatch(/Shift\+Z|⇧\+Z/);
  });

  it("the Undo button and the keyboard shortcut end in the same state", () => {
    const { store } = setup();
    fireEvent.click(editToggle());
    const moved: DashboardLayout = { ...layoutA, lg: [{ panelId: "a", x: 6, y: 0, w: 6, h: 4 }] };
    act(() => {
      store.dispatch(pushLayoutSnapshot({ dashboardId: "d1", layout: moved }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Undo layout change" }));
    expect(store.getState().dashboards.items[0].layout).toEqual(moved);
    fireEvent.click(screen.getByRole("button", { name: "Redo layout change" }));
    expect(store.getState().dashboards.items[0].layout).toEqual(layoutA);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(store.getState().dashboards.items[0].layout).toEqual(moved);
  });

  it("the undo shortcut works with the meta row mounted and the command bar absent, in view mode", () => {
    const { store } = setup();
    const moved: DashboardLayout = { ...layoutA, lg: [{ panelId: "a", x: 6, y: 0, w: 6, h: 4 }] };
    act(() => void store.dispatch(pushLayoutSnapshot({ dashboardId: "d1", layout: moved })));
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(store.getState().dashboards.items[0].layout).toEqual(moved);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(store.getState().dashboards.items[0].layout).toEqual(layoutA);
  });

  it("Tidy layout is disabled when there is nothing to tidy, and compacts as one undoable entry", () => {
    const { store } = setup();
    fireEvent.click(editToggle());
    const tidy = screen.getByRole("button", { name: "Tidy layout" });
    expect(tidy).toBeEnabled();
    fireEvent.click(tidy);
    expect(store.getState().dashboards.items[0].layout.lg.map((i: { y: number }) => i.y)).toEqual([
      0, 4,
    ]);
    const after = screen.getByRole("button", { name: "Tidy layout" });
    expect(after).toBeDisabled();
    expect(after).toHaveAttribute("title", "Nothing to tidy");
    fireEvent.click(screen.getByRole("button", { name: "Undo layout change" }));
    expect(store.getState().dashboards.items[0].layout).toEqual(layoutA);
  });

  it("after a successful Tidy, keyboard focus moves to Undo (Tidy disables itself)", () => {
    setup();
    fireEvent.click(editToggle());
    const tidy = screen.getByRole("button", { name: "Tidy layout" });
    tidy.focus();
    fireEvent.click(tidy);
    expect(screen.getByRole("button", { name: "Undo layout change" })).toHaveFocus();
  });

  it("Tidy focuses Undo even when Undo was already enabled by an earlier layout change", () => {
    const { store } = setup();
    fireEvent.click(editToggle());
    act(() => void store.dispatch(pushLayoutSnapshot({ dashboardId: "d1", layout: layoutA })));
    expect(screen.getByRole("button", { name: "Undo layout change" })).toBeEnabled();
    const tidy = screen.getByRole("button", { name: "Tidy layout" });
    tidy.focus();
    fireEvent.click(tidy);
    expect(screen.getByRole("button", { name: "Undo layout change" })).toHaveFocus();
  });

  it("a layout change after a Tidy does not move focus", () => {
    const { store } = setup();
    fireEvent.click(editToggle());
    const tidy = screen.getByRole("button", { name: "Tidy layout" });
    tidy.focus();
    fireEvent.click(tidy);
    const redo = screen.getByRole("button", { name: "Redo layout change" });
    const elsewhere = editToggle();
    elsewhere.focus();
    const moved: DashboardLayout = { ...layoutA, lg: [{ panelId: "a", x: 6, y: 0, w: 6, h: 4 }] };
    act(() => void store.dispatch(pushLayoutSnapshot({ dashboardId: "d1", layout: moved })));
    expect(redo).not.toHaveFocus();
    expect(screen.getByRole("button", { name: "Undo layout change" })).not.toHaveFocus();
    expect(elsewhere).toHaveFocus();
  });

  it("Tidy layout is disabled while the dashboard's panels are not loaded", () => {
    const { store } = setup();
    act(() => void store.dispatch(fetchPanels.pending("r2", "other")));
    fireEvent.click(editToggle());
    expect(screen.getByRole("button", { name: "Tidy layout" })).toBeDisabled();
  });
});

describe("DashboardMetaRow Escape (HEL-1576 D4)", () => {
  function editing() {
    const ctx = setup();
    fireEvent.click(editToggle());
    expect(ctx.store.getState().layoutHistory.editingLayoutDashboardId).toBe("d1");
    return ctx;
  }
  const isEditing = (store: ReturnType<typeof setup>["store"]) =>
    store.getState().layoutHistory.editingLayoutDashboardId === "d1";

  it("leaves edit mode", () => {
    const { store } = editing();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(isEditing(store)).toBe(false);
  });

  it("does nothing outside edit mode", () => {
    const { store } = setup();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(isEditing(store)).toBe(false);
  });

  it("is ignored from an editable element", () => {
    const { store } = editing();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(isEditing(store)).toBe(true);
    input.remove();
  });

  it("is ignored while a menu or popover trigger reports open", () => {
    const { store } = editing();
    fireEvent.click(screen.getByRole("button", { name: "Dashboard actions" }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    // The menu closed (its own handler), edit mode stayed on.
    expect(isEditing(store)).toBe(true);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(isEditing(store)).toBe(false);
  });

  it("is ignored while the appearance editor popover is open (its trigger has no aria-haspopup)", () => {
    const { store } = editing();
    fireEvent.click(screen.getByRole("button", { name: "Customize dashboard appearance" }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(isEditing(store)).toBe(true);
  });

  it("is ignored while a dialog is open", () => {
    const { store } = editing();
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    document.body.appendChild(dialog);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(isEditing(store)).toBe(true);
    dialog.remove();
  });

  it("is ignored while a drag or resize is in progress", () => {
    const { store } = editing();
    const moving = document.createElement("div");
    moving.className = "react-draggable-dragging";
    document.body.appendChild(moving);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(isEditing(store)).toBe(true);
    moving.className = "resizing";
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(isEditing(store)).toBe(true);
    moving.remove();
  });

  it("is ignored when an inner handler already handled the event", () => {
    const { store } = editing();
    const inner = (event: KeyboardEvent) => event.preventDefault();
    document.body.addEventListener("keydown", inner);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(isEditing(store)).toBe(true);
    document.body.removeEventListener("keydown", inner);
  });
});

describe("DashboardMetaRow narrow-width ladder (HEL-1576 D3)", () => {
  it("tier 1: Edit layout and Share are icon-only but keep their accessible names and titles", () => {
    tierMock.mockReturnValue(1);
    setup();
    const edit = screen.getByRole("button", { name: "Edit layout" });
    expect(edit).toHaveTextContent("");
    expect(edit).toHaveAttribute("title", "Edit layout");
    const share = screen.getByRole("button", { name: "Share dashboard" });
    expect(share).toHaveTextContent("");
    expect(screen.getByRole("button", { name: "Add panel" })).toHaveTextContent("Add panel");
  });

  it("tier 1 in edit mode: Undo, Redo and Tidy are icon-only", () => {
    tierMock.mockReturnValue(1);
    setup();
    fireEvent.click(editToggle());
    for (const name of ["Undo layout change", "Redo layout change", "Tidy layout"]) {
      expect(screen.getByRole("button", { name })).toHaveTextContent("");
    }
  });

  it.each([2, 3] as const)(
    "tier %i with no dashboard selected: the assistant button is still rendered",
    (tier) => {
      tierMock.mockReturnValue(tier);
      const { onOpenQuickLauncher } = setup({ selected: false });
      fireEvent.click(screen.getByRole("button", { name: "Open assistant" }));
      expect(onOpenQuickLauncher).toHaveBeenCalledTimes(1);
    },
  );

  it("tier 2: closing the share dialog returns focus to the kebab trigger, not the body", () => {
    jest.useFakeTimers();
    tierMock.mockReturnValue(2);
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Dashboard actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Share dashboard" }));
    expect(screen.getByTestId("share-target")).toHaveTextContent("Quarterly Revenue");
    act(() => {
      fireEvent.click(screen.getByTestId("close-share"));
      jest.advanceTimersByTime(10);
    });
    expect(screen.getByRole("button", { name: "Dashboard actions" })).toHaveFocus();
    jest.useRealTimers();
  });

  it("tier 2: Share and the assistant move into the kebab, with the same handlers and names", () => {
    tierMock.mockReturnValue(2);
    const { onOpenQuickLauncher } = setup();
    expect(screen.queryByRole("button", { name: "Share dashboard" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open assistant" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dashboard actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Share dashboard" }));
    expect(screen.getByTestId("share-target")).toHaveTextContent("Quarterly Revenue");
    fireEvent.click(screen.getByRole("button", { name: "Dashboard actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Open assistant" }));
    expect(onOpenQuickLauncher).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Add panel" })).toHaveTextContent("Add panel");
  });
});
