import { render } from "@testing-library/react";

import { PanelBodySkeleton } from "./PanelBodySkeleton";
import { PanelContent } from "./PanelContent";
import { PanelSuspenseFallback } from "../../../shared/ui/SuspenseFallback";
import { makeOutputPanel, makeTextPanel, makeMarkdownPanel } from "../../../test/panelFixtures";

// HEL-528 design.md D6 (6.5e) — `PanelContent`'s data-loading state and
// `PanelSuspenseFallback` (the lazy-chunk fallback) must present the SAME
// treatment, and that treatment must not vary by panel kind — the invariant
// that lets a chunk-load and a data-load stay indistinguishable inside one
// panel card (HEL-512).
describe("PanelBodySkeleton — shared, kind-agnostic (design.md D6)", () => {
  it("PanelContent's loading state renders the exact same markup as PanelSuspenseFallback", () => {
    const { container: contentContainer } = render(
      <PanelContent panel={makeOutputPanel()} isLoading />,
    );
    const { container: fallbackContainer } = render(<PanelSuspenseFallback />);

    const contentSkeleton = contentContainer.querySelector(".panel-body-skeleton");
    const fallbackSkeleton = fallbackContainer.querySelector(".panel-body-skeleton");
    expect(contentSkeleton).not.toBeNull();
    expect(fallbackSkeleton).not.toBeNull();
    expect(contentSkeleton?.innerHTML).toBe(fallbackSkeleton?.innerHTML);
  });

  it("renders identically for an output, a text, and a markdown panel — no per-kind variation", () => {
    const first = render(<PanelBodySkeleton />).container.innerHTML;
    const second = render(<PanelBodySkeleton />).container.innerHTML;
    const third = render(<PanelBodySkeleton />).container.innerHTML;
    expect(first).toBe(second);
    expect(second).toBe(third);

    // Sanity: PanelContent's loading branch (the actual call site) is also
    // identical across kinds — it never threads `panel` into the skeleton.
    const outputLoading = render(
      <PanelContent panel={makeOutputPanel()} isLoading />,
    ).container.querySelector(".panel-body-skeleton")?.innerHTML;
    const textLoading = render(
      <PanelContent panel={makeTextPanel()} isLoading />,
    ).container.querySelector(".panel-body-skeleton")?.innerHTML;
    const markdownLoading = render(
      <PanelContent panel={makeMarkdownPanel()} isLoading />,
    ).container.querySelector(".panel-body-skeleton")?.innerHTML;
    expect(outputLoading).toBe(textLoading);
    expect(textLoading).toBe(markdownLoading);
  });
});
