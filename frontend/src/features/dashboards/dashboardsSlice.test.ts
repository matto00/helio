import { addDashboard, dashboardsReducer } from "./dashboardsSlice";

describe("dashboardsSlice", () => {
  it("adds a dashboard with the provided name", () => {
    const initialState = dashboardsReducer(undefined, { type: "@@INIT" });
    const nextState = dashboardsReducer(initialState, addDashboard("Operations"));

    expect(nextState.items).toHaveLength(initialState.items.length + 1);
    expect(nextState.items.at(-1)?.name).toBe("Operations");
    expect(nextState.items.at(-1)?.id).toBeTruthy();
  });
});
