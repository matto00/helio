import { Profiler } from "react";
import { render } from "@testing-library/react";

import type { DashboardLayout, DashboardLayoutItem } from "../../../dashboards/types/dashboard";
import { DesktopPanelGridSkeleton } from "./DesktopPanelGridSkeleton";

// HEL-1835: on a full load the skeleton grid is first drawn for the dashboard id from the URL with no layout yet (the
// default stub set) at the pre-measure width (1280, `md`), then, for the SAME dashboard id, with the dashboard's
// layout at the measured width. When the stored `md` layout is empty and `sm` is authored that is one render that
// changes both the layouts and the breakpoint of a live instance, and react-grid-layout 2.2.4 never settles on it
// ("Maximum update depth exceeded" x3-4 in the browser; the HEL-1575 shape, which keying by dashboard id alone does
// not cover because the dashboard id did not change). The grid is also keyed by the active breakpoint now.
// A commit budget (React Profiler) turns "never settles" into a failure instead of a hung run.
let commits = 0;
function onRender() {
  commits += 1;
  if (commits > 200) throw new Error("LOOP: the skeleton grid never settled");
}
function Probe(props: { layout: DashboardLayout; width: number }) {
  return (
    <Profiler id="skeleton" onRender={onRender}>
      <DesktopPanelGridSkeleton dashboardId="d" layout={props.layout} width={props.width} />
    </Profiler>
  );
}

const item = (panelId: string, x: number, y: number, w: number, h = 4): DashboardLayoutItem => ({
  panelId,
  x,
  y,
  w,
  h,
});
const ids = Array.from({ length: 9 }, (_, i) => `p${i}`);
const loaded: DashboardLayout = {
  lg: ids.map((id, i) => item(id, (i % 3) * 4, Math.floor(i / 3) * 4, 4)),
  md: [],
  sm: ids.map((id, i) => item(id, i % 2 === 0 ? 0 : 3, Math.floor(i / 2) * 4, i % 2 === 0 ? 3 : 2)),
  xs: [],
};
const empty: DashboardLayout = { lg: [], md: [], sm: [], xs: [] };

function countDepthErrors(run: () => void): number {
  let depthErrors = 0;
  const spy = jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes("Maximum update depth")) depthErrors += 1;
  });
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  return depthErrors;
}

describe("DesktopPanelGridSkeleton: the layout arrives together with the measured width", () => {
  it("settles when the layout and the breakpoint change in one render of the same dashboard", () => {
    commits = 0;
    const depthErrors = countDepthErrors(() => {
      const { rerender } = render(<Probe layout={empty} width={1280} />);
      expect(() => rerender(<Probe layout={loaded} width={928} />)).not.toThrow();
    });
    expect(depthErrors).toBe(0);
  });

  it("renders the loaded layout's stubs after the change", () => {
    commits = 0;
    const { rerender, container } = render(<Probe layout={empty} width={1280} />);
    rerender(<Probe layout={loaded} width={928} />);
    expect(container.querySelectorAll(".react-grid-item")).toHaveLength(9);
  });
});
