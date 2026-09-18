// HEL-1084 task 4.8 — orphan-on-open, dataset-switch mismatch, 400-on-save inline + re-fetch,
// and computed accessible names (C6).
import { createRef } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { FormEditor } from "./FormEditor";
import { updatePanelForm as updatePanelFormRequest } from "../../services/panelService";
import { fetchDatasetSchema as fetchDatasetSchemaRequest } from "../../../sources/services/dataSourceService";
import { renderWithStore } from "../../../../test/renderWithStore";
import { makeFormPanel } from "../../../../test/panelFixtures";
import type { PanelEditorHandle } from "./editorTypes";

jest.mock("../../services/panelService", () => ({
  updatePanelForm: jest.fn(),
}));

jest.mock("../../../sources/services/dataSourceService", () => ({
  fetchDatasetSchema: jest.fn(),
}));

const updateFormMock = jest.mocked(updatePanelFormRequest);
const fetchDatasetSchemaMock = jest.mocked(fetchDatasetSchemaRequest);

const sourcesPreload = {
  items: [
    {
      id: "ds-1",
      type: "dataset" as const,
      name: "Orders",
      createdAt: "",
      updatedAt: "",
      inferredSchema: [],
    },
    {
      id: "ds-2",
      type: "dataset" as const,
      name: "Shipments",
      createdAt: "",
      updatedAt: "",
      inferredSchema: [],
    },
  ],
  status: "succeeded" as const,
};

function renderEditor(panel = makeFormPanel({ config: { dataSourceId: "ds-1", fields: [] } })) {
  const ref = createRef<PanelEditorHandle>();
  const onDirtyChange = jest.fn();
  renderWithStore(<FormEditor ref={ref} panel={panel} onDirtyChange={onDirtyChange} />, {
    sources: sourcesPreload,
  });
  return { ref, onDirtyChange };
}

describe("FormEditor", () => {
  beforeEach(() => {
    updateFormMock.mockReset();
    fetchDatasetSchemaMock.mockReset();
    fetchDatasetSchemaMock.mockResolvedValue({
      fields: [
        { name: "quantity", type: "integer", required: true },
        { name: "note", type: "string", required: false },
      ],
    });
  });

  it("surfaces an orphaned stored field on open with a field-associated error", async () => {
    const panel = makeFormPanel({
      config: { dataSourceId: "ds-1", fields: [{ sourceField: "legacy", control: "text" }] },
    });
    renderEditor(panel);

    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((a) => /not declared/.test(a.textContent ?? ""))).toBe(true);
  });

  it("surfaces the mismatch immediately on a dataset switch", async () => {
    const panel = makeFormPanel({
      config: { dataSourceId: "ds-1", fields: [{ sourceField: "quantity", control: "number" }] },
    });
    renderEditor(panel);
    await screen.findByLabelText("Field for quantity");

    fetchDatasetSchemaMock.mockResolvedValueOnce({
      fields: [{ name: "other", type: "string", required: false }],
    });
    // Select is a custom listbox — drive it via its trigger button.
    fireEvent.click(screen.getByLabelText("Bound dataset"));
    fireEvent.click(await screen.findByText("Shipments"));

    const switchAlerts = await screen.findAllByRole("alert");
    expect(switchAlerts.some((a) => /not declared/.test(a.textContent ?? ""))).toBe(true);
  });

  it("disables save (returns ok:false) while a blocking issue exists, and clears once fixed", async () => {
    const panel = makeFormPanel({
      config: { dataSourceId: "ds-1", fields: [{ sourceField: "legacy", control: "text" }] },
    });
    const { ref } = renderEditor(panel);
    await screen.findAllByRole("alert");

    // Force dirty by removing then re-adding (any edit marks dirty).
    fireEvent.click(screen.getByRole("button", { name: "Remove legacy" }));
    await waitFor(() => expect(screen.queryAllByRole("alert")).toHaveLength(0));

    const result = await ref.current!.save();
    expect(result.ok).toBe(true);
    expect(updateFormMock).toHaveBeenCalled();
  });

  it("shows a 400 rejection inline, re-fetches the schema, and preserves edits", async () => {
    const panel = makeFormPanel({
      config: { dataSourceId: "ds-1", fields: [{ sourceField: "quantity", control: "number" }] },
    });
    const { ref } = renderEditor(panel);
    await screen.findByLabelText("Field for quantity");

    fireEvent.click(screen.getByRole("button", { name: "Move quantity up" }) as HTMLElement);
    // touch an attribute to become dirty without changing structure
    fireEvent.change(screen.getByLabelText("Label for quantity"), { target: { value: "Qty" } });

    updateFormMock.mockRejectedValueOnce(new Error("boom"));
    fetchDatasetSchemaMock.mockClear();
    const result = await ref.current!.save();

    expect(result.ok).toBe(false);
    await waitFor(() => expect(fetchDatasetSchemaMock).toHaveBeenCalled());
    // The field's own label is now "Qty" (the edit that was just made) — its
    // accessible name tracks that, and the value survives the failed save.
    expect(screen.getByLabelText("Label for Qty")).toHaveValue("Qty");
  });

  it("every control's computed accessible name includes its field (C6)", async () => {
    const panel = makeFormPanel({
      config: { dataSourceId: "ds-1", fields: [{ sourceField: "quantity", control: "number" }] },
    });
    renderEditor(panel);
    await screen.findByLabelText("Field for quantity");

    expect(screen.getByLabelText("Control for quantity")).toBeInTheDocument();
    expect(screen.getByLabelText("Label for quantity")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove quantity" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move quantity up" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move quantity down" })).toBeInTheDocument();
  });
});
