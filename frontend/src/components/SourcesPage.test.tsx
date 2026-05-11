import { screen, waitFor } from "@testing-library/react";

import { fetchDataTypes as fetchDataTypesRequest } from "../services/dataTypeService";
import { renderWithStore } from "../test/renderWithStore";
import { SourcesPage } from "./SourcesPage";

jest.mock("../services/dataSourceService", () => ({
  fetchSources: jest.fn().mockResolvedValue([]),
  deleteSource: jest.fn(),
  refreshSource: jest.fn(),
  createRestSource: jest.fn(),
  createCsvSource: jest.fn(),
  inferFromJson: jest.fn(),
  inferFromCsv: jest.fn(),
  updateSource: jest.fn(),
}));

jest.mock("../services/dataTypeService", () => ({
  fetchDataTypes: jest.fn(),
  updateDataType: jest.fn(),
  deleteDataType: jest.fn(),
}));

const fetchDataTypesMock = jest.mocked(fetchDataTypesRequest);

describe("SourcesPage", () => {
  beforeEach(() => {
    fetchDataTypesMock.mockResolvedValue([]);
  });

  it("renders the page shell (heading lives in the top breadcrumb, not in-page)", () => {
    renderWithStore(<SourcesPage />);
    // The in-page section heading was removed because the top breadcrumb
    // already shows "Data Sources / <name>"; just verify the page mounts.
    expect(document.querySelector(".sources-page")).toBeInTheDocument();
  });

  it("renders the empty-state message when no sources exist", async () => {
    // The Add button moved to the sidebar (SidebarItemList's onAdd "+"). The
    // page itself now only renders the detail panel for the selected source
    // OR an empty-state nudge pointing the user at the sidebar.
    renderWithStore(<SourcesPage />);
    expect(await screen.findByText(/No data sources yet/i)).toBeInTheDocument();
  });

  it("dispatches fetchDataTypes on mount to populate the source schema preview", async () => {
    renderWithStore(<SourcesPage />);
    await screen.findByText(/No data sources yet/i);
    // The source detail panel renders its inferred-schema table from the
    // dataTypes slice, so the page warms the slice on mount.
    expect(fetchDataTypesMock).toHaveBeenCalled();
  });
});
