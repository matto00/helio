import { configureStore } from "@reduxjs/toolkit";

import * as outputService from "../../pipelines/services/outputService";
import {
  currentGeneration,
  invalidateOutput,
  invalidatePipeline,
  registerOutputPipeline,
} from "./outputFreshness";
import { fetchPanelPage } from "./panelThunks";
import { panelsReducer } from "./panelsSlice";

// HEL-1392 design.md D1/D2 -- a window is stamped with the generation read when its request STARTED.
// An invalidation that lands while the request is in flight must leave the window non-reusable, so a
// remount fetches again (never serves data that may predate the write).
jest.mock("../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../pipelines/services/outputService"),
  getOutputRows: jest.fn(),
}));
const rows = jest.mocked(outputService.getOutputRows);

function makeStore() {
  return configureStore({
    reducer: { panels: panelsReducer } as never,
    preloadedState: { panels: panelsReducer(undefined, { type: "@@INIT" }) } as never,
  });
}

describe("fetchPanelPage generation stamp", () => {
  it.each([
    ["an Output write", () => invalidateOutput("o1")],
    ["a pipeline write or run", () => invalidatePipeline("p1")],
  ])(
    "stamps the generation at request start when %s lands mid-flight",
    async (_name, invalidate) => {
      registerOutputPipeline("o1", "p1");
      let resolve!: (v: Awaited<ReturnType<typeof outputService.getOutputRows>>) => void;
      rows.mockReturnValueOnce(new Promise((res) => (resolve = res)));
      const store = makeStore();
      const atStart = currentGeneration("o1");
      const done = store.dispatch(
        fetchPanelPage({ panelId: "p", outputId: "o1", page: 0, pageSize: 200 }) as never,
      );
      await Promise.resolve();
      invalidate();
      resolve({ items: [], total: 0, offset: 0, limit: 200, materialized: true });
      await done;
      const entry = (store.getState() as { panels: ReturnType<typeof panelsReducer> }).panels
        .paginationState["p"];
      expect(entry.generation).toBe(atStart);
      expect(entry.generation).not.toBe(currentGeneration("o1"));
    },
  );
});
