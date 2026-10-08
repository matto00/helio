import { act, screen } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { getOutputById as getOutputByIdRequest } from "../../pipelines/services/outputService";
import { usePanelData } from "../hooks/usePanelData";
import { usePanelPolling } from "../hooks/usePanelPolling";
import { usePanelRunRefresh } from "../hooks/usePanelRunRefresh";
import { useTheme } from "../../../theme/ThemeProvider";
import * as chartAppearance from "../../../utils/chartAppearance";
import type { PanelPaginationState } from "../types/panel";
import type { Output } from "../../pipelines/types/output";
import { PanelCard } from "./PanelCard";

// HEL-1181 — a PIE chart Output with a configured `aggregation` reaches the chart grouped (one slice per
// group, not one "needle" slice per raw row), through the real dashboard card path:
// Output config -> ChartOutputPanel grouping -> buildChartOption -> final ECharts option.
// HEL-1351's card test is bar-only and HEL-624's pie test feeds a precomputed aggregate; this joins them.
// Viewport resize is not meaningful in jsdom; the live resize/theme probe is recorded evidence, not claimed here.

jest.mock("echarts-for-react/esm/core", () => ({
  __esModule: true,
  default: ({ option }: { option: unknown }) => (
    <div data-testid="echarts" data-option={JSON.stringify(option)} />
  ),
}));
jest.mock("./echartsCore", () => ({ __esModule: true, default: {} }));
jest.mock("../hooks/usePanelData", () => ({ usePanelData: jest.fn() }));
jest.mock("../hooks/usePanelPolling", () => ({ usePanelPolling: jest.fn() }));
jest.mock("../hooks/usePanelRunRefresh", () => ({ usePanelRunRefresh: jest.fn() }));
jest.mock("../../pipelines/services/outputService", () => ({
  getAssertionStatus: jest.fn(() => new Promise(() => {})),
  getOutputById: jest.fn(),
}));

const getOutputByIdMock = jest.mocked(getOutputByIdRequest);

const CATEGORIES = ["north", "south", "east", "west"];
const headers = ["region", "amount"];
// 80 raw rows over 4 repeated categories; integer amounts so sums are exact.
const records: Record<string, unknown>[] = Array.from({ length: 80 }, (_, i) => ({
  region: CATEGORIES[i % 4],
  amount: i + 1,
}));
const rawRows = records.map((r) => [String(r.region), String(r.amount)]);

// Expected slices computed independently from the fixture (never via groupAndAggregate).
const expectedSlices = [...CATEGORIES].sort().map((name) => ({
  name,
  value: records.filter((r) => r.region === name).reduce((sum, r) => sum + (r.amount as number), 0),
}));

function makeOutput(config: Record<string, unknown>): Output {
  return {
    id: "output-1",
    pipelineId: "pipe-1",
    ownerId: "u1",
    name: "Revenue share",
    kind: "chart",
    config,
    schema: [],
    createdAt: "",
    updatedAt: "",
  };
}
const PIE_BASE = { chartType: "pie", fieldMapping: { xAxis: "region", yAxis: "amount" } };
const PIE_AGG = {
  ...PIE_BASE,
  aggregation: { groupBy: "region", agg: "sum", yField: "amount" },
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(usePanelPolling).mockReturnValue(undefined);
  jest.mocked(usePanelRunRefresh).mockReturnValue(undefined);
  jest.mocked(usePanelData).mockReturnValue({
    data: null,
    rawRows,
    headers,
    isLoading: false,
    error: null,
    errorKind: null,
    noData: false,
    neverMaterialized: false,
    paginationRows: records,
    rowsTruncated: false,
    refresh: jest.fn(),
    isRefreshing: false,
  });
  getOutputByIdMock.mockResolvedValue(makeOutput(PIE_AGG));
});

function ThemeToggler() {
  const { toggleTheme } = useTheme();
  return (
    <button type="button" onClick={toggleTheme}>
      toggle theme
    </button>
  );
}

function renderCard() {
  const panel = makeOutputPanel({ title: "Revenue share" });
  const entry: PanelPaginationState = {
    currentPage: 0,
    hasMore: false,
    isLoadingMore: false,
    rows: records,
    materialized: true,
    total: records.length,
  };
  return renderWithStore(
    <>
      <PanelCard
        panel={panel}
        theme="dark"
        isDragging={false}
        dashboardId="dashboard-1"
        isEditingTitle={false}
        editingTitle=""
        editingTitleError={null}
        isConfirmingDelete={false}
        onMouseDown={jest.fn()}
        onCardClick={jest.fn()}
        onStartEdit={jest.fn()}
        onTitleChange={jest.fn()}
        onTitleKeyDown={jest.fn()}
        onTitleBlur={jest.fn()}
        onRequestDelete={jest.fn()}
        onCancelDelete={jest.fn()}
        onDetail={jest.fn()}
      />
      <ThemeToggler />
    </>,
    { panels: { items: [panel], paginationState: { [panel.id]: entry } } },
  );
}

interface OptionShape {
  tooltip?: { backgroundColor?: string };
  series?: { type?: string; data?: { name: string; value: number }[] }[];
}
// Slice order is the chart's concern (pie sorts by value), not this test's: compare by name.
function slicesOf(opt: OptionShape) {
  return [...(opt.series?.[0]?.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));
}
function optionOf(el: HTMLElement): OptionShape {
  return JSON.parse(el.getAttribute("data-option") ?? "{}") as OptionShape;
}

// jsdom loads no stylesheet, so token-derived colours are identical in both themes. Derive the resolved chart
// theme from the live `data-theme` attribute ThemeProvider really flips, as ChartPanel.theme.test.tsx does.
function mockResolveChartThemeFromLiveDom() {
  return jest.spyOn(chartAppearance, "resolveChartTheme").mockImplementation(() => {
    const isDark = document.documentElement.getAttribute("data-theme") !== "light";
    return {
      surfaceStrong: isDark ? "DARK_SURFACE" : "LIGHT_SURFACE",
      borderSubtle: isDark ? "DARK_BORDER" : "LIGHT_BORDER",
      text: isDark ? "DARK_TEXT" : "LIGHT_TEXT",
      fontSans: "sans",
      fontMono: "mono",
      shadowSoft: isDark ? "DARK_SHADOW" : "LIGHT_SHADOW",
      radiusMd: "9px",
      accentStrong: "ACCENT",
      textMuted: "MUTED",
    };
  });
}

async function toggleTheme() {
  await act(async () => {
    screen.getByText("toggle theme").click();
    // Flushes ThemeProvider's data-theme effect AND the rAF-deferred chart-theme recompute.
    await new Promise((r) => setTimeout(r, 50));
  });
}

describe("PanelCard aggregated pie Output (HEL-1181)", () => {
  it("plots one slice per group with the aggregated value, and keeps doing so across theme switches", async () => {
    const resolveSpy = mockResolveChartThemeFromLiveDom();
    try {
      renderCard();
      const before = optionOf(await screen.findByTestId("echarts"));
      expect(before.series?.[0]?.type).toBe("pie");
      // 80 raw rows must collapse to 4 slices (an ungrouped pie would have 80).
      expect(slicesOf(before)).toEqual(expectedSlices);
      expect(before.tooltip?.backgroundColor).toBe("DARK_SURFACE");

      await toggleTheme();
      // Precondition: the switch reached the chart option, so the assertions below span a real theme change.
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
      const light = optionOf(screen.getByTestId("echarts"));
      expect(light.tooltip?.backgroundColor).toBe("LIGHT_SURFACE");
      expect(light.series?.[0]?.type).toBe("pie");
      expect(slicesOf(light)).toEqual(expectedSlices);

      await toggleTheme();
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
      const dark = optionOf(screen.getByTestId("echarts"));
      expect(dark.tooltip?.backgroundColor).toBe("DARK_SURFACE");
      expect(slicesOf(dark)).toEqual(expectedSlices);
    } finally {
      resolveSpy.mockRestore();
    }
  });

  // Pins CURRENT behaviour, not an endorsement: an Output with NO `aggregation` plots one slice per raw row.
  // Whether that default should change is a separately-filed product question; change this case deliberately
  // if that decision lands.
  it("control: an unaggregated pie Output still plots one slice per raw row (current behaviour)", async () => {
    getOutputByIdMock.mockResolvedValue(makeOutput(PIE_BASE));
    renderCard();
    const opt = optionOf(await screen.findByTestId("echarts"));
    expect(opt.series?.[0]?.type).toBe("pie");
    expect(opt.series?.[0]?.data).toHaveLength(80);
  });
});
