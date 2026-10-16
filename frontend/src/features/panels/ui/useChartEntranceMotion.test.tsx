import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import type { EChartsOption } from "echarts";

import { ThemeProvider } from "../../../theme/ThemeProvider";
import type { Motion } from "../../../theme/appearancePrefs";
import { applyChartMotion } from "../../../utils/chartAppearance";
import { useChartEntranceMotion } from "./useChartEntranceMotion";

jest.mock("../../../shared/motion/motionTokens", () => ({
  ...jest.requireActual("../../../shared/motion/motionTokens"),
  readMotionDuration: jest.fn(() => 280),
}));

const dataOption = (values: number[]): EChartsOption => ({
  series: [{ type: "bar", data: values }],
});

describe("applyChartMotion (HEL-1034)", () => {
  const base: EChartsOption = { series: [{ type: "bar", data: [1] }] };

  it("Full, entrance open: both durations are the token and the curve is cubicOut", () => {
    expect(
      applyChartMotion(base, { motion: "full", entrance: true, durationMs: 280 }),
    ).toMatchObject({
      animationDuration: 280,
      animationDurationUpdate: 280,
      animationEasing: "cubicOut",
    });
  });

  it("Full after the entrance: no entrance replay, update animation keeps the token", () => {
    expect(
      applyChartMotion(base, { motion: "full", entrance: false, durationMs: 280 }),
    ).toMatchObject({
      animationDuration: 0,
      animationDurationUpdate: 280,
    });
  });

  it("Subtle: no entrance or update duration but animation stays on for hover colour fades", () => {
    const option = applyChartMotion(base, { motion: "subtle", entrance: true, durationMs: 280 });
    expect(option).toMatchObject({ animationDuration: 0, animationDurationUpdate: 0 });
    expect(option.animation).toBeUndefined();
  });

  it("Off: animation is false", () => {
    expect(
      applyChartMotion(base, { motion: "off", entrance: true, durationMs: 280 }).animation,
    ).toBe(false);
  });

  it("keeps the rest of the option untouched", () => {
    const option = applyChartMotion(base, { motion: "full", entrance: true, durationMs: 280 });
    expect(option.series).toBe(base.series);
  });
});

describe("useChartEntranceMotion", () => {
  let latest: EChartsOption | null = null;
  let ready: ((chart: { on: (e: string, h: () => void) => void }) => void) | null = null;
  const handlers: Record<string, () => void> = {};
  const chart = { on: (event: string, handler: () => void) => void (handlers[event] = handler) };

  function Probe({ option }: { option: EChartsOption }) {
    const result = useChartEntranceMotion(option);
    useEffect(() => {
      latest = result.option;
      ready = result.onChartReady;
    });
    return null;
  }

  function mount(option: EChartsOption, motion: Motion = "full") {
    const wrap = (o: EChartsOption) => (
      <ThemeProvider preferredAppearance={{ typeStyle: "sans", density: "comfortable", motion }}>
        <Probe option={o} />
      </ThemeProvider>
    );
    const view = render(wrap(option));
    return { setOption: (o: EChartsOption) => view.rerender(wrap(o)) };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    latest = null;
    ready = null;
    for (const key of Object.keys(handlers)) delete handlers[key];
  });
  afterEach(() => jest.useRealTimers());

  it("a new Full chart gets the entrance duration", () => {
    mount(dataOption([1, 2]));
    expect(latest).toMatchObject({ animationDuration: 280 });
  });

  it("a rebuild inside the window keeps the entrance (the chart is not cut short)", () => {
    const { setOption } = mount(dataOption([1, 2]));
    act(() => ready?.(chart));
    setOption(dataOption([1, 2]));
    expect(latest).toMatchObject({ animationDuration: 280 });
  });

  it("closes on the finished event once data rendered: the next option does not replay the entrance", () => {
    const { setOption } = mount(dataOption([1, 2]));
    act(() => ready?.(chart));
    act(() => handlers.finished());
    setOption(dataOption([3, 4]));
    expect(latest).toMatchObject({ animationDuration: 0 });
  });

  it("closes when the standard duration has elapsed since the chart was ready with data", () => {
    const { setOption } = mount(dataOption([1, 2]));
    act(() => ready?.(chart));
    act(() => {
      jest.advanceTimersByTime(300);
    });
    setOption(dataOption([3, 4]));
    expect(latest).toMatchObject({ animationDuration: 0 });
  });

  it("an empty first render does not spend the entrance: it plays when data arrives", () => {
    const { setOption } = mount({ series: [{ type: "bar", data: [] }] });
    act(() => ready?.(chart));
    act(() => handlers.finished());
    act(() => {
      jest.advanceTimersByTime(300);
    });
    setOption(dataOption([1, 2]));
    expect(latest).toMatchObject({ animationDuration: 280 });
  });

  it("Off renders with no animation", () => {
    mount(dataOption([1]), "off");
    expect(latest?.animation).toBe(false);
  });
});
