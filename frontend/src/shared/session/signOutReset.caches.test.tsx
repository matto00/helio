// HEL-1634 -- sign-out reset of module-level caches. Each test seeds "user A's" entry, ends the
// session with the real store's `clearAuth`, and asserts the cache serves nothing of A's. Late
// loads started before the sign-out must not land after it, and a subscriber registered before the
// sign-out must stay alive (notified by the reset, and still served by loads started after it).
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { Provider } from "react-redux";

import { clearAuth, setAuth } from "../../features/auth/state/authSlice";
import { patchShellPreferencesRequest } from "../../features/auth/services/authService";
import {
  getCachedHistory,
  loadHistory,
  refreshHistory,
  subscribeHistory,
  HISTORY_RETRY_DELAY_MS,
} from "../../features/panels/history/outputHistoryCache";
import {
  getPublishedComparison,
  publishComparison,
  subscribeComparisons,
} from "../../features/panels/history/metricComparisonStore";
import {
  getInsightChrome,
  setInsightChrome,
} from "../../features/panels/insight/insightChromeStore";
import { usePipelineOwnership } from "../../features/panels/insight/usePipelineOwnership";
import {
  getCachedProvenance,
  getAssertionStatusShared,
  loadProvenance,
  subscribeProvenance,
  subscribeProvenanceInvalidation,
  invalidateProvenance,
} from "../../features/panels/provenance/provenanceCache";
import {
  ensureCapabilitiesLoaded,
  getCapabilitiesEntry,
  invalidateCapabilities,
  subscribeCapabilities,
} from "../../features/panels/state/filterCapabilitiesStore";
import { useSavedOutputRows } from "../../features/pipelines/hooks/useSavedOutputRows";
import { getAssertionStatus, getOutputRows } from "../../features/pipelines/services/outputService";
import { getPipelineById } from "../../features/pipelines/services/pipelineService";
import { useContextListLayout } from "../../app/shell/useContextListLayout";
import { store } from "../../store/store";

jest.mock("../../features/auth/services/authService", () => ({
  patchShellPreferencesRequest: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../features/pipelines/services/outputService", () => ({
  getAssertionStatus: jest.fn(),
  getOutputRows: jest.fn(),
  getFilterCapabilities: jest.fn(),
}));
jest.mock("../../features/pipelines/services/pipelineService", () => ({
  getPipelineById: jest.fn(),
}));
jest.mock("../../features/dashboards/tabs/dashboardChangesService", () => ({
  fetchDashboardChanges: jest.fn(() => Promise.resolve({ serverNow: "", items: [] })),
}));

const USER_A = { id: "user-A", email: "a@example.com", tier: "free" } as never;
const USER_B = { id: "user-B", email: "b@example.com", tier: "free" } as never;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const flush = () => act(async () => void (await Promise.resolve()));

beforeEach(() => {
  store.dispatch(clearAuth());
  store.dispatch(setAuth({ user: USER_A }));
});

const PROVENANCE_A = { outputId: "out-A", sources: [{ name: "A's source" }] } as never;
const HISTORY_A = { current: { capturedAt: "2026-01-01T00:00:00Z", value: 42 } } as never;

describe("provenanceCache", () => {
  test("serves nothing of A's after clearAuth", async () => {
    await loadProvenance("output:out-A", () => Promise.resolve(PROVENANCE_A));
    expect(getCachedProvenance("output:out-A")).toBeDefined();
    store.dispatch(clearAuth());
    expect(getCachedProvenance("output:out-A")).toBeUndefined();
  });

  test("a load started before the sign-out is not stored after it", async () => {
    const pending = deferred<never>();
    const load = loadProvenance("output:out-A", () => pending.promise);
    store.dispatch(clearAuth());
    pending.resolve(PROVENANCE_A);
    await load;
    expect(getCachedProvenance("output:out-A")).toBeUndefined();
  });

  test("the shared in-flight assertion status of A is not reused by B", async () => {
    const pending = deferred<never>();
    (getAssertionStatus as jest.Mock).mockReturnValueOnce(pending.promise);
    void getAssertionStatusShared("out-A");
    store.dispatch(clearAuth());
    (getAssertionStatus as jest.Mock).mockReturnValueOnce(Promise.resolve({ invalid: false }));
    await getAssertionStatusShared("out-A");
    expect(getAssertionStatus).toHaveBeenCalledTimes(2);
  });

  test("a subscriber survives the reset: notified by it, and still served by later loads", async () => {
    const onChange = jest.fn();
    const onInvalidate = jest.fn();
    const unsubscribe = subscribeProvenance(onChange);
    const unsubscribeInvalidation = subscribeProvenanceInvalidation(onInvalidate);
    await loadProvenance("output:out-A", () => Promise.resolve(PROVENANCE_A));
    onChange.mockClear();
    store.dispatch(clearAuth());
    expect(onChange).toHaveBeenCalled();
    onChange.mockClear();
    await loadProvenance("output:out-B", () => Promise.resolve(PROVENANCE_A));
    expect(onChange).toHaveBeenCalled();
    invalidateProvenance("output:out-B");
    expect(onInvalidate).toHaveBeenCalled();
    unsubscribe();
    unsubscribeInvalidation();
  });
});

describe("outputHistoryCache", () => {
  test("serves nothing of A's after clearAuth", async () => {
    await loadHistory("output:out-A", () => Promise.resolve(HISTORY_A));
    expect(getCachedHistory("output:out-A")).toBeDefined();
    store.dispatch(clearAuth());
    expect(getCachedHistory("output:out-A")).toBeUndefined();
  });

  test("a load started before the sign-out is not stored after it", async () => {
    const pending = deferred<never>();
    const load = loadHistory("output:out-A", () => pending.promise);
    store.dispatch(clearAuth());
    pending.resolve(HISTORY_A);
    await load;
    expect(getCachedHistory("output:out-A")).toBeUndefined();
  });

  test("the delayed retry armed for A never refetches after the sign-out", async () => {
    jest.useFakeTimers();
    try {
      const fetcher = jest.fn(() => Promise.resolve(HISTORY_A));
      await loadHistory("output:out-A", fetcher);
      refreshHistory("output:out-A", fetcher);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const calls = fetcher.mock.calls.length;
      store.dispatch(clearAuth());
      await act(async () => {
        jest.advanceTimersByTime(HISTORY_RETRY_DELAY_MS + 100);
        await Promise.resolve();
      });
      expect(fetcher.mock.calls.length).toBe(calls);
    } finally {
      jest.useRealTimers();
    }
  });

  test("a subscriber survives the reset", async () => {
    const onChange = jest.fn();
    const unsubscribe = subscribeHistory(onChange);
    await loadHistory("output:out-A", () => Promise.resolve(HISTORY_A));
    onChange.mockClear();
    store.dispatch(clearAuth());
    expect(onChange).toHaveBeenCalled();
    onChange.mockClear();
    await loadHistory("output:out-B", () => Promise.resolve(HISTORY_A));
    expect(onChange).toHaveBeenCalled();
    unsubscribe();
  });
});

describe("metricComparisonStore", () => {
  test("serves nothing of A's after clearAuth, and its subscriber survives", () => {
    const onChange = jest.fn();
    const unsubscribe = subscribeComparisons(onChange);
    const owner = Symbol("publisher");
    publishComparison("card:panel-A", owner, { baselineAt: "x", baselineText: "A's baseline" });
    expect(getPublishedComparison("card:panel-A")).not.toBeNull();
    onChange.mockClear();
    store.dispatch(clearAuth());
    expect(getPublishedComparison("card:panel-A")).toBeNull();
    expect(onChange).toHaveBeenCalled();
    onChange.mockClear();
    publishComparison("card:panel-B", Symbol("p"), { baselineAt: "x", baselineText: "B" });
    expect(onChange).toHaveBeenCalled();
    unsubscribe();
  });
});

describe("insightChromeStore", () => {
  test("serves nothing of A's after clearAuth", () => {
    setInsightChrome("out-A", Symbol("owner"), { renderedAt: "2026-01-01", refetch: jest.fn() });
    expect(getInsightChrome("out-A")).not.toBeNull();
    store.dispatch(clearAuth());
    expect(getInsightChrome("out-A")).toBeNull();
  });
});

describe("filterCapabilitiesStore", () => {
  test("serves nothing of A's after clearAuth, and its subscriber survives", () => {
    const onChange = jest.fn();
    const unsubscribe = subscribeCapabilities(onChange);
    invalidateCapabilities("out-A");
    expect(getCapabilitiesEntry("out-A")).toBeDefined();
    onChange.mockClear();
    store.dispatch(clearAuth());
    expect(getCapabilitiesEntry("out-A")).toBeUndefined();
    expect(onChange).toHaveBeenCalled();
    onChange.mockClear();
    invalidateCapabilities("out-B");
    expect(onChange).toHaveBeenCalled();
    unsubscribe();
  });

  test("a load started before the sign-out does not land after it", async () => {
    const pending = deferred<never>();
    ensureCapabilitiesLoaded("out-A", () => pending.promise);
    store.dispatch(clearAuth());
    // B asks for the same key: its own load is the one that must win.
    const second = deferred<never>();
    ensureCapabilitiesLoaded("out-A", () => second.promise);
    pending.resolve({ columns: [{ column: "a_secret_column", operators: ["eq"] }] } as never);
    await flush();
    const entry = getCapabilitiesEntry("out-A");
    expect(entry?.status).toBe("loading");
  });
});

describe("useSavedOutputRows", () => {
  test("serves none of A's rows after clearAuth", async () => {
    (getOutputRows as jest.Mock).mockResolvedValueOnce({
      items: [{ secret: "A's row" }],
      columns: ["secret"],
      total: 1,
    });
    (getOutputRows as jest.Mock).mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => useSavedOutputRows("out-A", true));
    await waitFor(() => expect(result.current?.status).toBe("ready"));
    act(() => {
      store.dispatch(clearAuth());
    });
    expect(result.current?.status).not.toBe("ready");
  });

  test("a read started before the sign-out does not land after it", async () => {
    const pending = deferred<never>();
    (getOutputRows as jest.Mock).mockReturnValueOnce(pending.promise);
    (getOutputRows as jest.Mock).mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => useSavedOutputRows("out-A", true));
    await flush();
    act(() => {
      store.dispatch(clearAuth());
    });
    pending.resolve({ items: [{ secret: "A's row" }], columns: ["secret"], total: 1 } as never);
    await flush();
    expect(result.current?.status).not.toBe("ready");
  });
});

describe("usePipelineOwnership", () => {
  const wrapper = ({ children }: PropsWithChildren) => (
    <Provider store={store}>{children}</Provider>
  );

  test("A's 403 on a pipeline is not cached as 'not the owner' for B", async () => {
    (getPipelineById as jest.Mock).mockRejectedValueOnce(new Error("403"));
    const first = renderHook(() => usePipelineOwnership("pipe-1"), { wrapper });
    await waitFor(() => expect(first.result.current).toBe(false));
    first.unmount();
    store.dispatch(clearAuth());
    store.dispatch(setAuth({ user: USER_B }));
    (getPipelineById as jest.Mock).mockResolvedValueOnce({ id: "pipe-1", ownerId: "user-B" });
    const second = renderHook(() => usePipelineOwnership("pipe-1"), { wrapper });
    await waitFor(() => expect(second.result.current).toBe(true));
  });
});

describe("useContextListLayout keyboard write timer", () => {
  test("a nudge pending at sign-out never PATCHes the next user's preferences", () => {
    jest.useFakeTimers();
    try {
      (patchShellPreferencesRequest as jest.Mock).mockClear();
      const wrapper = ({ children }: PropsWithChildren) => (
        <Provider store={store}>{children}</Provider>
      );
      const { result } = renderHook(() => useContextListLayout(), { wrapper });
      act(() => result.current.nudgeWidth(300));
      act(() => {
        store.dispatch(clearAuth());
        store.dispatch(setAuth({ user: USER_B }));
      });
      act(() => {
        jest.advanceTimersByTime(5000);
      });
      expect(patchShellPreferencesRequest).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
