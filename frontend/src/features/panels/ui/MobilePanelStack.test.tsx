import { fireEvent, screen, within } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import {
  makeDividerPanel,
  makeMarkdownPanel,
  makeMetricPanel,
  makeTablePanel,
} from "../../../test/panelFixtures";
import { defaultDashboardLayout } from "../../dashboards/state/dashboardLayout";
import type { DashboardLayout } from "../../dashboards/types/dashboard";
import { usePanelData } from "../hooks/usePanelData";
import { MobilePanelStack } from "./MobilePanelStack";

// jest.fn() (not a plain factory function) so individual tests — e.g. the
// divider-orientation test below, which needs `noData: false` to reach
// DividerRenderer's actual markup instead of PanelContent's "No data
// available" early return — can override the return value per-case.
jest.mock("../hooks/usePanelData", () => ({
  usePanelData: jest.fn(() => ({
    data: null,
    rawRows: null,
    headers: null,
    isLoading: false,
    error: null,
    noData: true,
    refresh: jest.fn(),
  })),
}));

const mockUsePanelData = jest.mocked(usePanelData);

jest.mock("../hooks/usePanelPolling", () => ({
  usePanelPolling: jest.fn(),
}));

jest.mock("../services/panelService", () => ({
  updatePanelColumnWidths: jest.fn(),
}));

function layoutWithXs(items: DashboardLayout["xs"]): DashboardLayout {
  return { ...defaultDashboardLayout, xs: items };
}

describe("MobilePanelStack — read-only stack (HEL-301)", () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
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

  // Task 5.3 — order follows the resolved xs layout: y ascending, then x ascending.
  //
  // The xs layout must be geometrically valid (respects dashboardGridCols.xs
  // = 2, no overlaps) — resolveDashboardLayout's cleanupOverlaps pass
  // defensively repositions items it detects as colliding or column-
  // overflowing, which would silently rewrite the y/x values this test
  // exercises. B and C share y=0 at x=0/x=1 (2-col row) to test the x
  // tie-break; A sits in a separate row below both.
  it("orders panels by the xs layout's y then x, not declaration order", () => {
    const panelA = makeMetricPanel({ id: "a", title: "Panel A" });
    const panelB = makeMetricPanel({ id: "b", title: "Panel B" });
    const panelC = makeMetricPanel({ id: "c", title: "Panel C" });
    const layout = layoutWithXs([
      { panelId: "a", x: 0, y: 4, w: 2, h: 4 },
      { panelId: "b", x: 0, y: 0, w: 1, h: 4 },
      { panelId: "c", x: 1, y: 0, w: 1, h: 4 },
    ]);

    const { container } = renderWithStore(
      <MobilePanelStack panels={[panelA, panelB, panelC]} layout={layout} containerWidth={390} />,
      { panels: { items: [panelA, panelB, panelC] } },
    );

    const titles = Array.from(container.querySelectorAll(".panel-grid-card__title")).map(
      (el) => el.textContent,
    );
    expect(titles).toEqual(["Panel B", "Panel C", "Panel A"]);
  });

  it("falls back to resolveDashboardLayout placement for a panel missing from the saved xs layout", () => {
    const known = makeMetricPanel({ id: "known", title: "Known" });
    const missing = makeMetricPanel({ id: "missing", title: "Missing" });
    const layout = layoutWithXs([{ panelId: "known", x: 0, y: 5, w: 2, h: 4 }]);

    const { container } = renderWithStore(
      <MobilePanelStack panels={[known, missing]} layout={layout} containerWidth={390} />,
      { panels: { items: [known, missing] } },
    );

    const titles = Array.from(container.querySelectorAll(".panel-grid-card__title")).map(
      (el) => el.textContent,
    );
    // Both panels render — resolveDashboardLayout placed "missing" at a
    // non-overlapping fallback position rather than dropping it.
    expect(titles).toContain("Known");
    expect(titles).toContain("Missing");
  });

  // Task 5.5 — no drag handle, resize handle, title-edit affordance, or
  // delete control anywhere in the stack; tapping opens the detail modal.
  describe("read-only affordances", () => {
    it("renders no drag handle, actions menu, or title-edit input", () => {
      const panel = makeMetricPanel({ id: "p1", title: "Revenue" });
      const layout = layoutWithXs([{ panelId: "p1", x: 0, y: 0, w: 2, h: 4 }]);

      renderWithStore(<MobilePanelStack panels={[panel]} layout={layout} containerWidth={390} />, {
        panels: { items: [panel] },
      });

      expect(screen.queryByRole("button", { name: /Move .* panel/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /panel actions/ })).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Panel title")).not.toBeInTheDocument();
    });

    it("tapping a panel card opens the panel detail modal", () => {
      const panel = makeMetricPanel({ id: "p1", title: "Revenue" });
      const layout = layoutWithXs([{ panelId: "p1", x: 0, y: 0, w: 2, h: 4 }]);

      renderWithStore(<MobilePanelStack panels={[panel]} layout={layout} containerWidth={390} />, {
        panels: { items: [panel] },
      });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      fireEvent.click(screen.getByText("Revenue"));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("renders the plain stack container, not the RGL grid class", () => {
      const panel = makeMetricPanel({ id: "p1", title: "Revenue" });
      const layout = layoutWithXs([{ panelId: "p1", x: 0, y: 0, w: 2, h: 4 }]);

      const { container } = renderWithStore(
        <MobilePanelStack panels={[panel]} layout={layout} containerWidth={390} />,
        { panels: { items: [panel] } },
      );

      expect(container.querySelector(".mobile-panel-stack")).toBeInTheDocument();
      // `.panel-grid` is the className RGL's <Responsive> renders with
      // (DesktopPanelGrid.tsx) — its absence here is a proxy for "no
      // <Responsive> mounted", the property this file cannot check directly
      // without mocking react-grid-layout (which MobilePanelStack.tsx never
      // imports at runtime in the first place — see PanelGrid.test.tsx for
      // the structural mount assertion at the PanelGrid level).
      expect(container.querySelector(".panel-grid")).not.toBeInTheDocument();
    });
  });

  // W4.3 — divider gets no card chrome at all.
  it("renders a divider without card chrome (no header, no panel-grid-card class)", () => {
    const divider = makeDividerPanel({ id: "d1", title: "Divider" });
    const layout = layoutWithXs([{ panelId: "d1", x: 0, y: 0, w: 2, h: 1 }]);

    const { container } = renderWithStore(
      <MobilePanelStack panels={[divider]} layout={layout} containerWidth={390} />,
      { panels: { items: [divider] } },
    );

    const item = container.querySelector(".mobile-panel-stack__item--divider");
    expect(item).toBeInTheDocument();
    expect(item).not.toHaveClass("panel-grid-card");
    expect(within(item as HTMLElement).queryByText("Divider")).not.toBeInTheDocument();
  });

  // Cycle-2 evaluator fix: a stored `orientation: "vertical"` divider is
  // meaningless in a single-column stack — DividerPanel sets an inline
  // `height: 100%` for vertical dividers, which resolves to 0px against the
  // stack's auto-height flex item. MobilePanelStack must force it to render
  // as the intrinsic horizontal hairline instead.
  it("forces a vertical divider to render as a horizontal hairline in the stack", () => {
    // Real dividers carry no dataTypeId, so usePanelData's `currentFetchKey`
    // is null and production noData is always `false` (see usePanelData.ts)
    // — override the module-level default (noData: true) to reach
    // DividerRenderer's actual markup instead of PanelContent's "No data
    // available" early return.
    mockUsePanelData.mockReturnValue({
      data: null,
      rawRows: null,
      headers: null,
      isLoading: false,
      error: null,
      noData: false,
      chartAggregate: null,
      refresh: jest.fn(),
    });

    const divider = makeDividerPanel({
      id: "d1",
      title: "Sep",
      config: { orientation: "vertical" },
    });
    const layout = layoutWithXs([{ panelId: "d1", x: 0, y: 0, w: 2, h: 1 }]);

    const { container } = renderWithStore(
      <MobilePanelStack panels={[divider]} layout={layout} containerWidth={390} />,
      { panels: { items: [divider] } },
    );

    const rule = container.querySelector(".divider-panel__rule");
    expect(container.querySelector(".divider-panel--horizontal")).toBeInTheDocument();
    expect(container.querySelector(".divider-panel--vertical")).not.toBeInTheDocument();
    // The vertical branch sets an inline `height: 100%` that no CSS override
    // can win over — asserting its absence is the regression guard for the
    // 0px collapse.
    expect(rule).not.toHaveStyle({ height: "100%" });
  });

  // W4.3 — table panel gets the internal-scroll marker class.
  it("marks the table item with the internal-scroll class, distinct from other kinds", () => {
    const table = makeTablePanel({ id: "t1", title: "Table" });
    const markdown = makeMarkdownPanel({ id: "m1", title: "Markdown" });
    const layout = layoutWithXs([
      { panelId: "t1", x: 0, y: 0, w: 2, h: 5 },
      { panelId: "m1", x: 0, y: 1, w: 2, h: 5 },
    ]);

    const { container } = renderWithStore(
      <MobilePanelStack panels={[table, markdown]} layout={layout} containerWidth={390} />,
      { panels: { items: [table, markdown] } },
    );

    expect(container.querySelector(".mobile-panel-stack__item--table")).toBeInTheDocument();
    expect(container.querySelector(".mobile-panel-stack__item--markdown")).toBeInTheDocument();
  });
});
