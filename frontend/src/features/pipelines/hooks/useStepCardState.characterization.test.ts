// useStepCardState.characterization.test.ts — HEL-1481: pins the observable surface of
// `useStepCardState` (return shape, every change handler's wire payload and error capture, the
// emitOrPersist temp-id path, the during-render resync of all 26 editor states, the three
// state-reading accumulating handlers) so a behaviour-preserving split of the hook can be proven
// against it. Written and committed green on the pre-split base; the existing
// `useStepCardState.test.ts` (debounce, stale-token, cleanup, unsupported-op, temp-id guard,
// saveError staleness) keeps guarding the persist path itself.

import { act, renderHook } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";

import { useStepCardState } from "./useStepCardState";
import { updatePipelineStep } from "../services/pipelineService";
import {
  OP_TYPES,
  aggregateConfigOf,
  analyzeWithAiConfigOf,
  assertConfigOf,
  castsOf,
  chunkByTokenCountConfigOf,
  computeConfigOf,
  convertFormatConfigOf,
  dateBucketConfigOf,
  dedupeConfigOf,
  extractHeadingsConfigOf,
  fillNullConfigOf,
  filterConfigOf,
  generateTextConfigOf,
  joinConfigOf,
  limitCountOf,
  lookupConfigOf,
  pivotConfigOf,
  renamesOf,
  selectedFieldsOf,
  sortConfigOf,
  splitTextConfigOf,
  stringOpsConfigOf,
  unionConfigOf,
  unpivotConfigOf,
  upsertSourceConfigOf,
  windowConfigOf,
} from "../state/stepNarrowing";
import type { PipelineStepConfig } from "../types/pipelineStep";
import type { Step } from "../types/step";

jest.mock("../services/pipelineService", () => ({
  updatePipelineStep: jest.fn(),
}));

const updatePipelineStepMock = jest.mocked(updatePipelineStep);

const DEBOUNCE_MS = 400;

function makeAxiosError(data: unknown, status: number): AxiosError {
  return new AxiosError(
    `Request failed with status code ${status}`,
    "ERR_BAD_REQUEST",
    undefined,
    undefined,
    {
      status,
      statusText: "Unprocessable",
      headers: {},
      config: { headers: new AxiosHeaders() },
      data,
    },
  );
}

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

const EXPECTED_KEYS = [
  "selectedFields",
  "renames",
  "casts",
  "filterConfig",
  "computeConfig",
  "aggregateConfig",
  "limitCount",
  "sortConfig",
  "splitTextConfig",
  "extractHeadingsConfig",
  "chunkByTokenCountConfig",
  "dateBucketConfig",
  "pivotConfig",
  "windowConfig",
  "unpivotConfig",
  "dedupeConfig",
  "fillNullConfig",
  "stringOpsConfig",
  "unionConfig",
  "lookupConfig",
  "joinConfig",
  "assertConfig",
  "upsertSourceConfig",
  "convertFormatConfig",
  "analyzeWithAiConfig",
  "generateTextConfig",
  "saveError",
  "saveErrorIsValidation",
  "onFieldToggle",
  "onRenameChange",
  "onCastChange",
  "onFilterChange",
  "onComputeChange",
  "onAggregateChange",
  "onLimitChange",
  "onSortChange",
  "onSplitTextChange",
  "onExtractHeadingsChange",
  "onChunkByTokenCountChange",
  "onDateBucketChange",
  "onPivotChange",
  "onWindowChange",
  "onUnpivotChange",
  "onDedupeChange",
  "onFillNullChange",
  "onStringOpsChange",
  "onUnionChange",
  "onLookupChange",
  "onJoinChange",
  "onAssertChange",
  "onUpsertSourceChange",
  "onConvertFormatChange",
  "onAnalyzeWithAiChange",
  "onGenerateTextChange",
];

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

interface HandlerCase {
  name: string;
  handler: string;
  args: unknown[];
  /** The exact config handed to `updatePipelineStep` (toStrictEqual: undefined keys are pinned). */
  payload: unknown;
  captures: boolean;
  /** The returned value key that must echo locally, and its expected value. */
  valueKey: string;
  local: unknown;
}

const SECONDARY = { kind: "source", dataSourceId: "ds-1" };

const HANDLER_CASES: HandlerCase[] = [
  {
    name: "onFieldToggle (add)",
    handler: "onFieldToggle",
    args: ["a", true],
    payload: { fields: ["a"] },
    captures: false,
    valueKey: "selectedFields",
    local: ["a"],
  },
  {
    name: "onRenameChange",
    handler: "onRenameChange",
    args: ["a", "b"],
    payload: { renames: { a: "b" } },
    captures: false,
    valueKey: "renames",
    local: { a: "b" },
  },
  {
    name: "onCastChange",
    handler: "onCastChange",
    args: ["a", "int"],
    payload: { casts: { a: "int" } },
    captures: false,
    valueKey: "casts",
    local: { a: "int" },
  },
  {
    name: "onFilterChange",
    handler: "onFilterChange",
    args: [{ combinator: "OR", conditions: [{ field: "a", operator: "=", value: "1" }] }],
    payload: { combinator: "OR", conditions: [{ field: "a", operator: "=", value: "1" }] },
    captures: false,
    valueKey: "filterConfig",
    local: { combinator: "OR", conditions: [{ field: "a", operator: "=", value: "1" }] },
  },
  {
    name: "onComputeChange",
    handler: "onComputeChange",
    args: [{ column: "c", expression: "a + 1", type: "number" }],
    payload: { column: "c", expression: "a + 1", type: "number" },
    captures: false,
    valueKey: "computeConfig",
    local: { column: "c", expression: "a + 1", type: "number" },
  },
  {
    name: "onAggregateChange",
    handler: "onAggregateChange",
    args: [{ groupBy: ["g"], aggregations: [] }],
    payload: { groupBy: ["g"], aggregations: [] },
    captures: false,
    valueKey: "aggregateConfig",
    local: { groupBy: ["g"], aggregations: [] },
  },
  {
    name: "onLimitChange",
    handler: "onLimitChange",
    args: [{ count: 9 }],
    payload: { count: 9 },
    captures: false,
    valueKey: "limitCount",
    local: 9,
  },
  {
    name: "onSortChange",
    handler: "onSortChange",
    args: [{ sortBy: [{ field: "a", direction: "desc" }] }],
    payload: { sortBy: [{ field: "a", direction: "desc" }] },
    captures: false,
    valueKey: "sortConfig",
    local: [{ field: "a", direction: "desc" }],
  },
  {
    name: "onSplitTextChange",
    handler: "onSplitTextChange",
    args: [{ field: "t", mode: "heading", headingLevel: 2, indexField: "i" }],
    payload: { field: "t", mode: "heading", headingLevel: 2, indexField: "i" },
    captures: false,
    valueKey: "splitTextConfig",
    local: { field: "t", mode: "heading", headingLevel: 2, indexField: "i" },
  },
  {
    name: "onExtractHeadingsChange",
    handler: "onExtractHeadingsChange",
    args: [{ field: "t", indexField: "hi", levelField: "hl" }],
    payload: { field: "t", indexField: "hi", levelField: "hl" },
    captures: false,
    valueKey: "extractHeadingsConfig",
    local: { field: "t", indexField: "hi", levelField: "hl" },
  },
  {
    name: "onChunkByTokenCountChange",
    handler: "onChunkByTokenCountChange",
    args: [
      {
        field: "t",
        targetTokenCount: 100,
        encoding: "cl100k_base",
        indexField: "ci",
        tokenCountField: "tc",
      },
    ],
    payload: {
      field: "t",
      targetTokenCount: 100,
      encoding: "cl100k_base",
      indexField: "ci",
      tokenCountField: "tc",
    },
    captures: false,
    valueKey: "chunkByTokenCountConfig",
    local: {
      field: "t",
      targetTokenCount: 100,
      encoding: "cl100k_base",
      indexField: "ci",
      tokenCountField: "tc",
    },
  },
  {
    name: "onDateBucketChange (outputColumn set)",
    handler: "onDateBucketChange",
    args: [{ field: "d", granularity: "month", outputColumn: "m" }],
    payload: { field: "d", granularity: "month", outputColumn: "m" },
    captures: false,
    valueKey: "dateBucketConfig",
    local: { field: "d", granularity: "month", outputColumn: "m" },
  },
  {
    name: "onDateBucketChange (blank outputColumn is omitted -> undefined)",
    handler: "onDateBucketChange",
    args: [{ field: "d", granularity: "week", outputColumn: "" }],
    payload: { field: "d", granularity: "week", outputColumn: undefined },
    captures: false,
    valueKey: "dateBucketConfig",
    local: { field: "d", granularity: "week", outputColumn: "" },
  },
  {
    name: "onPivotChange",
    handler: "onPivotChange",
    args: [{ index: ["i"], column: "c", values: "v", agg: "avg" }],
    payload: { index: ["i"], column: "c", values: "v", agg: "avg" },
    captures: true,
    valueKey: "pivotConfig",
    local: { index: ["i"], column: "c", values: "v", agg: "avg" },
  },
  {
    name: "onWindowChange (lag uses field and offset)",
    handler: "onWindowChange",
    args: [
      {
        partitionBy: ["p"],
        orderBy: [{ field: "o", direction: "asc" }],
        function: "lag",
        field: "f",
        outputColumn: "out",
        offset: 3,
      },
    ],
    payload: {
      partitionBy: ["p"],
      orderBy: [{ field: "o", direction: "asc" }],
      function: "lag",
      field: "f",
      outputColumn: "out",
      offset: 3,
    },
    captures: true,
    valueKey: "windowConfig",
    local: {
      partitionBy: ["p"],
      orderBy: [{ field: "o", direction: "asc" }],
      function: "lag",
      field: "f",
      outputColumn: "out",
      offset: 3,
    },
  },
  {
    name: "onWindowChange (running_sum uses field, omits offset)",
    handler: "onWindowChange",
    args: [
      {
        partitionBy: [],
        orderBy: [],
        function: "running_sum",
        field: "f",
        outputColumn: "out",
        offset: 3,
      },
    ],
    payload: {
      partitionBy: [],
      orderBy: [],
      function: "running_sum",
      field: "f",
      outputColumn: "out",
    },
    captures: true,
    valueKey: "windowConfig",
    local: {
      partitionBy: [],
      orderBy: [],
      function: "running_sum",
      field: "f",
      outputColumn: "out",
      offset: 3,
    },
  },
  {
    name: "onWindowChange (rank family omits field and offset)",
    handler: "onWindowChange",
    args: [
      {
        partitionBy: [],
        orderBy: [],
        function: "row_number",
        field: "f",
        outputColumn: "out",
        offset: 3,
      },
    ],
    payload: {
      partitionBy: [],
      orderBy: [],
      function: "row_number",
      outputColumn: "out",
    },
    captures: true,
    valueKey: "windowConfig",
    local: {
      partitionBy: [],
      orderBy: [],
      function: "row_number",
      field: "f",
      outputColumn: "out",
      offset: 3,
    },
  },
  {
    name: "onUnpivotChange",
    handler: "onUnpivotChange",
    args: [{ idVars: ["i"], valueVars: ["v"], varName: "vn", valueName: "vl" }],
    payload: { idVars: ["i"], valueVars: ["v"], varName: "vn", valueName: "vl" },
    captures: false,
    valueKey: "unpivotConfig",
    local: { idVars: ["i"], valueVars: ["v"], varName: "vn", valueName: "vl" },
  },
  {
    name: "onDedupeChange",
    handler: "onDedupeChange",
    args: [{ keys: ["k"], keep: "last" }],
    payload: { keys: ["k"], keep: "last" },
    captures: false,
    valueKey: "dedupeConfig",
    local: { keys: ["k"], keep: "last" },
  },
  {
    name: "onFillNullChange",
    handler: "onFillNullChange",
    args: [{ columns: ["c"], strategy: "constant", value: 0 }],
    payload: { columns: ["c"], strategy: "constant", value: 0 },
    captures: true,
    valueKey: "fillNullConfig",
    local: { columns: ["c"], strategy: "constant", value: 0 },
  },
  {
    name: "onStringOpsChange (trim)",
    handler: "onStringOpsChange",
    args: [
      {
        operation: "trim",
        field: "f",
        outputColumn: "o",
        pattern: "p",
        separator: "s",
        index: 2,
        fields: ["x"],
      },
    ],
    payload: {
      operation: "trim",
      field: "f",
      outputColumn: "o",
      pattern: undefined,
      separator: undefined,
      index: undefined,
      fields: undefined,
    },
    captures: false,
    valueKey: "stringOpsConfig",
    local: {
      operation: "trim",
      field: "f",
      outputColumn: "o",
      pattern: "p",
      separator: "s",
      index: 2,
      fields: ["x"],
    },
  },
  {
    name: "onStringOpsChange (split uses separator and index)",
    handler: "onStringOpsChange",
    args: [
      {
        operation: "split",
        field: "f",
        outputColumn: "o",
        pattern: "p",
        separator: "s",
        index: 2,
        fields: ["x"],
      },
    ],
    payload: {
      operation: "split",
      field: "f",
      outputColumn: "o",
      pattern: undefined,
      separator: "s",
      index: 2,
      fields: undefined,
    },
    captures: false,
    valueKey: "stringOpsConfig",
    local: {
      operation: "split",
      field: "f",
      outputColumn: "o",
      pattern: "p",
      separator: "s",
      index: 2,
      fields: ["x"],
    },
  },
  {
    name: "onStringOpsChange (concat blanks field, uses separator and fields)",
    handler: "onStringOpsChange",
    args: [
      {
        operation: "concat",
        field: "f",
        outputColumn: "o",
        pattern: "p",
        separator: "s",
        index: 2,
        fields: ["x"],
      },
    ],
    payload: {
      operation: "concat",
      field: "",
      outputColumn: "o",
      pattern: undefined,
      separator: "s",
      index: undefined,
      fields: ["x"],
    },
    captures: false,
    valueKey: "stringOpsConfig",
    local: {
      operation: "concat",
      field: "f",
      outputColumn: "o",
      pattern: "p",
      separator: "s",
      index: 2,
      fields: ["x"],
    },
  },
  {
    name: "onStringOpsChange (extractRegex uses pattern)",
    handler: "onStringOpsChange",
    args: [
      {
        operation: "extractRegex",
        field: "f",
        outputColumn: "o",
        pattern: "p",
        separator: "s",
        index: 2,
        fields: ["x"],
      },
    ],
    payload: {
      operation: "extractRegex",
      field: "f",
      outputColumn: "o",
      pattern: "p",
      separator: undefined,
      index: undefined,
      fields: undefined,
    },
    captures: false,
    valueKey: "stringOpsConfig",
    local: {
      operation: "extractRegex",
      field: "f",
      outputColumn: "o",
      pattern: "p",
      separator: "s",
      index: 2,
      fields: ["x"],
    },
  },
  {
    name: "onUnionChange",
    handler: "onUnionChange",
    args: [{ secondary: SECONDARY, mode: "byName" }],
    payload: { secondaryInput: SECONDARY, mode: "byName" },
    captures: false,
    valueKey: "unionConfig",
    local: { secondary: SECONDARY, mode: "byName" },
  },
  {
    name: "onLookupChange",
    handler: "onLookupChange",
    args: [{ secondary: SECONDARY, sourceKey: "sk", lookupKey: "lk", columns: ["c"] }],
    payload: { secondaryInput: SECONDARY, sourceKey: "sk", lookupKey: "lk", columns: ["c"] },
    captures: false,
    valueKey: "lookupConfig",
    local: { secondary: SECONDARY, sourceKey: "sk", lookupKey: "lk", columns: ["c"] },
  },
  {
    name: "onJoinChange",
    handler: "onJoinChange",
    args: [{ secondary: SECONDARY, joinKey: "jk", joinType: "left" }],
    payload: { secondaryInput: SECONDARY, joinKey: "jk", joinType: "left" },
    captures: false,
    valueKey: "joinConfig",
    local: { secondary: SECONDARY, joinKey: "jk", joinType: "left" },
  },
  {
    name: "onAssertChange",
    handler: "onAssertChange",
    args: [{ rules: [{ kind: "notNull", field: "f", params: {}, severity: "error" }] }],
    payload: { rules: [{ kind: "notNull", field: "f", params: {}, severity: "error" }] },
    captures: false,
    valueKey: "assertConfig",
    local: { rules: [{ kind: "notNull", field: "f", params: {}, severity: "error" }] },
  },
  {
    name: "onUpsertSourceChange",
    handler: "onUpsertSourceChange",
    args: [{ target: { kind: "existingSource", dataSourceId: "ds-9" }, mode: "replace" }],
    payload: { target: { kind: "existingSource", dataSourceId: "ds-9" }, mode: "replace" },
    captures: true,
    valueKey: "upsertSourceConfig",
    local: { target: { kind: "existingSource", dataSourceId: "ds-9" }, mode: "replace" },
  },
];

// Handlers that go through emitOrPersist (group 3 covers their temp-id path).
const EMIT_CASES: HandlerCase[] = [
  {
    name: "onConvertFormatChange (outputField set)",
    handler: "onConvertFormatChange",
    args: [{ field: "f", from: "csv", to: "json", outputField: "o" }],
    payload: { field: "f", from: "csv", to: "json", outputField: "o" },
    captures: false,
    valueKey: "convertFormatConfig",
    local: { field: "f", from: "csv", to: "json", outputField: "o" },
  },
  {
    name: "onConvertFormatChange (blank outputField -> undefined)",
    handler: "onConvertFormatChange",
    args: [{ field: "f", from: "csv", to: "json", outputField: "" }],
    payload: { field: "f", from: "csv", to: "json", outputField: undefined },
    captures: false,
    valueKey: "convertFormatConfig",
    local: { field: "f", from: "csv", to: "json", outputField: "" },
  },
  {
    name: "onAnalyzeWithAiChange",
    handler: "onAnalyzeWithAiChange",
    args: [{ inputField: "i", instruction: "do it", outputSchema: [] }],
    payload: { inputField: "i", instruction: "do it", outputSchema: [] },
    captures: false,
    valueKey: "analyzeWithAiConfig",
    local: { inputField: "i", instruction: "do it", outputSchema: [] },
  },
  {
    name: "onGenerateTextChange",
    handler: "onGenerateTextChange",
    args: [{ inputField: "i", instruction: "write", outputField: "o" }],
    payload: { inputField: "i", instruction: "write", outputField: "o" },
    captures: false,
    valueKey: "generateTextConfig",
    local: { inputField: "i", instruction: "write", outputField: "o" },
  },
];

const ALL_CASES = [...HANDLER_CASES, ...EMIT_CASES];

describe("useStepCardState characterization — handler wire payloads (group 2)", () => {
  it("covers all 26 handlers", () => {
    expect(new Set(ALL_CASES.map((c) => c.handler)).size).toBe(26);
  });

  it.each(ALL_CASES)("$name: one debounced PATCH with the exact payload", (c) => {
    const onConfigChange = jest.fn();
    const { result } = renderStateHook(stepOf("limit", { count: 5 }), onConfigChange);

    act(() => {
      call(result, c.handler, ...c.args);
    });
    expect(updatePipelineStepMock).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(updatePipelineStepMock).toHaveBeenCalledTimes(1);
    expect(updatePipelineStepMock.mock.calls[0][0]).toBe("persisted-step-1");
    expect(updatePipelineStepMock.mock.calls[0][1]).toStrictEqual(c.payload);
  });

  it.each(ALL_CASES)("$name: saveError captured only where the handler opts in", async (c) => {
    updatePipelineStepMock.mockRejectedValue(makeAxiosError({ message: "nope" }, 422));
    const { result } = renderStateHook(stepOf("limit", { count: 5 }), jest.fn());

    act(() => {
      call(result, c.handler, ...c.args);
    });
    await act(async () => {
      jest.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(updatePipelineStepMock).toHaveBeenCalledTimes(1);
    if (c.captures) {
      expect(result.current.saveError).toBe("nope");
      expect(result.current.saveErrorIsValidation).toBe(true);
    } else {
      expect(result.current.saveError).toBeNull();
      expect(result.current.saveErrorIsValidation).toBe(false);
    }
  });

  it("captures exactly pivot/window/fillnull/upsertsource", () => {
    const capturing = new Set(ALL_CASES.filter((c) => c.captures).map((c) => c.handler));
    expect(capturing).toEqual(
      new Set(["onPivotChange", "onWindowChange", "onFillNullChange", "onUpsertSourceChange"]),
    );
  });

  it("a non-422 rejection on a capturing handler sets saveError but not saveErrorIsValidation", async () => {
    updatePipelineStepMock.mockRejectedValue(makeAxiosError({ error: "boom" }, 500));
    const { result } = renderStateHook(stepOf("limit", { count: 5 }), jest.fn());
    act(() => {
      call(result, "onFillNullChange", { columns: [], strategy: "constant", value: null });
    });
    await act(async () => {
      jest.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(result.current.saveError).toBe("boom");
    expect(result.current.saveErrorIsValidation).toBe(false);
  });
});

describe("useStepCardState characterization — local echo (group 6)", () => {
  it.each(ALL_CASES)("$name: the returned value reflects the edit before the debounce", (c) => {
    const { result } = renderStateHook(stepOf("limit", { count: 5 }), jest.fn());
    act(() => {
      call(result, c.handler, ...c.args);
    });
    expect(updatePipelineStepMock).not.toHaveBeenCalled();
    expect(api(result)[c.valueKey]).toEqual(c.local);
  });
});

// ---------------------------------------------------------------------------------------------
// Group 3 — emitOrPersist
// ---------------------------------------------------------------------------------------------

describe("useStepCardState characterization — emitOrPersist (group 3)", () => {
  it.each(EMIT_CASES)("$name: a temp-id step emits synchronously and never PATCHes", (c) => {
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
    "$name: a persisted step PATCHes (debounced) and reports only after success",
    async (c) => {
      const onConfigChange = jest.fn();
      const { result } = renderStateHook(stepOf("limit", { count: 5 }), onConfigChange);
      act(() => {
        call(result, c.handler, ...c.args);
      });
      expect(onConfigChange).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(DEBOUNCE_MS);
      });
      expect(updatePipelineStepMock).toHaveBeenCalledTimes(1);
      expect(onConfigChange).toHaveBeenCalledTimes(1);
      expect(onConfigChange.mock.calls[0][1]).toStrictEqual(c.payload);
    },
  );

  it.each(HANDLER_CASES)(
    "$name: a temp-id step never PATCHes and never calls onConfigChange",
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

interface ResyncRow {
  op: string;
  valueKey: string;
  helper: (s: Step) => unknown;
  a: unknown;
  b: unknown;
}

const RESYNC_ROWS: ResyncRow[] = [
  {
    op: "select",
    valueKey: "selectedFields",
    helper: selectedFieldsOf,
    a: { fields: ["x"] },
    b: { fields: ["y", "z"] },
  },
  {
    op: "rename",
    valueKey: "renames",
    helper: renamesOf,
    a: { renames: { a: "b" } },
    b: { renames: { c: "d" } },
  },
  {
    op: "cast",
    valueKey: "casts",
    helper: castsOf,
    a: { casts: { a: "int" } },
    b: { casts: { b: "string" } },
  },
  {
    op: "filter",
    valueKey: "filterConfig",
    helper: filterConfigOf,
    a: { combinator: "AND", conditions: [] },
    b: { combinator: "OR", conditions: [{ field: "a", operator: "=", value: "1" }] },
  },
  {
    op: "compute",
    valueKey: "computeConfig",
    helper: computeConfigOf,
    a: { column: "a", expression: "1", type: "number" },
    b: { column: "b", expression: "2", type: "string" },
  },
  {
    op: "limit",
    valueKey: "limitCount",
    helper: limitCountOf,
    a: { count: 5 },
    b: { count: 7 },
  },
  {
    op: "aggregate",
    valueKey: "aggregateConfig",
    helper: aggregateConfigOf,
    a: { groupBy: ["a"], aggregations: [] },
    b: { groupBy: ["b"], aggregations: [] },
  },
  {
    op: "sort",
    valueKey: "sortConfig",
    helper: sortConfigOf,
    a: { sortBy: [{ field: "a", direction: "asc" }] },
    b: { sortBy: [{ field: "b", direction: "desc" }] },
  },
  {
    op: "splittext",
    valueKey: "splitTextConfig",
    helper: splitTextConfigOf,
    a: { field: "a", mode: "paragraph", headingLevel: 1, indexField: "i" },
    b: { field: "b", mode: "heading", headingLevel: 2, indexField: "j" },
  },
  {
    op: "extractheadings",
    valueKey: "extractHeadingsConfig",
    helper: extractHeadingsConfigOf,
    a: { field: "a", indexField: "i", levelField: "l" },
    b: { field: "b", indexField: "j", levelField: "m" },
  },
  {
    op: "chunkbytokencount",
    valueKey: "chunkByTokenCountConfig",
    helper: chunkByTokenCountConfigOf,
    a: {
      field: "a",
      targetTokenCount: 100,
      encoding: "o200k_base",
      indexField: "i",
      tokenCountField: "t",
    },
    b: {
      field: "b",
      targetTokenCount: 200,
      encoding: "cl100k_base",
      indexField: "j",
      tokenCountField: "u",
    },
  },
  {
    op: "datebucket",
    valueKey: "dateBucketConfig",
    helper: dateBucketConfigOf,
    a: { field: "a", granularity: "day", outputColumn: "o" },
    b: { field: "b", granularity: "month", outputColumn: "p" },
  },
  {
    op: "pivot",
    valueKey: "pivotConfig",
    helper: pivotConfigOf,
    a: { index: ["a"], column: "c", values: "v", agg: "sum" },
    b: { index: ["b"], column: "d", values: "w", agg: "avg" },
  },
  {
    op: "window",
    valueKey: "windowConfig",
    helper: windowConfigOf,
    a: {
      partitionBy: ["a"],
      orderBy: [],
      function: "row_number",
      field: "",
      outputColumn: "o",
      offset: 1,
      frameSize: null,
      frameUnit: "rows",
    },
    b: {
      partitionBy: ["b"],
      orderBy: [],
      function: "lag",
      field: "f",
      outputColumn: "p",
      offset: 2,
      frameSize: null,
      frameUnit: "rows",
    },
  },
  {
    op: "unpivot",
    valueKey: "unpivotConfig",
    helper: unpivotConfigOf,
    a: { idVars: ["a"], valueVars: ["b"], varName: "v", valueName: "w" },
    b: { idVars: ["c"], valueVars: ["d"], varName: "x", valueName: "y" },
  },
  {
    op: "dedupe",
    valueKey: "dedupeConfig",
    helper: dedupeConfigOf,
    a: { keys: ["a"], keep: "first" },
    b: { keys: ["b"], keep: "last" },
  },
  {
    op: "fillnull",
    valueKey: "fillNullConfig",
    helper: fillNullConfigOf,
    a: { columns: ["a"], strategy: "constant", value: 0 },
    b: { columns: ["b"], strategy: "constant", value: 1 },
  },
  {
    op: "stringops",
    valueKey: "stringOpsConfig",
    helper: stringOpsConfigOf,
    a: { operation: "trim", field: "a", outputColumn: "o" },
    b: { operation: "split", field: "b", outputColumn: "p", separator: ",", index: 1 },
  },
  {
    op: "union",
    valueKey: "unionConfig",
    helper: unionConfigOf,
    a: { secondaryInput: { kind: "source", dataSourceId: "ds-a" }, mode: "byPosition" },
    b: { secondaryInput: { kind: "source", dataSourceId: "ds-b" }, mode: "byName" },
  },
  {
    op: "lookup",
    valueKey: "lookupConfig",
    helper: lookupConfigOf,
    a: {
      secondaryInput: { kind: "source", dataSourceId: "ds-a" },
      sourceKey: "a",
      lookupKey: "b",
      columns: [],
    },
    b: {
      secondaryInput: { kind: "source", dataSourceId: "ds-b" },
      sourceKey: "c",
      lookupKey: "d",
      columns: ["e"],
    },
  },
  {
    op: "join",
    valueKey: "joinConfig",
    helper: joinConfigOf,
    a: {
      secondaryInput: { kind: "source", dataSourceId: "ds-a" },
      joinKey: "a",
      joinType: "inner",
    },
    b: { secondaryInput: { kind: "source", dataSourceId: "ds-b" }, joinKey: "b", joinType: "left" },
  },
  {
    op: "assert",
    valueKey: "assertConfig",
    helper: assertConfigOf,
    a: { rules: [] },
    b: { rules: [{ kind: "notNull", field: "f", params: {}, severity: "error" }] },
  },
  {
    op: "upsertsource",
    valueKey: "upsertSourceConfig",
    helper: upsertSourceConfigOf,
    a: { target: { kind: "existingSource", dataSourceId: "ds-a" }, mode: "append" },
    b: { target: { kind: "existingSource", dataSourceId: "ds-b" }, mode: "replace" },
  },
  {
    op: "convertformat",
    valueKey: "convertFormatConfig",
    helper: convertFormatConfigOf,
    a: { field: "a", from: "csv", to: "json" },
    b: { field: "b", from: "json", to: "csv", outputField: "o" },
  },
  {
    op: "analyzewithai",
    valueKey: "analyzeWithAiConfig",
    helper: analyzeWithAiConfigOf,
    a: { inputField: "a", instruction: "x", outputSchema: [] },
    b: { inputField: "b", instruction: "y", outputSchema: [] },
  },
  {
    op: "generatetext",
    valueKey: "generateTextConfig",
    helper: generateTextConfigOf,
    a: { inputField: "a", instruction: "x", outputField: "o" },
    b: { inputField: "b", instruction: "y", outputField: "p" },
  },
];

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
  it("onFieldToggle accumulates across calls and removes on uncheck", () => {
    const { result } = renderStateHook(stepOf("select", { fields: ["x"] }), jest.fn());
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
    act(() => {
      jest.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(updatePipelineStepMock).toHaveBeenCalledTimes(1);
    expect(updatePipelineStepMock.mock.calls[0][1]).toStrictEqual({ fields: ["x", "b"] });
  });

  it("onFieldToggle: two edits inside one debounce window both reach the single PATCH", () => {
    const { result } = renderStateHook(stepOf("select", { fields: ["x"] }), jest.fn());
    act(() => {
      result.current.onFieldToggle("a", true);
    });
    act(() => {
      result.current.onFieldToggle("b", true);
    });
    act(() => {
      jest.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(updatePipelineStepMock).toHaveBeenCalledTimes(1);
    expect(updatePipelineStepMock.mock.calls[0][1]).toStrictEqual({ fields: ["x", "a", "b"] });
  });

  it("onRenameChange accumulates across calls and an empty name deletes the key", () => {
    const { result } = renderStateHook(stepOf("rename", { renames: {} }), jest.fn());
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
    act(() => {
      jest.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(updatePipelineStepMock).toHaveBeenCalledTimes(1);
    expect(updatePipelineStepMock.mock.calls[0][1]).toStrictEqual({ renames: { y: "2" } });
  });

  it("onCastChange accumulates across calls and an empty type deletes the key", () => {
    const { result } = renderStateHook(stepOf("cast", { casts: {} }), jest.fn());
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
    act(() => {
      jest.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(updatePipelineStepMock).toHaveBeenCalledTimes(1);
    expect(updatePipelineStepMock.mock.calls[0][1]).toStrictEqual({ casts: { y: "float" } });
  });
});
