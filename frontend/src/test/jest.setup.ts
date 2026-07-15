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

// jsdom never performs real layout, so `offsetWidth`/`offsetHeight` are
// always 0 (see systematic-debugging probe in HEL-301's files-modified.md).
// react-grid-layout's `useContainerWidth` (used by `PanelGrid`, unmocked in
// tests like App.test.tsx) reads `offsetWidth` on mount to decide the
// initial grid width — HEL-301 made that width load-bearing (it now gates
// whether `PanelGrid` renders the desktop grid or the phone stack), so an
// unstubbed 0 silently flips every test that doesn't explicitly mock
// react-grid-layout onto the phone path. Default to a desktop-representative
// width so tests get the desktop grid unless they explicitly mock width
// themselves (as PanelGrid.test.tsx / MobilePanelStack.test.tsx do to
// exercise the phone path) — matching the pre-HEL-301 behavior where
// `PanelGrid` always rendered the RGL grid regardless of measured width.
if (typeof HTMLElement !== "undefined") {
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    value: 1280,
  });
}
