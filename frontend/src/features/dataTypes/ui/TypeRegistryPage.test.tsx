import { screen, waitFor, fireEvent } from "@testing-library/react";

import { fetchDataTypes as fetchDataTypesRequest } from "../services/dataTypeService";
import { renderWithStore } from "../../../test/renderWithStore";
import { TypeRegistryPage } from "./TypeRegistryPage";

jest.mock("../services/dataTypeService", () => ({
  fetchDataTypes: jest.fn(),
  updateDataType: jest.fn(),
  deleteDataType: jest.fn(),
}));

const fetchDataTypesMock = jest.mocked(fetchDataTypesRequest);

// Pipeline-output DataType (`sourceId: null`) — the only kind the Type
// Registry surfaces post-migration; companion DataTypes (`sourceId` set) are
// internal source-schema records and are filtered out.
const testDataType = {
  id: "dt-1",
  name: "Metrics",
  sourceId: null,
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

  it("renders the page shell (heading lives in the top breadcrumb, not in-page)", () => {
    renderWithStore(<TypeRegistryPage />);
    expect(document.querySelector(".type-registry-page")).toBeInTheDocument();
  });

  it("shows empty state for types when there are none", async () => {
    renderWithStore(<TypeRegistryPage />);
    await waitFor(() => expect(screen.getByText("No types defined")).toBeInTheDocument());
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

  // Note: Delete used to live in the detail panel; it's now owned by the
  // sidebar (SidebarItemList's ellipsis menu) so the page-level test no
  // longer asserts the Delete flow here. Sidebar delete is covered via the
  // SidebarItemList component's own tests / playwright verification.

  it("shows the empty state when the only DataType is a companion type (sourceId set)", async () => {
    const companionType = { ...testDataType, id: "dt-companion", sourceId: "s-1" };
    fetchDataTypesMock.mockResolvedValue([companionType]);

    renderWithStore(<TypeRegistryPage />);
    await waitFor(() => expect(screen.getByText("No types defined")).toBeInTheDocument());
    expect(screen.queryByRole("textbox", { name: "Data type name" })).not.toBeInTheDocument();
  });
});
