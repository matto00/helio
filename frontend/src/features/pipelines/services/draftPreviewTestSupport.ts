import type { DraftPreviewRequest } from "../types/draftPreview";

// HEL-1630: shared fixtures for the draft-preview client, scheduler and drag specs. jsdom has no global `Response`, so a
// response is a plain object with the three members the client reads.

const encoder = new TextEncoder();

export interface FakeResponseInit {
  status?: number;
  headers?: Record<string, string>;
}

export function fakeResponse(
  body: ReadableStream<Uint8Array> | null,
  init: FakeResponseInit = {},
): Response {
  const status = init.status ?? 200;
  const headers = init.headers ?? {};
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null },
    body,
  } as unknown as Response;
}

/** A response whose body delivers exactly `chunks`, in order, then ends. */
export function chunkedResponse(
  chunks: Array<string | Uint8Array>,
  init: FakeResponseInit = {},
): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === "string" ? encoder.encode(c) : c);
      controller.close();
    },
  });
  return fakeResponse(stream, init);
}

export interface OpenResponse {
  response: Response;
  push: (text: string) => void;
  close: () => void;
}

/** A response whose body stays open until the test pushes and closes it. */
export function openResponse(): OpenResponse {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: fakeResponse(stream),
    push: (text) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
  };
}

export const ndjson = (...objects: unknown[]): string =>
  objects.map((o) => JSON.stringify(o) + "\n").join("");

/** A request that is cheap to build and distinguishable by `tag`. */
export function requestTagged(tag: string): DraftPreviewRequest {
  return {
    roots: [{ id: "r", rows: [{ tag }] }],
    steps: [
      { id: "s", kind: "limit", enabled: true, rootId: "r", position: 0, config: { count: 1 } },
    ],
  };
}

export const tagOf = (request: DraftPreviewRequest): string =>
  String((request.roots[0].rows[0] as { tag: string }).tag);
