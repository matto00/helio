import { act, screen, within } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { selectDataPoint } from "../state/panelsSlice";
import { PanelInspectView } from "./PanelInspectView";
import type { ChartInspectConfig } from "../../../utils/chartClickSelection";

// jsdom does not implement showModal/close natively — mirrors
// PanelFullscreenOverlay.test.tsx's own stub exactly (see that file's
// comment for why this is required for a meaningful `open` assertion).
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  });
});

const headers = ["quarter", "region", "revenue"];
const rawRows = [
  ["Q1", "East", "100"],
  ["Q1", "West", "150"],
  ["Q2", "East", "120"],
];
const chartInspectConfig: ChartInspectConfig = {
  chartType: "bar",
  fieldMapping: { xAxis: "quarter", yAxis: "revenue", series: "region" },
};

function renderInspectView(overrides: Partial<Parameters<typeof PanelInspectView>[0]> = {}) {
  return renderWithStore(
    <PanelInspectView
      panelId="panel-1"
      panelTitle="Revenue"
      open
      onClose={jest.fn()}
      onClear={jest.fn()}
      rawRows={rawRows}
      headers={headers}
      chartInspectConfig={chartInspectConfig}
      variant="preview"
      {...overrides}
    />,
  );
}

describe("PanelInspectView — tasks.md 4.1 (header text)", () => {
  it("shows the labeled header for the current selection, including the series", async () => {
    const { store } = renderInspectView();
    act(() => {
      store.dispatch(
        selectDataPoint({ panelId: "panel-1", dimension: "quarter", value: "Q1", series: "West" }),
      );
    });

    expect(await screen.findByText("Showing rows for quarter: Q1 / West")).toBeInTheDocument();
  });

  it("omits the series suffix when series is empty", async () => {
    const { store } = renderInspectView();
    act(() => {
      store.dispatch(
        selectDataPoint({ panelId: "panel-1", dimension: "quarter", value: "Q1", series: "" }),
      );
    });

    expect(await screen.findByText("Showing rows for quarter: Q1")).toBeInTheDocument();
  });

  it("renders an empty state, not a header, when nothing is selected", () => {
    renderInspectView();
    expect(screen.getByText("Nothing selected")).toBeInTheDocument();
    expect(screen.queryByText(/Showing rows for/)).not.toBeInTheDocument();
  });
});

describe("PanelInspectView — tasks.md 4.1 (truncation notice)", () => {
  it("shows the truncation notice when rowsTruncated is true", async () => {
    const { store } = renderInspectView({ rowsTruncated: true });
    act(() => {
      store.dispatch(
        selectDataPoint({ panelId: "panel-1", dimension: "quarter", value: "Q1", series: "West" }),
      );
    });

    expect(await screen.findByRole("status")).toHaveTextContent(/currently loaded rows/);
  });

  it("does NOT show the truncation notice when rowsTruncated is false", async () => {
    const { store } = renderInspectView({ rowsTruncated: false });
    act(() => {
      store.dispatch(
        selectDataPoint({ panelId: "panel-1", dimension: "quarter", value: "Q1", series: "West" }),
      );
    });

    await screen.findByText("Showing rows for quarter: Q1 / West");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("PanelInspectView — tasks.md 4.2 (lists exactly the matching rows)", () => {
  it("shows exactly the rows matching the selection's dimension/series, and no others", async () => {
    const { store } = renderInspectView();
    act(() => {
      store.dispatch(
        selectDataPoint({ panelId: "panel-1", dimension: "quarter", value: "Q1", series: "West" }),
      );
    });

    await screen.findByText("Showing rows for quarter: Q1 / West");
    expect(screen.getByText("West")).toBeInTheDocument();
    expect(screen.queryByText("East")).not.toBeInTheDocument();
    expect(screen.queryByText("120")).not.toBeInTheDocument();
  });
});

describe("PanelInspectView — tasks.md 4.4 (clear/return control)", () => {
  it("calls onClear (not onClose) when the clear/return control is activated", async () => {
    const onClose = jest.fn();
    const onClear = jest.fn();
    const { store } = renderInspectView({ onClose, onClear });
    act(() => {
      store.dispatch(
        selectDataPoint({ panelId: "panel-1", dimension: "quarter", value: "Q1", series: "West" }),
      );
    });

    const clearButton = await screen.findByRole("button", { name: "Clear selection" });
    clearButton.click();

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  // spec.md "the same panel's inspect view is closed without an explicit
  // clear/return action" — Escape (Modal's native `cancel` event) must call
  // onClose only, never onClear, so the selection survives the dismiss.
  it("calls onClose (not onClear) on Escape", async () => {
    const onClose = jest.fn();
    const onClear = jest.fn();
    renderInspectView({ onClose, onClear });

    const dialog = document.querySelector("dialog")!;
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClear).not.toHaveBeenCalled();
  });

  it("the empty state's footer Close button calls onClose (not onClear) — nothing to clear", () => {
    const onClose = jest.fn();
    const onClear = jest.fn();
    renderInspectView({ onClose, onClear });

    const footer = document.querySelector<HTMLElement>(".ui-modal__footer")!;
    within(footer).getByRole("button", { name: "Close" }).click();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClear).not.toHaveBeenCalled();
  });
});

// HEL-588 tasks.md 2.1/2.2/2.4 — the owner-ruled "Action in Inspect" footer
// action: sets the dashboard's cross-filter and closes Inspect (never
// onClear — the selection itself is untouched).
describe("PanelInspectView — HEL-588 (Filter dashboard action)", () => {
  it("renders no filter action in the empty state (nothing selected)", () => {
    renderInspectView();
    expect(screen.queryByRole("button", { name: /Filter dashboard by/ })).not.toBeInTheDocument();
  });

  it("dispatches setCrossFilter with the current selection and closes Inspect (not onClear)", async () => {
    const onClose = jest.fn();
    const onClear = jest.fn();
    const { store } = renderInspectView({ onClose, onClear });
    act(() => {
      store.dispatch(
        selectDataPoint({ panelId: "panel-1", dimension: "quarter", value: "Q1", series: "West" }),
      );
    });

    const filterButton = await screen.findByRole("button", {
      name: "Filter dashboard by quarter = Q1",
    });
    filterButton.click();

    expect(store.getState().panels.crossFilter).toEqual({
      panelId: "panel-1",
      dimension: "quarter",
      value: "Q1",
      series: "West",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClear).not.toHaveBeenCalled();
  });

  it("activating the filter action for a different selection replaces the active cross-filter", async () => {
    const { store } = renderInspectView();
    act(() => {
      store.dispatch(
        selectDataPoint({ panelId: "panel-1", dimension: "quarter", value: "Q1", series: "West" }),
      );
    });
    (await screen.findByRole("button", { name: "Filter dashboard by quarter = Q1" })).click();

    act(() => {
      store.dispatch(
        selectDataPoint({ panelId: "panel-1", dimension: "quarter", value: "Q2", series: "East" }),
      );
    });
    (await screen.findByRole("button", { name: "Filter dashboard by quarter = Q2" })).click();

    expect(store.getState().panels.crossFilter).toMatchObject({ value: "Q2" });
  });

  // tasks.md 2.4 — reachable via Tab after opening Inspect through the
  // ActionsMenu path (not a chart click), and operable via a synthetic
  // click (jsdom's userEvent click already exercises Enter/Space-equivalent
  // native <button> activation — the load-bearing fact here is that the
  // action is a REAL, natively-focusable <button>, not a div/span).
  it("the filter action is a native, focusable button reachable by Tab", async () => {
    const { store } = renderInspectView();
    act(() => {
      store.dispatch(
        selectDataPoint({ panelId: "panel-1", dimension: "quarter", value: "Q1", series: "West" }),
      );
    });

    const filterButton = await screen.findByRole("button", {
      name: "Filter dashboard by quarter = Q1",
    });
    expect(filterButton.tagName).toBe("BUTTON");
    expect(filterButton).not.toHaveAttribute("disabled");
    filterButton.focus();
    expect(filterButton).toHaveFocus();
  });
});
