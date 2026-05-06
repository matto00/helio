import { screen, waitFor } from "@testing-library/react";

import { fetchSources as fetchSourcesRequest } from "../services/dataSourceService";
import { fetchDataTypes as fetchDataTypesRequest } from "../services/dataTypeService";
import { renderWithStore } from "../test/renderWithStore";
import { DataSourcesPage } from "./DataSourcesPage";

jest.mock("../services/dataSourceService", () => ({
  fetchSources: jest.fn(),
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

const fetchSourcesMock = jest.mocked(fetchSourcesRequest);
const fetchDataTypesMock = jest.mocked(fetchDataTypesRequest);

describe("DataSourcesPage", () => {
  beforeEach(() => {
    fetchSourcesMock.mockClear();
    fetchSourcesMock.mockResolvedValue([]);
    fetchDataTypesMock.mockClear();
    fetchDataTypesMock.mockResolvedValue([]);
  });

  it("renders the data source list section heading", () => {
    renderWithStore(<DataSourcesPage />);
    expect(screen.getByRole("heading", { name: "Data Sources" })).toBeInTheDocument();
  });

  it("renders the Add source button", () => {
    renderWithStore(<DataSourcesPage />);
    expect(screen.getByRole("button", { name: "Add source" })).toBeInTheDocument();
  });

  it("shows empty state message when there are no data sources", async () => {
    renderWithStore(<DataSourcesPage />);
    await waitFor(() =>
      expect(screen.getByText("No data sources yet. Add one to get started.")).toBeInTheDocument(),
    );
  });

  it("dispatches fetchSources and fetchDataTypes on mount", async () => {
    renderWithStore(<DataSourcesPage />);
    await waitFor(() => expect(fetchSourcesMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fetchDataTypesMock).toHaveBeenCalledTimes(1));
  });
});
