/**
 * Seam guard (HEL-1713): the bodies helio-mcp POSTs to the two refresh-family routes are validated
 * against the SAME committed JSON schemas the backend's `McpRefreshFamilyRoutesSpec` validates its
 * real requests and responses against, so a field renamed on one side fails here.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ajv2020 from "ajv/dist/2020.js";
import {
  REFRESH_CLIENT,
  fullFlow,
  startBackend,
  startMcp,
  tokenRequest,
  type McpHarness,
  type StubBackend,
} from "../testing/httpHarness.js";

type Ajv2020Ctor = typeof import("ajv/dist/2020.js").default;
const interop = ajv2020 as unknown as {
  default?: { default?: Ajv2020Ctor } & Ajv2020Ctor;
} & Ajv2020Ctor;
const Ajv2020: Ajv2020Ctor = interop.default?.default ?? interop.default ?? interop;

const SCHEMAS = join(__dirname, "..", "..", "..", "schemas", "mcp");
const load = (file: string): object =>
  JSON.parse(readFileSync(join(SCHEMAS, file), "utf8")) as object;
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });

jest.setTimeout(20_000);

let backend: StubBackend;
let mcp: McpHarness;
beforeEach(async () => {
  backend = await startBackend();
  backend.pats.set("helio_pat_alice", "live");
  mcp = await startMcp(backend);
});
afterEach(async () => {
  await mcp.close();
  await backend.close();
});

describe("refresh-family request bodies match schemas/mcp", () => {
  it("create and rotate bodies validate, and carry no other key", async () => {
    const flow = await fullFlow(mcp, "helio_pat_alice", {}, REFRESH_CLIENT);
    await tokenRequest(mcp, {
      grant_type: "refresh_token",
      client_id: flow.clientId,
      refresh_token: flow.refreshToken ?? "",
    });
    const create = backend.familyBodies.find((b) => b.route === "create");
    const rotate = backend.familyBodies.find((b) => b.route === "rotate");
    expect(create).toBeDefined();
    expect(rotate).toBeDefined();
    const validateCreate = ajv.compile(load("mcp-refresh-family-create-request.schema.json"));
    const validateRotate = ajv.compile(load("mcp-refresh-family-rotate-request.schema.json"));
    expect(validateCreate(create?.body)).toBe(true);
    expect(validateRotate(rotate?.body)).toBe(true);
    expect(validateCreate({ ...(create?.body as object), extra: 1 })).toBe(false);
  });
});
