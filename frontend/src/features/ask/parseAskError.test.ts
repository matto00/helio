import { AxiosError, type AxiosResponse } from "axios";

import { parseAskError } from "./parseAskError";

function failure(status: number, data: unknown): AxiosError {
  return new AxiosError("fail", undefined, undefined, undefined, {
    status,
    data,
  } as AxiosResponse);
}

describe("parseAskError (status and code only, never message text)", () => {
  it("403 is tierForbidden whatever the body says", () => {
    expect(parseAskError(failure(403, { code: "TIER_FORBIDDEN", message: "x" }))).toEqual({
      kind: "tierForbidden",
    });
    expect(parseAskError(failure(403, null))).toEqual({ kind: "tierForbidden" });
  });

  it("429 carries the limit when present and omits it when absent", () => {
    expect(
      parseAskError(failure(429, { code: "CHAT_LIMIT_REACHED", message: "m", limit: 8 })),
    ).toEqual({
      kind: "limitReached",
      limit: 8,
    });
    expect(parseAskError(failure(429, { code: "CHAT_LIMIT_REACHED", message: "m" }))).toEqual({
      kind: "limitReached",
    });
  });

  it("422 ASK_ANSWER_TRUNCATED is truncated; ASK_UNGROUNDED and any unknown 422 code is ungrounded", () => {
    expect(parseAskError(failure(422, { code: "ASK_ANSWER_TRUNCATED", message: "m" }))).toEqual({
      kind: "truncated",
    });
    expect(
      parseAskError(failure(422, { code: "ASK_UNGROUNDED", message: "m", reasons: [] })),
    ).toEqual({
      kind: "ungrounded",
    });
    expect(parseAskError(failure(422, { code: "SOMETHING_NEW", message: "m" }))).toEqual({
      kind: "ungrounded",
    });
    expect(parseAskError(failure(422, "not json"))).toEqual({ kind: "ungrounded" });
  });

  it("does not switch on message text", () => {
    expect(
      parseAskError(
        failure(422, {
          code: "ASK_UNGROUNDED",
          message: "ran out of room, ask something narrower",
        }),
      ),
    ).toEqual({
      kind: "ungrounded",
    });
  });

  it("any 5xx is unavailable; 400 is invalid; another 4xx is unknown", () => {
    for (const s of [500, 502, 503, 504])
      expect(parseAskError(failure(s, {}))).toEqual({ kind: "unavailable" });
    expect(parseAskError(failure(400, {}))).toEqual({ kind: "invalid" });
    expect(parseAskError(failure(404, {}))).toEqual({ kind: "unknown" });
  });

  it("a request with no response is network; a non-axios error is unknown", () => {
    expect(parseAskError(new AxiosError("Network Error"))).toEqual({ kind: "network" });
    expect(parseAskError(new Error("boom"))).toEqual({ kind: "unknown" });
  });
});
