// HEL-1413 — DesktopPanelGrid reports the container width RGL has PROCESSED (not merely the
// `width` prop it was handed) as a CSS custom property on the grid root, so the breakpoint-layout
// e2e can wait on RGL itself rather than race the ResizeObserver -> rAF -> setWidth chain.
import { act } from "@testing-library/react";
import { Responsive } from "react-grid-layout";

import { makeOutputPanel } from "../../../../test/panelFixtures";
import { renderWithStore } from "../../../../test/renderWithStore";
import { PanelGrid } from "./PanelGrid";

jest.mock("react-grid-layout", () => {
  const React = require("react");
  return {
    Responsive: jest.fn(({ children }: { children?: import("react").ReactNode }) =>
      React.createElement("div", { "data-testid": "mock-responsive" }, children),
    ),
  };
});
jest.mock("react-grid-layout/core", () => ({
  ...jest.requireActual("react-grid-layout/core"),
  noCompactor: {},
  createScaledStrategy: jest.fn((scale: number) => ({ __scale: scale })),
}));
jest.mock("../../hooks/usePanelData", () => ({
  usePanelData: () => ({
    data: null,
    rawRows: null,
    headers: null,
    isLoading: false,
    error: null,
    noData: true,
    refresh: jest.fn(),
  }),
}));
jest.mock("../../hooks/usePanelPolling", () => ({ usePanelPolling: jest.fn() }));

const MockResponsive = jest.mocked(Responsive);
const PROP = "--panel-grid-processed-width";

type Props = {
  style: Record<string, string>;
  onWidthChange: (width: number, margin: [number, number], cols: number, padding: null) => void;
};
const lastProps = () =>
  MockResponsive.mock.calls[MockResponsive.mock.calls.length - 1][0] as unknown as Props;

const panels = [makeOutputPanel({ id: "a", dashboardId: "d1", title: "A" })];
const layout = { lg: [{ panelId: "a", x: 0, y: 0, w: 4, h: 4 }], md: [], sm: [], xs: [] };

function Grid({ width }: { width: number }) {
  return <PanelGrid dashboardId="d1" layout={layout} panels={panels} width={width} />;
}

describe("DesktopPanelGrid processed width (HEL-1413)", () => {
  beforeEach(() => MockResponsive.mockClear());

  it("starts at the mounted width", () => {
    renderWithStore(<Grid width={1612} />, { panels: { items: panels } });
    expect(lastProps().style[PROP]).toBe("1612px");
  });

  it("does not advance on a new width prop alone, only once RGL reports it processed it", () => {
    const { rerender } = renderWithStore(<Grid width={1612} />, { panels: { items: panels } });
    rerender(<Grid width={1212} />);
    expect(lastProps().style[PROP]).toBe("1612px");
    act(() => lastProps().onWidthChange(1212, [18, 18], 10, null));
    expect(lastProps().style[PROP]).toBe("1212px");
  });
});
