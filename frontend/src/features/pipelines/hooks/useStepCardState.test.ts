// useStepCardState.test.ts — F-005: every step-config editor PATCHed the
// backend on every keystroke, with no debounce and no protection against an
// out-of-order response clobbering a newer edit. Exercises `persist` (the
// hook's single PATCH path, shared by all 20 change handlers) directly via
// one representative handler (`onLimitChange`) rather than every handler —
// they all funnel through the same `persist` function.

import { act, renderHook } from "@testing-library/react";

import { useStepCardState } from "./useStepCardState";
import { updatePipelineStep } from "../services/pipelineService";
import { OP_TYPES } from "../state/stepNarrowing";
import type { Step } from "../types/step";
import type { PipelineStep, PipelineStepConfig } from "../types/pipelineStep";

jest.mock("../services/pipelineService", () => ({
  updatePipelineStep: jest.fn(),
}));

const updatePipelineStepMock = jest.mocked(updatePipelineStep);

const LIMIT_OP_TYPE = OP_TYPES.find((op) => op.id === "limit")!;

function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    id: "step-1",
    opType: LIMIT_OP_TYPE,
    label: "Limit rows",
    config: { count: 5 },
    enabled: true,
    ...overrides,
  };
}

function resolvedStep(config: PipelineStepConfig): PipelineStep {
  return {
    id: "step-1",
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
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
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
    expect(updatePipelineStepMock).toHaveBeenCalledWith("step-1", { count: 9 });
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
    expect(updatePipelineStepMock).toHaveBeenLastCalledWith("step-1", { count: 7 });
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
    expect(onConfigChange).toHaveBeenLastCalledWith("step-1", { count: 7 });

    await act(async () => {
      first.resolve(resolvedStep({ count: 6 }));
    });
    // The stale response must NOT re-invoke onConfigChange with the older
    // value — the parent's step.config must stay at the latest-dispatched
    // edit, never regress to an earlier one.
    expect(onConfigChange).toHaveBeenCalledTimes(1);
    expect(onConfigChange).toHaveBeenLastCalledWith("step-1", { count: 7 });
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
