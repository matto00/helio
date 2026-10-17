import { fireEvent, render } from "@testing-library/react";
import fs from "fs";
import path from "path";

import { MarkShape } from "./TimelineMark";

// HEL-1584 D11b: a run mark that turns failed while it is on screen nudges once; one that was already failed never does.

const shape = (container: HTMLElement) => container.querySelector(".tl-shape") as HTMLElement;

describe("MarkShape failed nudge (HEL-1584)", () => {
  it("running -> failed adds the nudge once, and its animation ending removes it", () => {
    const { container, rerender } = render(<MarkShape status="running" />);
    expect(shape(container)).not.toHaveClass("tl-shape--nudge");
    rerender(<MarkShape status="failed" />);
    expect(shape(container)).toHaveClass("tl-shape--failed", "tl-shape--nudge");
    rerender(<MarkShape status="failed" />);
    expect(shape(container)).toHaveClass("tl-shape--nudge");
    fireEvent.animationEnd(shape(container));
    expect(shape(container)).not.toHaveClass("tl-shape--nudge");
  });

  it("a mark mounted already failed never nudges", () => {
    const { container, rerender } = render(<MarkShape status="failed" />);
    expect(shape(container)).not.toHaveClass("tl-shape--nudge");
    rerender(<MarkShape status="failed" />);
    expect(shape(container)).not.toHaveClass("tl-shape--nudge");
  });

  it("a change to any other status does not nudge", () => {
    const { container, rerender } = render(<MarkShape status="running" />);
    rerender(<MarkShape status="succeeded" />);
    expect(shape(container)).not.toHaveClass("tl-shape--nudge");
  });

  it("the keyframes keep the diamond's rotation in every frame and move by the nudge token only", () => {
    const css = fs
      .readFileSync(path.join(__dirname, "HomePage.css"), "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const keyframes = /@keyframes tl-nudge\s*\{([\s\S]*?)\n\}\n/.exec(css)?.[1] ?? "";
    const frames = keyframes.match(/transform:[^;]+;/g) ?? [];
    expect(frames.length).toBeGreaterThanOrEqual(3);
    for (const frame of frames) expect(frame).toContain("rotate(45deg)");
    expect(keyframes).toContain("var(--motion-nudge-distance)");
    expect(keyframes).not.toMatch(/translateX\(-?[1-9]/);
    expect(css).toMatch(
      /\.tl-shape--failed\.tl-shape--nudge\s*\{\s*animation:\s*tl-nudge var\(--motion-duration-standard\) var\(--motion-ease-out\);/,
    );
  });
});
