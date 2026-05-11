import "@testing-library/jest-dom";

// react-router-dom (v7) uses the Node.js web APIs which jsdom doesn't polyfill.
if (typeof globalThis.TextEncoder === "undefined") {
  const { TextEncoder, TextDecoder } = require("util") as typeof import("util");
  globalThis.TextEncoder = TextEncoder as typeof globalThis.TextEncoder;
  globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder;
}

// Polyfill ReadableStream for tests that exercise fetch-based SSE streaming.
// jsdom does not expose the Streams API but Node.js 18+ has it in stream/web.
if (typeof globalThis.ReadableStream === "undefined") {
  const { ReadableStream: RS } = require("stream/web") as { ReadableStream: typeof ReadableStream };
  globalThis.ReadableStream = RS;
}
