import { render } from "@testing-library/react";

import { PanelBodySkeleton } from "./PanelBodySkeleton";
import { PanelContent } from "./PanelContent";
import { PanelSuspenseFallback } from "../../../shared/ui/SuspenseFallback";
import { makeChartPanel, makeMetricPanel, makeTablePanel } from "../../../test/panelFixtures";

// HEL-528 design.md D6 (6.5e) — `PanelContent`'s data-loading state and
// `PanelSuspenseFallback` (the lazy-chunk fallback) must present the SAME
// treatment, and that treatment must not vary by panel kind — the invariant
// that lets a chunk-load and a data-load stay indistinguishable inside one
// panel card (HEL-512).
describe("PanelBodySkeleton — shared, kind-agnostic (design.md D6)", () => {
  it("PanelContent's loading state renders the exact same markup as PanelSuspenseFallback", () => {
    const { container: contentContainer } = render(
      <PanelContent panel={makeMetricPanel()} isLoading />,
    );
    const { container: fallbackContainer } = render(<PanelSuspenseFallback />);

    const contentSkeleton = contentContainer.querySelector(".panel-body-skeleton");
    const fallbackSkeleton = fallbackContainer.querySelector(".panel-body-skeleton");
    expect(contentSkeleton).not.toBeNull();
    expect(fallbackSkeleton).not.toBeNull();
    expect(contentSkeleton?.innerHTML).toBe(fallbackSkeleton?.innerHTML);
  });

  it("renders identically for a metric, a table, and a chart panel — no per-kind variation", () => {
    const metric = render(<PanelBodySkeleton />).container.innerHTML;
    const table = render(<PanelBodySkeleton />).container.innerHTML;
    const chart = render(<PanelBodySkeleton />).container.innerHTML;
    expect(metric).toBe(table);
    expect(table).toBe(chart);

    // Sanity: PanelContent's loading branch (the actual call site) is also
    // identical across kinds — it never threads `panel` into the skeleton.
    const metricLoading = render(
      <PanelContent panel={makeMetricPanel()} isLoading />,
    ).container.querySelector(".panel-body-skeleton")?.innerHTML;
    const tableLoading = render(
      <PanelContent panel={makeTablePanel()} isLoading />,
    ).container.querySelector(".panel-body-skeleton")?.innerHTML;
    const chartLoading = render(
      <PanelContent panel={makeChartPanel()} isLoading />,
    ).container.querySelector(".panel-body-skeleton")?.innerHTML;
    expect(metricLoading).toBe(tableLoading);
    expect(tableLoading).toBe(chartLoading);
  });
});
