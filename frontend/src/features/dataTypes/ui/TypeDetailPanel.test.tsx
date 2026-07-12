import { screen, fireEvent, waitFor } from "@testing-library/react";

import { fetchDataTypeRows } from "../services/dataTypeService";
import { renderWithStore } from "../../../test/renderWithStore";
import { TypeDetailPanel } from "./TypeDetailPanel";
import type { DataType } from "../types/dataType";

jest.mock("../services/dataTypeService", () => ({
  fetchDataTypeRows: jest.fn(),
}));

const fetchDataTypeRowsMock = jest.mocked(fetchDataTypeRows);

const testDataType: DataType = {
  id: "dt-1",
  name: "Documents",
  sourceId: null,
  version: 1,
  fields: [{ name: "body", displayName: "Body", dataType: "string", nullable: false }],
  computedFields: [],
  createdAt: "2026-03-22T00:00:00Z",
  updatedAt: "2026-03-22T00:00:00Z",
};

describe("TypeDetailPanel", () => {
  beforeEach(() => {
    fetchDataTypeRowsMock.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it("renders string-body and binary-ref as selectable field-type options", async () => {
    renderWithStore(<TypeDetailPanel dataType={testDataType} />);

    await waitFor(() => expect(fetchDataTypeRowsMock).toHaveBeenCalledWith("dt-1"));

    const trigger = screen.getByRole("combobox", { name: "Data type for body" });
    fireEvent.click(trigger);

    const options = screen.getAllByRole("option").map((el) => el.textContent);
    expect(options).toEqual(
      expect.arrayContaining([
        "string",
        "integer",
        "float",
        "boolean",
        "timestamp",
        "string-body",
        "binary-ref",
      ]),
    );
  });

  it("renders its preview DataGrid at condensed density (preview variant default)", async () => {
    fetchDataTypeRowsMock.mockResolvedValue({ rows: [{ body: "hello" }], rowCount: 1 });

    const { container } = renderWithStore(<TypeDetailPanel dataType={testDataType} />);

    await waitFor(() => expect(screen.getByText("hello")).toBeInTheDocument());

    expect(container.querySelector(".ui-data-grid")).toHaveClass("ui-data-grid--condensed");
  });
});
