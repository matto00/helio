import { screen, waitFor, fireEvent } from "@testing-library/react";

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

const testSource = {
  id: "s-1",
  name: "Sales API",
  sourceType: "rest_api",
  createdAt: "2026-03-22T00:00:00Z",
  updatedAt: "2026-03-22T00:00:00Z",
};

const testDataType = {
  id: "dt-1",
  name: "Metrics",
  sourceId: "s-1",
  version: 1,
  fields: [{ name: "value", displayName: "Value", dataType: "float", nullable: false }],
  computedFields: [],
  createdAt: "2026-03-22T00:00:00Z",
  updatedAt: "2026-03-22T00:00:00Z",
};

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

  it("shows empty state for types when there are none", async () => {
    renderWithStore(<SourcesPage />);
    await waitFor(() =>
      expect(
        screen.getByText("No data types yet. Add a data source to create types automatically."),
      ).toBeInTheDocument(),
    );
  });

  it("clicking a DataType sets selection without toggling it off on re-click", async () => {
    fetchSourcesMock.mockResolvedValue([testSource]);
    fetchDataTypesMock.mockResolvedValue([testDataType]);

    renderWithStore(<SourcesPage />);
    const typeBtn = await screen.findByRole("button", { name: "Metrics 1 field" });

    // First click — selects
    fireEvent.click(typeBtn);
    await waitFor(() => expect(typeBtn).toHaveAttribute("aria-pressed", "true"));

    // Second click — should NOT deselect (selection stays)
    fireEvent.click(typeBtn);
    expect(typeBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("shows delete confirm button when delete is clicked for a DataType", async () => {
    fetchSourcesMock.mockResolvedValue([testSource]);
    fetchDataTypesMock.mockResolvedValue([testDataType]);

    renderWithStore(<SourcesPage />);
    const deleteBtn = await screen.findByRole("button", { name: "Delete Metrics" });
    fireEvent.click(deleteBtn);
    expect(
      await screen.findByRole("button", { name: "Confirm delete Metrics" }),
    ).toBeInTheDocument();
  });

  it("shows cancel button in DataType delete confirm and does not call API on cancel", async () => {
    fetchSourcesMock.mockResolvedValue([testSource]);
    fetchDataTypesMock.mockResolvedValue([testDataType]);

    const { deleteDataType: deleteDataTypeMock } = jest.requireMock(
      "../services/dataTypeService",
    ) as {
      deleteDataType: jest.Mock;
    };
    deleteDataTypeMock.mockReset();

    renderWithStore(<SourcesPage />);
    const deleteBtn = await screen.findByRole("button", { name: "Delete Metrics" });
    fireEvent.click(deleteBtn);

    const cancelBtn = await screen.findByRole("button", { name: "No" });
    fireEvent.click(cancelBtn);

    // Confirm button should be gone
    expect(
      screen.queryByRole("button", { name: "Confirm delete Metrics" }),
    ).not.toBeInTheDocument();
    expect(deleteDataTypeMock).not.toHaveBeenCalled();
  });
});
