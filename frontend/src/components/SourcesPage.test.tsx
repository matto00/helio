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

  it("renders Add source button", () => {
    renderWithStore(<SourcesPage />);
    expect(screen.getByRole("button", { name: "Add source" })).toBeInTheDocument();
  });

  it("does not dispatch fetchDataTypes on mount", async () => {
    renderWithStore(<SourcesPage />);
    await screen.findByRole("button", { name: "Add source" });
    expect(fetchDataTypesMock).not.toHaveBeenCalled();
  });
});
