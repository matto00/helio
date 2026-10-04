import { fireEvent, screen, waitFor } from "@testing-library/react";

import { fetchSourceReferences as fetchSourceReferencesRequest } from "../services/dataSourceService";
import { renderWithStore } from "../../../test/renderWithStore";
import type { DataSource } from "../types/dataSource";
import { EmptySchemaAffordance } from "./EmptySchemaAffordance";

jest.mock("../services/dataSourceService", () => ({
  fetchSources: jest.fn().mockResolvedValue([]),
  fetchSourceReferences: jest.fn().mockResolvedValue([]),
  deleteSource: jest.fn(),
  refreshSource: jest.fn(),
}));

const fetchSourceReferencesMock = jest.mocked(fetchSourceReferencesRequest);

const source = {
  id: "src-1",
  name: "Sales CSV",
  type: "csv",
  createdAt: "2026-05-01T00:00:00Z",
  updatedAt: "2026-05-01T00:00:00Z",
  inferredSchema: [],
  config: { path: "csv/src-1.csv" },
} as DataSource;

describe("EmptySchemaAffordance delete warning (HEL-1258)", () => {
  beforeEach(() => {
    fetchSourceReferencesMock.mockReset();
    fetchSourceReferencesMock.mockResolvedValue([]);
  });

  it("warns from the server summary for a source referenced only by a form panel, with no pipelines loaded", async () => {
    // The mount-time refresh replaces the preloaded summary, so the mock answers with the same one.
    fetchSourceReferencesMock.mockResolvedValue([
      {
        sourceId: "src-1",
        pipelines: [],
        panels: [{ id: "pn", title: "Entry", dashboardId: "d", dashboardName: "Ops" }],
        hiddenPipelineCount: 0,
        hiddenPanelCount: 0,
      },
    ]);
    renderWithStore(<EmptySchemaAffordance source={source} />, {
      sources: { items: [source], status: "succeeded" },
    });
    await waitFor(() => expect(fetchSourceReferencesMock).toHaveBeenCalled());
    await Promise.resolve();
    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));
    expect(screen.getByText(/1 form panel references this source/)).toBeInTheDocument();
  });

  it("shows only the plain confirm when the summary lists no reference", () => {
    renderWithStore(<EmptySchemaAffordance source={source} />, {
      sources: { items: [source], status: "succeeded", referencesStatus: "succeeded" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));
    expect(screen.getByText('Delete "Sales CSV"?')).toBeInTheDocument();
    expect(screen.queryByText(/reference/)).not.toBeInTheDocument();
  });
});
