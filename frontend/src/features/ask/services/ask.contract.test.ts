import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020";
import { AxiosError, type AxiosResponse } from "axios";

import { parseAskError } from "../parseAskError";
import type { AskError } from "../types/ask";
import { mapAskResponse } from "./askService";

// HEL-1746 task 1.4, the client half of the ask wire seam. The fixtures are NOT hand-built: the backend spec AskSeamSpec asserts
// they equal what the real routes write (and fails if they drift). Here the same files are validated with Ajv against the
// committed schemas and run through the client's response mapping and error parser.

const root = resolve(__dirname, "../../../../..");
const readJson = (p: string): unknown => JSON.parse(readFileSync(resolve(root, p), "utf8"));
const fixture = (name: string): Record<string, unknown> =>
  readJson(`shared-test-fixtures/ask/${name}`) as Record<string, unknown>;

const ajv = new Ajv2020({ allErrors: true, validateFormats: false });
const compile = (p: string) => ajv.compile(readJson(`schemas/ask/${p}`) as object);
const responseSchema = compile("ask-response.schema.json");
const ungroundedSchema = compile("ask-ungrounded-response.schema.json");
const truncatedSchema = compile("ask-truncated-response.schema.json");
const tierSchema = compile("ask-tier-error-response.schema.json");

function failure(status: number, data: unknown): AxiosError {
  return new AxiosError("fail", undefined, undefined, undefined, {
    status,
    data,
  } as AxiosResponse);
}

describe("ask 200 fixtures", () => {
  it.each(["ask-200-pin.json", "ask-200-no-pin.json"])(
    "%s validates and maps without loss",
    (name) => {
      const body = fixture(name);
      expect(responseSchema(body)).toBe(true);
      const mapped = mapAskResponse(body);
      expect(mapped.answer).toBe(body.answer);
      expect(mapped.citations).toHaveLength((body.citations as unknown[]).length);
      expect(mapped.citedOutputs).toEqual(body.citedOutputs);
      expect(mapped.pin).toEqual(body.pin);
    },
  );

  it("the viewer fixture carries an explicit null pin, the owner fixture a pin whose request holds no answer text", () => {
    expect(mapAskResponse(fixture("ask-200-no-pin.json")).pin).toBeNull();
    const owner = mapAskResponse(fixture("ask-200-pin.json"));
    expect(owner.pin).not.toBeNull();
    expect(JSON.stringify(owner.pin?.request)).not.toContain(owner.answer);
  });

  it("rejects a body with an unknown field, a model key or a missing pin (the schema the fixture is held to)", () => {
    const ok = fixture("ask-200-pin.json");
    expect(responseSchema({ ...ok, model: "x" })).toBe(false);
    const { pin: _pin, ...noPin } = ok;
    expect(responseSchema(noPin)).toBe(false);
  });
});

describe("ask error fixtures", () => {
  const cases: Array<[string, number, ReturnType<typeof compile>, AskError]> = [
    ["ask-422-ungrounded.json", 422, ungroundedSchema, { kind: "ungrounded" }],
    ["ask-422-truncated.json", 422, truncatedSchema, { kind: "truncated" }],
    ["ask-403-tier.json", 403, tierSchema, { kind: "tierForbidden" }],
    ["ask-429-limit.json", 429, tierSchema, { kind: "limitReached", limit: 50 }],
  ];

  it.each(cases)("%s validates and parses to its kind", (name, status, schema, expected) => {
    const body = fixture(name);
    expect(schema(body)).toBe(true);
    expect(parseAskError(failure(status, body))).toEqual(expected);
  });

  it("negative: a body that breaks its schema is rejected", () => {
    expect(ungroundedSchema({ message: "m", code: "ASK_UNGROUNDED" })).toBe(false);
    expect(truncatedSchema({ ...fixture("ask-422-truncated.json"), reasons: [] })).toBe(false);
    expect(tierSchema({ code: "OTHER", message: "m" })).toBe(false);
    expect(
      ungroundedSchema({ ...fixture("ask-422-ungrounded.json"), code: "ASK_ANSWER_TRUNCATED" }),
    ).toBe(false);
  });
});
