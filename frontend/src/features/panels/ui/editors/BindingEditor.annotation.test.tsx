// HEL-323 — BindingEditor save-path coverage for the chart annotation's
// field-or-literal source. Verifies the two write directions each clear the
// other slot: Fixed text sets `config.annotation` and removes
// `fieldMapping.annotation`; Bind to field sets `fieldMapping.annotation` and
// clears `config.annotation` to null. Only the chart branch of the save path
// is exercised (the metric label/unit merge is covered by useBoundOrLiteralState).

import { createRef } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { BindingEditor } from "./BindingEditor";
import type { PanelEditorHandle } from "./editorTypes";
import { renderWithStore } from "../../../../test/renderWithStore";
import { makeChartPanel } from "../../../../test/panelFixtures";
import type { DataType } from "../../../dataTypes/types/dataType";
import * as panelService from "../../services/panelService";

jest.mock("../../services/panelService");

const mockedUpdateBinding = panelService.updatePanelBinding as jest.MockedFunction<
  typeof panelService.updatePanelBinding
>;

const dataType: DataType = {
  id: "dt1",
  name: "Sales",
  sourceId: null,
  version: 1,
  fields: [
    { name: "date", displayName: "date", dataType: "string", nullable: false },
    { name: "price", displayName: "price", dataType: "number", nullable: false },
    { name: "note", displayName: "note", dataType: "string", nullable: true },
  ],
  computedFields: [],
  createdAt: "2026-03-14T00:00:00Z",
  updatedAt: "2026-03-14T00:00:00Z",
};

function renderEditor(configOverrides: Record<string, unknown>) {
  const panel = makeChartPanel({
    id: "p1",
    config: {
      dataTypeId: "dt1",
      fieldMapping: { xAxis: "date", yAxis: "price" },
      ...configOverrides,
    },
  });
  mockedUpdateBinding.mockResolvedValue(panel);
  const ref = createRef<PanelEditorHandle>();
  renderWithStore(
    <BindingEditor
      ref={ref}
      panel={panel}
      initialRefreshInterval={null}
      chartType="line"
      onDirtyChange={() => {}}
    />,
    { dataTypes: { items: [dataType], status: "succeeded" } },
  );
  return { ref };
}

beforeEach(() => {
  mockedUpdateBinding.mockReset();
});

describe("BindingEditor — chart annotation source (HEL-323)", () => {
  it("Fixed text sets config.annotation and removes fieldMapping.annotation", async () => {
    // Start bound (field mode default when no literal is set), then switch to
    // Fixed text and type a literal so the binding must be cleared.
    const { ref } = renderEditor({
      fieldMapping: { xAxis: "date", yAxis: "price", annotation: "note" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Fixed text" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Annotation text" }), {
      target: { value: "Source: internal" },
    });

    await ref.current!.save();

    expect(mockedUpdateBinding).toHaveBeenCalledTimes(1);
    const call = mockedUpdateBinding.mock.calls[0];
    const fieldMapping = call[2];
    const annotation = call[9];
    expect(fieldMapping).toEqual({ xAxis: "date", yAxis: "price" });
    expect(fieldMapping).not.toHaveProperty("annotation");
    expect(annotation).toBe("Source: internal");
  });

  it("Bind to field sets fieldMapping.annotation and clears config.annotation to null", async () => {
    // Start with a static literal (literal mode default), then switch to Bind
    // to field and pick a column.
    const { ref } = renderEditor({ annotation: "Old fixed note" });

    fireEvent.click(screen.getByRole("button", { name: "Bind to field" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Annotation field" }));
    fireEvent.click(screen.getByRole("option", { name: "note" }));

    await ref.current!.save();

    expect(mockedUpdateBinding).toHaveBeenCalledTimes(1);
    const call = mockedUpdateBinding.mock.calls[0];
    const fieldMapping = call[2];
    const annotation = call[9];
    expect(fieldMapping).toEqual({ xAxis: "date", yAxis: "price", annotation: "note" });
    expect(annotation).toBeNull();
  });
});
