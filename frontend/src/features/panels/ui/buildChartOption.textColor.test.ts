import { defaultChartAppearance } from "../../../theme/appearance";
import type { ChartThemeTokens } from "../../../utils/chartAppearance";
import type { PanelAppearance } from "../types/panel";
import { buildChartOption } from "./buildChartOption";

// HEL-1263 — `appearance.color` defaults to "inherit", which ECharts cannot paint (the string
// reaches canvas as an invalid fillStyle). An inherited colour must resolve to the live
// `--app-text` token; an explicit colour must pass through untouched.

const TOKEN_TEXT = "#abcdef";
const themeTokens: ChartThemeTokens = {
  surfaceStrong: "#1a1d24",
  borderSubtle: "#d0d5dd",
  text: TOKEN_TEXT,
  fontSans: "Inter, sans-serif",
  fontMono: "ui-monospace, monospace",
  shadowSoft: "0 1px 2px rgba(0,0,0,0.1)",
  radiusMd: "8px",
  accentStrong: "#ea580c",
};

const rows = [
  ["East", "100"],
  ["West", "150"],
];
const base = {
  rawRows: rows,
  headers: ["region", "revenue"],
  fieldMapping: { xAxis: "region", yAxis: "revenue" },
  effectiveCompact: false,
  measuredPieLegendOverlap: false,
  themeTokens,
  theme: "dark" as const,
};

type Kind = "line" | "bar" | "scatter" | "pie";
const KINDS: Kind[] = ["line", "bar", "scatter", "pie"];

function appearanceFor(kind: Kind, over: Partial<PanelAppearance> = {}): PanelAppearance {
  return {
    background: "transparent",
    color: "inherit",
    transparency: 0,
    ...over,
    chart: { ...defaultChartAppearance, chartType: kind },
  };
}

interface Texty {
  color?: string;
}
interface AxisLike {
  axisLabel?: Texty;
  nameTextStyle?: Texty;
}

function colorsOf(kind: Kind, appearance: PanelAppearance, compact = false) {
  const option = buildChartOption({ ...base, appearance, effectiveCompact: compact });
  const legend = (option.legend as { textStyle?: Texty }).textStyle?.color;
  const global = (option.textStyle as Texty).color;
  if (kind === "pie") return { global, legend };
  const x = option.xAxis as AxisLike;
  const y = option.yAxis as AxisLike;
  return {
    global,
    legend,
    xLabel: x.axisLabel?.color,
    yLabel: y.axisLabel?.color,
    xName: x.nameTextStyle?.color,
    yName: y.nameTextStyle?.color,
  };
}

function expectAll(colors: Record<string, string | undefined>, expected: string) {
  for (const [slot, value] of Object.entries(colors)) {
    expect({ slot, value }).toEqual({ slot, value: expected });
  }
}

describe.each(KINDS)("buildChartOption text colour (%s)", (kind) => {
  it.each([
    ["inherit", { color: "inherit" }],
    ["empty", { color: "" }],
    ["absent", { color: undefined as unknown as string }],
  ])("a %s panel colour resolves to the live text token", (_n, over) => {
    expectAll(colorsOf(kind, appearanceFor(kind, over)), TOKEN_TEXT);
  });

  it("an undefined appearance resolves to the live text token", () => {
    const option = buildChartOption({ ...base, appearance: undefined });
    expect((option.textStyle as Texty).color).toBe(TOKEN_TEXT);
    expect((option.legend as { textStyle?: Texty }).textStyle?.color).toBe(TOKEN_TEXT);
  });

  it("an explicit colour passes through unchanged", () => {
    expectAll(colorsOf(kind, appearanceFor(kind, { color: "#336699" })), "#336699");
  });

  it("an explicit colour is not corrected on a tinted surface", () => {
    const tinted = appearanceFor(kind, { color: "#336699", background: "#ffd700" });
    expectAll(colorsOf(kind, tinted), "#336699");
  });

  it("an inherited colour on a tinted surface still resolves to the card's text colour", () => {
    expectAll(colorsOf(kind, appearanceFor(kind, { background: "#ffd700" })), TOKEN_TEXT);
  });

  it("the compact path keeps the resolved colour", () => {
    expectAll(colorsOf(kind, appearanceFor(kind), true), TOKEN_TEXT);
  });
});

describe("buildChartOption text colour follows the theme argument", () => {
  it("light theme with the same token still returns the token", () => {
    const option = buildChartOption({
      ...base,
      theme: "light",
      appearance: appearanceFor("line"),
    });
    expect((option.textStyle as Texty).color).toBe(TOKEN_TEXT);
  });
});
