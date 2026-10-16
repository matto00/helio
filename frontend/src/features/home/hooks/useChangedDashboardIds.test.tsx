import { configureStore } from "@reduxjs/toolkit";
import { act, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";

import { dashboardSeenStore } from "../../commandPalette/model/dashboardSeenStore";
import { homeSummaryReducer, loadHomeSummary } from "../state/homeSummarySlice";
import { summary } from "../test/homeFixtures";
import { useChangedDashboardIds } from "./useChangedDashboardIds";

jest.mock("../services/homeService");
import { fetchHomeSummary } from "../services/homeService";

const fetchMock = fetchHomeSummary as jest.MockedFunction<typeof fetchHomeSummary>;

function Probe() {
  return <p data-testid="ids">{[...useChangedDashboardIds()].sort().join(",")}</p>;
}

async function mount(changes: Array<{ id: string; content: number | null; data: number | null }>) {
  fetchMock.mockResolvedValue(
    summary({
      dashboardChanges: changes.map((c) => ({
        dashboardId: c.id,
        contentUpdatedAt: c.content === null ? null : new Date(c.content).toISOString(),
        dataUpdatedAt: c.data === null ? null : new Date(c.data).toISOString(),
      })),
    }),
  );
  const store = configureStore({ reducer: { homeSummary: homeSummaryReducer } });
  await store.dispatch(loadHomeSummary());
  render(
    <Provider store={store}>
      <Probe />
    </Provider>,
  );
  return store;
}

const ids = () => screen.getByTestId("ids").textContent;

describe("useChangedDashboardIds (HEL-1578 Phase B)", () => {
  beforeEach(() => fetchMock.mockReset());

  it("shows the dot for another user's edit after the view stamp, and not for an unviewed dashboard", async () => {
    dashboardSeenStore.recordViewed("pb-a", 1_000);
    await mount([
      { id: "pb-a", content: 2_000, data: null },
      { id: "pb-never", content: 2_000, data: null },
    ]);
    expect(ids()).toBe("pb-a");
  });

  it("shows the dot for new data", async () => {
    dashboardSeenStore.recordViewed("pb-d", 1_000);
    await mount([{ id: "pb-d", content: 500, data: 3_000 }]);
    expect(ids()).toBe("pb-d");
  });

  it("clears once the dashboard is viewed again", async () => {
    dashboardSeenStore.recordViewed("pb-c", 1_000);
    await mount([{ id: "pb-c", content: 2_000, data: null }]);
    expect(ids()).toBe("pb-c");
    act(() => dashboardSeenStore.recordViewed("pb-c", 2_500));
    expect(ids()).toBe("");
  });

  it("never marks the user's own edit (own write after the content change)", async () => {
    dashboardSeenStore.recordViewed("pb-o", 1_000);
    dashboardSeenStore.recordOwnWrite("pb-o", 2_100);
    await mount([{ id: "pb-o", content: 2_000, data: null }]);
    expect(ids()).toBe("");
  });

  it("opening X leaves Y's dot: only the viewed dashboard's stamp moves", async () => {
    dashboardSeenStore.recordViewed("pb-x", 1_000);
    dashboardSeenStore.recordViewed("pb-y", 1_000);
    await mount([
      { id: "pb-x", content: 2_000, data: null },
      { id: "pb-y", content: 2_000, data: null },
    ]);
    expect(ids()).toBe("pb-x,pb-y");
    act(() => dashboardSeenStore.recordViewed("pb-x", 3_000));
    expect(ids()).toBe("pb-y");
  });
});
