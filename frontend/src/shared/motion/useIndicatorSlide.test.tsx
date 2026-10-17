import { act, render, screen } from "@testing-library/react";

import { ThemeProvider } from "../../theme/ThemeProvider";
import type { Motion } from "../../theme/appearancePrefs";
import { useIndicatorSlide } from "./useIndicatorSlide";

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}
const boxes: Record<string, Box> = {
  a: { left: 4, top: 4, width: 40, height: 40 },
  b: { left: 4, top: 52, width: 40, height: 40 },
};

beforeAll(() => {
  const read = (key: keyof Box, el: HTMLElement) =>
    boxes[el.getAttribute("data-id") ?? ""]?.[key] ?? 0;
  Object.defineProperties(HTMLElement.prototype, {
    offsetLeft: {
      configurable: true,
      get(this: HTMLElement) {
        return read("left", this);
      },
    },
    offsetTop: {
      configurable: true,
      get(this: HTMLElement) {
        return read("top", this);
      },
    },
    offsetWidth: {
      configurable: true,
      get(this: HTMLElement) {
        return read("width", this);
      },
    },
    offsetHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return read("height", this);
      },
    },
  });
});
afterAll(() => {
  for (const name of ["offsetLeft", "offsetTop", "offsetWidth", "offsetHeight"]) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  }
});

function Rail({ active }: { active: string | null }) {
  const ref = useIndicatorSlide<HTMLDivElement>();
  return (
    <div ref={ref} data-testid="rail">
      <span className="motion-indicator" />
      {["a", "b"].map((id) => (
        <button key={id} data-id={id} data-indicator-active={active === id ? "" : undefined}>
          {id}
        </button>
      ))}
    </div>
  );
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const rail = () => screen.getByTestId("rail");
const frames = () =>
  act(() => {
    jest.advanceTimersByTime(40);
  });

describe("useIndicatorSlide", () => {
  it("places the indicator on the active item", () => {
    render(<Rail active="a" />);
    expect(rail().style.getPropertyValue("--indicator-x")).toBe("4px");
    expect(rail().style.getPropertyValue("--indicator-y")).toBe("4px");
    expect(rail().style.getPropertyValue("--indicator-w")).toBe("40px");
    expect(rail().style.getPropertyValue("--indicator-h")).toBe("40px");
  });

  it("does not slide on first placement (snap), and only allows the transition after the first frames", () => {
    render(<Rail active="a" />);
    expect(rail()).toHaveAttribute("data-indicator", "snap");
    frames();
    expect(rail()).toHaveAttribute("data-indicator", "ready");
  });

  it("moves to the newly active item and stays in the transitioning state", () => {
    const { rerender } = render(<Rail active="a" />);
    frames();
    rerender(<Rail active="b" />);
    expect(rail().style.getPropertyValue("--indicator-y")).toBe("52px");
    expect(rail()).toHaveAttribute("data-indicator", "ready");
  });

  it("hides with no active item, and snaps (no slide from the old place) when it reappears", () => {
    const { rerender } = render(<Rail active="a" />);
    frames();
    rerender(<Rail active={null} />);
    expect(rail()).toHaveAttribute("data-indicator", "hidden");
    rerender(<Rail active="b" />);
    expect(rail()).toHaveAttribute("data-indicator", "snap");
    expect(rail().style.getPropertyValue("--indicator-y")).toBe("52px");
  });

  it.each<Motion>(["subtle", "off"])(
    "never leaves the snap state outside Full (%s), so it cannot slide at Full speed",
    (motion) => {
      const wrap = (active: string) => (
        <ThemeProvider preferredAppearance={{ typeStyle: "sans", density: "comfortable", motion }}>
          <Rail active={active} />
        </ThemeProvider>
      );
      const { rerender } = render(wrap("a"));
      frames();
      rerender(wrap("b"));
      expect(rail()).toHaveAttribute("data-indicator", "snap");
      expect(rail().style.getPropertyValue("--indicator-y")).toBe("52px");
    },
  );
});
