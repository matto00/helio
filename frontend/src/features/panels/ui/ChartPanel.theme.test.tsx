import { act, render, screen } from "@testing-library/react";

import { ThemeProvider, useTheme } from "../../../theme/ThemeProvider";
import * as chartAppearance from "../../../utils/chartAppearance";
import { resolveChartTheme } from "../../../utils/chartAppearance";
import { ChartPanel } from "./ChartPanel";
import { baseAppearance, baseChartConfig, getOption, renderChart } from "./chartPanelTestHelpers";

jest.mock("echarts-for-react/esm/core", () => ({
  __esModule: true,
  default: ({ option }: { option: unknown }) => (
    <div data-testid="echarts" data-option={JSON.stringify(option)} />
  ),
}));
jest.mock("./echartsCore", () => ({ __esModule: true, default: {} }));

// HEL-566 — tooltip shadow/radius/mono-value-font, axis-trigger multi-series
// tooltip, and hover emphasis, wired end-to-end through ChartPanel.
describe("ChartPanel — tooltip and hover emphasis (HEL-566)", () => {
  const barMultiSeries = {
    appearance: { ...baseAppearance, chart: { ...baseChartConfig, chartType: "bar" as const } },
    headers: ["year", "value", "team"],
    rawRows: [
      ["2020", "10", "A"],
      ["2020", "30", "B"],
    ],
    fieldMapping: { xAxis: "year", yAxis: "value", series: "team" },
  };

  it("carries the tooltip's shadow/radius (extraCssText) and mono value font", () => {
    renderChart(
      <ChartPanel
        appearance={{ ...baseAppearance, chart: baseChartConfig }}
        fieldMapping={{ xAxis: "date", yAxis: "price" }}
        headers={["date", "price"]}
        rawRows={[["2024-01-01", "100"]]}
      />,
    );
    const option = getOption(screen.getByTestId("echarts")) as {
      tooltip: { extraCssText?: string; textStyle?: { fontFamily?: string } };
    };
    const theme = resolveChartTheme();
    expect(option.tooltip.extraCssText).toContain(theme.shadowSoft);
    expect(option.tooltip.extraCssText).toContain(theme.radiusMd);
    expect(option.tooltip.textStyle?.fontFamily).toBe(theme.fontMono);
  });

  it("uses an axis-trigger tooltip for a multi-series bar chart", () => {
    renderChart(<ChartPanel {...barMultiSeries} />);
    const option = getOption(screen.getByTestId("echarts")) as {
      tooltip: { trigger?: string; axisPointer?: { type?: string } };
      series: unknown[];
    };
    expect(option.series.length).toBe(2);
    expect(option.tooltip.trigger).toBe("axis");
    expect(option.tooltip.axisPointer?.type).toBe("shadow");
  });

  it("keeps an item-trigger tooltip for a single-series bar chart", () => {
    renderChart(
      <ChartPanel
        appearance={{ ...baseAppearance, chart: { ...baseChartConfig, chartType: "bar" as const } }}
        fieldMapping={{ xAxis: "date", yAxis: "price" }}
        headers={["date", "price"]}
        rawRows={[["2024-01-01", "100"]]}
      />,
    );
    const option = getOption(screen.getByTestId("echarts")) as {
      tooltip: { trigger?: string };
    };
    expect(option.tooltip.trigger).toBeUndefined();
  });

  it("adds accent-strong-colored emphasis to every rendered series", () => {
    renderChart(<ChartPanel {...barMultiSeries} />);
    const option = getOption(screen.getByTestId("echarts")) as {
      series: Array<{ emphasis?: { focus?: string; itemStyle?: { borderColor?: string } } }>;
    };
    const theme = resolveChartTheme();
    for (const s of option.series) {
      expect(s.emphasis).toMatchObject({
        focus: "series",
        itemStyle: { borderColor: theme.accentStrong },
      });
    }
  });

  // HEL-566 skeptic-final-1 CR1/CR2 — `resolveChartTheme()`'s live
  // `getComputedStyle` read races `ThemeProvider`'s own `useEffect` (the
  // thing that actually flips `data-theme`/writes the accent custom
  // properties): on the SAME render a `theme`/`accentColor` context change
  // triggers, that effect has not run yet, so a naive re-resolve captures
  // the PREVIOUS theme/accent's values. Root-cause confirmed via a minimal
  // probe (see files-modified.md) — fixed by `themeSyncTick`, a
  // `requestAnimationFrame`-deferred corrective re-render scheduled from an
  // effect keyed on `theme`/`accentColor` (rAF fires after every effect of
  // the commit — ancestor and descendant alike — has already run).
  //
  // These tests mock `resolveChartTheme`'s return value from a REAL,
  // JS-visible signal `ThemeProvider` actually mutates
  // (`document.documentElement`'s `data-theme` attribute for theme;
  // `applyAccentTokens`'s real inline `--app-accent` custom property for
  // accent — `--app-accent-strong` itself is CSS `color-mix`-derived and
  // unreadable in jsdom, which never loads theme.css, so the mock stands in
  // for the browser's own cascade) — this is a faithful "does the real
  // wiring converge to the right VALUE" test, not merely a call-count spy
  // (a call-count-only assertion passes even when the returned value is
  // stale, which is exactly how this defect shipped past task 3.2's
  // original version of this test).
  describe("theme/accent toggle without remount (HEL-566 skeptic-final-1)", () => {
    function mockResolveChartThemeFromLiveDom() {
      return jest.spyOn(chartAppearance, "resolveChartTheme").mockImplementation(() => {
        const isDark = document.documentElement.getAttribute("data-theme") !== "light";
        const accent = document.documentElement.style.getPropertyValue("--app-accent") || "#f97316";
        return {
          surfaceStrong: isDark ? "DARK_SURFACE" : "LIGHT_SURFACE",
          borderSubtle: isDark ? "DARK_BORDER" : "LIGHT_BORDER",
          text: isDark ? "DARK_TEXT" : "LIGHT_TEXT",
          fontSans: "sans",
          fontMono: "mono",
          shadowSoft: isDark ? "DARK_SHADOW" : "LIGHT_SHADOW",
          radiusMd: "9px",
          accentStrong: `ACCENT_STRONG(${accent})`,
        };
      });
    }

    it("re-resolves the RENDERED tooltip background to the new theme after a light/dark toggle, without remounting", async () => {
      const resolveSpy = mockResolveChartThemeFromLiveDom();
      function ThemeToggler() {
        const { toggleTheme } = useTheme();
        return (
          <button type="button" onClick={toggleTheme}>
            toggle theme
          </button>
        );
      }
      render(
        <ThemeProvider>
          <ChartPanel {...barMultiSeries} />
          <ThemeToggler />
        </ThemeProvider>,
      );

      const echartsNode = screen.getByTestId("echarts");
      const before = getOption(echartsNode) as { tooltip: { backgroundColor?: string } };
      expect(before.tooltip.backgroundColor).toBe("DARK_SURFACE");

      await act(async () => {
        screen.getByText("toggle theme").click();
        // Flushes ThemeProvider's `data-theme`-flipping effect AND the
        // rAF-deferred `themeSyncTick` corrective re-render.
        await new Promise((r) => setTimeout(r, 50));
      });

      const after = getOption(screen.getByTestId("echarts")) as {
        tooltip: { backgroundColor?: string };
      };
      expect(after.tooltip.backgroundColor).toBe("LIGHT_SURFACE");
      // Same mounted echarts node throughout — never remounted.
      expect(screen.getByTestId("echarts")).toBe(echartsNode);

      resolveSpy.mockRestore();
    });

    it("re-resolves the RENDERED hover-emphasis color when accentColor changes alone, with no theme change", async () => {
      const resolveSpy = mockResolveChartThemeFromLiveDom();
      function AccentChanger() {
        const { setAccentColor } = useTheme();
        return (
          <button type="button" onClick={() => setAccentColor("#123456")}>
            change accent
          </button>
        );
      }
      render(
        <ThemeProvider>
          <ChartPanel {...barMultiSeries} />
          <AccentChanger />
        </ThemeProvider>,
      );

      const echartsNode = screen.getByTestId("echarts");
      const before = getOption(echartsNode) as {
        series: Array<{ emphasis?: { itemStyle?: { borderColor?: string } } }>;
      };
      expect(before.series[0].emphasis?.itemStyle?.borderColor).toBe("ACCENT_STRONG(#f97316)");

      await act(async () => {
        screen.getByText("change accent").click();
        await new Promise((r) => setTimeout(r, 50));
      });

      const after = getOption(screen.getByTestId("echarts")) as {
        series: Array<{ emphasis?: { itemStyle?: { borderColor?: string } } }>;
      };
      expect(after.series[0].emphasis?.itemStyle?.borderColor).toBe("ACCENT_STRONG(#123456)");
      expect(screen.getByTestId("echarts")).toBe(echartsNode);

      resolveSpy.mockRestore();
    });
  });
});
