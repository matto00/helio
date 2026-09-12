import { AxiosError } from "axios";

import { parseSchemaUpdateError } from "./parseSchemaUpdateError";

function axiosErrorWith(status: number, data: unknown): AxiosError {
  const err = new AxiosError("Request failed");
  err.response = {
    status,
    data,
    statusText: "",
    headers: {},
    config: {} as never,
  };
  return err;
}

describe("parseSchemaUpdateError", () => {
  it("parses a 409 SchemaUpdateConflictResponse into the conflict shape", () => {
    const err = axiosErrorWith(409, {
      rejectedFields: [{ name: "age", reason: "3 rows are incompatible" }],
      message: "Schema update rejected.",
    });
    const parsed = parseSchemaUpdateError(err);
    expect(parsed).toEqual({
      kind: "conflict",
      rejectedFields: [{ name: "age", reason: "3 rows are incompatible" }],
      message: "Schema update rejected.",
    });
  });

  it("parses a structural 400 (no rejectedFields) into the structural shape", () => {
    const err = axiosErrorWith(400, { message: "Rename target collides with a dropped field." });
    const parsed = parseSchemaUpdateError(err);
    expect(parsed).toEqual({
      kind: "structural",
      message: "Rename target collides with a dropped field.",
    });
  });

  it("falls back to structural with a generic message when the 400 body has no message/error", () => {
    const err = axiosErrorWith(400, {});
    expect(parseSchemaUpdateError(err)).toEqual({
      kind: "structural",
      message: "Schema edit failed.",
    });
  });

  it("falls back to unknown for a non-axios error", () => {
    expect(parseSchemaUpdateError(new Error("boom"))).toEqual({
      kind: "unknown",
      message: "Failed to update schema.",
    });
  });

  it("falls back to unknown for a 500", () => {
    const err = axiosErrorWith(500, { message: "Internal error" });
    expect(parseSchemaUpdateError(err)).toEqual({
      kind: "unknown",
      message: "Failed to update schema.",
    });
  });
});
