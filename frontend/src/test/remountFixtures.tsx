import { StrictMode } from "react";

import { makeOutputPanel } from "./panelFixtures";
import { renderWithStore } from "./renderWithStore";
import { defaultDashboardLayout } from "../features/dashboards/state/dashboardLayout";
import { PanelGrid } from "../features/panels/ui/grid/PanelGrid";
import * as outputService from "../features/pipelines/services/outputService";
import type { Output } from "../features/pipelines/types/output";
import type { OutputPanel } from "../features/panels/types/panel";

export const DESKTOP_WIDTH = 1280;
export const PHONE_WIDTH = 375;

/** Shared fixtures for the remount-reuse jest suites (HEL-1392): one Output per panel, with the
 *  panel kinds that stress the reuse predicate (plain table, chart, persisted sort default, URL
 *  viewer control). The `outputService` module must be `jest.mock`-ed by the calling test file. */
export function makeOutput(id: string, kind: string, config: Record<string, unknown>): Output {
  return {
    id,
    pipelineId: `pipeline-${id}`,
    ownerId: "u1",
    name: `Output ${id}`,
    kind,
    config,
    schema: [
      { name: "region", type: "string" },
      { name: "revenue", type: "integer" },
    ],
    createdAt: "",
    updatedAt: "",
  };
}

export const OUTPUTS: Record<string, Output> = {
  "o-table": makeOutput("o-table", "table", { fieldMapping: {} }),
  "o-chart": makeOutput("o-chart", "chart", {
    chartType: "bar",
    fieldMapping: { xAxis: "region", yAxis: "revenue" },
  }),
  "o-sorted": makeOutput("o-sorted", "table", {
    fieldMapping: {},
    columnSort: { key: "revenue", direction: "desc" },
  }),
  "o-control": makeOutput("o-control", "table", { fieldMapping: {} }),
};

export const PANELS: OutputPanel[] = [
  makeOutputPanel({
    id: "p-table",
    dashboardId: "d1",
    title: "Table",
    config: { outputId: "o-table" },
  }),
  makeOutputPanel({
    id: "p-chart",
    dashboardId: "d1",
    title: "Chart",
    config: { outputId: "o-chart" },
  }),
  makeOutputPanel({
    id: "p-sorted",
    dashboardId: "d1",
    title: "Sorted",
    config: { outputId: "o-sorted" },
  }),
  makeOutputPanel({
    id: "p-control",
    dashboardId: "d1",
    title: "Control",
    config: {
      outputId: "o-control",
      controls: [{ id: "c1", kind: "dropdown", column: "region", label: "Region" }],
    },
  }),
];

export const CONTROL_URL = "/?p.p-control.c1=East";

/** Wires the mocked `outputService` to answer metadata/rows/assertion calls for `OUTPUTS`. */
export function wireOutputService(
  mocks: {
    getOutputRows: jest.Mock;
    getOutputById: jest.Mock;
    getAssertionStatus: jest.Mock;
  },
  overrides: { rows?: () => Record<string, unknown>[] } = {},
): void {
  mocks.getOutputById.mockImplementation((id: string) => Promise.resolve(OUTPUTS[id]));
  mocks.getAssertionStatus.mockImplementation((id: string) =>
    Promise.resolve({ outputId: id, invalid: false, failedRuleCount: 0 }),
  );
  mocks.getOutputRows.mockImplementation(() => {
    const items = overrides.rows?.() ?? [
      { region: "East", revenue: 100 },
      { region: "West", revenue: 150 },
    ];
    return Promise.resolve({
      items,
      total: items.length,
      offset: 0,
      limit: 200,
      materialized: true,
    });
  });
}

export function renderGridAt(width: number, panels: OutputPanel[] = PANELS, url = CONTROL_URL) {
  const ui = (w: number) => (
    <StrictMode>
      <PanelGrid dashboardId="d1" layout={defaultDashboardLayout} panels={panels} width={w} />
    </StrictMode>
  );
  const view = renderWithStore(ui(width), undefined, url);
  return { ...view, setWidth: (w: number) => view.rerender(ui(w)) };
}

export type { outputService };
