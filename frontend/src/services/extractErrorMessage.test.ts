import { AxiosError, AxiosHeaders } from "axios";

import { extractErrorMessage } from "./extractErrorMessage";

function makeAxiosError(data: unknown, status = 500): AxiosError {
  return new AxiosError(
    "Request failed with status code 500",
    "ERR_BAD_RESPONSE",
    undefined,
    undefined,
    {
      status,
      statusText: "Internal Server Error",
      headers: {},
      config: { headers: new AxiosHeaders() },
      data,
    },
  );
}

describe("extractErrorMessage", () => {
  it("returns the response body's `error` field when present", () => {
    const err = makeAxiosError({ error: "Duplicate pipeline name" });
    expect(extractErrorMessage(err, "Failed to save.")).toBe("Duplicate pipeline name");
  });

  it("returns the response body's `message` field when `error` is absent", () => {
    const err = makeAxiosError({ message: "Schedule not found" });
    expect(extractErrorMessage(err, "Failed to save.")).toBe("Schedule not found");
  });

  it("prefers `error` over `message` when both are present", () => {
    const err = makeAxiosError({ error: "Duplicate name", message: "generic" });
    expect(extractErrorMessage(err, "Failed to save.")).toBe("Duplicate name");
  });

  it("falls back to the caller-supplied message for an unparseable Axios error body", () => {
    const err = makeAxiosError(undefined);
    expect(extractErrorMessage(err, "Failed to save.")).toBe("Failed to save.");
  });

  it("never surfaces the raw Axios error message (e.g. 'Network Error')", () => {
    const err = new AxiosError("Network Error", "ERR_NETWORK");
    expect(extractErrorMessage(err, "Failed to save.")).toBe("Failed to save.");
  });

  it("falls back to the caller-supplied message for a plain JS Error", () => {
    const err = new Error("something exploded");
    expect(extractErrorMessage(err, "Failed to save.")).toBe("Failed to save.");
  });

  it("falls back to the caller-supplied message for a non-Error thrown value", () => {
    expect(extractErrorMessage("boom", "Failed to save.")).toBe("Failed to save.");
    expect(extractErrorMessage(null, "Failed to save.")).toBe("Failed to save.");
  });

  it("ignores non-string `error`/`message` fields and falls back", () => {
    const err = makeAxiosError({ error: 42, message: null });
    expect(extractErrorMessage(err, "Failed to save.")).toBe("Failed to save.");
  });
});
