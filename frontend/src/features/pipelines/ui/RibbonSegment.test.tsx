import { render } from "@testing-library/react";

import { RibbonSegment } from "./RibbonSegment";

// HEL sweep F-014 regression: the ribbon used to paint every step gap with
// `--app-accent`/`--app-accent-strong`/`--app-accent-mid` fills — a
// persistent accent-tinted texture across the whole pipeline-builder canvas.
// Locks the fix in as a neutral-only connector so a future edit can't
// silently reintroduce an accent token here.
describe("RibbonSegment", () => {
  it("renders no accent-colored fill or stroke", () => {
    const { container } = render(<RibbonSegment />);
    const svg = container.querySelector("svg.pipeline-detail-page__ribbon");
    expect(svg).toBeInTheDocument();
    expect(svg?.outerHTML).not.toMatch(/--app-accent/);
  });

  it("uses only neutral border tokens for its bands", () => {
    const { container } = render(<RibbonSegment />);
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBeGreaterThan(0);
    paths.forEach((path) => {
      const fill = path.getAttribute("fill") ?? "";
      expect(fill === "var(--app-border-strong)" || fill === "var(--app-border-subtle)").toBe(true);
    });
  });
});
