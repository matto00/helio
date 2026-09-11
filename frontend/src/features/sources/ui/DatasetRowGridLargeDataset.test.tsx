import { fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { DatasetRowGrid } from "./DatasetRowGrid";
import { DATASET_GRID_PAGE_SIZE } from "../state/datasetRowsSlice";
import {
  fetchDatasetSchema as fetchDatasetSchemaRequest,
  fetchSourceRows as fetchSourceRowsRequest,
} from "../services/dataSourceService";
import type { DatasetSchemaResponse, RowResponseRow } from "../types/dataSource";

jest.mock("../services/dataSourceService", () => ({
  fetchDatasetSchema: jest.fn(),
  fetchSourceRows: jest.fn(),
  patchSourceRow: jest.fn(),
  deleteSourceRow: jest.fn(),
  appendSourceRows: jest.fn(),
}));

const fetchDatasetSchemaMock = jest.mocked(fetchDatasetSchemaRequest);
const fetchSourceRowsMock = jest.mocked(fetchSourceRowsRequest);

const sourceId = "src-1";
const schema: DatasetSchemaResponse = {
  fields: [{ name: "name", type: "string", required: false }],
};

// HEL-1080 tasks.md 5.7 (design.md Decision 9, evaluation-1.md CR4): a real measurement over the
// maximum row count (`DataSourceService.staticMaxRows = 500`), not an assumption that "paging
// exists" is sufficient -- asserts every request carries an explicit `limit`/`cursor`, and the
// mounted DOM row count is a literal, asserted number that never exceeds the page size.
const TOTAL_ROWS = 500;

function pageOf(startSeq: number, count: number, cursor: number | undefined) {
  const rows: RowResponseRow[] = Array.from({ length: count }, (_, i) => ({
    id: `r${startSeq + i}`,
    seq: startSeq + i,
    updatedAt: "2026-01-01T00:00:00Z",
    data: [`row-${startSeq + i}`],
  }));
  const nextSeq = startSeq + count;
  return {
    rows,
    total: TOTAL_ROWS,
    nextCursor: nextSeq < TOTAL_ROWS ? nextSeq : undefined,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  fetchDatasetSchemaMock.mockResolvedValue(schema);
});

describe("DatasetRowGrid large-dataset measurement (tasks.md 5.7)", () => {
  it("requests exactly limit=100 on every page, a cursor param on every page after the first, and never mounts more than 100 rows across all 5 pages", async () => {
    // TOTAL_ROWS=500 at DATASET_GRID_PAGE_SIZE=100 is exactly 5 pages -- pin both constants so
    // this test fails loudly (not silently) if either changes.
    expect(DATASET_GRID_PAGE_SIZE).toBe(100);
    expect(TOTAL_ROWS / DATASET_GRID_PAGE_SIZE).toBe(5);

    fetchSourceRowsMock.mockImplementation(async (_sourceId, options) => {
      const cursor = options?.cursor;
      const startSeq = cursor ?? 0;
      return pageOf(startSeq, DATASET_GRID_PAGE_SIZE, cursor);
    });

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    await screen.findByText("row-0");

    // Page 1: no cursor param at all.
    expect(fetchSourceRowsMock).toHaveBeenCalledWith(sourceId, {
      cursor: undefined,
      limit: DATASET_GRID_PAGE_SIZE,
    });

    const mountedRowCounts: number[] = [];
    const countMountedRows = () =>
      document.querySelectorAll(".ui-data-grid__table tbody tr").length; // excludes the <thead> header row

    mountedRowCounts.push(countMountedRows());

    for (let page = 2; page <= 5; page++) {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      await waitFor(() => expect(screen.getByText(`Page ${page}`)).toBeInTheDocument());
      mountedRowCounts.push(countMountedRows());
    }

    // Every page-2+ request carried an explicit cursor param.
    const cursorCalls = fetchSourceRowsMock.mock.calls.filter(
      ([, options]) => options?.cursor !== undefined,
    );
    expect(cursorCalls.length).toBeGreaterThanOrEqual(4);
    cursorCalls.forEach(([, options]) => {
      expect(options?.limit).toBe(DATASET_GRID_PAGE_SIZE);
    });

    // The measured, literal assertion: mounted DOM row count is <= 100 on every page, across all
    // 5 pages, and never grows page-over-page (it stays flat at exactly one page's worth).
    expect(mountedRowCounts).toHaveLength(5);
    mountedRowCounts.forEach((count) => expect(count).toBeLessThanOrEqual(DATASET_GRID_PAGE_SIZE));
    expect(new Set(mountedRowCounts).size).toBe(1); // does not grow while paging
  });
});
