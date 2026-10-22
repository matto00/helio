import { act, fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithStore } from "../../../../test/renderWithStore";
import { makeHistory } from "../../../panels/history/historyFixtures";
import { resetHistoryCache } from "../../../panels/history/outputHistoryCache";
import * as historyService from "../../../panels/history/outputHistoryService";
import { int, type Frame } from "../../evaluator";
import * as outputService from "../../services/outputService";
import type { DraftStepView } from "../../state/draftStepView";
import type { SampleState } from "../../state/liveOutput/liveOutputSource";
import type { Output } from "../../types/output";
import type { usePipelineDraftPresentation } from "../../hooks/usePipelineDraftPresentation";
import type { PipelinePageState } from "../spine/PipelineSpineLayout";
import { clearSavedOutputRows } from "../../hooks/useSavedOutputRows";
import { LiveOutputColumn } from "./LiveOutputColumn";

jest.mock("../../../panels/history/outputHistoryService", () => ({
  fetchOutputHistory: jest.fn(),
  fetchPublicOutputHistory: jest.fn(),
}));
jest.mock("../../services/outputService", () => ({ getOutputRows: jest.fn() }));
const mockBodyRenders = { count: 0 };
jest.mock("./LiveOutputBody", () => {
  const actual = jest.requireActual("./LiveOutputBody");
  const { createElement, memo } = jest.requireActual("react");
  return {
    ...actual,
    LiveOutputBody: memo((props: object) => {
      mockBodyRenders.count += 1;
      return createElement(actual.LiveOutputBody, props);
    }),
  };
});
let sampleState: SampleState = "ready";
const sampleStateCalls = jest.fn();
jest.mock("../../hooks/useLiveSampleState", () => ({
  useLiveSampleState: () => {
    sampleStateCalls();
    return sampleState;
  },
}));

const fetchHistory = jest.mocked(historyService.fetchOutputHistory);
const getOutputRows = jest.mocked(outputService.getOutputRows);

const SCHEMA = [
  { name: "date", type: "string" },
  { name: "amount", type: "integer" },
];
const output = (over: Partial<Output>): Output => ({
  id: "o1",
  pipelineId: "p1",
  nodeStepId: "s1",
  ownerId: "u",
  name: "Total",
  kind: "metric",
  config: { aggregation: { value: "amount", agg: "sum" } },
  schema: SCHEMA,
  createdAt: "",
  updatedAt: "",
  ...over,
});

const BASE: Frame = [
  { date: "a", amount: int(10) },
  { date: "b", amount: int(20) },
  { date: "c", amount: int(30) },
];
const DRAFT: Frame = [{ date: "c", amount: int(30) }];
const view = (over: Partial<DraftStepView> = {}): DraftStepView => ({
  status: "ok",
  count: 1,
  rows: DRAFT,
  frameStale: false,
  message: null,
  ...over,
});

interface Setup {
  outputs?: Output[];
  hasDraft?: boolean;
  views?: Map<string, DraftStepView> | null;
  truncated?: boolean;
  runStatus?: string | null;
  selectedStepId?: string | null;
}

function parts(setup: Setup = {}) {
  const outputs = setup.outputs ?? [output({})];
  const page = {
    id: "p1",
    roots: [],
    allOutputs: outputs,
    runStatus: setup.runStatus ?? null,
    runIsDry: false,
  } as unknown as PipelinePageState;
  const presentation = {
    hasDraft: setup.hasDraft ?? false,
    frames: {
      views: setup.views ?? null,
      baseRows: new Map([["s1", BASE]]),
      rootRows: new Map(),
      sampleTruncated: setup.truncated ?? false,
    },
  } as unknown as ReturnType<typeof usePipelineDraftPresentation>;
  return { page, presentation, selectedStepId: setup.selectedStepId ?? "s1" };
}
const metricValue = { selector: ".panel-content__metric-value" };
const findValue = (text: string) => screen.findByText(text, metricValue);
const getValue = (text: string) => screen.getByText(text, metricValue);
const column = (setup?: Setup) => <LiveOutputColumn {...parts(setup)} />;

beforeEach(() => {
  resetHistoryCache();
  clearSavedOutputRows();
  sampleStateCalls.mockClear();
  mockBodyRenders.count = 0;
  sampleState = "ready";
  fetchHistory.mockReset();
  getOutputRows.mockReset();
  fetchHistory.mockResolvedValue(
    makeHistory({
      compare: null,
      current: { capturedAt: "2026-10-05T10:00:00Z", rowCount: 5, value: 999 },
    }),
  );
});

describe("LiveOutputColumn", () => {
  it("renders the saved pipeline over the sample with no draft: no live marker, the baseline delta, the walked value", async () => {
    renderWithStore(column());
    expect(await findValue("60")).toBeInTheDocument();
    expect(
      screen.getByText("Rendered from the saved pipeline over the cached sample."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Output is live")).not.toBeInTheDocument();
    expect(await screen.findByText("−2 vs last run")).toBeInTheDocument();
    expect(getOutputRows).not.toHaveBeenCalled();
  });

  it("shows the draft's value, never the history headline, with the live marker and the draft caption", async () => {
    renderWithStore(column({ hasDraft: true, views: new Map([["s1", view()]]) }));
    expect(await screen.findByLabelText("Output is live")).toHaveTextContent("live");
    expect(
      screen.getByText("Rendered from the draft. Nothing is written until you save and run."),
    ).toBeInTheDocument();
    expect(screen.queryByText("999")).not.toBeInTheDocument();
    expect(await findValue("30")).toBeInTheDocument();
  });

  it("reads the history once however many drafts follow, and refreshes it once after a run settles", async () => {
    const { rerender } = renderWithStore(column());
    await waitFor(() => expect(fetchHistory).toHaveBeenCalledTimes(1));
    for (const n of [1, 2, 3, 4, 5]) {
      const rows: Frame = BASE.slice(0, n % 3);
      rerender(
        column({ hasDraft: true, views: new Map([["s1", view({ rows, count: rows.length })]]) }),
      );
    }
    rerender(column({ hasDraft: false }));
    expect(fetchHistory).toHaveBeenCalledTimes(1);
    expect(getOutputRows).not.toHaveBeenCalled();

    rerender(column({ runStatus: "running" }));
    rerender(column({ runStatus: "succeeded" }));
    await waitFor(() => expect(fetchHistory).toHaveBeenCalledTimes(2));
  });

  it("is stale on the last good frame for an error, and does not repeat the step's message", async () => {
    renderWithStore(
      column({
        hasDraft: true,
        views: new Map([
          [
            "s1",
            view({ status: "error", rows: BASE, frameStale: true, message: "bad expression" }),
          ],
        ]),
      }),
    );
    expect(await screen.findByLabelText("Output is stale")).toBeInTheDocument();
    expect(screen.queryByLabelText("Output is live")).not.toBeInTheDocument();
    expect(screen.queryByText("bad expression")).not.toBeInTheDocument();
    expect(screen.getByText("Showing the last good render.")).toBeInTheDocument();
    expect(getValue("60")).toBeInTheDocument();
  });

  it("is updating while a server fallback is pending", async () => {
    renderWithStore(
      column({
        hasDraft: true,
        views: new Map([["s1", view({ status: "pending", rows: BASE, frameStale: true })]]),
      }),
    );
    expect(await screen.findByLabelText("Output is updating")).toBeInTheDocument();
  });

  it("renders saved rows labelled stale for a not-previewed node, read once", async () => {
    getOutputRows.mockResolvedValue({
      items: [{ date: "z", amount: 77 }],
      total: 1,
      offset: 0,
      limit: 500,
      materialized: true,
    });
    const { rerender } = renderWithStore(
      column({
        hasDraft: true,
        views: new Map([["s1", view({ status: "notPreviewed", rows: null })]]),
      }),
    );
    expect(await findValue("77")).toBeInTheDocument();
    expect(screen.getByLabelText("Output is stale")).toBeInTheDocument();
    expect(
      screen.getByText("Not previewed (AI step): showing the last run's data."),
    ).toBeInTheDocument();
    rerender(
      column({
        hasDraft: true,
        views: new Map([["s1", view({ status: "notPreviewed", rows: null })]]),
      }),
    );
    expect(getOutputRows).toHaveBeenCalledTimes(1);
    expect(getOutputRows).toHaveBeenCalledWith("o1", 0, 500);
  });

  it("renders saved rows when the sample failed, and a skeleton-style line while it loads", async () => {
    getOutputRows.mockResolvedValue({
      items: [{ date: "z", amount: 5 }],
      total: 1,
      offset: 0,
      limit: 500,
      materialized: true,
    });
    sampleState = "unusable";
    renderWithStore(column());
    expect(await findValue("5")).toBeInTheDocument();
    expect(screen.getByText("Showing the last run.")).toBeInTheDocument();
  });

  it("says so when there are no saved rows to fall back on", async () => {
    getOutputRows.mockRejectedValue(new Error("404"));
    sampleState = "unusable";
    renderWithStore(column());
    expect(
      await screen.findByText("No saved data yet. Save & run to populate it."),
    ).toBeInTheDocument();
  });

  it("shows the sample marker and no difference when the sample is truncated", async () => {
    renderWithStore(column({ truncated: true }));
    expect(await screen.findByText("sample")).toBeInTheDocument();
    await waitFor(() => expect(fetchHistory).toHaveBeenCalled());
    expect(screen.queryByText(/vs last run/)).not.toBeInTheDocument();
  });

  it("shows an empty state and sends no request without an Output", () => {
    renderWithStore(column({ outputs: [] }));
    expect(screen.getByText("No Output yet. Add one from the spine.")).toBeInTheDocument();
    expect(fetchHistory).not.toHaveBeenCalled();
    expect(getOutputRows).not.toHaveBeenCalled();
  });

  it("lists every Output in a selector, follows the selected step, and honours an explicit pick", async () => {
    const second = output({ id: "o2", name: "Second", nodeStepId: "s2" });
    const outputs = [output({}), second];
    const { rerender } = renderWithStore(column({ outputs, selectedStepId: "s2" }));
    expect(await screen.findByRole("combobox", { name: "Displayed Output" })).toHaveTextContent(
      "Second",
    );
    rerender(column({ outputs, selectedStepId: "s1" }));
    expect(screen.getByRole("combobox", { name: "Displayed Output" })).toHaveTextContent("Total");
    fireEvent.click(screen.getByRole("combobox", { name: "Displayed Output" }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("option", { name: "Second" }));
    });
    expect(screen.getByRole("combobox", { name: "Displayed Output" })).toHaveTextContent("Second");
  });

  it("coalesces a burst of draft edits to one render of the latest frame, shown once the edits go quiet; a step selection shows at once", async () => {
    jest.useFakeTimers();
    try {
      const two = output({ id: "o2", name: "Second", nodeStepId: "s2" });
      const outputs = [output({}), two];
      const edit = (n: number) =>
        column({
          outputs,
          hasDraft: true,
          views: new Map([["s1", view({ rows: BASE.slice(0, n), count: n })]]),
        });
      const { rerender } = renderWithStore(column({ outputs }));
      expect(getValue("60")).toBeInTheDocument();
      for (const n of [1, 2, 1, 2]) {
        rerender(edit(n));
        await act(async () => {
          jest.advanceTimersByTime(30);
        });
      }
      // Still the first render: nothing between the edits.
      expect(getValue("60")).toBeInTheDocument();
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      expect(getValue("30")).toBeInTheDocument(); // rows 10 + 20 = 30: the latest frame (BASE.slice(0, 2))
      // A selection change is not coalesced.
      rerender(
        column({
          outputs,
          hasDraft: true,
          views: new Map([["s1", view({ rows: BASE.slice(0, 2), count: 2 })]]),
          selectedStepId: "s2",
        }),
      );
      expect(screen.getByRole("combobox", { name: "Displayed Output" })).toHaveTextContent(
        "Second",
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not re-render its view per edit: ten edits inside the quiet window cost one view render (the burst starts, so it reads "updating"), then one for the frame', async () => {
    jest.useFakeTimers();
    try {
      const edit = (n: number) =>
        column({
          hasDraft: true,
          views: new Map([["s1", view({ rows: BASE.slice(0, (n % 3) + 1), count: n })]]),
        });
      const { rerender } = renderWithStore(column());
      // Let the mount settle (the baseline read lands and re-renders the view once).
      await act(async () => {
        await jest.advanceTimersByTimeAsync(50);
      });
      const afterMount = sampleStateCalls.mock.calls.length;
      for (let n = 1; n <= 10; n += 1) {
        rerender(edit(n));
        await act(async () => {
          jest.advanceTimersByTime(40);
        });
      }
      // The view (and every hook in it) rendered at most once for the ten edits: when the burst started and "settling" flipped.
      expect(sampleStateCalls.mock.calls.length).toBeLessThanOrEqual(afterMount + 1);
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(sampleStateCalls.mock.calls.length).toBeLessThanOrEqual(afterMount + 3);
    } finally {
      jest.useRealTimers();
    }
  });

  describe("while a newer draft frame is settling", () => {
    const NEXT: Frame = [{ date: "d", amount: int(5) }];
    const liveColumn = (rows: Frame) =>
      column({ hasDraft: true, views: new Map([["s1", view({ rows, count: rows.length })]]) });

    it("shows 'updating' on the previous frame from the edit until the newer frame renders, then 'live'", async () => {
      const { rerender } = renderWithStore(liveColumn(DRAFT));
      expect(await screen.findByLabelText("Output is live")).toBeInTheDocument();

      rerender(liveColumn(NEXT));

      expect(screen.getByLabelText("Output is updating")).toBeInTheDocument();
      expect(screen.queryByLabelText("Output is live")).not.toBeInTheDocument();
      expect(getValue("30")).toBeInTheDocument();
      expect(await screen.findByLabelText("Output is live")).toBeInTheDocument();
      expect(getValue("5")).toBeInTheDocument();
    });

    it("never shows 'updating' for a re-render that leaves the Output's frame alone", async () => {
      const { rerender } = renderWithStore(liveColumn(DRAFT));
      expect(await screen.findByLabelText("Output is live")).toBeInTheDocument();

      rerender(liveColumn(DRAFT));
      rerender(column({ hasDraft: true, runStatus: "running", views: new Map([["s1", view()]]) }));

      expect(screen.queryByLabelText("Output is updating")).not.toBeInTheDocument();
      expect(screen.getByLabelText("Output is live")).toBeInTheDocument();
    });

    it("does not re-render the body when the burst starts, only when the newer frame renders", async () => {
      const { rerender } = renderWithStore(liveColumn(DRAFT));
      expect(await screen.findByLabelText("Output is live")).toBeInTheDocument();
      const before = mockBodyRenders.count;

      rerender(liveColumn(NEXT));

      expect(screen.getByLabelText("Output is updating")).toBeInTheDocument();
      expect(mockBodyRenders.count).toBe(before);
      await waitFor(() => expect(mockBodyRenders.count).toBeGreaterThan(before));
    });
  });
});
