// HEL-1380 — render-count proof that a cache-miss mount of `PanelCardBody` no longer pays a
// redundant render from `useOutputMeta`'s mount-time same-value `setIsLoading(true)`.
//
// This must be proven at the component level, not with a bare `renderHook`: React's eager-state
// bailout drops a same-value update without re-invoking the component when the fiber has nothing
// else pending, so an isolated hook cannot show the waste. `PanelCardBody` has other mount-time
// updates pending, which is exactly where the bailout re-invokes the function body.

import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { useEffect, useState } from "react";

import { makeOutputPanel } from "../../../test/panelFixtures";
import { authReducer } from "../../auth/state/authSlice";
import { usePanelData } from "../hooks/usePanelData";
import { useOutputMeta } from "../hooks/useOutputMeta";
import { usePanelPolling } from "../hooks/usePanelPolling";
import { resetOutputFreshness } from "../state/outputFreshness";
import { getOutputId } from "../state/panelNarrowing";
import { panelsReducer } from "../state/panelsSlice";
import type { Panel } from "../types/panel";
import { PanelCardBody } from "./PanelCardBody";

jest.mock("../hooks/usePanelPolling", () => ({ usePanelPolling: jest.fn() }));
jest.mock("../hooks/usePanelRunRefresh", () => ({ usePanelRunRefresh: jest.fn() }));
jest.mock("../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../pipelines/services/outputService"),
  getOutputById: jest.fn(() => new Promise(() => {})),
  getOutputRows: jest.fn(() => new Promise(() => {})),
}));

const mockUsePanelPolling = jest.mocked(usePanelPolling);

// Plays the role `PanelCard` plays in production: the single `usePanelData` call site, whose
// mount-time store dispatch is the other pending update on `PanelCardBody`'s fiber.
function PanelCardBodyHarness({ panel }: { panel: Panel }) {
  const panelData = usePanelData(panel);
  return (
    <PanelCardBody
      panel={panel}
      frozen={false}
      outputId={getOutputId(panel)}
      data={panelData.data}
      rawRows={panelData.rawRows}
      headers={panelData.headers}
      isLoading={panelData.isLoading}
      error={panelData.error}
      errorKind={panelData.errorKind}
      noData={panelData.noData}
      neverMaterialized={panelData.neverMaterialized}
      rowsTruncated={panelData.rowsTruncated}
      refresh={panelData.refresh}
    />
  );
}

function makeStore(panel: Panel) {
  return configureStore({
    reducer: { panels: panelsReducer, auth: authReducer } as never,
    preloadedState: {
      panels: {
        items: [panel],
        loadedDashboardId: "d1",
        status: "succeeded",
        error: null,
        pendingPanelUpdates: {},
        lastSavedAt: null,
        paginationState: {},
        latestFetchRequestId: {},
      },
    } as never,
  });
}

async function flushMicrotasks() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  resetOutputFreshness();
  mockUsePanelPolling.mockClear();
});

describe("PanelCardBody — HEL-1380 mount render count", () => {
  it("a cache-miss output panel mount invokes PanelCardBody exactly 2 times (was 3 before the fix)", async () => {
    const panel = makeOutputPanel({ config: { outputId: "output-1" } });
    const store = makeStore(panel);
    await act(async () => {
      render(
        <MemoryRouter>
          <Provider store={store}>
            <PanelCardBodyHarness panel={panel} />
          </Provider>
        </MemoryRouter>,
      );
    });
    await flushMicrotasks();
    expect(mockUsePanelPolling.mock.calls.length).toBe(2);
  });
});

// A consumer of `useOutputMeta(null)` with one other mount-time state update, the situation in
// which the null branch's same-value `setOutput(null)`/`setIsLoading(false)` is observable.
describe("useOutputMeta(null) — HEL-1380 mount render count", () => {
  it("a null-outputId consumer with another mount-time update renders exactly 2 times (was 3)", async () => {
    const renderSpy = jest.fn();
    function Consumer() {
      renderSpy();
      const [, setTick] = useState(0);
      useOutputMeta(null);
      // The other pending mount-time update; the lint rule targets production effects.
      useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setTick(1);
      }, []);
      return null;
    }
    await act(async () => {
      render(<Consumer />);
    });
    await flushMicrotasks();
    expect(renderSpy).toHaveBeenCalledTimes(2);
  });
});
