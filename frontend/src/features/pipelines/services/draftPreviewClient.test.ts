import {
  DraftPreviewError,
  isDraftPreviewLine,
  postDraftPreview,
  readDraftPreviewStream,
} from "./draftPreviewClient";
import type { DraftPreviewLine } from "../types/draftPreview";
import { chunkedResponse, ndjson, requestTagged } from "./draftPreviewTestSupport";

const stepLine = { type: "step", step: "a", count: 2, schema: [{ name: "k", type: "int" }] };
const rowsLine = {
  type: "rows",
  step: "a",
  available: true,
  rows: [{ k: { $int: 1 } }],
  count: 1,
  truncated: false,
};

async function read(response: Response): Promise<DraftPreviewLine[]> {
  const lines: DraftPreviewLine[] = [];
  await readDraftPreviewStream(response, (l) => lines.push(l));
  return lines;
}

describe("readDraftPreviewStream", () => {
  it("delivers each line once and in order", async () => {
    const lines = await read(chunkedResponse([ndjson(stepLine, rowsLine)]));
    expect(lines).toEqual([stepLine, rowsLine]);
  });

  it("joins a line that arrives in two chunks", async () => {
    const text = ndjson(stepLine);
    const cut = Math.floor(text.length / 2);
    const lines = await read(
      chunkedResponse([text.slice(0, cut), text.slice(cut) + ndjson(rowsLine)]),
    );
    expect(lines).toEqual([stepLine, rowsLine]);
  });

  it("joins a multi-byte character split across two chunks", async () => {
    const line = { type: "error", step: "naïve-€", message: "ünïcode €" };
    const bytes = new TextEncoder().encode(ndjson(line));
    const euro = bytes.indexOf(0xe2);
    const lines = await read(chunkedResponse([bytes.slice(0, euro + 1), bytes.slice(euro + 1)]));
    expect(lines).toEqual([line]);
  });

  it("delivers lines as they arrive, before the stream ends", async () => {
    const seen: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(ndjson(stepLine)));
        await gate;
        controller.enqueue(encoder.encode(ndjson(rowsLine)));
        controller.close();
      },
    });
    const done = readDraftPreviewStream(
      { ok: true, status: 200, headers: { get: () => null }, body } as unknown as Response,
      (l) => seen.push(l.type),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual(["step"]);
    release();
    await done;
    expect(seen).toEqual(["step", "rows"]);
  });

  it("rejects a line that is not JSON, and one that is not a known line", async () => {
    await expect(read(chunkedResponse(["not json\n"]))).rejects.toThrow(DraftPreviewError);
    await expect(read(chunkedResponse([ndjson({ type: "progress", step: "a" })]))).rejects.toThrow(
      /not a known line/,
    );
  });

  it("rejects a body that ends in the middle of a line", async () => {
    await expect(read(chunkedResponse([JSON.stringify(stepLine)]))).rejects.toThrow(
      /middle of a line/,
    );
  });

  it("rejects a non-200 response with its status, and carries Retry-After", async () => {
    const failure = await read(
      chunkedResponse([], { status: 429, headers: { "Retry-After": "3" } }),
    ).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(DraftPreviewError);
    expect(failure).toMatchObject({ status: 429, retryAfterSeconds: 3 });
    await expect(read(chunkedResponse([], { status: 500 }))).rejects.toMatchObject({ status: 500 });
  });
});

describe("isDraftPreviewLine", () => {
  it("accepts every line type the contract defines", () => {
    const failed = { type: "failed", message: "Draft preview failed" };
    const unavailable = { type: "unavailable", step: "a", reason: "aiStep" };
    const error = { type: "error", step: "a", message: "boom" };
    for (const line of [stepLine, rowsLine, failed, unavailable, error])
      expect(isDraftPreviewLine(line)).toBe(true);
    expect(isDraftPreviewLine({ ...rowsLine, step: null, available: false, rows: [] })).toBe(true);
  });

  it("rejects a renamed, missing or extra field, an unknown reason or column type, and a negative count", () => {
    const { count, ...withoutCount } = stepLine;
    expect(count).toBe(2);
    expect(isDraftPreviewLine({ ...withoutCount, n: 2 })).toBe(false);
    expect(isDraftPreviewLine(withoutCount)).toBe(false);
    expect(isDraftPreviewLine({ ...stepLine, extra: true })).toBe(false);
    expect(isDraftPreviewLine({ ...stepLine, schema: [{ name: "k", type: "decimal" }] })).toBe(
      false,
    );
    expect(isDraftPreviewLine({ type: "unavailable", step: "a", reason: "because" })).toBe(false);
    expect(isDraftPreviewLine({ ...stepLine, count: -1 })).toBe(false);
    expect(isDraftPreviewLine({ type: "failed", message: "other" })).toBe(false);
    expect(isDraftPreviewLine(null)).toBe(false);
    expect(isDraftPreviewLine([stepLine])).toBe(false);
  });
});

describe("postDraftPreview", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("posts JSON with the session credentials, the CSRF header and the abort signal", async () => {
    const fetchMock = jest.fn().mockResolvedValue(chunkedResponse([]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const controller = new AbortController();
    const request = requestTagged("x");
    await postDraftPreview("pipe/1", request, controller.signal);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/pipelines/pipe%2F1/draft-preview");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Helio-Requested-With": "1",
    });
    expect(init.signal).toBe(controller.signal);
    expect(JSON.parse(init.body as string)).toEqual(request);
  });
});
