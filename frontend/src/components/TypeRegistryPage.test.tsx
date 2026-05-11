import { screen, waitFor, fireEvent } from "@testing-library/react";

import { fetchDataTypes as fetchDataTypesRequest } from "../services/dataTypeService";
import { renderWithStore } from "../test/renderWithStore";
import { TypeRegistryPage } from "./TypeRegistryPage";

jest.mock("../services/dataTypeService", () => ({
  fetchDataTypes: jest.fn(),
  updateDataType: jest.fn(),
  deleteDataType: jest.fn(),
}));

const fetchDataTypesMock = jest.mocked(fetchDataTypesRequest);

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

describe("TypeRegistryPage", () => {
  beforeEach(() => {
    fetchDataTypesMock.mockResolvedValue([]);
  });

  it("renders the Type Registry heading", () => {
    renderWithStore(<TypeRegistryPage />);
    expect(screen.getByRole("heading", { name: "Type Registry" })).toBeInTheDocument();
  });

  it("shows empty state for types when there are none", async () => {
    renderWithStore(<TypeRegistryPage />);
    await waitFor(() =>
      expect(
        screen.getByText("No data types yet. Add a data source to create types automatically."),
      ).toBeInTheDocument(),
    );
  });

  it("auto-selects the first type and renders the detail panel when types load", async () => {
    // Selection is now driven by the sidebar (Redux state); the page derives
    // the effective type as "explicit selection OR first item" so the detail
    // panel is never blank.
    fetchDataTypesMock.mockResolvedValue([testDataType]);

    renderWithStore(<TypeRegistryPage />);
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Data type name" })).toHaveValue("Metrics"),
    );
  });

  it("shows delete confirm/cancel buttons in the detail panel when Delete is clicked", async () => {
    fetchDataTypesMock.mockResolvedValue([testDataType]);

    renderWithStore(<TypeRegistryPage />);
    const deleteBtn = await screen.findByRole("button", { name: "Delete" });
    fireEvent.click(deleteBtn);
    expect(await screen.findByRole("button", { name: "Confirm delete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("cancel restores the Delete button without calling the API", async () => {
    fetchDataTypesMock.mockResolvedValue([testDataType]);

    const { deleteDataType: deleteDataTypeMock } = jest.requireMock(
      "../services/dataTypeService",
    ) as {
      deleteDataType: jest.Mock;
    };
    deleteDataTypeMock.mockReset();

    renderWithStore(<TypeRegistryPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("button", { name: "Confirm delete" })).not.toBeInTheDocument();
    expect(deleteDataTypeMock).not.toHaveBeenCalled();
  });
});
