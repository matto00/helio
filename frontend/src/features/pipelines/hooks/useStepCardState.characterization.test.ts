// useStepCardState.characterization.test.ts — HEL-1481: pins the observable surface of
// `useStepCardState` (return shape, every change handler's wire payload and error capture, the
// emitOrPersist temp-id path, the during-render resync of all 26 editor states, the three
// state-reading accumulating handlers) so a behaviour-preserving split of the hook can be proven
// against it. Written and committed green on the pre-split base. HEL-1631 moved every edit from a debounced PATCH to the
// page's client-only draft: the payload each handler produces is unchanged and is still pinned here, now as the argument of a
// synchronous `onConfigChange`; the debounce/PATCH/saveError tests that pinned the old transport were replaced by tests that
// the editor sends no request at all (the `updatePipelineStep` mock is the guard).

import { act, renderHook } from "@testing-library/react";

import { useStepCardState } from "./useStepCardState";
import { updatePipelineStep } from "../services/pipelineService";
import { OP_TYPES } from "../state/stepNarrowing";
import {
  ALL_CASES,
  EMIT_CASES,
  EXPECTED_KEYS,
  HANDLER_CASES,
  RESYNC_ROWS,
} from "./useStepCardState.characterization.fixtures";
import type { PipelineStepConfig } from "../types/pipelineStep";
import type { Step } from "../types/step";

jest.mock("../services/pipelineService", () => ({
  updatePipelineStep: jest.fn(),
}));

const updatePipelineStepMock = jest.mocked(updatePipelineStep);

const DEBOUNCE_MS = 400;

function opType(id: string) {
  return OP_TYPES.find((op) => op.id === id)!;
}

function cfg(value: unknown): PipelineStepConfig {
  return value as PipelineStepConfig;
}

function stepOf(id: string, config: unknown, stepId = "persisted-step-1"): Step {
  const op = opType(id);
  return { id: stepId, opType: op, label: op.label, config: cfg(config), enabled: true };
}

type Api = Record<string, unknown>;
type Handler = (...args: unknown[]) => void;

function api(result: { current: unknown }): Api {
  return result.current as Api;
}

function call(result: { current: unknown }, name: string, ...args: unknown[]) {
  (api(result)[name] as Handler)(...args);
}

/** The step is built ONCE, outside the hook callback: a fresh `step.config` per render would
 *  trip the hook's own during-render resync on every render. */
function renderStateHook(step: Step, onConfigChange: (id: string, c: PipelineStepConfig) => void) {
  return renderHook(() => useStepCardState(step, onConfigChange));
}

beforeEach(() => {
  jest.useFakeTimers();
  updatePipelineStepMock.mockReset();
  updatePipelineStepMock.mockResolvedValue({} as never);
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------------------------
// Group 1 — return shape
// ---------------------------------------------------------------------------------------------

describe("useStepCardState characterization — return shape (group 1)", () => {
  it("returns exactly the 54 keys in base order", () => {
    const { result } = renderStateHook(stepOf("limit", { count: 5 }), jest.fn());
    expect(Object.keys(result.current)).toEqual(EXPECTED_KEYS);
    expect(EXPECTED_KEYS).toHaveLength(54);
  });

  it("starts with null saveError and false saveErrorIsValidation", () => {
    const { result } = renderStateHook(stepOf("limit", { count: 5 }), jest.fn());
    expect(result.current.saveError).toBeNull();
    expect(result.current.saveErrorIsValidation).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Group 2 + 6 — per-handler wire payload, error capture, local echo
// ---------------------------------------------------------------------------------------------

describe("useStepCardState characterization — handler wire payloads (group 2)", () => {
  it("covers all 26 handlers", () => {
    expect(new Set(ALL_CASES.map((c) => c.handler)).size).toBe(26);
  });

  it.each(ALL_CASES)(
    "$name: hands the exact payload to onConfigChange at once, with no request",
    (c) => {
      const onConfigChange = jest.fn();
      const { result } = renderStateHook(stepOf("limit", { count: 5 }), onConfigChange);

      act(() => {
        call(result, c.handler, ...c.args);
      });

      expect(onConfigChange).toHaveBeenCalledTimes(1);
      expect(onConfigChange.mock.calls[0][0]).toBe("persisted-step-1");
      expect(onConfigChange.mock.calls[0][1]).toStrictEqual(c.payload);
      act(() => {
        jest.advanceTimersByTime(DEBOUNCE_MS * 2);
      });
      expect(updatePipelineStepMock).not.toHaveBeenCalled();
      expect(onConfigChange).toHaveBeenCalledTimes(1);
    },
  );

  it.each(ALL_CASES)("$name: never populates saveError (there is no server round trip)", (c) => {
    const { result } = renderStateHook(stepOf("limit", { count: 5 }), jest.fn());

    act(() => {
      call(result, c.handler, ...c.args);
    });

    expect(result.current.saveError).toBeNull();
    expect(result.current.saveErrorIsValidation).toBe(false);
  });
});

describe("useStepCardState characterization — local echo (group 6)", () => {
  it.each(ALL_CASES)("$name: the returned value reflects the edit at once", (c) => {
    const { result } = renderStateHook(stepOf("limit", { count: 5 }), jest.fn());
    act(() => {
      call(result, c.handler, ...c.args);
    });
    expect(api(result)[c.valueKey]).toEqual(c.local);
  });
});

// ---------------------------------------------------------------------------------------------
// Group 3 — emitOrPersist
// ---------------------------------------------------------------------------------------------

describe("useStepCardState characterization — emitOrPersist (group 3)", () => {
  it.each(EMIT_CASES)("$name: a temp-id step emits synchronously and sends no request", (c) => {
    const onConfigChange = jest.fn();
    const { result } = renderStateHook(stepOf("limit", { count: 5 }, "step-1"), onConfigChange);
    act(() => {
      call(result, c.handler, ...c.args);
    });
    expect(onConfigChange).toHaveBeenCalledTimes(1);
    expect(onConfigChange.mock.calls[0][0]).toBe("step-1");
    expect(onConfigChange.mock.calls[0][1]).toStrictEqual(c.payload);
    act(() => {
      jest.advanceTimersByTime(DEBOUNCE_MS * 2);
    });
    expect(updatePipelineStepMock).not.toHaveBeenCalled();
    expect(onConfigChange).toHaveBeenCalledTimes(1);
  });

  it.each(EMIT_CASES)(
    "$name: a persisted step reports to the draft synchronously and sends no request",
    (c) => {
      const onConfigChange = jest.fn();
      const { result } = renderStateHook(stepOf("limit", { count: 5 }), onConfigChange);
      act(() => {
        call(result, c.handler, ...c.args);
      });
      expect(onConfigChange).toHaveBeenCalledTimes(1);
      expect(onConfigChange.mock.calls[0][1]).toStrictEqual(c.payload);
      act(() => {
        jest.advanceTimersByTime(DEBOUNCE_MS * 2);
      });
      expect(updatePipelineStepMock).not.toHaveBeenCalled();
    },
  );

  it.each(HANDLER_CASES)(
    "$name: a temp-id step sends no request and never calls onConfigChange",
    (c) => {
      const onConfigChange = jest.fn();
      const { result } = renderStateHook(stepOf("limit", { count: 5 }, "step-1"), onConfigChange);
      act(() => {
        call(result, c.handler, ...c.args);
        jest.advanceTimersByTime(DEBOUNCE_MS * 2);
      });
      expect(updatePipelineStepMock).not.toHaveBeenCalled();
      expect(onConfigChange).not.toHaveBeenCalled();
    },
  );
});

// ---------------------------------------------------------------------------------------------
// Group 4 — during-render resync, one row per op kind
// ---------------------------------------------------------------------------------------------

describe("useStepCardState characterization — during-render resync (group 4)", () => {
  it("has one row per op kind with distinguishable A/B", () => {
    expect(RESYNC_ROWS).toHaveLength(26);
    expect(new Set(RESYNC_ROWS.map((r) => r.valueKey)).size).toBe(26);
    for (const r of RESYNC_ROWS) {
      expect(r.helper(stepOf(r.op, r.a))).not.toEqual(r.helper(stepOf(r.op, r.b)));
    }
  });

  it.each(RESYNC_ROWS)("$op: a new step.config of the same op re-syncs $valueKey", (r) => {
    const stepA = stepOf(r.op, r.a);
    const stepB = stepOf(r.op, r.b);
    const { result, rerender } = renderHook(
      ({ step }: { step: Step }) => useStepCardState(step, jest.fn()),
      { initialProps: { step: stepA } },
    );
    expect(api(result)[r.valueKey]).toEqual(r.helper(stepA));

    rerender({ step: stepB });

    expect(api(result)[r.valueKey]).toEqual(r.helper(stepB));
  });

  it("an opType change with an unchanged config object resets the previous op's value (4b)", () => {
    const filterCfg = { combinator: "OR", conditions: [{ field: "a", operator: "=", value: "1" }] };
    const config = cfg(filterCfg);
    const filterStep: Step = { ...stepOf("filter", filterCfg), config };
    const limitStep: Step = { ...stepOf("limit", filterCfg), config };
    expect(limitStep.config).toBe(filterStep.config);

    const { result, rerender } = renderHook(
      ({ step }: { step: Step }) => useStepCardState(step, jest.fn()),
      { initialProps: { step: filterStep } },
    );
    expect(result.current.filterConfig).toEqual(filterCfg);

    rerender({ step: limitStep });

    expect(result.current.filterConfig).toEqual({ combinator: "AND", conditions: [] });
    expect(result.current.limitCount).toBe(100);
  });

  it("re-rendering with the same step does not clobber a local edit", () => {
    const step = stepOf("limit", { count: 5 });
    const { result, rerender } = renderHook(
      ({ s }: { s: Step }) => useStepCardState(s, jest.fn()),
      { initialProps: { s: step } },
    );
    act(() => {
      result.current.onLimitChange({ count: 42 });
    });
    rerender({ s: step });
    expect(result.current.limitCount).toBe(42);
  });
});

// ---------------------------------------------------------------------------------------------
// Group 5 — accumulating handlers read current state across re-renders
// ---------------------------------------------------------------------------------------------

describe("useStepCardState characterization — accumulating handlers (group 5)", () => {
  const lastReported = (fn: jest.Mock) => fn.mock.calls.at(-1)?.[1];

  it("onFieldToggle accumulates across calls and removes on uncheck", () => {
    const onConfigChange = jest.fn();
    const { result } = renderStateHook(stepOf("select", { fields: ["x"] }), onConfigChange);
    act(() => {
      result.current.onFieldToggle("a", true);
    });
    expect(result.current.selectedFields).toEqual(["x", "a"]);
    act(() => {
      result.current.onFieldToggle("b", true);
    });
    expect(result.current.selectedFields).toEqual(["x", "a", "b"]);
    act(() => {
      result.current.onFieldToggle("a", false);
    });
    expect(result.current.selectedFields).toEqual(["x", "b"]);
    expect(lastReported(onConfigChange)).toStrictEqual({ fields: ["x", "b"] });
    expect(updatePipelineStepMock).not.toHaveBeenCalled();
  });

  it("onFieldToggle: two edits in a row both reach the draft, each with everything before it", () => {
    const onConfigChange = jest.fn();
    const { result } = renderStateHook(stepOf("select", { fields: ["x"] }), onConfigChange);
    act(() => {
      result.current.onFieldToggle("a", true);
    });
    act(() => {
      result.current.onFieldToggle("b", true);
    });
    expect(onConfigChange).toHaveBeenCalledTimes(2);
    expect(lastReported(onConfigChange)).toStrictEqual({ fields: ["x", "a", "b"] });
  });

  it("onRenameChange accumulates across calls and an empty name deletes the key", () => {
    const onConfigChange = jest.fn();
    const { result } = renderStateHook(stepOf("rename", { renames: {} }), onConfigChange);
    act(() => {
      result.current.onRenameChange("x", "1");
    });
    act(() => {
      result.current.onRenameChange("y", "2");
    });
    expect(result.current.renames).toEqual({ x: "1", y: "2" });
    act(() => {
      result.current.onRenameChange("x", "");
    });
    expect(result.current.renames).toEqual({ y: "2" });
    expect(lastReported(onConfigChange)).toStrictEqual({ renames: { y: "2" } });
  });

  it("onCastChange accumulates across calls and an empty type deletes the key", () => {
    const onConfigChange = jest.fn();
    const { result } = renderStateHook(stepOf("cast", { casts: {} }), onConfigChange);
    act(() => {
      result.current.onCastChange("x", "int");
    });
    act(() => {
      result.current.onCastChange("y", "float");
    });
    expect(result.current.casts).toEqual({ x: "int", y: "float" });
    act(() => {
      result.current.onCastChange("x", "");
    });
    expect(result.current.casts).toEqual({ y: "float" });
    expect(lastReported(onConfigChange)).toStrictEqual({ casts: { y: "float" } });
  });
});
