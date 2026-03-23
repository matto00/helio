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
}));

jest.mock("../services/dataTypeService", () => ({
  fetchDataTypes: jest.fn(),
  updateDataType: jest.fn(),
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

  it("renders the Type Registry section heading", () => {
    renderWithStore(<SourcesPage />);
    expect(screen.getByRole("heading", { name: "Type Registry" })).toBeInTheDocument();
  });

  it("renders Add source button", () => {
    renderWithStore(<SourcesPage />);
    expect(screen.getByRole("button", { name: "Add source" })).toBeInTheDocument();
  });

  it("shows empty state for sources when there are none", async () => {
    renderWithStore(<SourcesPage />);
    await waitFor(() =>
      expect(
        screen.getByText("No data sources yet. Add one to get started."),
      ).toBeInTheDocument(),
    );
  });

  it("shows empty state for types when there are none", async () => {
    renderWithStore(<SourcesPage />);
    await waitFor(() =>
      expect(
        screen.getByText("No data types yet. Add a source to create one."),
      ).toBeInTheDocument(),
    );
  });
});
