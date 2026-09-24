import { AxiosError, AxiosHeaders } from "axios";

import { isDefiniteRejection } from "./classifySubmitFailure";

function axiosErrorWith(status: number): AxiosError {
  return new AxiosError("Request failed", String(status), undefined, undefined, {
    status,
    statusText: "",
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
    data: {},
  });
}

describe("isDefiniteRejection", () => {
  it("is true for any axios error carrying an HTTP response, any status code", () => {
    expect(isDefiniteRejection(axiosErrorWith(400))).toBe(true);
    expect(isDefiniteRejection(axiosErrorWith(500))).toBe(true);
    // A proxy-relayed 502/503/504 still carries a real response — HEL-1169 design.md D1
    // deliberately treats it as definite too, since axios's `err.response` boundary is the "did
    // anything answer" signal, not the status code.
    expect(isDefiniteRejection(axiosErrorWith(502))).toBe(true);
  });

  it("is false for a response-less axios error (network error, timeout, abort)", () => {
    expect(isDefiniteRejection(new AxiosError("Network Error"))).toBe(false);
  });

  it("is false for a non-axios error", () => {
    expect(isDefiniteRejection(new Error("boom"))).toBe(false);
  });
});
