import { render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";

import { useStaggeredEntrance } from "./useStaggeredEntrance";

function List({ items }: { items: string[] }) {
  const stagger = useStaggeredEntrance(items.length);
  return (
    <ul>
      {items.map((item, index) => {
        const { className, style } = stagger.itemProps(index);
        return (
          <li key={item} className={className} style={style} data-testid={item}>
            {item}
          </li>
        );
      })}
    </ul>
  );
}

const indexOf = (id: string) => screen.getByTestId(id).style.getPropertyValue("--motion-index");

describe("useStaggeredEntrance", () => {
  it("indexes the first population in order and gives every item the entrance class", () => {
    render(<List items={["a", "b", "c"]} />);
    expect(["a", "b", "c"].map(indexOf)).toEqual(["0", "1", "2"]);
    expect(screen.getByTestId("c")).toHaveClass("motion-enter");
  });

  it("gives an item that arrives later index 0, a single rise with no queue", () => {
    const { rerender } = render(<List items={["a", "b"]} />);
    rerender(<List items={["a", "b", "c", "d"]} />);
    expect(["a", "b", "c", "d"].map(indexOf)).toEqual(["0", "1", "0", "0"]);
  });

  it("treats the first NON-empty render as the population (an empty list while loading does not count)", () => {
    const { rerender } = render(<List items={[]} />);
    rerender(<List items={["a", "b", "c"]} />);
    expect(["a", "b", "c"].map(indexOf)).toEqual(["0", "1", "2"]);
  });

  it("keeps the same element on a re-render (the CSS animation is not replayed by a new node)", () => {
    const { rerender } = render(<List items={["a", "b"]} />);
    const before = screen.getByTestId("a");
    rerender(<List items={["a", "b"]} />);
    expect(screen.getByTestId("a")).toBe(before);
  });

  it("releases the entrance's end state: the animation fills backwards, not both (no permanent transform)", () => {
    const css = fs
      .readFileSync(path.join(__dirname, "motion.css"), "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = /\.motion-enter\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/\bbackwards\s*;/);
    expect(rule).not.toMatch(/\bboth\b|\bforwards\b/);
  });
});
