import { fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { DatasetRowGrid } from "./DatasetRowGrid";
import {
  fetchDatasetSchema as fetchDatasetSchemaRequest,
  fetchSourceRows as fetchSourceRowsRequest,
} from "../services/dataSourceService";
import type { DatasetSchemaResponse, RowListResponse } from "../types/dataSource";

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
  fields: [{ name: "name", type: "string", required: true }],
};
const onePage = (rows: RowListResponse["rows"]): RowListResponse => ({
  rows,
  total: rows.length,
});

beforeEach(() => jest.clearAllMocks());

// HEL-1080 tasks.md 5.4: a validation error must be present in the ACCESSIBILITY TREE (via
// `role="alert"`/`aria-live`), not merely visually rendered -- Testing Library's `getByRole`
// query only finds elements that expose the role, which is what makes this a real a11y
// assertion rather than a visual-only text check.
describe("DatasetRowGrid screen-reader announcement (tasks.md 5.4)", () => {
  it("a required-field-emptied validation error is announced via role=alert + aria-live", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValue(
      onePage([{ id: "r1", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["Alice"] }]),
    );

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const cell = await screen.findByText("Alice");
    fireEvent.click(cell);
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Enter" });
    const editor = screen.getByDisplayValue("Alice");
    fireEvent.change(editor, { target: { value: "" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert).toHaveTextContent(/cannot be emptied/);
    expect(alert).toHaveAttribute("aria-live", "assertive");
  });
});
