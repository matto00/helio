import { render } from "@testing-library/react";

import { ThemeProvider } from "../../theme/ThemeProvider";
import type { Motion } from "../../theme/appearancePrefs";
import { useLayoutSlide } from "./useLayoutSlide";

jest.mock("./motionTokens", () => ({
  ...jest.requireActual("./motionTokens"),
  readMotionDuration: jest.fn(),
  readMotionEasing: jest.fn(() => "ease-out-curve"),
}));
import { readMotionDuration } from "./motionTokens";

const tops: Record<string, number> = {};
const animate = jest.fn();

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetTop", {
    configurable: true,
    get(this: HTMLElement) {
      return tops[this.getAttribute("data-motion-key") ?? ""] ?? 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
});

afterAll(() => {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).animate;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetTop;
});

beforeEach(() => {
  animate.mockClear();
  (readMotionDuration as jest.Mock).mockReturnValue(280);
  for (const key of Object.keys(tops)) delete tops[key];
});

function List({ ids }: { ids: string[] }) {
  const ref = useLayoutSlide<HTMLUListElement>();
  return (
    <ul ref={ref}>
      {ids.map((id) => (
        <li key={id} data-motion-key={id}>
          {id}
        </li>
      ))}
    </ul>
  );
}

function renderList(ids: string[], motion: Motion = "full") {
  const wrap = (list: string[]) => (
    <ThemeProvider preferredAppearance={{ typeStyle: "sans", density: "comfortable", motion }}>
      <List ids={list} />
    </ThemeProvider>
  );
  const view = render(wrap(ids));
  return { rerenderIds: (next: string[]) => view.rerender(wrap(next)) };
}

describe("useLayoutSlide", () => {
  it("slides a moved sibling from its old offset to its new place over the move token", () => {
    Object.assign(tops, { a: 0, b: 40, c: 80 });
    const { rerenderIds } = renderList(["a", "b", "c"]);
    animate.mockClear();
    // Remove "a": b and c move up.
    Object.assign(tops, { b: 0, c: 40 });
    rerenderIds(["b", "c"]);
    expect(animate).toHaveBeenCalledTimes(2);
    expect(animate).toHaveBeenCalledWith(
      [{ transform: "translate(0px, 40px)" }, { transform: "translate(0, 0)" }],
      { duration: 280, easing: "ease-out-curve" },
    );
  });

  it("does not animate on first render or when nothing moved", () => {
    Object.assign(tops, { a: 0, b: 40 });
    const { rerenderIds } = renderList(["a", "b"]);
    expect(animate).not.toHaveBeenCalled();
    rerenderIds(["a", "b"]);
    expect(animate).not.toHaveBeenCalled();
  });

  it("makes no animate call at all when the move duration is instant (Subtle and Off resolve to 0.01ms)", () => {
    (readMotionDuration as jest.Mock).mockReturnValue(0.01);
    Object.assign(tops, { a: 0, b: 40 });
    const { rerenderIds } = renderList(["a", "b"]);
    Object.assign(tops, { b: 0 });
    rerenderIds(["b"]);
    expect(animate).not.toHaveBeenCalled();
  });

  it.each<Motion>(["subtle", "off"])(
    "makes no animate call under %s even when the token reads long",
    (motion) => {
      Object.assign(tops, { a: 0, b: 40 });
      const { rerenderIds } = renderList(["a", "b"], motion);
      Object.assign(tops, { b: 0 });
      rerenderIds(["b"]);
      expect(animate).not.toHaveBeenCalled();
    },
  );
});
