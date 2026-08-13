/** Test helper for mocking a `fetch` + `ReadableStream`-based SSE stream
 *  (never `EventSource` — see `usePipelineRunEvents.ts`'s doc comment for
 *  why). Shared by `useDashboardAuthoringStream.test.ts` and
 *  `AuthoringChatDrawer.test.tsx` so both reuse the same Response/
 *  ReadableStream scaffolding instead of hand-rolling it twice. */

export interface SseMockController {
  /** Push a named SSE event to the stream. Object/array data is JSON-encoded
   *  automatically; strings are sent as-is. */
  push: (eventName: string, data: unknown) => void;
  /** Close the stream cleanly (simulates server-side close). */
  close: () => void;
}

export function createSseMock(
  options: {
    ok?: boolean;
    contentType?: string;
  } = {},
): { controller: SseMockController; fetchMock: jest.Mock } {
  const { ok = true, contentType = "text/event-stream; charset=UTF-8" } = options;

  let enqueue: (chunk: Uint8Array) => void = () => undefined;
  let closeStream: () => void = () => undefined;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      enqueue = (chunk) => ctrl.enqueue(chunk);
      closeStream = () => ctrl.close();
    },
  });

  // Use a plain object instead of new Response(...) because jsdom does not
  // expose the global Response constructor in the test environment.
  const response = {
    ok,
    status: ok ? 200 : 401,
    headers: {
      get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null),
    },
    body: stream,
  } as unknown as Response;

  const fetchMock = jest.fn().mockResolvedValue(response);

  const controller: SseMockController = {
    push(eventName: string, data: unknown) {
      const payload = typeof data === "string" ? data : JSON.stringify(data);
      enqueue(encoder.encode(`event: ${eventName}\ndata: ${payload}\n\n`));
    },
    close() {
      try {
        closeStream();
      } catch {
        /* already closed by hook on terminal event */
      }
    },
  };

  return { controller, fetchMock };
}
