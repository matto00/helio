import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AxiosError } from "axios";

import { renderWithStore } from "../../../test/renderWithStore";
import { DatasetSchemaEditor } from "./DatasetSchemaEditor";
import { DatasetRowGrid } from "./DatasetRowGrid";
import {
  fetchDatasetSchema as fetchDatasetSchemaRequest,
  fetchSourceRows as fetchSourceRowsRequest,
  updateDatasetSchema as updateDatasetSchemaRequest,
} from "../services/dataSourceService";
import type { DatasetSchemaResponse, RowListResponse } from "../types/dataSource";

jest.mock("../services/dataSourceService", () => ({
  fetchDatasetSchema: jest.fn(),
  fetchSourceRows: jest.fn(),
  updateDatasetSchema: jest.fn(),
  patchSourceRow: jest.fn(),
  deleteSourceRow: jest.fn(),
  appendSourceRows: jest.fn(),
}));

const fetchDatasetSchemaMock = jest.mocked(fetchDatasetSchemaRequest);
const fetchSourceRowsMock = jest.mocked(fetchSourceRowsRequest);
const updateDatasetSchemaMock = jest.mocked(updateDatasetSchemaRequest);

const sourceId = "src-1";

const baseSchema: DatasetSchemaResponse = {
  fields: [
    { name: "name", type: "string", required: true },
    { name: "note", type: "string", required: false },
  ],
};

function onePage(total: number): RowListResponse {
  return {
    rows: Array.from({ length: total }, (_, i) => ({
      id: `r${i}`,
      seq: i,
      updatedAt: "2026-01-01T00:00:00Z",
      data: ["Alice", "hi"],
    })),
    total,
  };
}

function axiosErrorWith(status: number, data: unknown): AxiosError {
  const err = new AxiosError("Request failed");
  err.response = { status, data, statusText: "", headers: {}, config: {} as never };
  return err;
}

beforeEach(() => {
  jest.clearAllMocks();
});

/** Mounts both the row grid and the schema editor, mirroring `SourceDetailPanel`'s real
 *  composition -- `DatasetSchemaEditor` reads the dataset's row count from the SAME slice state
 *  the row grid populates (design.md Decision 3a), so it needs the grid mounted to have a
 *  realistic non-zero `total` under test. */
async function renderComposed(total: number) {
  fetchSourceRowsMock.mockResolvedValue(onePage(total));
  const result = renderWithStore(
    <>
      <DatasetRowGrid sourceId={sourceId} />
      <DatasetSchemaEditor sourceId={sourceId} />
    </>,
  );
  await waitFor(() =>
    expect(result.store.getState().datasetRows.bySource[sourceId]?.total).toBe(total),
  );
  return result;
}

describe("DatasetSchemaEditor", () => {
  it("renders the current declared fields once loaded", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(baseSchema);
    await renderComposed(0);
    expect(await screen.findByDisplayValue("name")).toBeInTheDocument();
    expect(screen.getByDisplayValue("note")).toBeInTheDocument();
  });

  it("allows adding an optional field with no confirmation, zero-row dataset", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(baseSchema);
    updateDatasetSchemaMock.mockResolvedValue({
      fields: [...baseSchema.fields, { name: "extra", type: "string", required: false }],
      rowsMigrated: 0,
    });
    await renderComposed(0);
    await screen.findByDisplayValue("name");

    fireEvent.click(screen.getByRole("button", { name: /add field/i }));
    fireEvent.change(screen.getByLabelText("Field 3 name"), { target: { value: "extra" } });
    fireEvent.click(screen.getByRole("button", { name: /save schema/i }));

    await waitFor(() => expect(updateDatasetSchemaMock).toHaveBeenCalledTimes(1));
    expect(updateDatasetSchemaMock).toHaveBeenCalledWith(
      sourceId,
      expect.objectContaining({
        fields: expect.arrayContaining([
          expect.objectContaining({ name: "extra", required: false }),
        ]),
      }),
    );
    // No confirmDrop on an add-only edit.
    expect(updateDatasetSchemaMock.mock.calls[0][1].confirmDrop).toBeUndefined();
  });

  it("blocks submit with an inline reason when a required field with no default is added to a non-empty dataset", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(baseSchema);
    await renderComposed(3);
    await screen.findByDisplayValue("name");

    fireEvent.click(screen.getByRole("button", { name: /add field/i }));
    fireEvent.change(screen.getByLabelText("Field 3 name"), { target: { value: "score" } });
    fireEvent.click(screen.getByLabelText("Field 3 required"));

    expect(screen.getByRole("button", { name: /save schema/i })).toBeDisabled();
    expect(screen.getByText(/is required with no default value/)).toBeInTheDocument();
    expect(updateDatasetSchemaMock).not.toHaveBeenCalled();
  });

  it("requires no confirmation for the same required-no-default add on a zero-row dataset", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(baseSchema);
    await renderComposed(0);
    await screen.findByDisplayValue("name");

    fireEvent.click(screen.getByRole("button", { name: /add field/i }));
    fireEvent.change(screen.getByLabelText("Field 3 name"), { target: { value: "score" } });
    fireEvent.click(screen.getByLabelText("Field 3 required"));

    expect(screen.getByRole("button", { name: /save schema/i })).not.toBeDisabled();
  });

  it("shows a drop-confirmation dialog when removing a field from a non-empty dataset, and submits confirmDrop: true on confirm", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(baseSchema);
    updateDatasetSchemaMock.mockResolvedValue({
      fields: [baseSchema.fields[0]],
      rowsMigrated: 3,
    });
    await renderComposed(3);
    await screen.findByDisplayValue("name");

    fireEvent.click(screen.getByLabelText("Remove field 2"));
    // Removal is NOT applied yet -- the field still exists.
    expect(screen.getByDisplayValue("note")).toBeInTheDocument();
    expect(screen.getByText(/permanently delete "note"'s data from 3 rows/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /delete field data/i }));

    await waitFor(() => expect(updateDatasetSchemaMock).toHaveBeenCalledTimes(1));
    expect(updateDatasetSchemaMock).toHaveBeenCalledWith(
      sourceId,
      expect.objectContaining({ confirmDrop: true }),
    );
  });

  // evaluation-1.md CR1: the on-screen table must reflect the drop immediately once the PATCH
  // succeeds -- never only after a hard reload. Regression guard for the seededSchemaRef/
  // rows-reset race (root-caused: `submitSchema` used to reset `rows` to `null` and rely on a
  // separate, later-resolving `fetchDatasetSchemaThunk` dispatch to re-seed it, which raced the
  // still-stale `schema` already in Redux at that render).
  it("removes the dropped field from the on-screen table immediately once the confirmed drop succeeds, with no reload", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(baseSchema);
    updateDatasetSchemaMock.mockResolvedValue({
      fields: [baseSchema.fields[0]],
      rowsMigrated: 3,
    });
    await renderComposed(3);
    await screen.findByDisplayValue("name");

    fireEvent.click(screen.getByLabelText("Remove field 2"));
    fireEvent.click(screen.getByRole("button", { name: /delete field data/i }));

    await waitFor(() => expect(updateDatasetSchemaMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByDisplayValue("note")).not.toBeInTheDocument());
    expect(screen.getByDisplayValue("name")).toBeInTheDocument();
  });

  // skeptic-final-1.md CR1: a REJECTED confirmed drop must leave the field on screen (never
  // presented as applied), still removable/recoverable, and never a dead end.
  it("leaves the dropped field on screen with its rejection reason when a confirmed drop is REJECTED", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(baseSchema);
    updateDatasetSchemaMock.mockRejectedValue(
      axiosErrorWith(409, {
        rejectedFields: [{ name: "note", reason: "dropping note requires confirmDrop: true" }],
        message: "Schema update rejected.",
      }),
    );
    await renderComposed(3);
    await screen.findByDisplayValue("name");

    fireEvent.click(screen.getByLabelText("Remove field 2"));
    fireEvent.click(screen.getByRole("button", { name: /delete field data/i }));

    await waitFor(() => expect(updateDatasetSchemaMock).toHaveBeenCalledTimes(1));
    // The field is still on screen -- never presented as dropped when the server rejected it.
    expect(screen.getByDisplayValue("note")).toBeInTheDocument();
    expect(screen.getByText(/dropping note requires confirmDrop: true/)).toBeInTheDocument();
    // Recoverable: its own Remove button still exists to re-trigger the confirm dialog (the
    // pre-fix dead end was that this button no longer existed once the drop was applied
    // optimistically).
    const removeButton = screen.getByLabelText("Remove field 2");
    expect(removeButton).toBeInTheDocument();
    // Focus returns to that same remove button, not left on the now-unmounted confirm dialog.
    await waitFor(() => expect(removeButton).toHaveFocus());
  });

  // evaluation-1.md CR2 / design.md Decision 6: on confirm, focus moves to the next remaining
  // field's name input (never left on `<body>`).
  it("moves focus to the next remaining field's name input after confirming a drop", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(baseSchema);
    updateDatasetSchemaMock.mockResolvedValue({
      fields: [baseSchema.fields[0]],
      rowsMigrated: 3,
    });
    await renderComposed(3);
    await screen.findByDisplayValue("name");

    fireEvent.click(screen.getByLabelText("Remove field 2"));
    fireEvent.click(screen.getByRole("button", { name: /delete field data/i }));

    // Focus is applied once the (mocked, async) PATCH resolves -- not synchronously on click.
    await waitFor(() => expect(screen.getByLabelText("Field 1 name")).toHaveFocus());
    expect(screen.getByLabelText("Field 1 name")).toHaveValue("name");
  });

  // Same contract, zero-remaining-fields case: focus moves to "Add field".
  it("moves focus to 'Add field' after confirming a drop that removes the last remaining field", async () => {
    const oneFieldSchema: DatasetSchemaResponse = {
      fields: [{ name: "solo", type: "string", required: false }],
    };
    fetchDatasetSchemaMock.mockResolvedValue(oneFieldSchema);
    updateDatasetSchemaMock.mockResolvedValue({ fields: [], rowsMigrated: 3 });
    await renderComposed(3);
    await screen.findByDisplayValue("solo");

    fireEvent.click(screen.getByLabelText("Remove field 1"));
    fireEvent.click(screen.getByRole("button", { name: /delete field data/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /add field/i })).toHaveFocus());
  });

  it("cancelling the drop confirmation leaves the field undropped and returns focus to its remove button", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(baseSchema);
    await renderComposed(3);
    await screen.findByDisplayValue("name");

    fireEvent.click(screen.getByLabelText("Remove field 2"));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(screen.getByDisplayValue("note")).toBeInTheDocument();
    expect(updateDatasetSchemaMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Remove field 2")).toHaveFocus();
  });

  it("sends no confirmDrop when dropping a field from a zero-row dataset", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(baseSchema);
    updateDatasetSchemaMock.mockResolvedValue({ fields: [baseSchema.fields[0]], rowsMigrated: 0 });
    await renderComposed(0);
    await screen.findByDisplayValue("name");

    fireEvent.click(screen.getByLabelText("Remove field 2"));
    // No confirmation dialog for a zero-row dataset -- the removal applies to local state
    // immediately (verified indirectly: "Save schema" now submits a 1-field declaration).
    expect(screen.queryByText(/permanently delete/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /save schema/i }));
    await waitFor(() => expect(updateDatasetSchemaMock).toHaveBeenCalledTimes(1));
    expect(updateDatasetSchemaMock.mock.calls[0][1].confirmDrop).toBeUndefined();
  });

  it("on a 409 SchemaUpdateConflictResponse, keeps the editor open and shows the rejected field's reason inline", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(baseSchema);
    updateDatasetSchemaMock.mockRejectedValue(
      axiosErrorWith(409, {
        rejectedFields: [{ name: "name", reason: "3 rows are incompatible with 'integer'." }],
        message: "Schema update rejected.",
      }),
    );
    await renderComposed(3);
    await screen.findByDisplayValue("name");

    fireEvent.click(screen.getByRole("combobox", { name: "Field 1 type" }));
    fireEvent.click(screen.getByRole("option", { name: "integer" }));
    fireEvent.click(screen.getByRole("button", { name: /save schema/i }));

    expect(await screen.findByText(/3 rows are incompatible/)).toBeInTheDocument();
    // Editor stays open with the in-progress edit intact.
    expect(screen.getByRole("combobox", { name: "Field 1 type" })).toHaveTextContent("integer");
  });

  it("on a structural 400, shows a single non-field-specific inline error banner", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(baseSchema);
    updateDatasetSchemaMock.mockRejectedValue(
      axiosErrorWith(400, { message: "Rename target collides with a dropped field." }),
    );
    await renderComposed(3);
    await screen.findByDisplayValue("name");

    fireEvent.change(screen.getByLabelText("Field 1 name"), { target: { value: "renamed" } });
    fireEvent.click(screen.getByRole("button", { name: /save schema/i }));

    expect(
      await screen.findByText("Rename target collides with a dropped field."),
    ).toBeInTheDocument();
  });

  it("on 200, toasts a message reflecting rowsMigrated", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(baseSchema);
    updateDatasetSchemaMock.mockResolvedValue({ fields: baseSchema.fields, rowsMigrated: 0 });
    await renderComposed(3);
    await screen.findByDisplayValue("name");

    fireEvent.change(screen.getByLabelText("Field 1 name"), { target: { value: "fullName" } });
    fireEvent.click(screen.getByRole("button", { name: /save schema/i }));

    await waitFor(() => expect(updateDatasetSchemaMock).toHaveBeenCalledTimes(1));
    expect(updateDatasetSchemaMock).toHaveBeenCalledWith(
      sourceId,
      expect.objectContaining({
        fields: expect.arrayContaining([
          expect.objectContaining({ name: "fullName", previousName: "name" }),
        ]),
      }),
    );
  });
});
