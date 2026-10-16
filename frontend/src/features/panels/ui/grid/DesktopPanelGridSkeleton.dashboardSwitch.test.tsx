import { Profiler } from "react";
import { render } from "@testing-library/react";

import type { DashboardLayout } from "../../../dashboards/types/dashboard";
import { DesktopPanelGridSkeleton } from "./DesktopPanelGridSkeleton";

// HEL-1575 fix cycle 3: the loading skeleton uses the real react-grid-layout (no mock). react-grid-layout
// 2.2.4 never settles when ONE render changes both the layouts (with their children) and the active
// breakpoint: its sync effect alternates between the two breakpoints' layouts forever ("Maximum update
// depth exceeded"). On load the skeleton is first drawn for the dashboard selected by default at the
// initial width, then for the URL's dashboard at the measured width, i.e. exactly that change. Keying the
// grid by dashboard id remounts it, so the library sees a fresh mount instead of a double change.
// The loop is a chain of synchronous commits inside the library, so a commit budget (React Profiler) turns
// "never settles" into a failure instead of a hung test run.
let commits = 0;
function onRender() {
  commits += 1;
  if (commits > 200) throw new Error("LOOP: the skeleton grid never settled");
}
function Probe(props: { id: string; width: number }) {
  return (
    <Profiler id="skeleton" onRender={onRender}>
      <DesktopPanelGridSkeleton
        dashboardId={props.id}
        layout={layoutFor(props.id)}
        width={props.width}
      />
    </Profiler>
  );
}

const item = (panelId: string, w: number) => ({ panelId, x: 0, y: 0, w, h: 5 });
const layoutFor = (id: string): DashboardLayout => ({
  lg: [item(id, 6)],
  md: [item(id, 5)],
  sm: [item(id, 3)],
  xs: [item(id, 2)],
});

describe("DesktopPanelGridSkeleton — dashboard and breakpoint change in one render", () => {
  it("settles instead of looping when the dashboard and the breakpoint change together", () => {
    commits = 0;
    let depthErrors = 0;
    const spy = jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes("Maximum update depth")) depthErrors += 1;
    });
    try {
      const { rerender, container } = render(<Probe id="a" width={1280} />);
      expect(() => rerender(<Probe id="b" width={928} />)).not.toThrow();
      expect(depthErrors).toBe(0);
      expect(container.querySelectorAll(".react-grid-item")).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
});
