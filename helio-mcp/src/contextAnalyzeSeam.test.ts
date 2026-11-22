/**
 * HEL-1625 seam guard (design D8), the MCP half: the fake `GET /api/pipelines/context-analyze` body every context
 * test serves is validated against the SAME committed JSON schema the backend's real response is validated against
 * (`PipelineContextAnalyzeRoutesSpec`). `buildWorkspaceContext` falls back silently, so a key the fake and the real
 * server disagree on would keep every other test green while production re-analyzes every pipeline. A drifted key
 * must fail HERE.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ajv2020 from "ajv/dist/2020.js";
import { buildWorkspaceContext } from "./context.js";
import { ANALYZE_FAILS_INDEX, createFixture, PIPELINE_COUNT } from "./contextBudgetFixture.js";

type Ajv2020Ctor = typeof import("ajv/dist/2020.js").default;
const interop = ajv2020 as unknown as {
  default?: { default?: Ajv2020Ctor } & Ajv2020Ctor;
} & Ajv2020Ctor;
const Ajv2020: Ajv2020Ctor = interop.default?.default ?? interop.default ?? interop;

const SCHEMAS = join(__dirname, "..", "..", "schemas", "pipelines");
const load = (file: string): object =>
  JSON.parse(readFileSync(join(SCHEMAS, file), "utf8")) as object;

function compile() {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  // the cross-file $ref to the analyze schema's definitions resolves by $id
  ajv.addSchema(load("pipeline-analyze-response.schema.json"));
  return ajv.compile(load("pipeline-context-analyze-response.schema.json"));
}

async function servedBody(opts: Parameters<typeof createFixture>[0] = {}): Promise<unknown> {
  const fx = createFixture({ contextAnalyze: "serve", ...opts });
  const response = await fx.fetchImpl("https://helio.test/api/pipelines/context-analyze");
  return response.json();
}

describe("context-analyze seam: MCP fake body vs the committed schema (HEL-1625 D8)", () => {
  it("the fake body every context test serves conforms to the committed schema", async () => {
    const validate = compile();
    const body = await servedBody();
    expect(validate(body)).toBe(true);
    expect(validate.errors).toBeNull();
    // every pipeline but the one whose analysis fails
    expect((body as { items: unknown[] }).items).toHaveLength(PIPELINE_COUNT - 1);
  });

  it("the fake items equal the fake /analyze bodies' steps and warnings (they cannot drift)", async () => {
    const fx = createFixture({ contextAnalyze: "serve" });
    const { items } = (await (
      await fx.fetchImpl("https://helio.test/api/pipelines/context-analyze")
    ).json()) as { items: Array<{ pipelineId: string; steps: unknown; warnings: unknown }> };
    for (const item of items) {
      const analyze = (await (
        await fx.fetchImpl(`https://helio.test/api/pipelines/${item.pipelineId}/analyze`)
      ).json()) as { steps: unknown; warnings: unknown };
      expect(item.steps).toEqual(analyze.steps);
      expect(item.warnings).toEqual(analyze.warnings);
    }
    expect(items.some((i) => (i.warnings as unknown[]).length > 0)).toBe(true);
    expect(items.some((i) => (i.steps as unknown[]).length === 0)).toBe(true);
  });

  it("the schema rejects a renamed key, at the envelope, the item, the step and the warning level (the guard can fail)", async () => {
    const validate = compile();
    const { items } = (await servedBody()) as { items: Array<Record<string, unknown>> };
    expect(validate({ results: items })).toBe(false);
    expect(
      validate({
        items: items.map(({ pipelineId, ...rest }) => ({ pipeline_id: pipelineId, ...rest })),
      }),
    ).toBe(false);
    expect(
      validate({
        items: items.map(({ warnings, ...rest }) => ({ ...rest, warning: warnings })),
      }),
    ).toBe(false);
    expect(
      validate({
        items: items.map((i) => ({
          ...i,
          steps: (i["steps"] as Array<Record<string, unknown>>).map(({ outputSchema, ...s }) => ({
            ...s,
            output_schema: outputSchema,
          })),
        })),
      }),
    ).toBe(false);
    expect(
      validate({
        items: items.map((i) => ({
          ...i,
          warnings: (i["warnings"] as Array<Record<string, unknown>>).map(({ stepId, ...w }) => ({
            ...w,
            step_id: stepId,
          })),
        })),
      }),
    ).toBe(false);
  });

  it("a body the schema rejects makes buildWorkspaceContext analyze every pipeline per pipeline (why the guard matters)", async () => {
    const fx = createFixture({
      contextAnalyze: "serve",
      contextAnalyzeBody: (items) => ({
        items: (items as Array<Record<string, unknown>>).map(({ pipelineId, ...rest }) => ({
          pipeline_id: pipelineId,
          ...rest,
        })),
      }),
    });
    const write = jest.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    try {
      await buildWorkspaceContext(fx.api, 50_000_000, false);
    } finally {
      write.mockRestore();
    }
    expect(fx.stats().byRoute["/api/pipelines/:id/analyze"]).toBe(PIPELINE_COUNT);
    expect(ANALYZE_FAILS_INDEX).toBeLessThan(PIPELINE_COUNT);
  });
});
