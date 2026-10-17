import { dashboardSeenStore } from "../../../commandPalette/model/dashboardSeenStore";
import { resetServerClock } from "../serverClock";
import { noteOwnDashboardWrite } from "./warmCache";

describe("noteOwnDashboardWrite feeds the Home page's own-write stamp (HEL-1578 D5)", () => {
  beforeEach(() => resetServerClock());

  it("records ownWriteAt for a dashboard with no tab, keeping its view stamp", () => {
    dashboardSeenStore.recordViewed("own-x", 1_000);
    const before = Date.now();
    noteOwnDashboardWrite(jest.fn(), null, "own-x", false);
    const seen = dashboardSeenStore.get("own-x");
    expect(seen?.viewedAt).toBe(1_000);
    expect(seen?.ownWriteAt).toBeGreaterThanOrEqual(before);
  });

  it("records it whether or not the list is loaded", () => {
    noteOwnDashboardWrite(jest.fn(), null, "own-y", true);
    expect(dashboardSeenStore.get("own-y")?.ownWriteAt).toBeDefined();
  });
});
