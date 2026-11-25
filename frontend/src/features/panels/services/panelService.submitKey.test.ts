// HEL-1175 — `submitFormPanel` mints one key per call, sends it as `submitKey`, and re-sends the same body and key
// when a request gets no HTTP response (at most 2 more times). Mocked at the HTTP layer, never `submitFormPanel`.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AxiosError, AxiosHeaders } from "axios";

import { httpClient } from "../../../services/httpClient";
import { submitFormPanel } from "./panelService";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { post: jest.fn() },
}));
const post = jest.mocked(httpClient.post);

const OK = {
  data: { rows: [{ id: "r1", seq: 0, updatedAt: "now" }], updatedAt: "now", deniedPipelines: [] },
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function noResponse(): AxiosError {
  return new AxiosError("Network Error", "ERR_NETWORK");
}
function withResponse(status: number): AxiosError {
  return new AxiosError("Request failed", String(status), undefined, undefined, {
    status,
    statusText: "",
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
    data: {},
  });
}

type Body = { values: unknown; submitKey: string };
// Each request body is deep-copied AT CALL TIME: the mock records the same object reference otherwise, so a body
// mutated between attempts would still compare equal to itself.
let sent: Body[] = [];
const bodyOf = (call: number) => sent[call];
// Scripts the outcomes of successive posts; the last outcome repeats.
function script(...outcomes: Array<{ ok: unknown } | { err: unknown }>) {
  let i = 0;
  post.mockImplementation((_url: string, body?: unknown) => {
    sent.push(JSON.parse(JSON.stringify(body)) as Body);
    const o = outcomes[Math.min(i++, outcomes.length - 1)];
    return "err" in o ? Promise.reject(o.err) : Promise.resolve(o.ok);
  });
}
const retry = { backoffMs: [0, 0] };

describe("submitFormPanel idempotency key (HEL-1175)", () => {
  beforeEach(() => {
    post.mockReset();
    sent = [];
  });

  it("sends a UUID submitKey beside values, in the shape of the shared seam fixture", async () => {
    script({ ok: OK });
    await submitFormPanel("p1", { quantity: 3, note: "hello" }, {}, retry);
    const fixture = JSON.parse(
      readFileSync(
        resolve(
          __dirname,
          "../../../../../shared-test-fixtures/panels/form-submit-keyed-request.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(Object.keys(bodyOf(0)).sort()).toEqual(Object.keys(fixture).sort());
    expect(bodyOf(0).submitKey).toMatch(UUID);
    expect(bodyOf(0).values).toEqual({ quantity: 3, note: "hello" });
  });

  it("re-sends the same body and key after a no-response failure and resolves on the replayed success", async () => {
    script({ err: noResponse() }, { ok: OK });
    await expect(submitFormPanel("p1", { delta: 1 }, {}, retry)).resolves.toEqual(OK.data);
    expect(post).toHaveBeenCalledTimes(2);
    expect(bodyOf(1)).toEqual(bodyOf(0));
    expect(bodyOf(1).submitKey).toBe(bodyOf(0).submitKey);
  });

  it("stops after 3 requests, all with the same key, and rethrows the original error", async () => {
    const err = noResponse();
    script({ err });
    await expect(submitFormPanel("p1", { delta: 1 }, {}, retry)).rejects.toBe(err);
    expect(post).toHaveBeenCalledTimes(3);
    expect(new Set([0, 1, 2].map((i) => bodyOf(i).submitKey)).size).toBe(1);
  });

  it("does not retry when any HTTP response arrives", async () => {
    const err = withResponse(500);
    script({ err });
    await expect(submitFormPanel("p1", { delta: 1 }, {}, retry)).rejects.toBe(err);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-axios failure", async () => {
    const err = new Error("boom");
    script({ err });
    await expect(submitFormPanel("p1", { delta: 1 }, {}, retry)).rejects.toBe(err);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("gives every separate call a new key", async () => {
    script({ ok: OK });
    await submitFormPanel("p1", { delta: 1 }, {}, retry);
    await submitFormPanel("p1", { delta: 1 }, {}, retry);
    expect(bodyOf(0).submitKey).not.toBe(bodyOf(1).submitKey);
  });
});
