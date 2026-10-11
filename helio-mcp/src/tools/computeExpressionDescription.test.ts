/**
 * HEL-1314 seam test, MCP half. `shared-test-fixtures/compute-expression-functions.json` lists every
 * function the backend's compute grammar supports (`ComputeExpressionFunctionsSeamSpec` asserts it equals
 * `ExpressionEvaluator.SupportedFunctions`). Here every tool description an agent authors or validates a
 * compute step from must name each one, so a function added to the engine cannot go undocumented.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { HelioApi } from "../helioApi.js";
import { COMPUTE_EXPRESSION_DOC } from "./computeExpression.js";
import { registerPipelineProposalTools } from "./pipelineProposal.js";
import { registerWriteTools } from "./write.js";

const { functions } = JSON.parse(
  readFileSync(
    join(__dirname, "../../../shared-test-fixtures/compute-expression-functions.json"),
    "utf8",
  ),
) as { functions: string[] };

function descriptions(register: (server: never, api: HelioApi) => void): Record<string, string> {
  const out: Record<string, string> = {};
  const server = {
    registerTool: (name: string, def: { description?: string }) => {
      out[name] = def.description ?? "";
    },
  };
  register(server as never, {} as HelioApi);
  return out;
}

describe("compute expression description (MCP side)", () => {
  // Only the "Functions: ..." list, so prose such as "no now()" never counts as a function name.
  const listed = (): string[] => {
    const start = COMPUTE_EXPRESSION_DOC.indexOf("Functions: ");
    const end = COMPUTE_EXPRESSION_DOC.indexOf(" date_trunc/add_days return");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const names = COMPUTE_EXPRESSION_DOC.slice(start, end).match(/\b[a-z_]+(?=\()/g) ?? [];
    return [...new Set(names)];
  };

  it("names exactly the functions in the shared fixture, in both directions", () => {
    expect([...listed()].sort()).toEqual([...functions].sort());
  });

  it("documents the date functions' units, UTC semantics and the absence of now()", () => {
    expect(COMPUTE_EXPRESSION_DOC).toContain("seconds_between(end,start)");
    expect(COMPUTE_EXPRESSION_DOC).toContain("quarter, year");
    expect(COMPUTE_EXPRESSION_DOC).toContain("UTC");
    expect(COMPUTE_EXPRESSION_DOC).toContain("no now()");
  });

  it("is embedded in add_pipeline_step, propose_pipeline and analyze_pipeline_proposal", () => {
    const write = descriptions(registerWriteTools);
    const proposal = descriptions(registerPipelineProposalTools);
    expect(write["add_pipeline_step"]).toContain(COMPUTE_EXPRESSION_DOC);
    expect(proposal["propose_pipeline"]).toContain(COMPUTE_EXPRESSION_DOC);
    expect(proposal["analyze_pipeline_proposal"]).toContain(COMPUTE_EXPRESSION_DOC);
  });
});
