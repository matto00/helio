// useStepCardState.test.ts — F-005: every step-config editor PATCHed the
// backend on every keystroke, with no debounce and no protection against an
// out-of-order response clobbering a newer edit. Exercises `persist` (the
// hook's single PATCH path, shared by all 20 change handlers) directly via
// one representative handler (`onLimitChange`) rather than every handler —
// they all funnel through the same `persist` function.

import { act, renderHook } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";

import { useStepCardState } from "./useStepCardState";
import { updatePipelineStep } from "../services/pipelineService";
import { OP_TYPES, unsupportedOpType } from "../state/stepNarrowing";
import type { Step } from "../types/step";
import type { PipelineStep, PipelineStepConfig } from "../types/pipelineStep";

function makeAxiosError(data: unknown, status = 400): AxiosError {
  return new AxiosError(
    `Request failed with status code ${status}`,
    "ERR_BAD_REQUEST",
    undefined,
    undefined,
    {
      status,
      statusText: "Bad Request",
      headers: {},
      config: { headers: new AxiosHeaders() },
      data,
    },
  );
}

jest.mock("../services/pipelineService", () => ({
  updatePipelineStep: jest.fn(),
}));

const updatePipelineStepMock = jest.mocked(updatePipelineStep);

const LIMIT_OP_TYPE = OP_TYPES.find((op) => op.id === "limit")!;

// HEL-1109: `persisted-step-1` (not `step-1`) deliberately, everywhere in
// this file — `persist`'s new not-yet-real-id guard treats exactly the
// `^step-\d+$` shape (the real `makeStep` temp-id format) as a draft with no
// PATCH path, so a fixture id in that same shape would silently defeat
// every test below that expects a PATCH to fire.
function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    id: "persisted-step-1",
    opType: LIMIT_OP_TYPE,
    label: "Limit rows",
    config: { count: 5 },
    enabled: true,
    ...overrides,
  };
}

function resolvedStep(config: PipelineStepConfig): PipelineStep {
  return {
    id: "persisted-step-1",
    pipelineId: "pipe-1",
    position: 0,
    type: "limit",
    config,
    createdAt: "",
    updatedAt: "",
  } as unknown as PipelineStep;
}

/** A promise plus its externally-callable resolver, so a test can control
 *  exactly when — and in what order — two overlapping PATCH calls settle. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // A rejected promise with no attached `.catch` before the test explicitly rejects it fires
  // Node's unhandledRejection warning — pre-attach a no-op catch (HEL-1102 task 2.4's new
  // reject-path tests are this helper's first rejecting caller).
  promise.catch(() => {});
  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.useFakeTimers();
  updatePipelineStepMock.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("useStepCardState — persist debounce (F-005)", () => {
  it("does not PATCH immediately on a single change", () => {
    updatePipelineStepMock.mockResolvedValue(resolvedStep({ count: 6 }));
    const onConfigChange = jest.fn();
    const step = makeStep();
    const { result } = renderHook(() => useStepCardState(step, onConfigChange));

    act(() => {
      result.current.onLimitChange({ count: 6 });
    });

    expect(updatePipelineStepMock).not.toHaveBeenCalled();
  });

  it("collapses a burst of rapid changes (keystrokes) into exactly one PATCH, with the latest value", () => {
    updatePipelineStepMock.mockResolvedValue(resolvedStep({ count: 9 }));
    const onConfigChange = jest.fn();
    const step = makeStep();
    const { result } = renderHook(() => useStepCardState(step, onConfigChange));

    // Simulate a rapid burst — e.g. "5" -> "9" typed digit by digit, each
    // keystroke re-clearing the pending debounce timer.
    for (const count of [6, 7, 8, 9]) {
      act(() => {
        result.current.onLimitChange({ count });
        jest.advanceTimersByTime(100); // well under the debounce window
      });
    }
    expect(updatePipelineStepMock).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(400);
    });

    expect(updatePipelineStepMock).toHaveBeenCalledTimes(1);
    expect(updatePipelineStepMock).toHaveBeenCalledWith("persisted-step-1", { count: 9 });
  });

  it("PATCHes again for a second edit made after the first debounce window elapsed", () => {
    updatePipelineStepMock
      .mockResolvedValueOnce(resolvedStep({ count: 6 }))
      .mockResolvedValueOnce(resolvedStep({ count: 7 }));
    const onConfigChange = jest.fn();
    const step = makeStep();
    const { result } = renderHook(() => useStepCardState(step, onConfigChange));

    act(() => {
      result.current.onLimitChange({ count: 6 });
      jest.advanceTimersByTime(400);
    });
    expect(updatePipelineStepMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.onLimitChange({ count: 7 });
      jest.advanceTimersByTime(400);
    });
    expect(updatePipelineStepMock).toHaveBeenCalledTimes(2);
    expect(updatePipelineStepMock).toHaveBeenLastCalledWith("persisted-step-1", { count: 7 });
  });

  it("clears the pending debounce timer on unmount — no PATCH fires after the component is gone", () => {
    updatePipelineStepMock.mockResolvedValue(resolvedStep({ count: 6 }));
    const onConfigChange = jest.fn();
    const step = makeStep();
    const { result, unmount } = renderHook(() => useStepCardState(step, onConfigChange));

    act(() => {
      result.current.onLimitChange({ count: 6 });
    });
    unmount();

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(updatePipelineStepMock).not.toHaveBeenCalled();
  });

  it("drops an out-of-order (stale) PATCH response instead of clobbering a newer edit's result", async () => {
    const first = deferred<PipelineStep>();
    const second = deferred<PipelineStep>();
    updatePipelineStepMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const onConfigChange = jest.fn();
    const step = makeStep();
    const { result } = renderHook(() => useStepCardState(step, onConfigChange));

    // First edit — its debounce window elapses and the PATCH is dispatched
    // (but not yet resolved).
    act(() => {
      result.current.onLimitChange({ count: 6 });
      jest.advanceTimersByTime(400);
    });
    // Second edit — a separate debounce window (simulating a user typing
    // again after the first request was already in flight), also dispatched.
    act(() => {
      result.current.onLimitChange({ count: 7 });
      jest.advanceTimersByTime(400);
    });
    expect(updatePipelineStepMock).toHaveBeenCalledTimes(2);

    // Network reorders the responses: the NEWER request (count: 7) resolves
    // first, then the OLDER, now-stale request (count: 6) resolves after it.
    await act(async () => {
      second.resolve(resolvedStep({ count: 7 }));
    });
    expect(onConfigChange).toHaveBeenCalledTimes(1);
    expect(onConfigChange).toHaveBeenLastCalledWith("persisted-step-1", { count: 7 });

    await act(async () => {
      first.resolve(resolvedStep({ count: 6 }));
    });
    // The stale response must NOT re-invoke onConfigChange with the older
    // value — the parent's step.config must stay at the latest-dispatched
    // edit, never regress to an earlier one.
    expect(onConfigChange).toHaveBeenCalledTimes(1);
    expect(onConfigChange).toHaveBeenLastCalledWith("persisted-step-1", { count: 7 });
  });
});

// HEL-911 evaluation-1.md CR6 (cycle 2): `onUnionChange`/`onLookupChange` widen the
// narrowed UI value (otherDataSourceId/referenceDataSourceId) back to the wire shape
// (secondaryInput) before persisting -- `stepNarrowing.test.ts` only covers the READ
// direction (unionConfigOf/lookupConfigOf). A regression here would ship a config the
// backend now rejects outright (Decision 1a), with jest green everywhere else.
describe("useStepCardState — union/lookup wire-shape widening (evaluation-1.md CR6)", () => {
  const UNION_OP_TYPE = OP_TYPES.find((op) => op.id === "union")!;
  const LOOKUP_OP_TYPE = OP_TYPES.find((op) => op.id === "lookup")!;

  it("onUnionChange persists secondaryInput (not the narrowed otherDataSourceId) to the backend", () => {
    updatePipelineStepMock.mockResolvedValue(
      resolvedStep({
        secondaryInput: { kind: "source", dataSourceId: "ds-2" },
        mode: "byPosition",
      }),
    );
    const step = makeStep({
      id: "union-1",
      opType: UNION_OP_TYPE,
      config: { secondaryInput: { kind: "source", dataSourceId: "ds-1" }, mode: "byPosition" },
    });
    const { result } = renderHook(() => useStepCardState(step, jest.fn()));

    act(() => {
      result.current.onUnionChange({
        secondary: { kind: "source", dataSourceId: "ds-2" },
        mode: "byPosition",
      });
      jest.advanceTimersByTime(400);
    });

    expect(updatePipelineStepMock).toHaveBeenCalledWith("union-1", {
      secondaryInput: { kind: "source", dataSourceId: "ds-2" },
      mode: "byPosition",
    });
  });

  it("onLookupChange persists secondaryInput (not the narrowed referenceDataSourceId) to the backend", () => {
    updatePipelineStepMock.mockResolvedValue(
      resolvedStep({
        secondaryInput: { kind: "source", dataSourceId: "ds-2" },
        sourceKey: "code",
        lookupKey: "code",
        columns: ["label"],
      }),
    );
    const step = makeStep({
      id: "lookup-1",
      opType: LOOKUP_OP_TYPE,
      config: {
        secondaryInput: { kind: "source", dataSourceId: "ds-1" },
        sourceKey: "code",
        lookupKey: "code",
        columns: ["label"],
      },
    });
    const { result } = renderHook(() => useStepCardState(step, jest.fn()));

    act(() => {
      result.current.onLookupChange({
        secondary: { kind: "source", dataSourceId: "ds-2" },
        sourceKey: "code",
        lookupKey: "code",
        columns: ["label"],
      });
      jest.advanceTimersByTime(400);
    });

    expect(updatePipelineStepMock).toHaveBeenCalledWith("lookup-1", {
      secondaryInput: { kind: "source", dataSourceId: "ds-2" },
      sourceKey: "code",
      lookupKey: "code",
      columns: ["label"],
    });
  });

  // HEL-912 (design.md Decision 4) — a lane-kind secondary input widens
  // straight through too, not just source-kind: the HEL-911 unconditional
  // `{kind:"source"}` this replaced would silently overwrite a stored lane
  // reference on any subsequent edit.
  it("onUnionChange persists a lane-kind secondaryInput straight through", () => {
    updatePipelineStepMock.mockResolvedValue(
      resolvedStep({ secondaryInput: { kind: "lane", stepId: "step-7" }, mode: "byPosition" }),
    );
    const step = makeStep({
      id: "union-1",
      opType: UNION_OP_TYPE,
      config: { secondaryInput: { kind: "source", dataSourceId: "ds-1" }, mode: "byPosition" },
    });
    const { result } = renderHook(() => useStepCardState(step, jest.fn()));

    act(() => {
      result.current.onUnionChange({
        secondary: { kind: "lane", stepId: "step-7" },
        mode: "byPosition",
      });
      jest.advanceTimersByTime(400);
    });

    expect(updatePipelineStepMock).toHaveBeenCalledWith("union-1", {
      secondaryInput: { kind: "lane", stepId: "step-7" },
      mode: "byPosition",
    });
  });

  // HEL-912 task 5.6 — the round-trip proof CR2 of evaluation-1.md requires:
  // a step PERSISTED with `secondaryInput = {kind:"lane", stepId}` (a) loads
  // with that lane node already selected (`unionConfigOf` narrowing, read
  // through the hook's own initial state -- not re-derived here), and (b)
  // changing an UNRELATED field on the same step (mode byPosition -> byName)
  // still persists the SAME lane reference, not a source-kind default.
  //
  // Manually verified RED against the pre-`22ed8642`/pre-HEL-912 narrowing:
  // reverting `unionConfigOf` to its old "degrade lane-kind to \"\"" branch
  // (`stepNarrowing.ts`'s deleted HEL-911 behaviour) makes assertion (a) fail
  // immediately (`unionConfig.secondary` would be `{kind:"source",
  // dataSourceId:""}`, not the stored lane), and reverting `onUnionChange`
  // to its old unconditional `{kind:"source"}` widening makes assertion (b)
  // fail (the PATCH would send `{kind:"source",dataSourceId:""}` instead of
  // preserving the lane) -- both reverts were applied locally, observed
  // failing, then discarded; this is the same data-loss branch task 5.1
  // deleted, not re-pinned in new clothes.
  it("round-trips a stored lane-kind secondaryInput: loads selected, survives an unrelated-field edit", () => {
    const step = makeStep({
      id: "union-2",
      opType: UNION_OP_TYPE,
      config: { secondaryInput: { kind: "lane", stepId: "step-9" }, mode: "byPosition" },
    });
    const { result } = renderHook(() => useStepCardState(step, jest.fn()));

    // (a) loads with the stored lane node already selected.
    expect(result.current.unionConfig).toEqual({
      secondary: { kind: "lane", stepId: "step-9" },
      mode: "byPosition",
    });

    updatePipelineStepMock.mockResolvedValue(
      resolvedStep({ secondaryInput: { kind: "lane", stepId: "step-9" }, mode: "byName" }),
    );

    // (b) change an UNRELATED field (mode) on the same step, preserving the
    // already-selected lane reference exactly as onUnionChange received it.
    act(() => {
      result.current.onUnionChange({
        secondary: result.current.unionConfig.secondary,
        mode: "byName",
      });
      jest.advanceTimersByTime(400);
    });

    expect(updatePipelineStepMock).toHaveBeenCalledWith("union-2", {
      secondaryInput: { kind: "lane", stepId: "step-9" },
      mode: "byName",
    });
  });
});

// HEL-1100 (design.md Decision 9) — an unsupported step kind has no config editor that could
// have produced a real edit; `persist` must never PATCH for one, regardless of which handler is
// invoked (every handler funnels through the same shared `persist`).
describe("useStepCardState — persist skips unsupported op types (HEL-1100)", () => {
  it("never calls updatePipelineStep for a step whose opType is unsupported", () => {
    updatePipelineStepMock.mockResolvedValue(resolvedStep({ count: 6 }));
    const onConfigChange = jest.fn();
    const step = makeStep({ opType: unsupportedOpType("somefuturestep") });
    const { result } = renderHook(() => useStepCardState(step, onConfigChange));

    act(() => {
      result.current.onLimitChange({ count: 6 });
      jest.advanceTimersByTime(400);
    });

    expect(updatePipelineStepMock).not.toHaveBeenCalled();
    expect(onConfigChange).not.toHaveBeenCalled();
  });
});

// evaluation-1.md CR4 (task 3.1) — the `persist` guard itself was the one new
// behavior with no test in its own purpose's direction: every existing test
// used `"persisted-step-1"` (a real-shaped id), so nothing proved the guard
// actually skips a PATCH for a genuine temp id. A future edit could delete
// the guard entirely and every pre-existing test would still pass.
describe("useStepCardState — not-yet-real-id guard (HEL-1109 design.md D3, evaluation-1.md CR4)", () => {
  it("never PATCHes for a makeStep-shaped temp id (step-<counter>)", () => {
    updatePipelineStepMock.mockResolvedValue(resolvedStep({ count: 6 }));
    const onConfigChange = jest.fn();
    const step = makeStep({ id: "step-1" });
    const { result } = renderHook(() => useStepCardState(step, onConfigChange));

    act(() => {
      result.current.onLimitChange({ count: 6 });
      jest.advanceTimersByTime(400);
    });

    expect(updatePipelineStepMock).not.toHaveBeenCalled();
  });

  it("still PATCHes for a real (non-temp-shaped) id", () => {
    updatePipelineStepMock.mockResolvedValue(resolvedStep({ count: 6 }));
    const onConfigChange = jest.fn();
    const step = makeStep({ id: "a1b2c3d4-real-backend-id" });
    const { result } = renderHook(() => useStepCardState(step, onConfigChange));

    act(() => {
      result.current.onLimitChange({ count: 6 });
      jest.advanceTimersByTime(400);
    });

    expect(updatePipelineStepMock).toHaveBeenCalledWith("a1b2c3d4-real-backend-id", {
      count: 6,
    });
  });

  it("does not mistake a semantic test-fixture id (e.g. step-rename-1) for a temp id", () => {
    updatePipelineStepMock.mockResolvedValue(resolvedStep({ count: 6 }));
    const onConfigChange = jest.fn();
    const step = makeStep({ id: "step-rename-1" });
    const { result } = renderHook(() => useStepCardState(step, onConfigChange));

    act(() => {
      result.current.onLimitChange({ count: 6 });
      jest.advanceTimersByTime(400);
    });

    expect(updatePipelineStepMock).toHaveBeenCalledWith("step-rename-1", { count: 6 });
  });
});

// HEL-1102 task 2.4 (design.md Decision 6) — `saveError` is a NEW, narrowly-scoped hook
// state: `onUpsertSourceChange`'s `persist` call opts INTO surfacing a rejected PATCH's
// backend message, while every other op kind (`onLimitChange` here as the representative,
// matching this file's own convention above) keeps the pre-existing silent-swallow behavior.
describe("useStepCardState — saveError (HEL-1102 task 2.4)", () => {
  const UPSERTSOURCE_OP_TYPE = OP_TYPES.find((op) => op.id === "upsertsource")!;

  function makeUpsertSourceStep(overrides: Partial<Step> = {}): Step {
    return {
      id: "persisted-step-1",
      opType: UPSERTSOURCE_OP_TYPE,
      label: "Write to source",
      config: { mode: "append" },
      enabled: true,
      ...overrides,
    };
  }

  it("shows the backend's rejection message verbatim", async () => {
    updatePipelineStepMock.mockRejectedValueOnce(
      makeAxiosError({ error: "Data source not found: ds-1" }),
    );
    const step = makeUpsertSourceStep();
    const { result } = renderHook(() => useStepCardState(step, jest.fn()));

    await act(async () => {
      result.current.onUpsertSourceChange({
        target: { kind: "existingSource", dataSourceId: "ds-1" },
        mode: "append",
      });
      jest.advanceTimersByTime(400);
    });

    expect(result.current.saveError).toBe("Data source not found: ds-1");
  });

  it("falls back to a specific message (not a generic one) when the rejection carries no backend message", async () => {
    updatePipelineStepMock.mockRejectedValueOnce(makeAxiosError(undefined));
    const step = makeUpsertSourceStep();
    const { result } = renderHook(() => useStepCardState(step, jest.fn()));

    await act(async () => {
      result.current.onUpsertSourceChange({
        target: { kind: "newSource", name: "x" },
        mode: "append",
      });
      jest.advanceTimersByTime(400);
    });

    expect(result.current.saveError).toBe(
      "Failed to save this step's target or mode — the server didn't say why.",
    );
  });

  it("clears saveError at the start of the next persist attempt", async () => {
    updatePipelineStepMock.mockRejectedValueOnce(makeAxiosError({ error: "Cycle detected" }));
    const step = makeUpsertSourceStep();
    const { result } = renderHook(() => useStepCardState(step, jest.fn()));

    await act(async () => {
      result.current.onUpsertSourceChange({
        target: { kind: "existingSource", dataSourceId: "ds-1" },
        mode: "append",
      });
      jest.advanceTimersByTime(400);
    });
    expect(result.current.saveError).toBe("Cycle detected");

    updatePipelineStepMock.mockResolvedValueOnce(
      resolvedStep({ target: { kind: "newSource", name: "y" }, mode: "append" }),
    );
    await act(async () => {
      result.current.onUpsertSourceChange({
        target: { kind: "newSource", name: "y" },
        mode: "append",
      });
      jest.advanceTimersByTime(400);
    });
    expect(result.current.saveError).toBeNull();
  });

  it("respects the requestTokenRef staleness guard: a superseded rejection never clobbers a newer success", async () => {
    const first = deferred<never>();
    const second = deferred<PipelineStep>();
    updatePipelineStepMock.mockReturnValueOnce(first.promise as Promise<PipelineStep>);
    updatePipelineStepMock.mockReturnValueOnce(second.promise);
    const onConfigChange = jest.fn();
    const step = makeUpsertSourceStep();
    const { result } = renderHook(() => useStepCardState(step, onConfigChange));

    act(() => {
      result.current.onUpsertSourceChange({
        target: { kind: "existingSource", dataSourceId: "ds-1" },
        mode: "append",
      });
      jest.advanceTimersByTime(400);
    });
    act(() => {
      result.current.onUpsertSourceChange({
        target: { kind: "existingSource", dataSourceId: "ds-2" },
        mode: "append",
      });
      jest.advanceTimersByTime(400);
    });
    expect(updatePipelineStepMock).toHaveBeenCalledTimes(2);

    // Newer request succeeds first.
    await act(async () => {
      second.resolve(
        resolvedStep({ target: { kind: "existingSource", dataSourceId: "ds-2" }, mode: "append" }),
      );
    });
    expect(result.current.saveError).toBeNull();

    // Older, now-stale request's rejection arrives after — must NOT set saveError.
    await act(async () => {
      first.reject(makeAxiosError({ error: "stale rejection" }));
    });
    expect(result.current.saveError).toBeNull();
  });

  it("does not populate saveError for other op kinds (existing swallow-on-reject behavior unchanged)", async () => {
    updatePipelineStepMock.mockRejectedValueOnce(makeAxiosError({ error: "some backend error" }));
    const step = makeStep(); // limit op
    const { result } = renderHook(() => useStepCardState(step, jest.fn()));

    await act(async () => {
      result.current.onLimitChange({ count: 6 });
      jest.advanceTimersByTime(400);
    });

    expect(result.current.saveError).toBeNull();
  });
});
