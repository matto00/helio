import { act, render, screen } from "@testing-library/react";

import { ThemeProvider } from "../../theme/ThemeProvider";
import type { Motion } from "../../theme/appearancePrefs";
import { useValueTween } from "./useValueTween";

jest.mock("./motionTokens", () => ({
  ...jest.requireActual("./motionTokens"),
  readMotionDuration: jest.fn(),
}));
import { readMotionDuration } from "./motionTokens";

function Shown({ value }: { value: number | null }) {
  return <span data-testid="v">{String(useValueTween(value))}</span>;
}

function renderValue(value: number | null, motion: Motion = "full") {
  const wrap = (v: number | null) => (
    <ThemeProvider preferredAppearance={{ typeStyle: "sans", density: "comfortable", motion }}>
      <Shown value={v} />
    </ThemeProvider>
  );
  const view = render(wrap(value));
  return { setValue: (v: number | null) => view.rerender(wrap(v)) };
}

const shown = () => screen.getByTestId("v").textContent;

beforeEach(() => {
  jest.useFakeTimers();
  (readMotionDuration as jest.Mock).mockReturnValue(280);
});
afterEach(() => jest.useRealTimers());

describe("useValueTween", () => {
  it("shows the first value immediately, with no count-up from zero", () => {
    renderValue(120);
    expect(shown()).toBe("120");
  });

  it("counts through intermediate values and settles on exactly the target", () => {
    const { setValue } = renderValue(120);
    setValue(180);
    expect(shown()).toBe("120");
    act(() => {
      jest.advanceTimersByTime(140);
    });
    const mid = Number(shown());
    expect(mid).toBeGreaterThan(120);
    expect(mid).toBeLessThan(180);
    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(shown()).toBe("180");
  });

  it.each<Motion>(["subtle", "off"])("swaps instantly under %s", (motion) => {
    const { setValue } = renderValue(120, motion);
    setValue(180);
    expect(shown()).toBe("180");
  });

  it("swaps instantly when the duration token is instant or unresolved", () => {
    (readMotionDuration as jest.Mock).mockReturnValue(0.01);
    const { setValue } = renderValue(120);
    setValue(180);
    expect(shown()).toBe("180");
  });

  it("does not tween to or from a non-finite or missing value", () => {
    const { setValue } = renderValue(120);
    setValue(null);
    expect(shown()).toBe("null");
    setValue(Number.POSITIVE_INFINITY);
    expect(shown()).toBe("Infinity");
  });

  it("retargets mid-flight from the value on screen, ending exactly on the newest target", () => {
    const { setValue } = renderValue(0);
    setValue(100);
    act(() => {
      jest.advanceTimersByTime(140);
    });
    const mid = Number(shown());
    setValue(200);
    expect(Number(shown())).toBeCloseTo(mid, 5);
    act(() => {
      jest.advanceTimersByTime(600);
    });
    expect(shown()).toBe("200");
  });

  it("rounds in-flight frames to the endpoints' precision: integers count through integers", () => {
    const { setValue } = renderValue(120);
    setValue(180);
    const frames: string[] = [];
    for (let i = 0; i < 20; i++) {
      act(() => {
        jest.advanceTimersByTime(16);
      });
      frames.push(shown() ?? "");
    }
    expect(frames.length).toBeGreaterThan(5);
    for (const frame of frames) expect(frame).toMatch(/^\d+$/);
    expect(frames).toContain("180");
  });

  it("a decimal endpoint tweens at its own precision and never beyond it", () => {
    const { setValue } = renderValue(1.5);
    setValue(4.25);
    const frames: string[] = [];
    for (let i = 0; i < 20; i++) {
      act(() => {
        jest.advanceTimersByTime(16);
      });
      frames.push(shown() ?? "");
    }
    for (const frame of frames) expect(frame).toMatch(/^\d+(\.\d{1,2})?$/);
    expect(frames.some((f) => f.includes("."))).toBe(true);
  });
});
