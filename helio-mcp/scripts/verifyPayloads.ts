/**
 * Pure builders for every WRITE tool call `verify.ts` makes. verify.ts and the drift guard
 * (`verifyPayloads.test.ts`) both import these, so the script cannot carry a payload the guard
 * never saw -- the duplication that let `create_pipeline`'s retired `source:` shape survive
 * HEL-913's `roots[]` change.
 */

export interface VerifyToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

const SOURCE_COLUMNS = [
  { name: "region", type: "string" },
  { name: "revenue", type: "integer" },
];

const SOURCE_ROWS = [
  ["North", 320],
  ["South", 210],
  ["East", 265],
  ["West", 180],
];

export function pipelineNameFor(runId: string): string {
  return `HEL-1264 verify pipeline ${runId}`;
}

export function sourceNameFor(runId: string): string {
  return `HEL-1264 verify source ${runId}`;
}

/** Pipeline with ONE inline static root and no steps/outputs (add_outputs_from_shape adds those). */
export function buildCreatePipelineCall(runId: string): VerifyToolCall {
  return {
    name: "create_pipeline",
    arguments: {
      name: pipelineNameFor(runId),
      roots: [
        {
          type: "static",
          name: sourceNameFor(runId),
          config: { columns: SOURCE_COLUMNS, rows: SOURCE_ROWS },
        },
      ],
      steps: [],
      outputs: [],
    },
  };
}

export function buildAddTopNOutputCall(pipelineId: string, runId: string): VerifyToolCall {
  return {
    name: "add_outputs_from_shape",
    arguments: {
      pipelineId,
      shapeId: "top-n",
      params: { measure: "revenue", direction: "desc", n: 2 },
      outputName: `HEL-1264 verify top-n output ${runId}`,
    },
  };
}

/** Deliberately missing `n`: the backend rejects it and nothing is written. */
export function buildAddInvalidParamsCall(pipelineId: string, runId: string): VerifyToolCall {
  return {
    name: "add_outputs_from_shape",
    arguments: {
      pipelineId,
      shapeId: "top-n",
      params: { measure: "revenue", direction: "desc" },
      outputName: `HEL-1264 verify should-not-exist (invalid params) ${runId}`,
    },
  };
}

/** Deliberately unknown shape id: the backend 404s and nothing is written. */
export function buildAddUnknownShapeCall(pipelineId: string, runId: string): VerifyToolCall {
  return {
    name: "add_outputs_from_shape",
    arguments: {
      pipelineId,
      shapeId: "not-a-real-shape",
      params: {},
      outputName: `HEL-1264 verify should-not-exist (unknown shape) ${runId}`,
    },
  };
}

export const VERIFY_WRITE_BUILDERS = [
  "buildCreatePipelineCall",
  "buildAddTopNOutputCall",
  "buildAddInvalidParamsCall",
  "buildAddUnknownShapeCall",
] as const;
