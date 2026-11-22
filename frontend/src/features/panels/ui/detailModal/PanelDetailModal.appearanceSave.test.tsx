// HEL-1615: a modal save must not change an appearance field the user did not edit. The modal sends only the keys it
// changed; the stored `appearance.chart` and a non-whole-percent transparency (0.555) survive in client state (read
// BEFORE any batch flush -- standing constraint C1) and in the pending patch.

import { fireEvent, screen } from "@testing-library/react";

import { renderWithStore } from "../../../../test/renderWithStore";
import { makeMarkdownPanel } from "../../../../test/panelFixtures";
import { fetchPanels } from "../../state/panelsSlice";
import type { ChartAppearance } from "../../types/panel";
import { PanelDetailModal } from "./PanelDetailModal";

jest.mock("echarts-for-react/esm/core", () => ({
  __esModule: true,
  default: ({ option }: { option: unknown }) => (
    <div data-testid="echarts" data-option={JSON.stringify(option)} />
  ),
}));
jest.mock("../echartsCore", () => ({ __esModule: true, default: {} }));

const storedChart: ChartAppearance = {
  seriesColors: ["#111111"],
  legend: { show: true, position: "top" },
  tooltip: { enabled: true },
  axisLabels: { x: { show: true, label: "" }, y: { show: true, label: "" } },
  chartType: "pie",
};

function setup() {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  const panel = makeMarkdownPanel({
    id: "p1",
    title: "Notes",
    appearance: {
      background: "#112233",
      color: "#aabbcc",
      transparency: 0.555,
      chart: storedChart,
    },
    config: { content: "# Hi" },
  });
  const rendered = renderWithStore(<PanelDetailModal panel={panel} onClose={jest.fn()} />);
  rendered.store.dispatch(fetchPanels.fulfilled([panel], "req", "dashboard-1"));
  fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
  return rendered.store;
}

function save() {
  fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));
}

describe("PanelDetailModal appearance save preserves unedited fields (HEL-1615)", () => {
  it("title-only save sends no appearance and keeps chart, colors and transparency 0.555 in client state", () => {
    const store = setup();
    fireEvent.change(screen.getByLabelText("Panel title"), { target: { value: "Notes v2" } });
    save();

    const state = store.getState().panels;
    expect(state.pendingPanelUpdates["p1"]).toEqual({ title: "Notes v2" });
    expect(state.items[0].appearance).toEqual({
      background: "#112233",
      color: "#aabbcc",
      transparency: 0.555,
      chart: storedChart,
    });
  });

  it("background-only save sends only the background and keeps chart, color and transparency", () => {
    const store = setup();
    fireEvent.change(screen.getByLabelText("Notes background color"), {
      target: { value: "#445566" },
    });
    save();

    const state = store.getState().panels;
    expect(state.pendingPanelUpdates["p1"].appearance).toEqual({ background: "#445566" });
    expect(state.items[0].appearance).toEqual({
      background: "#445566",
      color: "#aabbcc",
      transparency: 0.555,
      chart: storedChart,
    });
  });

  it("an edited transparency is sent as the new fraction", () => {
    const store = setup();
    fireEvent.change(screen.getByLabelText(/transparency/i), { target: { value: "40" } });
    save();

    expect(store.getState().panels.pendingPanelUpdates["p1"].appearance).toEqual({
      transparency: 0.4,
    });
  });

  it("a save with nothing changed stages nothing", () => {
    const store = setup();
    save();

    expect(store.getState().panels.pendingPanelUpdates["p1"]).toBeUndefined();
  });

  it("two partial saves before a flush are both staged", () => {
    const store = setup();
    fireEvent.change(screen.getByLabelText("Notes background color"), {
      target: { value: "#445566" },
    });
    save();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.change(screen.getByLabelText("Notes text color"), { target: { value: "#ddeeff" } });
    save();

    expect(store.getState().panels.pendingPanelUpdates["p1"].appearance).toEqual({
      background: "#445566",
      color: "#ddeeff",
    });
  });
});
