import { addPanel, panelsReducer } from "./panelsSlice";

describe("panelsSlice", () => {
  it("adds a panel linked to the referenced dashboard", () => {
    const nextState = panelsReducer(
      undefined,
      addPanel({ dashboardId: "dashboard-1", title: "Latency" }),
    );

    expect(nextState.items).toHaveLength(1);
    expect(nextState.items[0]).toMatchObject({
      dashboardId: "dashboard-1",
      title: "Latency",
    });
    expect(nextState.items[0].id).toBeTruthy();
  });
});
