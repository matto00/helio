import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { expect, type Page, type Route } from "@playwright/test";

// HEL-1746 C1: the ONLY thing the ask e2e fakes is the `/ask` response, at the browser seam. The bodies are the committed
// `shared-test-fixtures/ask/*.json` files, which the backend spec AskSeamSpec asserts equal what the REAL routes write, and
// each is validated here against its committed schema both before and after the real ids are substituted. The pin POST, the
// placement and everything after them run against the real backend.

const requireFromFrontend = createRequire(resolve(__dirname, "../../frontend/package.json"));
const Ajv2020 = requireFromFrontend("ajv/dist/2020").default;
const ROOT = resolve(__dirname, "../..");
const ajv = new Ajv2020({ allErrors: true, validateFormats: false });

const read = (p: string): string => readFileSync(resolve(ROOT, p), "utf8");
const compiled = new Map<string, ReturnType<typeof ajv.compile>>();
const validator = (schema: string) => {
  const cached = compiled.get(schema);
  if (cached !== undefined) return cached;
  const fn = ajv.compile(JSON.parse(read(`schemas/ask/${schema}`)));
  compiled.set(schema, fn);
  return fn;
};
const SCHEMA_OF: Record<AskFixtureName, string> = {
  "ask-200-pin.json": "ask-response.schema.json",
  "ask-200-no-pin.json": "ask-response.schema.json",
  "ask-422-ungrounded.json": "ask-ungrounded-response.schema.json",
  "ask-422-truncated.json": "ask-truncated-response.schema.json",
  "ask-403-tier.json": "ask-tier-error-response.schema.json",
  "ask-429-limit.json": "ask-tier-error-response.schema.json",
};

export type AskFixtureName =
  | "ask-200-pin.json"
  | "ask-200-no-pin.json"
  | "ask-422-ungrounded.json"
  | "ask-422-truncated.json"
  | "ask-403-tier.json"
  | "ask-429-limit.json";

export interface AskIds {
  output1: string;
  output2: string;
  pipeline: string;
  /** The pipeline root's real id (the server's pin falls back to the pipeline id for a single root). */
  root: string;
}

/** A committed fixture, schema-validated, with the placeholders replaced by the real ids (and re-validated). */
export function askFixture(
  name: AskFixtureName,
  ids: AskIds,
  names: readonly [string, string] = ["Orders table", "Total amount"],
): Record<string, unknown> {
  const validate = validator(SCHEMA_OF[name]);
  const raw = JSON.parse(read(`shared-test-fixtures/ask/${name}`)) as unknown;
  expect(validate(raw), `${name}: ${JSON.stringify(validate.errors)}`).toBe(true);
  const text = read(`shared-test-fixtures/ask/${name}`)
    .replaceAll("{{OUTPUT_1}}", ids.output1)
    .replaceAll("{{OUTPUT_2}}", ids.output2)
    .replace(/("rootId": ")\{\{PIPELINE_1\}\}/, `$1${ids.root}`)
    .replaceAll("{{PIPELINE_1}}", ids.pipeline)
    // The fixture's cited-Output names are the harness's; the page shows the names this lane's Outputs really have.
    .replace('"name": "Revenue"', `"name": ${JSON.stringify(names[0])}`)
    .replace('"name": "Cost"', `"name": ${JSON.stringify(names[1])}`);
  const body = JSON.parse(text) as Record<string, unknown>;
  expect(validate(body), `${name} (substituted): ${JSON.stringify(validate.errors)}`).toBe(true);
  return body;
}

export interface AskSeam {
  /** Every ask request the page sent (path and parsed body), in order. */
  requests: Array<{ path: string; body: unknown }>;
}

/** Fulfils `/api/dashboards/:id/ask` and `/api/outputs/:id/ask` with `respond(n)` (n is 0 for the first request) and records them. */
export async function fakeAsk(
  page: Page,
  respond: (n: number) => { status: number; body: Record<string, unknown> },
): Promise<AskSeam> {
  const seam: AskSeam = { requests: [] };
  await page.route(/\/api\/(dashboards|outputs)\/[^/]+\/ask$/, async (route: Route) => {
    const request = route.request();
    const { status, body } = respond(seam.requests.length);
    seam.requests.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() });
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  return seam;
}
