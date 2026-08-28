import { screen, fireEvent, waitFor } from "@testing-library/react";

import { fetchAssertionStatus, fetchDataTypeRows } from "../services/dataTypeService";
import { renderWithStore } from "../../../test/renderWithStore";
import { TypeDetailPanel } from "./TypeDetailPanel";
import type { DataType } from "../types/dataType";

jest.mock("../services/dataTypeService", () => ({
  fetchDataTypeRows: jest.fn(),
  fetchAssertionStatus: jest.fn(),
}));

const fetchDataTypeRowsMock = jest.mocked(fetchDataTypeRows);
const fetchAssertionStatusMock = jest.mocked(fetchAssertionStatus);

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
    fetchAssertionStatusMock.mockResolvedValue({
      dataTypeId: testDataType.id,
      invalid: false,
      failedRuleCount: 0,
    });
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

  // F-001 (critical): switching the selected type must reset the editable
  // Name/Schema form — otherwise a save could silently overwrite a
  // different type with stale data. `TypeDetailPage` fixes this by
  // keying `<TypeDetailPanel key={selectedType.id} .../>` on the type id, so
  // this regression test mirrors that: it rerenders with a new `key` (as the
  // real parent does on selection change) rather than merely swapping props
  // in place, which is what let the bug through undetected before.
  it("resets the name input and schema table when the selected type changes (F-001)", async () => {
    const otherDataType: DataType = {
      id: "dt-2",
      name: "Orders",
      sourceId: null,
      version: 1,
      fields: [{ name: "total", displayName: "Total", dataType: "float", nullable: true }],
      computedFields: [],
      createdAt: "2026-04-01T00:00:00Z",
      updatedAt: "2026-04-01T00:00:00Z",
    };

    const { rerender } = renderWithStore(
      <TypeDetailPanel key={testDataType.id} dataType={testDataType} />,
    );
    await waitFor(() => expect(fetchDataTypeRowsMock).toHaveBeenCalledWith("dt-1"));
    expect(screen.getByLabelText("Data type name")).toHaveValue("Documents");
    expect(screen.getByText("body")).toBeInTheDocument();

    rerender(<TypeDetailPanel key={otherDataType.id} dataType={otherDataType} />);

    await waitFor(() => expect(fetchDataTypeRowsMock).toHaveBeenCalledWith("dt-2"));
    expect(screen.getByLabelText("Data type name")).toHaveValue("Orders");
    expect(screen.getByText("total")).toBeInTheDocument();
    expect(screen.queryByText("body")).not.toBeInTheDocument();
  });

  // F-182: assertion/rule-validity status was tracked (`selectAssertionInvalid`,
  // already consumed by `PanelCard`) but never surfaced inside the Type
  // Registry itself.
  it("shows an Invalid data badge near the Schema heading when the type's assertion status is invalid (F-182)", async () => {
    renderWithStore(<TypeDetailPanel dataType={testDataType} />, {
      dataTypes: {
        items: [],
        status: "succeeded",
        assertionStatusByDataTypeId: { "dt-1": { invalid: true, failedRuleCount: 2 } },
      },
    });

    expect(await screen.findByText("Invalid data")).toBeInTheDocument();
  });

  it("does not show the Invalid data badge when the assertion status is valid or unknown", async () => {
    renderWithStore(<TypeDetailPanel dataType={testDataType} />);

    await waitFor(() => expect(fetchDataTypeRowsMock).toHaveBeenCalledWith("dt-1"));
    expect(screen.queryByText("Invalid data")).not.toBeInTheDocument();
  });

  // F-076: an out-of-order (superseded) preview response must never overwrite
  // a newer one's rows — regression-tests the monotonic request-token guard
  // in `handlePreview` directly (independent of `TypeDetailPage`'s
  // F-001 `key` fix, which already prevents the cross-type case structurally
  // by remounting; this is the defense-in-depth layer the fix note called
  // for). Rerenders the SAME component instance (no `key` change) with a new
  // `dataType`, so the id-changed effect fires a second fetch while the
  // first is still pending, then resolves the stale first one last.
  it("ignores a stale preview response that resolves after a newer dataType's response (F-076)", async () => {
    let resolveFirst: (value: { rows: Record<string, unknown>[]; rowCount: number }) => void;
    const firstRequest = new Promise<{ rows: Record<string, unknown>[]; rowCount: number }>(
      (resolve) => {
        resolveFirst = resolve;
      },
    );
    fetchDataTypeRowsMock.mockReturnValueOnce(firstRequest);

    const { rerender } = renderWithStore(<TypeDetailPanel dataType={testDataType} />);
    await waitFor(() => expect(fetchDataTypeRowsMock).toHaveBeenCalledWith("dt-1"));

    const otherDataType: DataType = {
      id: "dt-2",
      name: "Orders",
      sourceId: null,
      version: 1,
      fields: [{ name: "total", displayName: "Total", dataType: "float", nullable: true }],
      computedFields: [],
      createdAt: "2026-04-01T00:00:00Z",
      updatedAt: "2026-04-01T00:00:00Z",
    };
    fetchDataTypeRowsMock.mockResolvedValueOnce({ rows: [{ total: "fresh-dt2" }], rowCount: 1 });
    rerender(<TypeDetailPanel dataType={otherDataType} />);

    await waitFor(() => expect(fetchDataTypeRowsMock).toHaveBeenCalledWith("dt-2"));
    await waitFor(() => expect(screen.getByText("fresh-dt2")).toBeInTheDocument());

    // The slow dt-1 request finally resolves — it must be discarded, not
    // clobber the newer dt-2 rows already on screen.
    resolveFirst!({ rows: [{ body: "stale-dt1" }], rowCount: 1 });
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.getByText("fresh-dt2")).toBeInTheDocument();
    expect(screen.queryByText("stale-dt1")).not.toBeInTheDocument();
  });
});
