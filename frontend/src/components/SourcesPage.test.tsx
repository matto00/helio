import { screen, waitFor } from "@testing-library/react";

import { fetchSources as fetchSourcesRequest } from "../services/dataSourceService";
import { fetchDataTypes as fetchDataTypesRequest } from "../services/dataTypeService";
import { renderWithStore } from "../test/renderWithStore";
import { SourcesPage } from "./SourcesPage";

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

describe("SourcesPage", () => {
  beforeEach(() => {
    fetchSourcesMock.mockResolvedValue([]);
    fetchDataTypesMock.mockResolvedValue([]);
  });

  it("renders the Data Sources section heading", () => {
    renderWithStore(<SourcesPage />);
    expect(screen.getByRole("heading", { name: "Data Sources" })).toBeInTheDocument();
  });

  it("renders Add source button", () => {
    renderWithStore(<SourcesPage />);
    expect(screen.getByRole("button", { name: "Add source" })).toBeInTheDocument();
  });

  it("shows empty state message for sources when there are none", async () => {
    renderWithStore(<SourcesPage />);
    await waitFor(() =>
      expect(screen.getByText("No data sources yet. Add one to get started.")).toBeInTheDocument(),
    );
  });

  it("shows empty state CTA button for data sources", async () => {
    renderWithStore(<SourcesPage />);
    const ctaBtn = await screen.findByRole("button", { name: "Add a data source" });
    expect(ctaBtn).toBeInTheDocument();
  });

  it("does not dispatch fetchDataTypes on mount", async () => {
    renderWithStore(<SourcesPage />);
    await screen.findByRole("button", { name: "Add a data source" });
    expect(fetchDataTypesMock).not.toHaveBeenCalled();
  });
});
