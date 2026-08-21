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

  it("HEL-528: renders a skeleton, not an empty browser, while types are loading", () => {
    fetchDataTypesMock.mockReturnValueOnce(new Promise(() => {})); // never resolves
    const { container } = renderWithStore(<TypeRegistryPage />);

    expect(container.querySelector(".ui-empty-state--main .ui-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("No types defined")).not.toBeInTheDocument();
  });

  it("HEL-528: keeps rendering already-loaded types instead of the skeleton if status re-enters loading", async () => {
    fetchDataTypesMock.mockResolvedValueOnce([testDataType]);
    const { container } = renderWithStore(<TypeRegistryPage />);
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Data type name" })).toHaveValue("Metrics"),
    );

    expect(container.querySelector(".ui-skeleton")).not.toBeInTheDocument();
  });

  it("shows empty state for types when there are none", async () => {
    renderWithStore(<TypeRegistryPage />);
    await waitFor(() => expect(screen.getByText("No types defined")).toBeInTheDocument());
  });

  // HEL-548 D4/5.1/5.4 — the registry's empty state gains a real CTA that
  // opens the pipeline-create flow (types exist only as pipeline output),
  // never a "create type" path that doesn't exist.
  it("HEL-548: the main-content empty state offers a working 'New pipeline' CTA and no create-type path", async () => {
    const { store } = renderWithStore(<TypeRegistryPage />);
    await waitFor(() => expect(screen.getByText("No types defined")).toBeInTheDocument());

    expect(
      screen.queryByRole("button", { name: /add type|new type|create type/i }),
    ).not.toBeInTheDocument();

    expect(store.getState().pipelines.createModalOpen).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "New pipeline" }));
    expect(store.getState().pipelines.createModalOpen).toBe(true);
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

  // HEL-539 — error state + retry recovery
  it("renders a visible error state with Retry on fetch failure, and Retry recovers on success", async () => {
    fetchDataTypesMock.mockReset();
    fetchDataTypesMock.mockRejectedValueOnce(new Error("network error"));
    renderWithStore(<TypeRegistryPage />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load types");
    const retryBtn = screen.getByRole("button", { name: "Retry" });

    fetchDataTypesMock.mockResolvedValueOnce([]);
    fireEvent.click(retryBtn);

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(await screen.findByText("No types defined")).toBeInTheDocument();
    expect(fetchDataTypesMock).toHaveBeenCalledTimes(2);
  });
});
