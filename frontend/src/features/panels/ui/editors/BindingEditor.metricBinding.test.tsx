// HEL-500/HEL-553 — BindingEditor's bind-to-metric mode. Split-file test
// matching `.annotation.test.tsx`/`.aggregation.test.tsx` precedent:
// selecting a metric sets `metricId` and shows read-only resolved fields
// (metric panel); chart/table panels keep field-mapping controls editable
// after binding a metric; collection/timeline panels don't offer the mode
// (they never mount BindingEditor at all).

import { createRef } from "react";
import { fireEvent, screen } from "@testing-library/react";

import { BindingEditor } from "./BindingEditor";
import { CollectionEditor } from "./CollectionEditor";
import { TimelineEditor } from "./TimelineEditor";
import type { PanelEditorHandle } from "./editorTypes";
import { renderWithStore } from "../../../../test/renderWithStore";
import {
  makeChartPanel,
  makeCollectionPanel,
  makeMetricPanel,
  makeTablePanel,
} from "../../../../test/panelFixtures";
import type { DataType } from "../../../dataTypes/types/dataType";
import type { MetricSummary } from "../../../metrics/types/metric";
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
  ],
  computedFields: [],
  createdAt: "2026-03-14T00:00:00Z",
  updatedAt: "2026-03-14T00:00:00Z",
};

const metric: MetricSummary = {
  id: "m-1",
  ownerId: "u-1",
  dataTypeId: "dt1",
  name: "Total Revenue",
  description: null,
  measureField: "price",
  aggregation: "sum",
  allowedDimensions: [],
  format: { unit: "$", decimals: 2, prefix: null, suffix: null },
  deprecated: false,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

const deprecatedMetric: MetricSummary = {
  ...metric,
  id: "m-2",
  name: "Legacy Revenue",
  deprecated: true,
};

beforeEach(() => {
  mockedUpdateBinding.mockReset();
});

describe("BindingEditor — bind-to-metric mode, metric panel (HEL-500/HEL-553)", () => {
  it("selecting a metric sets metricId on save and shows resolved fields read-only", async () => {
    const panel = makeMetricPanel({ id: "p1", config: { dataTypeId: "dt1", fieldMapping: {} } });
    mockedUpdateBinding.mockResolvedValue(panel);
    const ref = createRef<PanelEditorHandle>();
    renderWithStore(
      <BindingEditor
        ref={ref}
        panel={panel}
        initialRefreshInterval={null}
        onDirtyChange={() => {}}
      />,
      {
        dataTypes: { items: [dataType], status: "succeeded" },
        metrics: { items: [metric], status: "succeeded" },
      },
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Metric" }));
    fireEvent.click(screen.getByRole("option", { name: "Total Revenue" }));

    // The Field/Reduce selectors are replaced by read-only resolved fields.
    expect(screen.queryByRole("combobox", { name: "Value field" })).not.toBeInTheDocument();
    expect(screen.getByText("price")).toBeInTheDocument();
    expect(screen.getByText("sum")).toBeInTheDocument();

    await ref.current!.save();

    expect(mockedUpdateBinding).toHaveBeenCalledTimes(1);
    const call = mockedUpdateBinding.mock.calls[0];
    const metricId = call[10];
    expect(metricId).toBe("m-1");
  });

  it("clearing the metric selection reveals the raw Field/Reduce controls again", () => {
    const panel = makeMetricPanel({
      id: "p1",
      config: { dataTypeId: "dt1", fieldMapping: { value: "price" }, metricId: "m-1" },
    });
    mockedUpdateBinding.mockResolvedValue(panel);
    const ref = createRef<PanelEditorHandle>();
    renderWithStore(
      <BindingEditor
        ref={ref}
        panel={panel}
        initialRefreshInterval={null}
        onDirtyChange={() => {}}
      />,
      {
        dataTypes: { items: [dataType], status: "succeeded" },
        metrics: { items: [metric], status: "succeeded" },
      },
    );

    // Starts bound to the metric — resolved fields shown, Value/Reduce hidden.
    expect(screen.queryByRole("combobox", { name: "Value field" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox", { name: "Metric" }));
    fireEvent.click(screen.getByRole("option", { name: "— None —" }));

    expect(screen.getByRole("combobox", { name: "Value field" })).toBeInTheDocument();
  });
});

describe("BindingEditor — bind-to-metric mode, chart/table panels (HEL-500/HEL-553 D6)", () => {
  it("chart panel: selecting a metric sets metricId without touching field-mapping controls", async () => {
    const panel = makeChartPanel({
      id: "p2",
      config: { dataTypeId: "dt1", fieldMapping: { xAxis: "date", yAxis: "price" } },
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
      {
        dataTypes: { items: [dataType], status: "succeeded" },
        metrics: { items: [metric], status: "succeeded" },
      },
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Metric" }));
    fireEvent.click(screen.getByRole("option", { name: "Total Revenue" }));

    // No resolved-fields materialization for chart panels (D6): the
    // read-only measure/aggregation/format summary never renders here, and
    // the chart's own field-mapping controls (xAxis/yAxis + Aggregation
    // section) remain present/editable, unaffected by the metric selection.
    expect(document.querySelector(".panel-detail-modal__metric-resolved")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Group by field")).toBeInTheDocument();
    expect(screen.getByText("date")).toBeInTheDocument();
    expect(screen.getByText("price")).toBeInTheDocument();

    await ref.current!.save();

    expect(mockedUpdateBinding).toHaveBeenCalledTimes(1);
    const call = mockedUpdateBinding.mock.calls[0];
    const fieldMapping = call[2];
    const metricId = call[10];
    expect(fieldMapping).toEqual({ xAxis: "date", yAxis: "price" });
    expect(metricId).toBe("m-1");
  });

  it("table panel: bind-to-metric mode is offered and sets metricId on save", async () => {
    const panel = makeTablePanel({
      id: "p3",
      config: { dataTypeId: "dt1", fieldMapping: { date: "date" } },
    });
    mockedUpdateBinding.mockResolvedValue(panel);
    const ref = createRef<PanelEditorHandle>();
    renderWithStore(
      <BindingEditor
        ref={ref}
        panel={panel}
        initialRefreshInterval={null}
        onDirtyChange={() => {}}
      />,
      {
        dataTypes: { items: [dataType], status: "succeeded" },
        metrics: { items: [metric], status: "succeeded" },
      },
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Metric" }));
    fireEvent.click(screen.getByRole("option", { name: "Total Revenue" }));

    await ref.current!.save();

    expect(mockedUpdateBinding).toHaveBeenCalledTimes(1);
    const call = mockedUpdateBinding.mock.calls[0];
    const metricId = call[10];
    expect(metricId).toBe("m-1");
  });
});

describe("BindingEditor — deprecated metric indicator (HEL-560)", () => {
  it("shows a 'deprecated' indicator for a metric panel already bound to a deprecated metric", () => {
    const panel = makeMetricPanel({
      id: "p1",
      config: { dataTypeId: "dt1", fieldMapping: { value: "price" }, metricId: "m-2" },
    });
    renderWithStore(
      <BindingEditor panel={panel} initialRefreshInterval={null} onDirtyChange={() => {}} />,
      {
        dataTypes: { items: [dataType], status: "succeeded" },
        // The panel's currently-bound deprecated metric stays in the offered
        // list per design.md D5 — the real filtering lives in
        // useMetricBindingState (covered by its own test file); this fixture
        // just carries the deprecated flag through for the indicator to read.
        metrics: { items: [metric, deprecatedMetric], status: "succeeded" },
      },
    );

    expect(screen.getByText("deprecated")).toBeInTheDocument();
  });

  it("shows no indicator for a metric panel bound to an active metric", () => {
    const panel = makeMetricPanel({
      id: "p1",
      config: { dataTypeId: "dt1", fieldMapping: { value: "price" }, metricId: "m-1" },
    });
    renderWithStore(
      <BindingEditor panel={panel} initialRefreshInterval={null} onDirtyChange={() => {}} />,
      {
        dataTypes: { items: [dataType], status: "succeeded" },
        metrics: { items: [metric, deprecatedMetric], status: "succeeded" },
      },
    );

    expect(screen.queryByText("deprecated")).not.toBeInTheDocument();
  });

  it("shows a 'deprecated' indicator for a chart panel already bound to a deprecated metric", () => {
    const panel = makeChartPanel({
      id: "p2",
      config: { dataTypeId: "dt1", fieldMapping: {}, metricId: "m-2" },
    });
    renderWithStore(
      <BindingEditor
        panel={panel}
        initialRefreshInterval={null}
        chartType="line"
        onDirtyChange={() => {}}
      />,
      {
        dataTypes: { items: [dataType], status: "succeeded" },
        metrics: { items: [metric, deprecatedMetric], status: "succeeded" },
      },
    );

    expect(screen.getByText("deprecated")).toBeInTheDocument();
  });

  // skeptic-final-1.md change request 1: clearing a deprecated-bound
  // metric's selection mid-edit (before saving) must drop the indicator
  // immediately, not fall through to the panel's stale
  // `config.metricDeprecated` from its last server-fetched materialization.
  it("hides the indicator immediately after clearing a deprecated-bound metric's selection, before saving", () => {
    const panel = makeMetricPanel({
      id: "p1",
      config: {
        dataTypeId: "dt1",
        fieldMapping: { value: "price" },
        metricId: "m-2",
        metricDeprecated: true,
      },
    });
    renderWithStore(
      <BindingEditor panel={panel} initialRefreshInterval={null} onDirtyChange={() => {}} />,
      {
        dataTypes: { items: [dataType], status: "succeeded" },
        metrics: { items: [metric, deprecatedMetric], status: "succeeded" },
      },
    );

    expect(screen.getByText("deprecated")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox", { name: "Metric" }));
    fireEvent.click(screen.getByRole("option", { name: "— None —" }));

    expect(screen.queryByText("deprecated")).not.toBeInTheDocument();
  });
});

describe("BindingEditor — bind-to-metric mode is absent for collection/timeline panels", () => {
  it("CollectionEditor never renders a 'Bind to metric' section", () => {
    const panel = makeCollectionPanel({ id: "p4" });
    renderWithStore(<CollectionEditor panel={panel} onDirtyChange={() => {}} />, {
      dataTypes: { items: [dataType], status: "succeeded" },
      metrics: { items: [metric], status: "succeeded" },
    });

    expect(screen.queryByText("Bind to metric")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Metric" })).not.toBeInTheDocument();
  });

  it("TimelineEditor never renders a 'Bind to metric' section", () => {
    const panel = {
      id: "p5",
      dashboardId: "dashboard-1",
      title: "Timeline",
      meta: {
        createdBy: "u1",
        createdAt: "2024-01-01T00:00:00Z",
        lastUpdated: "2024-01-01T00:00:00Z",
      },
      appearance: { background: "#ffffff", color: "#000000", transparency: 1 },
      ownerId: "u1",
      type: "timeline" as const,
      config: {
        dataTypeId: "",
        fieldMapping: {},
        timelineOptions: { sort: "asc" as const },
      },
    };
    renderWithStore(<TimelineEditor panel={panel} onDirtyChange={() => {}} />, {
      dataTypes: { items: [dataType], status: "succeeded" },
      metrics: { items: [metric], status: "succeeded" },
    });

    expect(screen.queryByText("Bind to metric")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Metric" })).not.toBeInTheDocument();
  });
});
