/**
 * HEL-1619 seam guard (design D10a), the MCP half: the fake `GET /api/pipelines/context-details` body
 * every context test serves is validated against the SAME committed JSON schema the backend's real
 * response is validated against (`PipelineContextDetailsRoutesSpec`). Because `buildWorkspaceContext`
 * falls back silently, a key the fake and the real server disagree on would keep every other test
 * green while production re-reads every pipeline (about 3.5x the requests). A drifted key must fail HERE.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ajv2020 from "ajv/dist/2020.js";
import { buildWorkspaceContext } from "./context.js";
import { createFixture, PIPELINE_COUNT } from "./contextBudgetFixture.js";

type Ajv2020Ctor = typeof import("ajv/dist/2020.js").default;
// ajv ships CommonJS; depending on the loader the class is the namespace, `.default`, or `.default.default`.
const interop = ajv2020 as unknown as {
  default?: { default?: Ajv2020Ctor } & Ajv2020Ctor;
} & Ajv2020Ctor;
const Ajv2020: Ajv2020Ctor = interop.default?.default ?? interop.default ?? interop;

const SCHEMAS = join(__dirname, "..", "..", "schemas", "pipelines");
const load = (file: string): object =>
  JSON.parse(readFileSync(join(SCHEMAS, file), "utf8")) as object;

function compile() {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  // the cross-file $ref to the run-record schema's AssertionSummary resolves by $id
  ajv.addSchema(load("pipeline-run-record.schema.json"));
  return ajv.compile(load("pipeline-context-details-response.schema.json"));
}

async function servedBody(opts: Parameters<typeof createFixture>[0] = {}): Promise<unknown> {
  const fx = createFixture({ contextDetails: "serve", ...opts });
  const response = await fx.fetchImpl("https://helio.test/api/pipelines/context-details");
  return response.json();
}

describe("context-details seam: MCP fake body vs the committed schema (HEL-1619 D10a)", () => {
  it("the fake body every context test serves conforms to the committed schema", async () => {
    const validate = compile();
    const body = await servedBody();
    expect(validate(body)).toBe(true);
    expect(validate.errors).toBeNull();
    expect((body as { items: unknown[] }).items).toHaveLength(PIPELINE_COUNT);
  });

  it("covers a never-run pipeline (no latestRunAssertions key) and a zero-step pipeline", async () => {
    const { items } = (await servedBody()) as {
      items: Array<{ steps: unknown[]; latestRunAssertions?: unknown }>;
    };
    expect(items.some((i) => !("latestRunAssertions" in i))).toBe(true);
    expect(items.some((i) => i.steps.length === 0)).toBe(true);
  });

  it("the schema rejects a renamed key, at the envelope, the item and the step level (the guard can fail)", async () => {
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
        items: items.map(({ latestRunAssertions, ...rest }) => ({
          ...rest,
          latestRunAssertion: latestRunAssertions,
        })),
      }),
    ).toBe(false);
    expect(
      validate({
        items: items.map((i) => ({
          ...i,
          steps: (i["steps"] as Array<Record<string, unknown>>).map(({ parentStepId, ...s }) => ({
            ...s,
            parent_step_id: parentStepId ?? "x",
          })),
        })),
      }),
    ).toBe(false);
  });

  it("a body the schema rejects makes buildWorkspaceContext fall back for every pipeline (why the guard matters)", async () => {
    const fx = createFixture({
      contextDetails: "serve",
      contextDetailsBody: (items) => ({
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
    // every pipeline fell back: 55 steps + 55 run-history requests, silently as far as the payload goes
    expect(fx.stats().byRoute["/api/pipelines/:id/steps"]).toBe(PIPELINE_COUNT);
    expect(fx.stats().total).toBeGreaterThan(120);
  });
});
