import { screen } from "@testing-library/react";

import { ChartPanel } from "./ChartPanel";
import { getOption, renderChart } from "./chartPanelTestHelpers";

jest.mock("echarts-for-react/esm/core", () => ({
  __esModule: true,
  default: ({ option }: { option: unknown }) => (
    <div data-testid="echarts" data-option={JSON.stringify(option)} />
  ),
}));
jest.mock("./echartsCore", () => ({ __esModule: true, default: {} }));

// HEL-1632: the pipeline page's live Output re-draws on every draft edit; an animated data morph paints frames between one
// edit and the next, so that view asks for no animation at all.
describe("ChartPanel noAnimation", () => {
  const rows = [
    ["a", "1"],
    ["b", "2"],
  ];
  const headers = ["x", "y"];
  const mapping = { xAxis: "x", yAxis: "y" };

  it("turns animation off, for the first draw and for updates", () => {
    renderChart(<ChartPanel rawRows={rows} headers={headers} fieldMapping={mapping} noAnimation />);
    const option = getOption(screen.getByTestId("echarts"));
    expect(option.animation).toBe(false);
    expect(option.animationDurationUpdate).toBe(0);
  });

  const referenceMarks = { lines: [{ value: 1.5 }], bands: [{ from: 0, to: 1 }] };
  const markAnimations = (option: ReturnType<typeof getOption>) =>
    (
      option.series as Array<{
        markLine?: { animation?: boolean };
        markArea?: { animation?: boolean };
      }>
    )
      .flatMap((s) => [s.markLine, s.markArea])
      .filter((mark) => mark !== undefined)
      .map((mark) => mark?.animation);

  it("also turns off the reference marks' own animation, which sits outside the chart-level flag", () => {
    renderChart(
      <ChartPanel
        rawRows={rows}
        headers={headers}
        fieldMapping={mapping}
        referenceMarks={referenceMarks}
        noAnimation
      />,
    );
    const animations = markAnimations(getOption(screen.getByTestId("echarts")));
    expect(animations.length).toBeGreaterThan(0);
    expect(animations.every((a) => a === false)).toBe(true);
  });

  it("leaves a dashboard chart's reference marks as they were", () => {
    renderChart(
      <ChartPanel
        rawRows={rows}
        headers={headers}
        fieldMapping={mapping}
        referenceMarks={referenceMarks}
      />,
    );
    const animations = markAnimations(getOption(screen.getByTestId("echarts")));
    expect(animations.length).toBeGreaterThan(0);
    expect(animations.every((a) => a === true)).toBe(true);
  });

  it("leaves a dashboard chart's animation as it was", () => {
    renderChart(<ChartPanel rawRows={rows} headers={headers} fieldMapping={mapping} />);
    expect(getOption(screen.getByTestId("echarts")).animation).not.toBe(false);
  });
});
