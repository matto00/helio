import { act, waitFor } from "@testing-library/react";

import * as outputService from "../../../pipelines/services/outputService";
import {
  DESKTOP_WIDTH,
  PANELS,
  PHONE_WIDTH,
  renderGridAt,
  wireOutputService,
} from "../../../../test/remountFixtures";

// HEL-1392 red-first — crossing the 768px container boundary swaps the desktop grid for the phone
// stack (and back), remounting every card. Rows and Output metadata already held must not be
// requested again. Rendered under StrictMode (the dev double-effect run) with the real hooks.
jest.mock("react-grid-layout", () => {
  const React = require("react");
  return {
    Responsive: ({ children }: { children?: import("react").ReactNode }) =>
      React.createElement("div", null, children),
  };
});
jest.mock("react-grid-layout/core", () => ({
  ...jest.requireActual("react-grid-layout/core"),
  noCompactor: {},
  createScaledStrategy: jest.fn((scale: number) => ({ __scale: scale })),
}));
jest.mock("../../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../../pipelines/services/outputService"),
  getOutputRows: jest.fn(),
  getOutputById: jest.fn(),
  getAssertionStatus: jest.fn(),
  getDistinctValues: jest.fn(),
}));
jest.mock("../../hooks/usePanelPolling", () => ({ usePanelPolling: jest.fn() }));
jest.mock("../../services/pipelineRunFanout", () => ({
  subscribeToPipelineSucceeded: jest.fn(() => () => undefined),
  subscribeToPipelineTerminal: jest.fn(() => () => undefined),
  hasRunBaseline: jest.fn(() => true),
}));

const svc = jest.mocked(outputService);

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}

describe("PanelGrid desktop <-> phone crossing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(svc.getDistinctValues)
      .mockResolvedValue({ column: "region", values: [{ value: "East", count: 2 }] });
    wireOutputService({
      getOutputRows: svc.getOutputRows as jest.Mock,
      getOutputById: svc.getOutputById as jest.Mock,
      getAssertionStatus: svc.getAssertionStatus as jest.Mock,
    });
  });

  it("requests no rows and no Output metadata for cards remounting across the boundary", async () => {
    const view = renderGridAt(DESKTOP_WIDTH);
    await waitFor(() =>
      expect(Object.keys(view.store.getState().panels.paginationState)).toHaveLength(PANELS.length),
    );
    await settle();
    // Not vacuous: the cold load really did request rows and metadata.
    expect(svc.getOutputRows.mock.calls.length).toBeGreaterThanOrEqual(PANELS.length);
    expect(svc.getOutputById.mock.calls.length).toBeGreaterThanOrEqual(PANELS.length);

    for (const width of [PHONE_WIDTH, DESKTOP_WIDTH, PHONE_WIDTH]) {
      svc.getOutputRows.mockClear();
      svc.getOutputById.mockClear();
      act(() => view.setWidth(width));
      await settle();
      expect(svc.getOutputRows.mock.calls).toEqual([]);
      expect(svc.getOutputById.mock.calls).toEqual([]);
    }
  });
});
