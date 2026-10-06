import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { renderWithStore } from "../../../../test/renderWithStore";
import * as service from "../../../panels/history/outputHistoryService";
import type {
  HistoryPoint,
  HistorySeries,
  OutputHistory,
} from "../../../panels/history/outputHistoryService";
import type { ChartOverlay } from "../../../panels/history/chartOverlay";
import type { Output } from "../../types/output";
import { OutputHistoryModal } from "./OutputHistoryModal";

jest.mock("../../../panels/history/outputHistoryService", () => ({
  fetchOutputHistory: jest.fn(),
  fetchHistoryPointRows: jest.fn(),
}));

// ChartPanel loads echarts lazily; capture the overlay `ChartRenderer` is handed instead.
const overlays: Array<ChartOverlay | null | undefined> = [];
jest.mock("../../../panels/ui/renderers/ChartRenderer", () => ({
  ChartRenderer: ({ overlay }: { overlay?: ChartOverlay | null }) => {
    overlays.push(overlay);
    return <div data-testid="history-chart">{overlay ? overlay.label : "no-overlay"}</div>;
  },
}));

const fetchHistory = jest.mocked(service.fetchOutputHistory);
const fetchRows = jest.mocked(service.fetchHistoryPointRows);

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

function makeOutput(overrides: Partial<Output> = {}): Output {
  return {
    id: "out-1",
    pipelineId: "pipe-1",
    ownerId: "u1",
    name: "Orders",
    kind: "table",
    config: {},
    schema: [],
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

const NEW_AT = "2026-10-05T14:02:00Z";
const OLD_AT = "2026-10-04T09:30:00Z";
const OLDEST_AT = "2026-10-03T08:00:00Z";

function point(
  id: string,
  capturedAt: string,
  overrides: Partial<HistoryPoint> = {},
  summary: HistoryPoint["summary"] = {},
): HistoryPoint {
  return {
    id,
    hasPayload: false,
    capturedAt,
    runId: `run-${id}`,
    triggerSource: "manual",
    rowCount: 2,
    summary: { v: 1, ...summary },
    ...overrides,
  };
}

function history(points: HistoryPoint[]): OutputHistory {
  return {
    outputId: "out-1",
    compare: null,
    current: null,
    baseline: null,
    delta: null,
    pct: null,
    availableFrom: null,
    sparkline: [],
    points,
  };
}

function render(points: HistoryPoint[], output: Output = makeOutput()) {
  fetchHistory.mockResolvedValue(history(points));
  return renderWithStore(<OutputHistoryModal output={output} onClose={jest.fn()} />);
}

function scrubTo(valueFromOldest: number) {
  fireEvent.change(screen.getByRole("slider", { name: "Recorded runs" }), {
    target: { value: String(valueFromOldest) },
  });
}

beforeEach(() => {
  overlays.length = 0;
  fetchHistory.mockReset();
  fetchRows.mockReset();
});

describe("OutputHistoryModal (HEL-1277)", () => {
  it("opens against the Output's history route with limit 100", async () => {
    render([point("a", NEW_AT)]);
    await screen.findByRole("slider", { name: "Recorded runs" });
    expect(fetchHistory).toHaveBeenCalledWith("out-1", { limit: 100 });
  });

  it("renders an EmptyState when no runs are recorded (and no 'previous' copy)", async () => {
    render([]);
    expect(await screen.findByText("No runs recorded for this Output yet")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/previous run/i);
  });

  it("renders a visible error when the history request fails", async () => {
    fetchHistory.mockRejectedValue(new Error("boom"));
    renderWithStore(<OutputHistoryModal output={makeOutput()} onClose={jest.fn()} />);
    expect(await screen.findByText("Couldn't load this Output's history.")).toBeInTheDocument();
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("selects the newest point by default and shows its row count and trigger", async () => {
    render([
      point("a", NEW_AT, { rowCount: 3, triggerSource: "auto-run" }),
      point("b", OLD_AT),
      point("c", OLDEST_AT),
    ]);
    const slider = await screen.findByRole("slider", { name: "Recorded runs" });
    expect(slider).toHaveValue("2");
    expect(screen.getByText("3 rows")).toBeInTheDocument();
    expect(screen.getByText("Auto-run")).toBeInTheDocument();
  });

  it("scrubbing older selects the next-older point and updates the summary", async () => {
    render([
      point("a", NEW_AT, { rowCount: 3 }),
      point("b", OLD_AT, { rowCount: 7, triggerSource: "scheduled" }),
    ]);
    await screen.findByText("3 rows");
    scrubTo(0);
    expect(await screen.findByText("7 rows")).toBeInTheDocument();
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Newer run" }));
    expect(await screen.findByText("3 rows")).toBeInTheDocument();
  });

  it("labels the comparison by capture time and has none for the oldest point", async () => {
    render([point("a", NEW_AT), point("b", OLD_AT)]);
    await screen.findByRole("slider");
    expect(screen.getByText(/^vs .*\d/)).toBeInTheDocument();
    scrubTo(0);
    await waitFor(() => expect(screen.queryByText(/^vs .*\d/)).toBeNull());
    expect(screen.getByText(/nothing to compare against/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/previous run/i);
  });

  it("shows the headline metric beside the comparison's and the per-column stats", async () => {
    const stats = { amount: { count: 2, sum: 30, min: 10, max: 20 } };
    render(
      [
        point(
          "a",
          NEW_AT,
          {},
          { metric: { field: "amount", agg: "sum", value: 30 }, columns: stats },
        ),
        point("b", OLD_AT, {}, { metric: { field: "amount", agg: "sum", value: 25 } }),
      ],
      makeOutput({ kind: "metric", config: { format: "integer" } }),
    );
    await screen.findByText("amount");
    expect(document.querySelector(".output-history__metric-value")).toHaveTextContent("30");
    expect(screen.getByText(/: 25$/)).toBeInTheDocument();
    expect(screen.getByText("amount")).toBeInTheDocument();
  });

  describe("rows and the changed-rows diff", () => {
    it("summary-only points request no rows, highlight nothing, and say rows weren't stored", async () => {
      render([point("a", NEW_AT), point("b", OLD_AT)]);
      expect(await screen.findByText(/Rows weren.t stored for this run/)).toBeInTheDocument();
      expect(fetchRows).not.toHaveBeenCalled();
      expect(screen.queryByText("New or changed")).toBeNull();
      expect(screen.queryByText(/no longer present/)).toBeNull();
    });

    it("highlights new-or-changed rows, counts rows no longer present, and survives a sort", async () => {
      fetchRows.mockImplementation(async (_o, pointId) =>
        pointId === "a"
          ? { rows: [{ a: 1 }, { a: 3 }], rowCount: 2 }
          : { rows: [{ a: 1 }, { a: 2 }], rowCount: 2 },
      );
      render([point("a", NEW_AT, { hasPayload: true }), point("b", OLD_AT, { hasPayload: true })]);

      const flagged = await screen.findByText("New or changed");
      expect(screen.getAllByText("New or changed")).toHaveLength(1);
      expect(flagged.closest("tr")).toHaveTextContent("3");
      expect(screen.getByText(/1 row from .* no longer present/)).toBeInTheDocument();

      // Sort by the data column (descending): the same row stays flagged.
      const sortBtn = screen.getByRole("button", { name: "a" });
      fireEvent.click(sortBtn);
      fireEvent.click(sortBtn);
      expect(screen.getAllByText("New or changed")).toHaveLength(1);
      expect(screen.getByText("New or changed").closest("tr")).toHaveTextContent("3");
      // The Change column itself is inert: no sort control.
      expect(screen.queryByRole("button", { name: /Change/ })).toBeNull();
    });

    it("never reads a missing comparison payload as removed rows", async () => {
      fetchRows.mockResolvedValue({ rows: [{ a: 1 }], rowCount: 1 });
      render([point("a", NEW_AT, { hasPayload: true }), point("b", OLD_AT, { hasPayload: false })]);
      expect(await screen.findByText(/Row comparison unavailable/)).toBeInTheDocument();
      expect(screen.queryByText("New or changed")).toBeNull();
      expect(screen.queryByText(/no longer present/)).toBeNull();
      expect(fetchRows).toHaveBeenCalledTimes(1);
      expect(fetchRows).toHaveBeenCalledWith("out-1", "a");
    });

    it("a failed payload fetch shows an error and disables the diff", async () => {
      fetchRows.mockRejectedValue(new Error("nope"));
      render([point("a", NEW_AT, { hasPayload: true }), point("b", OLD_AT, { hasPayload: true })]);
      expect(await screen.findByText(/Couldn.t load the stored rows/)).toBeInTheDocument();
      expect(screen.queryByText("New or changed")).toBeNull();
      expect(screen.queryByText(/no longer present/)).toBeNull();
    });

    it("a failed comparison-payload fetch reports a load error, never 'rows weren't stored'", async () => {
      fetchRows.mockImplementation(async (_o, pointId) => {
        if (pointId === "b") throw new Error("500");
        return { rows: [{ a: 1 }], rowCount: 1 };
      });
      render([point("a", NEW_AT, { hasPayload: true }), point("b", OLD_AT, { hasPayload: true })]);
      const alert = await screen.findByText(/Couldn.t load the stored rows from .* to compare/);
      expect(alert).toHaveAttribute("role", "alert");
      expect(screen.queryByText(/weren.t stored/)).toBeNull();
      expect(screen.queryByText("New or changed")).toBeNull();
      expect(screen.queryByText(/no longer present/)).toBeNull();
    });

    it("shows no pin control for any point, so it never appears while scrubbing", async () => {
      fetchRows.mockResolvedValue({ rows: [{ a: 1 }], rowCount: 1 });
      render([point("a", NEW_AT, { hasPayload: true }), point("b", OLD_AT, { hasPayload: true })]);
      await screen.findByText("a", { selector: "th *, th" });
      expect(screen.queryByRole("button", { name: /^Pin/ })).toBeNull();
      scrubTo(0);
      await waitFor(() => expect(screen.queryByText(/^vs /)).toBeNull());
      expect(screen.queryByRole("button", { name: /^Pin/ })).toBeNull();
    });

    it("adds seconds to both labels when the two runs share a minute", async () => {
      render([point("a", "2026-10-05T14:02:40Z"), point("b", "2026-10-05T14:02:10Z")]);
      await screen.findByRole("slider");
      const caption = screen.getByText(/^vs /);
      expect(caption.textContent).toMatch(/:10/);
      expect(document.querySelector(".output-history__point-time")?.textContent).toMatch(/:40/);
    });

    it("ignores a late payload for a point that is no longer selected", async () => {
      let resolveA: (v: { rows: Record<string, unknown>[]; rowCount: number }) => void = () => {};
      fetchRows.mockImplementation((_o, pointId) =>
        pointId === "a"
          ? new Promise((resolve) => {
              resolveA = resolve;
            })
          : Promise.resolve({ rows: [{ marker: "from-b" }], rowCount: 1 }),
      );
      render([
        point("a", NEW_AT, { hasPayload: true }),
        point("b", OLD_AT, { hasPayload: true }),
        point("c", OLDEST_AT),
      ]);
      await screen.findByRole("slider");
      scrubTo(1); // select b while a's payload is still in flight
      expect(await screen.findByText("from-b")).toBeInTheDocument();
      await act(async () => {
        resolveA({ rows: [{ marker: "from-a" }], rowCount: 1 });
      });
      expect(screen.getByText("from-b")).toBeInTheDocument();
      expect(screen.queryByText("from-a")).toBeNull();
    });
  });

  describe("chart Outputs", () => {
    const base: HistorySeries = {
      mode: "rows",
      x: "day",
      y: "revenue",
      agg: null,
      points: [
        ["Mon", 1],
        ["Tue", 2],
      ],
      totalPoints: 2,
      downsampled: false,
    };
    const chartOutput = makeOutput({ kind: "chart", config: { chartType: "line" } });

    it("draws the point's series with a labelled overlay from the next-older point", async () => {
      render(
        [
          point("a", NEW_AT, {}, { series: base }),
          point("b", OLD_AT, {}, { series: { ...base, points: [["Mon", 5]] } }),
        ],
        chartOutput,
      );
      const chart = await screen.findByTestId("history-chart");
      expect(chart.textContent).toMatch(/^vs /);
      expect(overlays.at(-1)?.points).toEqual([["Mon", 5]]);
    });

    it("draws no overlay when the comparison series plots a different y", async () => {
      render(
        [
          point("a", NEW_AT, {}, { series: base }),
          point("b", OLD_AT, {}, { series: { ...base, y: "cost" } }),
        ],
        chartOutput,
      );
      expect((await screen.findByTestId("history-chart")).textContent).toBe("no-overlay");
      expect(overlays.every((o) => o == null)).toBe(true);
    });

    it("draws no overlay for the oldest point", async () => {
      render([point("a", NEW_AT, {}, { series: base })], chartOutput);
      expect((await screen.findByTestId("history-chart")).textContent).toBe("no-overlay");
    });
  });

  it("never renders 'previous run' copy anywhere in the populated view", async () => {
    render([point("a", NEW_AT), point("b", OLD_AT)]);
    await screen.findByRole("slider");
    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(within(dialog).queryByText(/previous run/i)).toBeNull();
    expect(document.body.textContent).not.toMatch(/previous run/i);
  });
});
