import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020";

import type { DraftSaveRequest, DraftSaveResponse } from "../types/draftSave";
import { extractDraftSaveConflict } from "./draftSaveService";
import { AxiosError, type AxiosResponse } from "axios";

// HEL-1629 task 5.2, the client half of the draft-save wire seam (same discipline as HEL-1628's sample seam). The response
// fixtures are NOT hand-built: the backend spec DraftSaveSeamSpec asserts they equal what the real production serializers
// emit and fails if they drift. Here the same files are validated with Ajv against the committed schemas, the request
// fixture is the body this client's types produce, and the conflict extractor reads the real 409 and 422 bodies.

const root = resolve(__dirname, "../../../../..");
const read = (p: string) => JSON.parse(readFileSync(resolve(root, p), "utf8"));
const schema = (name: string) => read(`schemas/${name}`);

const ajv = new Ajv2020({ allErrors: true, validateFormats: false });
ajv.addSchema(schema("outputs/output-schema-field.schema.json"));
const compile = (name: string) => ajv.compile(schema(name));

const validateRequest = compile("pipelines/draft-save-request.schema.json");
const validateResponse = compile("pipelines/draft-save-response.schema.json");
const validateCascade = compile("pipelines/draft-cascade-required-response.schema.json");
const validateStale = compile("shared/patch-set-stale-response.schema.json");
const errorsOf = (validate: { errors?: { instancePath: string; message?: string }[] | null }) =>
  (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);

const fixture = <T>(name: string): T => read(`shared-test-fixtures/draft-save/${name}`) as T;
const requestFixture = fixture<DraftSaveRequest>("draft-save-request.json");
const noRun = fixture<DraftSaveResponse>("draft-save-response.json");
const started = fixture<DraftSaveResponse>("draft-save-response-run-started.json");
const rejected = fixture<DraftSaveResponse>("draft-save-response-run-rejected.json");

const asAxiosError = (status: number, data: unknown): AxiosError => {
  const error = new AxiosError("request failed");
  error.response = { status, data } as AxiosResponse;
  return error;
};

describe("draft save wire contract", () => {
  it("accepts the request body the client types produce", () => {
    expect(validateRequest(requestFixture)).toBe(true);
    expect(requestFixture.steps.map((s) => s.id ?? s.clientId)).toEqual(["s1", "n1"]);
  });

  it("rejects a request with an unknown field (no force or overwrite flag exists), a bad runAfterSave, or no base", () => {
    expect(validateRequest({ ...requestFixture, force: true })).toBe(false);
    expect(validateRequest({ ...requestFixture, runAfterSave: "always" })).toBe(false);
    const { baseFingerprint: _omitted, ...noBase } = requestFixture;
    expect(validateRequest(noBase)).toBe(false);
  });

  it("accepts the serializer's 200 bodies: no run, a started run, a refused run", () => {
    for (const body of [noRun, started, rejected]) {
      validateResponse(body);
      expect(errorsOf(validateResponse)).toEqual([]);
    }
    expect(noRun.run).toBeNull();
    expect(started.run).toMatchObject({ started: true, status: "succeeded" });
    expect(rejected.run).toMatchObject({ started: false, code: 429, retryAfterSeconds: 12 });
  });

  it("rejects a 200 body without `run` or with a malformed fingerprint", () => {
    const { run: _omitted, ...withoutRun } = noRun;
    expect(validateResponse(withoutRun)).toBe(false);
    expect(validateResponse({ ...noRun, saved: { ...noRun.saved, fingerprint: "v1:abc" } })).toBe(
      false,
    );
  });

  it("reads the real 409 and 422 bodies through the conflict extractor", () => {
    const stale = fixture<Record<string, unknown>>("draft-save-stale-409.json");
    const cascade = fixture<Record<string, unknown>>("draft-save-cascade-422.json");
    expect(validateStale(stale)).toBe(true);
    expect(validateCascade(cascade)).toBe(true);
    expect(extractDraftSaveConflict(asAxiosError(409, stale))).toMatchObject({
      kind: "stale",
      staleTargets: [{ index: 0, kind: "pipeline", id: "p1" }],
    });
    expect(extractDraftSaveConflict(asAxiosError(422, cascade))).toMatchObject({
      kind: "cascadeRequired",
      impact: { panelIds: ["panel-1"], alertRuleIds: ["rule-1"] },
    });
  });
});
