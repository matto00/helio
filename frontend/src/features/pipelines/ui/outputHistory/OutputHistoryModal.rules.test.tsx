import { screen } from "@testing-library/react";

import { renderWithStore } from "../../../../test/renderWithStore";
import * as service from "../../../panels/history/outputHistoryService";
import type { HistoryPoint, OutputHistory } from "../../../panels/history/outputHistoryService";
import type { Output } from "../../types/output";
import { OutputHistoryModal } from "./OutputHistoryModal";

// HEL-1490 item 5 -- the history rows table applies the Output's CURRENT conditional-format rules.
jest.mock("../../../panels/history/outputHistoryService", () => ({
  fetchOutputHistory: jest.fn(),
  fetchHistoryPointRows: jest.fn(),
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

function makeOutput(kind: string, config: Record<string, unknown>): Output {
  return {
    id: "out-1",
    pipelineId: "pipe-1",
    ownerId: "u1",
    name: "Runs",
    kind,
    config,
    schema: [],
    createdAt: "",
    updatedAt: "",
  } as Output;
}

function pt(id: string, capturedAt: string): HistoryPoint {
  return {
    id,
    hasPayload: true,
    capturedAt,
    runId: `run-${id}`,
    triggerSource: "manual",
    rowCount: 2,
    summary: { v: 1 },
  };
}

function renderHistory(output: Output, newRows: unknown[], oldRows?: unknown[]) {
  const points = oldRows
    ? [pt("a", "2026-10-05T14:02:00Z"), pt("b", "2026-10-04T09:30:00Z")]
    : [pt("a", "2026-10-05T14:02:00Z")];
  const h: OutputHistory = {
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
  fetchHistory.mockResolvedValue(h);
  fetchRows.mockImplementation(async (_o, id) => {
    const rows = (id === "a" ? newRows : oldRows) as Record<string, unknown>[];
    return { rows, rowCount: rows.length };
  });
  return renderWithStore(<OutputHistoryModal output={output} onClose={jest.fn()} />);
}

beforeEach(() => {
  fetchHistory.mockReset();
  fetchRows.mockReset();
});

const cellRule = { op: "gt", value: 600, tone: "warning", column: "duration_s", target: "cell" };
const rowRule = { op: "gt", value: 600, tone: "error", column: "duration_s", target: "row" };

describe("History rows apply conditional formats (HEL-1490)", () => {
  it("colours a table cell by its raw value, with glyph and accessible text", async () => {
    renderHistory(makeOutput("table", { conditionalFormats: [cellRule] }), [
      { duration_s: 900 },
      { duration_s: 10 },
    ]);
    const hot = (await screen.findByText("900")).closest("td");
    expect(hot).toHaveClass("ui-data-grid__cell--tone-warning");
    expect(hot).toHaveTextContent("Warning");
    expect(screen.getByText("10").closest("td")).not.toHaveClass(
      "ui-data-grid__cell--tone-warning",
    );
  });

  it("applies a row rule and keeps the changed-row highlight on the same row", async () => {
    renderHistory(
      makeOutput("table", { conditionalFormats: [rowRule] }),
      [{ duration_s: 900 }, { duration_s: 10 }],
      [{ duration_s: 10 }],
    );
    const tr = (await screen.findByText("900")).closest("tr");
    expect(tr).toHaveClass("ui-data-grid__row--tone-error");
    expect(tr).toHaveClass("output-history__row--changed");
    expect(tr).toHaveTextContent("New or changed");
  });

  it("marks the Change cell of a ruled Output so the accent wash can win there", async () => {
    renderHistory(
      makeOutput("table", { conditionalFormats: [rowRule] }),
      [{ duration_s: 900 }],
      [{ duration_s: 10 }],
    );
    const change = (await screen.findByText("New or changed")).closest("td");
    expect(change).toHaveClass("output-history__change-cell");
  });

  it("leaves the Change cell unclassed when the Output has no rules", async () => {
    renderHistory(makeOutput("table", {}), [{ duration_s: 900 }], [{ duration_s: 10 }]);
    const change = (await screen.findByText("New or changed")).closest("td");
    expect(change).not.toHaveClass("output-history__change-cell");
  });

  it("evaluates a collection's rules against its mapped value column", async () => {
    renderHistory(
      makeOutput("collection", {
        fieldMapping: { value: "score" },
        conditionalFormats: [{ op: "lt", value: 50, tone: "error" }],
      }),
      [
        { name: "a", score: 20 },
        { name: "b", score: 80 },
      ],
    );
    const low = (await screen.findByText("20")).closest("td");
    expect(low).toHaveClass("ui-data-grid__cell--tone-error");
    expect(low).toHaveTextContent("Critical");
    expect(screen.getByText("80").closest("td")).not.toHaveClass("ui-data-grid__cell--tone-error");
    expect(screen.getByText("a").closest("td")).not.toHaveClass("ui-data-grid__cell--tone-error");
  });

  it("does not colour a metric Output's stored rows", async () => {
    renderHistory(
      makeOutput("metric", {
        fieldMapping: { value: "duration_s" },
        conditionalFormats: [{ op: "gt", value: 600, tone: "error" }],
      }),
      [{ duration_s: 900 }],
    );
    const cell = (await screen.findByText("900")).closest("td");
    expect(cell?.className ?? "").not.toMatch(/tone/);
    expect(cell?.closest("tr")?.className ?? "").not.toMatch(/tone/);
  });

  it("renders a no-rules Output with no tone classes", async () => {
    renderHistory(makeOutput("table", {}), [{ duration_s: 900 }]);
    const cell = (await screen.findByText("900")).closest("td");
    expect(cell?.className ?? "").not.toMatch(/tone/);
  });
});
