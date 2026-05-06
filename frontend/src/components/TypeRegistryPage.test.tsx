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

  it("clicking a DataType sets selection without toggling it off on re-click", async () => {
    fetchDataTypesMock.mockResolvedValue([testDataType]);

    renderWithStore(<TypeRegistryPage />);
    const typeBtn = await screen.findByRole("button", { name: "Metrics 1 field" });

    fireEvent.click(typeBtn);
    await waitFor(() => expect(typeBtn).toHaveAttribute("aria-pressed", "true"));

    fireEvent.click(typeBtn);
    expect(typeBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("shows delete confirm button when delete is clicked for a DataType", async () => {
    fetchDataTypesMock.mockResolvedValue([testDataType]);

    renderWithStore(<TypeRegistryPage />);
    const deleteBtn = await screen.findByRole("button", { name: "Delete Metrics" });
    fireEvent.click(deleteBtn);
    expect(
      await screen.findByRole("button", { name: "Confirm delete Metrics" }),
    ).toBeInTheDocument();
  });

  it("shows cancel button in DataType delete confirm and does not call API on cancel", async () => {
    fetchDataTypesMock.mockResolvedValue([testDataType]);

    const { deleteDataType: deleteDataTypeMock } = jest.requireMock(
      "../services/dataTypeService",
    ) as {
      deleteDataType: jest.Mock;
    };
    deleteDataTypeMock.mockReset();

    renderWithStore(<TypeRegistryPage />);
    const deleteBtn = await screen.findByRole("button", { name: "Delete Metrics" });
    fireEvent.click(deleteBtn);

    const cancelBtn = await screen.findByRole("button", { name: "No" });
    fireEvent.click(cancelBtn);

    expect(
      screen.queryByRole("button", { name: "Confirm delete Metrics" }),
    ).not.toBeInTheDocument();
    expect(deleteDataTypeMock).not.toHaveBeenCalled();
  });
});
