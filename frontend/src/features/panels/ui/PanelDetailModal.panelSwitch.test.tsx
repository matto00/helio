// HEL-307 regression: switching the PanelDetailModal directly from one panel's
// open edit form to another panel (without an intervening close) must show the
// TARGET panel's values in every form field — and a Save in that state must
// never write the previous panel's staged values onto the new panel.
//
// The bug: both production call sites (DesktopPanelGrid, MobilePanelStack)
// render `<PanelDetailModal>` without a `key`, so React reuses the mounted
// instance across `detailPanelId` changes; every `useState(initial*)` seed
// keeps panel A's values while `panel.id` now points at B. The fix is a
// `key={panel.id}` at each call site, remounting the whole editor subtree.
//
// These tests drive the REAL MobilePanelStack call site (which owns the
// `key`), so removing the key would turn them red again.

import { fireEvent, screen } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { makeMarkdownPanel } from "../../../test/panelFixtures";
import { defaultDashboardLayout } from "../../dashboards/state/dashboardLayout";
import type { DashboardLayout } from "../../dashboards/types/dashboard";
import { usePanelData } from "../hooks/usePanelData";
import { MobilePanelStack } from "./MobilePanelStack";

jest.mock("../hooks/usePanelData", () => ({
  usePanelData: jest.fn(),
}));

jest.mock("../hooks/usePanelPolling", () => ({
  usePanelPolling: jest.fn(),
}));

const mockUsePanelData = jest.mocked(usePanelData);

function layoutWithXs(items: DashboardLayout["xs"]): DashboardLayout {
  return { ...defaultDashboardLayout, xs: items };
}

const panelA = makeMarkdownPanel({
  id: "a",
  title: "Panel A",
  appearance: { background: "#111111", color: "#010101", transparency: 0.2 },
  config: { content: "# A content" },
});
const panelB = makeMarkdownPanel({
  id: "b",
  title: "Panel B",
  appearance: { background: "#222222", color: "#020202", transparency: 0.8 },
  config: { content: "# B content" },
});

const switchLayout = layoutWithXs([
  { panelId: "a", x: 0, y: 0, w: 2, h: 4 },
  { panelId: "b", x: 0, y: 4, w: 2, h: 4 },
]);

function renderStack() {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  return renderWithStore(
    <MobilePanelStack panels={[panelA, panelB]} layout={switchLayout} containerWidth={390} />,
    {
      panels: { items: [panelA, panelB] },
      // Seed as succeeded so editors don't dispatch a data-type fetch.
      dataTypes: { items: [], status: "succeeded" },
    },
  );
}

function openPanelInEditMode(headingName: string) {
  fireEvent.click(screen.getByRole("heading", { name: headingName }));
  fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
}

// After a fixed (keyed) remount the modal reopens in VIEW mode, so re-enter
// edit mode; on the unfixed code the modal stays in edit mode (no Edit button)
// and this is a no-op — deliberately so the tests exercise the same flow on
// both code paths and fail red on the buggy one.
function reEnterEditModeIfNeeded() {
  const editBtn = screen.queryByRole("button", { name: "Edit panel" });
  if (editBtn) fireEvent.click(editBtn);
}

describe("PanelDetailModal — direct panel switch (HEL-307)", () => {
  beforeEach(() => {
    mockUsePanelData.mockReturnValue({
      data: null,
      rawRows: null,
      headers: null,
      isLoading: false,
      error: null,
      noData: true,
      chartAggregate: null,
      refresh: jest.fn(),
    });
  });

  it("shows panel B's values in every audited field group after a direct A→B switch", () => {
    renderStack();

    // Open A in edit mode and confirm A's values are staged.
    openPanelInEditMode("Panel A");
    expect((screen.getByLabelText("Panel title") as HTMLInputElement).value).toBe("Panel A");
    expect((screen.getByLabelText("Panel A background color") as HTMLInputElement).value).toBe(
      "#111111",
    );
    expect((screen.getByLabelText("Content text") as HTMLTextAreaElement).value).toBe(
      "# A content",
    );

    // Switch directly to B without closing the modal.
    fireEvent.click(screen.getByRole("heading", { name: "Panel B" }));
    reEnterEditModeIfNeeded();

    // Every field group must now reflect B's persisted values.
    expect((screen.getByLabelText("Panel title") as HTMLInputElement).value).toBe("Panel B");
    expect((screen.getByLabelText("Panel B background color") as HTMLInputElement).value).toBe(
      "#222222",
    );
    expect((screen.getByLabelText("Panel B text color") as HTMLInputElement).value).toBe("#020202");
    expect((screen.getByLabelText("Panel B transparency") as HTMLInputElement).value).toBe("80");
    expect((screen.getByLabelText("Content text") as HTMLTextAreaElement).value).toBe(
      "# B content",
    );
  });

  it("a Save after a direct A→B switch cannot carry A's staged values onto B", () => {
    const { store } = renderStack();

    openPanelInEditMode("Panel A");
    fireEvent.click(screen.getByRole("heading", { name: "Panel B" }));
    reEnterEditModeIfNeeded();

    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    const pending = store.getState().panels.pendingPanelUpdates;
    // B's staged appearance is B's own — never A's #111111.
    expect(pending["b"]).toBeDefined();
    expect(pending["b"].appearance?.background).toBe("#222222");
    expect(pending["b"].appearance?.background).not.toBe("#111111");
    // A was never saved, so no update is dispatched against A's id either.
    expect(pending["a"]).toBeUndefined();
  });
});
