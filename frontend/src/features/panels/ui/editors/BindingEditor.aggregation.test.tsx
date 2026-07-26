// HEL-624 — BindingEditor's chart Aggregation section is hidden (replaced by
// an explanatory note) for scatter, since the backend rejects scatter +
// aggregation. Verifies the section is present for pie/bar/line, absent for
// scatter, and that switching the live chart-type selector to scatter while
// aggregation fields are populated clears them so Save never submits the
// rejected combination.

import { createRef } from "react";
import { fireEvent, screen } from "@testing-library/react";

import { BindingEditor } from "./BindingEditor";
import type { PanelEditorHandle } from "./editorTypes";
import { renderWithStore } from "../../../../test/renderWithStore";
import { makeChartPanel } from "../../../../test/panelFixtures";
import type { DataType } from "../../../dataTypes/types/dataType";
import type { ChartType } from "../../../../utils/chartAppearance";
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
    { name: "category", displayName: "category", dataType: "string", nullable: false },
    { name: "amount", displayName: "amount", dataType: "number", nullable: false },
  ],
  computedFields: [],
  createdAt: "2026-03-14T00:00:00Z",
  updatedAt: "2026-03-14T00:00:00Z",
};

function renderEditor(chartType: ChartType, configOverrides: Record<string, unknown> = {}) {
  const panel = makeChartPanel({
    id: "p1",
    config: {
      dataTypeId: "dt1",
      fieldMapping: { xAxis: "category", yAxis: "amount" },
      ...configOverrides,
    },
  });
  mockedUpdateBinding.mockResolvedValue(panel);
  const ref = createRef<PanelEditorHandle>();
  const result = renderWithStore(
    <BindingEditor
      ref={ref}
      panel={panel}
      initialRefreshInterval={null}
      chartType={chartType}
      onDirtyChange={() => {}}
    />,
    { dataTypes: { items: [dataType], status: "succeeded" } },
  );
  return { ref, ...result };
}

beforeEach(() => {
  mockedUpdateBinding.mockReset();
});

describe("BindingEditor — Aggregation section visibility by chart type (HEL-624)", () => {
  it.each<ChartType>(["bar", "line", "pie"])(
    "renders the Aggregation section for chartType=%s",
    (chartType) => {
      renderEditor(chartType);
      expect(screen.getByText("Aggregation")).toBeInTheDocument();
      expect(screen.getByLabelText("Group by field")).toBeInTheDocument();
      expect(screen.getByLabelText("Aggregation value field")).toBeInTheDocument();
      expect(screen.getByLabelText("Aggregation function")).toBeInTheDocument();
    },
  );

  it("hides the Aggregation controls and shows an explanatory note for scatter", () => {
    renderEditor("scatter");
    expect(screen.getByText("Aggregation")).toBeInTheDocument();
    expect(screen.getByText(/Aggregation isn't available for scatter/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Group by field")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Aggregation value field")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Aggregation function")).not.toBeInTheDocument();
  });

  it("clears populated aggregation fields when the live chart type switches to scatter", () => {
    const { rerender, ref } = renderEditor("bar", {
      aggregation: { groupBy: "category", agg: "sum", yField: "amount" },
    });

    // Sanity: the Group-by select starts populated from the stored aggregation.
    expect(screen.getByLabelText("Group by field")).toHaveTextContent("category");

    const panel = makeChartPanel({
      id: "p1",
      config: {
        dataTypeId: "dt1",
        fieldMapping: { xAxis: "category", yAxis: "amount" },
        aggregation: { groupBy: "category", agg: "sum", yField: "amount" },
      },
    });

    rerender(
      <BindingEditor
        ref={ref}
        panel={panel}
        initialRefreshInterval={null}
        chartType="scatter"
        onDirtyChange={() => {}}
      />,
    );

    // Aggregation controls are gone (scatter note shown instead) — the
    // cleared field state is exercised via the Save call below.
    expect(screen.queryByLabelText("Group by field")).not.toBeInTheDocument();
  });

  it("Save omits aggregation (sends null) after switching to scatter clears it", async () => {
    const { rerender, ref } = renderEditor("bar", {
      aggregation: { groupBy: "category", agg: "sum", yField: "amount" },
    });

    const panel = makeChartPanel({
      id: "p1",
      config: {
        dataTypeId: "dt1",
        fieldMapping: { xAxis: "category", yAxis: "amount" },
        aggregation: { groupBy: "category", agg: "sum", yField: "amount" },
      },
    });

    rerender(
      <BindingEditor
        ref={ref}
        panel={panel}
        initialRefreshInterval={null}
        chartType="scatter"
        onDirtyChange={() => {}}
      />,
    );

    await ref.current!.save();

    expect(mockedUpdateBinding).toHaveBeenCalledTimes(1);
    const call = mockedUpdateBinding.mock.calls[0];
    const aggregation = call[4];
    expect(aggregation).toBeNull();
  });
});

describe("BindingEditor — chart selector helper", () => {
  it("clicking a Select opens its listbox for aggregation fields", () => {
    renderEditor("pie");
    fireEvent.click(screen.getByLabelText("Group by field"));
    expect(screen.getByRole("option", { name: "category" })).toBeInTheDocument();
  });
});
