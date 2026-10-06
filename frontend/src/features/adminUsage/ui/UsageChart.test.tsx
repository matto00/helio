import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { ThemeProvider, useTheme } from "../../../theme/ThemeProvider";
import { UsageChart } from "./UsageChart";

// HEL-1342 — the usage page's chart text must come from the live `--app-text` token. jsdom loads
// no theme CSS, so the test installs DISTINCT token values per theme; otherwise both themes would
// resolve to the same fallback and a "follows the theme" assertion would be vacuous.

let lastOption: Record<string, unknown> | null = null;
jest.mock("echarts-for-react/esm/core", () => ({
  __esModule: true,
  default: ({ option }: { option: Record<string, unknown> }) => {
    lastOption = option;
    return null;
  },
}));
jest.mock("../../panels/ui/echartsCore", () => ({ __esModule: true, default: {} }));

const LIGHT_TEXT = "#111111";
const DARK_TEXT = "#eeeeee";

let styleEl: HTMLStyleElement;
beforeEach(() => {
  lastOption = null;
  styleEl = document.createElement("style");
  styleEl.textContent = `
    html[data-theme="light"] { --app-text: ${LIGHT_TEXT}; }
    html[data-theme="dark"] { --app-text: ${DARK_TEXT}; }`;
  document.head.appendChild(styleEl);
  jest.useFakeTimers();
});
afterEach(() => {
  styleEl.remove();
  jest.useRealTimers();
});

function Harness() {
  const { setTheme } = useTheme();
  return (
    <>
      <button onClick={() => setTheme("dark")}>to-dark</button>
      <UsageChart
        categories={["a", "b"]}
        series={[
          { name: "DAU", values: [1, 2] },
          { name: "WAU", values: [2, 3] },
        ]}
        kind="line"
        ariaLabel="usage"
      />
    </>
  );
}

interface Texty {
  color?: string;
  fontFamily?: string;
}
function texts(option: Record<string, unknown>) {
  const x = option.xAxis as { axisLabel?: Texty; nameTextStyle?: Texty };
  const y = option.yAxis as { axisLabel?: Texty; nameTextStyle?: Texty };
  return {
    global: (option.textStyle as Texty).color,
    legend: (option.legend as { textStyle?: Texty }).textStyle?.color,
    xLabel: x.axisLabel?.color,
    yLabel: y.axisLabel?.color,
    xName: x.nameTextStyle?.color,
    yName: y.nameTextStyle?.color,
  };
}

function flush() {
  act(() => {
    jest.runOnlyPendingTimers();
  });
}

function expectAll(option: Record<string, unknown>, expected: string) {
  for (const [slot, value] of Object.entries(texts(option))) {
    expect({ slot, value }).toEqual({ slot, value: expected });
  }
}

describe("UsageChart text colour (HEL-1342)", () => {
  it("resolves every text slot to the live --app-text token and tracks a theme switch", () => {
    localStorage.setItem("helio-theme", "light");
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );
    flush();
    expect(document.documentElement.dataset.theme).toBe("light");
    expectAll(lastOption!, LIGHT_TEXT);

    fireEvent.click(screen.getByText("to-dark"));
    flush();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expectAll(lastOption!, DARK_TEXT);
  });

  it("keeps the app font on the text styles", () => {
    localStorage.setItem("helio-theme", "dark");
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );
    flush();
    const option = lastOption!;
    expect((option.textStyle as Texty).fontFamily).toBeTruthy();
    expect((option.yAxis as { axisLabel?: Texty }).axisLabel?.fontFamily).toBeTruthy();
  });
});
