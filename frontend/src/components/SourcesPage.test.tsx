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

  it("renders the Data Sources section heading", () => {
    renderWithStore(<SourcesPage />);
    expect(screen.getByRole("heading", { name: "Data Sources" })).toBeInTheDocument();
  });

  it("renders the empty-state message when no sources exist", async () => {
    // The Add button moved to the sidebar (SidebarItemList's onAdd "+"). The
    // page itself now only renders the detail panel for the selected source
    // OR an empty-state nudge pointing the user at the sidebar.
    renderWithStore(<SourcesPage />);
    expect(await screen.findByText(/No data sources yet/i)).toBeInTheDocument();
  });

  it("does not dispatch fetchDataTypes on mount", async () => {
    renderWithStore(<SourcesPage />);
    await screen.findByText(/No data sources yet/i);
    expect(fetchDataTypesMock).not.toHaveBeenCalled();
  });
});
