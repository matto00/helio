import { render, screen } from "@testing-library/react";
import { Profiler, useEffect } from "react";
import fs from "fs";
import path from "path";

import {
  entranceClassProps,
  useKeyedEntrance,
  type Entrance,
  type KeyedEntranceOptions,
} from "./useKeyedEntrance";

const record: { seen: Record<string, Entrance> } = { seen: {} };

function List({ keys, options }: { keys: string[]; options: KeyedEntranceOptions }) {
  const { entranceOf } = useKeyedEntrance(keys, options);
  useEffect(() => {
    record.seen = Object.fromEntries(keys.map((key) => [key, entranceOf(key)]));
  });
  return (
    <ul>
      {keys.map((key) => {
        const entry = entranceOf(key);
        return (
          <li key={key} data-testid={key} data-entrance={entry.phase ?? undefined}>
            {entry.index}
          </li>
        );
      })}
    </ul>
  );
}

const POP: KeyedEntranceOptions = { playInitial: true, later: "pop" };
const phases = () => Object.fromEntries(Object.entries(record.seen).map(([k, v]) => [k, v.phase]));
const indexes = () => Object.fromEntries(Object.entries(record.seen).map(([k, v]) => [k, v.index]));

describe("useKeyedEntrance", () => {
  it("latches the first non-empty population in the order given", () => {
    render(<List keys={["c", "a", "b"]} options={POP} />);
    expect(phases()).toEqual({ c: "enter", a: "enter", b: "enter" });
    expect(indexes()).toEqual({ c: 0, a: 1, b: 2 });
  });

  it("an empty list while loading does not count as the population", () => {
    const { rerender } = render(<List keys={[]} options={POP} />);
    rerender(<List keys={["a", "b"]} options={POP} />);
    expect(phases()).toEqual({ a: "enter", b: "enter" });
    expect(indexes()).toEqual({ a: 0, b: 1 });
  });

  it("a key first seen later pops (index 0) and the first population does not animate again", () => {
    const { rerender } = render(<List keys={["a", "b"]} options={POP} />);
    rerender(<List keys={["a", "x", "b"]} options={POP} />);
    expect(phases()).toEqual({ a: "enter", x: "pop", b: "enter" });
    expect(record.seen.x.index).toBe(0);
  });

  it("later: none leaves a later key still, and playInitial: false leaves the first population still", () => {
    const { rerender } = render(
      <List keys={["a"]} options={{ playInitial: false, later: "none" }} />,
    );
    rerender(<List keys={["a", "b"]} options={{ playInitial: false, later: "none" }} />);
    expect(phases()).toEqual({ a: null, b: null });
  });

  it("never replays on a re-render with the same keys, and keeps a popped key's phase", () => {
    const { rerender } = render(<List keys={["a"]} options={POP} />);
    rerender(<List keys={["a", "b"]} options={POP} />);
    const popped = screen.getByTestId("b");
    rerender(<List keys={["a", "b"]} options={POP} />);
    expect(phases()).toEqual({ a: "enter", b: "pop" });
    expect(screen.getByTestId("b")).toBe(popped);
  });

  it("a key that leaves and returns counts as later", () => {
    const { rerender } = render(<List keys={["a", "b"]} options={POP} />);
    rerender(<List keys={["a"]} options={POP} />);
    rerender(<List keys={["a", "b"]} options={POP} />);
    expect(phases()).toEqual({ a: "enter", b: "pop" });
  });

  it("entranceOf yields a phase and an index, never a className", () => {
    render(<List keys={["a", "b"]} options={POP} />);
    for (const entry of Object.values(record.seen)) {
      expect(Object.keys(entry).sort()).toEqual(["index", "phase"]);
    }
  });

  it("adds no extra commit for the latch (it resolves in the render pass)", () => {
    const commits = { count: 0 };
    const view = (keys: string[]) => (
      <Profiler id="k" onRender={() => void (commits.count += 1)}>
        <List keys={keys} options={POP} />
      </Profiler>
    );
    const { rerender } = render(view(["a", "b"]));
    expect(commits.count).toBe(1);
    rerender(view(["a", "b", "c"]));
    expect(commits.count).toBe(2);
  });
});

describe("entranceClassProps", () => {
  it("maps enter to the staggered class with its index, emphasized on request", () => {
    expect(entranceClassProps({ phase: "enter", index: 3 })).toEqual({
      className: "motion-enter",
      style: { "--motion-index": 3 },
    });
    expect(entranceClassProps({ phase: "enter", index: 1 }, { emphasized: true }).className).toBe(
      "motion-enter motion-enter--emphasized",
    );
  });

  it("maps pop to motion-pop and no phase to nothing", () => {
    expect(entranceClassProps({ phase: "pop", index: 0 })).toEqual({
      className: "motion-pop",
      style: {},
    });
    expect(entranceClassProps({ phase: null, index: 0 })).toEqual({ className: "", style: {} });
  });
});

describe("motion.css entrance rules", () => {
  const css = fs
    .readFileSync(path.join(__dirname, "motion.css"), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (selector: string) =>
    new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

  it(".motion-pop is the rise keyframe on the overshoot curve, backwards-filled, without a delay", () => {
    const body = rule(".motion-pop");
    expect(body).toMatch(
      /animation:\s*motion-enter var\(--motion-duration-standard\) var\(--motion-ease-overshoot\) backwards/,
    );
    expect(body).not.toMatch(/\bboth\b|\bforwards\b/);
  });

  it(".motion-enter--emphasized only lengthens the duration to the emphasized token", () => {
    expect(rule(".motion-enter--emphasized").trim()).toBe(
      "animation-duration: var(--motion-duration-emphasized);",
    );
    expect(css.indexOf(".motion-enter--emphasized")).toBeGreaterThan(
      css.indexOf(".motion-enter {"),
    );
  });
});
