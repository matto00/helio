import { act } from "@testing-library/react";

import { renderWithStore } from "../../../../test/renderWithStore";
import { makeMarkdownPanel, makeOutputPanel } from "../../../../test/panelFixtures";
import { defaultDashboardLayout } from "../../../dashboards/state/dashboardLayout";
import { usePanelData } from "../../hooks/usePanelData";
import { MobilePanelStack } from "./MobilePanelStack";

// HEL-1656 stack wiring: a release past the threshold refreshes each output-bound panel once (none for a markdown
// panel), holds busy while a request is held open, and announces Refreshing then Refreshed. Recorded mutations: see the
// notes beside each test.

jest.mock("../../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../../pipelines/services/outputService"),
  getOutputById: jest.fn(() => Promise.reject(new Error("unmocked request stubbed (HEL-1656)"))),
}));
jest.mock("echarts-for-react/esm/core", () => ({
  __esModule: true,
  default: () => <div data-testid="echarts" />,
}));
jest.mock("../echartsCore", () => ({ __esModule: true, default: {} }));
jest.mock("../../hooks/usePanelData", () => ({ usePanelData: jest.fn() }));
jest.mock("../../hooks/usePanelPolling", () => ({ usePanelPolling: jest.fn() }));
jest.mock("../../services/panelService", () => ({ updatePanelColumnWidths: jest.fn() }));

const mockUsePanelData = jest.mocked(usePanelData);

const refreshA = jest.fn();
const refreshB = jest.fn();
const refreshText = jest.fn();
let refreshing: Record<string, boolean>;

function data(refresh: () => void, isRefreshing: boolean) {
  return {
    data: null,
    rawRows: null,
    headers: null,
    isLoading: false,
    error: null,
    errorKind: null,
    noData: true,
    neverMaterialized: false,
    rowsTruncated: false,
    refresh,
    isRefreshing,
  };
}

const a = makeOutputPanel({ id: "a", title: "A", config: { outputId: "out-a" } });
const b = makeOutputPanel({ id: "b", title: "B", config: { outputId: "out-b" } });
const text = makeMarkdownPanel({ id: "t", title: "T" });

function ui(panels = [a, b, text]) {
  return (
    <div className="app-content" data-testid="scroller">
      <MobilePanelStack panels={panels} layout={defaultDashboardLayout} containerWidth={390} />
    </div>
  );
}

const statusRegion = () => document.querySelector(".mobile-panel-pull__status") as HTMLElement;

function send(el: Element, type: string, points: Array<[number, number]>) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: points.map(([clientX, clientY]) => ({ clientX, clientY })),
  });
  act(() => {
    el.dispatchEvent(event);
  });
}

function pullAndRelease(distance: number) {
  const target = document.querySelector(".mobile-panel-stack__item") as Element;
  send(target, "touchstart", [[100, 200]]);
  send(target, "touchmove", [[100, 200 + distance]]);
  send(target, "touchend", []);
}

describe("MobilePanelStack pull-to-refresh", () => {
  beforeEach(() => {
    refreshing = {};
    refreshA.mockClear();
    refreshB.mockClear();
    refreshText.mockClear();
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    })) as unknown as typeof window.matchMedia;
    HTMLDialogElement.prototype.showModal = jest.fn();
    HTMLDialogElement.prototype.close = jest.fn();
    mockUsePanelData.mockImplementation((panel) => {
      const refresh = panel.id === "a" ? refreshA : panel.id === "b" ? refreshB : refreshText;
      return data(refresh, refreshing[panel.id] ?? false);
    });
  });

  // mutation: register non-output panels too -> the markdown refresh assertion goes red
  it("refreshes each output-bound panel once and no other panel on a qualifying release", () => {
    renderWithStore(ui(), { panels: { items: [a, b, text] } });
    pullAndRelease(400);
    expect(refreshA).toHaveBeenCalledTimes(1);
    expect(refreshB).toHaveBeenCalledTimes(1);
    expect(refreshText).not.toHaveBeenCalled();
  });

  // mutation: refresh regardless of the threshold -> red
  it("refreshes nothing on a release short of the threshold", () => {
    renderWithStore(ui(), { panels: { items: [a, b, text] } });
    pullAndRelease(30);
    expect(refreshA).not.toHaveBeenCalled();
    expect(refreshB).not.toHaveBeenCalled();
  });

  // mutation: end busy on the first false read -> red; the request is held open by hand, not instantly resolved
  it("stays busy while a request is held open, announces Refreshing then Refreshed", () => {
    const view = renderWithStore(ui(), { panels: { items: [a, b, text] } });
    pullAndRelease(400);
    const status = () => statusRegion().textContent;
    expect(status()).toBe("Refreshing");
    expect(document.querySelector(".pull-refresh-indicator")?.getAttribute("data-state")).toBe(
      "busy",
    );
    // pending dispatched for both panels: still busy
    refreshing = { a: true, b: true };
    view.rerender(ui());
    expect(status()).toBe("Refreshing");
    // a settles, b's request is still open
    refreshing = { a: false, b: true };
    view.rerender(ui());
    expect(status()).toBe("Refreshing");
    refreshing = { a: false, b: false };
    view.rerender(ui());
    expect(status()).toBe("Refreshed");
  });

  // mutation: start a round for an empty registry -> the status/indicator assertions go red
  it("a dashboard with no output-bound panel shows no busy state and announces nothing", () => {
    renderWithStore(ui([text]), { panels: { items: [text] } });
    pullAndRelease(400);
    expect(refreshText).not.toHaveBeenCalled();
    expect(statusRegion().textContent).toBe("");
    expect(document.querySelector(".pull-refresh-indicator")).toBeNull();
  });

  // mutation: render the indicator unconditionally -> red
  it("renders no indicator at rest and the status region is always mounted", () => {
    renderWithStore(ui(), { panels: { items: [a, b, text] } });
    expect(document.querySelector(".pull-refresh-indicator")).toBeNull();
    expect(statusRegion().getAttribute("aria-live")).toBe("polite");
    expect(document.querySelector(".mobile-panel-stack")?.getAttribute("style") ?? "").not.toMatch(
      /transform/,
    );
  });
});
