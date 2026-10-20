// useStepCardState.test.ts -- the editor's edit path. Until HEL-1631 every edit was debounced (F-005), PATCHed to the server
// and reported back only after the response, with a request token against an out-of-order response and a `saveError` for a
// rejected PATCH. Edits now go straight into the page's client-only draft: `persist` hands the config to `onConfigChange`
// synchronously and sends nothing. The tests of the old transport (debounce, stale-response token, unmount clear, the
// rejected-PATCH `saveError` family) were replaced by the ones below; a server rejection now surfaces when the draft is
// saved (see PipelineDetailPage.draftMode.test.tsx), not per keystroke. `onLimitChange` stands in for the 26 handlers, all of
// which funnel through the same `persist` (the characterization test covers each handler's payload).

import { act, renderHook } from "@testing-library/react";

import { useStepCardState } from "./useStepCardState";
import { updatePipelineStep } from "../services/pipelineService";
import { OP_TYPES, unsupportedOpType } from "../state/stepNarrowing";
import type { Step } from "../types/step";

// The mock is the guard that no request is made: if `persist` ever calls the service again, these tests go red.
jest.mock("../services/pipelineService", () => ({
  updatePipelineStep: jest.fn(),
}));

const updatePipelineStepMock = jest.mocked(updatePipelineStep);

const LIMIT_OP_TYPE = OP_TYPES.find((op) => op.id === "limit")!;

// HEL-1109: `persisted-step-1` (not `step-1`) deliberately: `persist` treats exactly the `^step-\d+$` shape (the real
// `makeStep` temp-id format) as a draft with no draft-overlay path, so a fixture id in that shape would defeat the tests that
// expect an edit to be reported.
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

beforeEach(() => {
  jest.useFakeTimers();
  updatePipelineStepMock.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("useStepCardState -- edits go to the draft (HEL-1631)", () => {
  it("reports a change to onConfigChange at once and sends no request", () => {
    const onConfigChange = jest.fn();
    const step = makeStep();
    const { result } = renderHook(() => useStepCardState(step, onConfigChange));

    act(() => {
      result.current.onLimitChange({ count: 6 });
    });

    expect(onConfigChange).toHaveBeenCalledTimes(1);
    expect(onConfigChange).toHaveBeenCalledWith("persisted-step-1", { count: 6 });
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(updatePipelineStepMock).not.toHaveBeenCalled();
  });

  it("reports every keystroke of a burst, the latest last, and still sends nothing", () => {
    const onConfigChange = jest.fn();
    const step = makeStep();
    const { result } = renderHook(() => useStepCardState(step, onConfigChange));

    for (const count of [6, 7, 8, 9]) {
      act(() => {
        result.current.onLimitChange({ count });
        jest.advanceTimersByTime(100);
      });
    }
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(onConfigChange).toHaveBeenCalledTimes(4);
    expect(onConfigChange).toHaveBeenLastCalledWith("persisted-step-1", { count: 9 });
    expect(updatePipelineStepMock).not.toHaveBeenCalled();
  });

  it("keeps an edit made just before the editor unmounts (nothing is pending to lose or flush)", () => {
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

    expect(onConfigChange).toHaveBeenCalledTimes(1);
    expect(updatePipelineStepMock).not.toHaveBeenCalled();
  });

  it("starts with no saveError: a server rejection is shown when the draft is saved, not per edit", () => {
    const step = makeStep();
    const { result } = renderHook(() => useStepCardState(step, jest.fn()));
    act(() => {
      result.current.onLimitChange({ count: 6 });
    });
    expect(result.current.saveError).toBeNull();
    expect(result.current.saveErrorIsValidation).toBe(false);
  });
});

// HEL-911 evaluation-1.md CR6 (cycle 2): `onUnionChange`/`onLookupChange` widen the narrowed UI value
// (otherDataSourceId/referenceDataSourceId) back to the wire shape (secondaryInput) before reporting it --
// `stepNarrowing.test.ts` only covers the READ direction (unionConfigOf/lookupConfigOf). A regression here would put a
// config the backend rejects outright (Decision 1a) into the draft, with jest green everywhere else.
describe("useStepCardState -- union/lookup wire-shape widening (evaluation-1.md CR6)", () => {
  const UNION_OP_TYPE = OP_TYPES.find((op) => op.id === "union")!;
  const LOOKUP_OP_TYPE = OP_TYPES.find((op) => op.id === "lookup")!;

  it("onUnionChange reports secondaryInput (not the narrowed otherDataSourceId)", () => {
    const onConfigChange = jest.fn();
    const step = makeStep({
      id: "union-1",
      opType: UNION_OP_TYPE,
      config: { secondaryInput: { kind: "source", dataSourceId: "ds-1" }, mode: "byPosition" },
    });
    const { result } = renderHook(() => useStepCardState(step, onConfigChange));

    act(() => {
      result.current.onUnionChange({
        secondary: { kind: "source", dataSourceId: "ds-2" },
        mode: "byPosition",
      });
    });

    expect(onConfigChange).toHaveBeenCalledWith("union-1", {
      secondaryInput: { kind: "source", dataSourceId: "ds-2" },
      mode: "byPosition",
    });
  });

  it("onLookupChange reports secondaryInput (not the narrowed referenceDataSourceId)", () => {
    const onConfigChange = jest.fn();
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
    const { result } = renderHook(() => useStepCardState(step, onConfigChange));

    act(() => {
      result.current.onLookupChange({
        secondary: { kind: "source", dataSourceId: "ds-2" },
        sourceKey: "code",
        lookupKey: "code",
        columns: ["label"],
      });
    });

    expect(onConfigChange).toHaveBeenCalledWith("lookup-1", {
      secondaryInput: { kind: "source", dataSourceId: "ds-2" },
      sourceKey: "code",
      lookupKey: "code",
      columns: ["label"],
    });
  });

  // HEL-912 (design.md Decision 4) -- a lane-kind secondary input widens straight through too, not just source-kind: the
  // HEL-911 unconditional `{kind:"source"}` this replaced would silently overwrite a stored lane reference on any edit.
  it("onUnionChange reports a lane-kind secondaryInput straight through", () => {
    const onConfigChange = jest.fn();
    const step = makeStep({
      id: "union-1",
      opType: UNION_OP_TYPE,
      config: { secondaryInput: { kind: "source", dataSourceId: "ds-1" }, mode: "byPosition" },
    });
    const { result } = renderHook(() => useStepCardState(step, onConfigChange));

    act(() => {
      result.current.onUnionChange({
        secondary: { kind: "lane", stepId: "step-7" },
        mode: "byPosition",
      });
    });

    expect(onConfigChange).toHaveBeenCalledWith("union-1", {
      secondaryInput: { kind: "lane", stepId: "step-7" },
      mode: "byPosition",
    });
  });

  // HEL-912 task 5.6 -- the round trip: a step stored with `secondaryInput = {kind:"lane", stepId}` loads with that lane node
  // already selected, and changing an UNRELATED field (mode) still reports the SAME lane reference, not a source-kind default.
  it("round-trips a stored lane-kind secondaryInput: loads selected, survives an unrelated-field edit", () => {
    const onConfigChange = jest.fn();
    const step = makeStep({
      id: "union-2",
      opType: UNION_OP_TYPE,
      config: { secondaryInput: { kind: "lane", stepId: "step-9" }, mode: "byPosition" },
    });
    const { result } = renderHook(() => useStepCardState(step, onConfigChange));

    expect(result.current.unionConfig).toEqual({
      secondary: { kind: "lane", stepId: "step-9" },
      mode: "byPosition",
    });

    act(() => {
      result.current.onUnionChange({
        secondary: result.current.unionConfig.secondary,
        mode: "byName",
      });
    });

    expect(onConfigChange).toHaveBeenCalledWith("union-2", {
      secondaryInput: { kind: "lane", stepId: "step-9" },
      mode: "byName",
    });
  });
});

// HEL-1100 (design.md Decision 9) -- an unsupported step kind has no config editor that could have produced a real edit;
// `persist` must report nothing for one, whichever handler is invoked.
describe("useStepCardState -- persist skips unsupported op types (HEL-1100)", () => {
  it("never reports an edit for a step whose opType is unsupported", () => {
    const onConfigChange = jest.fn();
    const step = makeStep({ opType: unsupportedOpType("somefuturestep") });
    const { result } = renderHook(() => useStepCardState(step, onConfigChange));

    act(() => {
      result.current.onLimitChange({ count: 6 });
    });

    expect(onConfigChange).not.toHaveBeenCalled();
    expect(updatePipelineStepMock).not.toHaveBeenCalled();
  });
});

// evaluation-1.md CR4 (task 3.1) -- the temp-id guard: every other test uses a real-shaped id, so nothing else proves `persist`
// really skips a genuine temp id (a future edit could delete the guard and every other test would still pass).
describe("useStepCardState -- not-yet-real-id guard (HEL-1109 design.md D3, evaluation-1.md CR4)", () => {
  it("never reports a makeStep-shaped temp id (step-<counter>) as a draft edit", () => {
    const onConfigChange = jest.fn();
    const step = makeStep({ id: "step-1" });
    const { result } = renderHook(() => useStepCardState(step, onConfigChange));

    act(() => {
      result.current.onLimitChange({ count: 6 });
    });

    expect(onConfigChange).not.toHaveBeenCalled();
  });

  it("reports an edit for a real (non-temp-shaped) id", () => {
    const onConfigChange = jest.fn();
    const step = makeStep({ id: "a1b2c3d4-real-backend-id" });
    const { result } = renderHook(() => useStepCardState(step, onConfigChange));

    act(() => {
      result.current.onLimitChange({ count: 6 });
    });

    expect(onConfigChange).toHaveBeenCalledWith("a1b2c3d4-real-backend-id", { count: 6 });
  });

  it("does not mistake a semantic test-fixture id (e.g. step-rename-1) for a temp id", () => {
    const onConfigChange = jest.fn();
    const step = makeStep({ id: "step-rename-1" });
    const { result } = renderHook(() => useStepCardState(step, onConfigChange));

    act(() => {
      result.current.onLimitChange({ count: 6 });
    });

    expect(onConfigChange).toHaveBeenCalledWith("step-rename-1", { count: 6 });
  });
});
