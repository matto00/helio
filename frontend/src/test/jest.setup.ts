import "@testing-library/jest-dom";

// react-router-dom (v7) uses the Node.js web APIs which jsdom doesn't polyfill.
if (typeof globalThis.TextEncoder === "undefined") {
  const { TextEncoder, TextDecoder } = require("util") as typeof import("util");
  globalThis.TextEncoder = TextEncoder as typeof globalThis.TextEncoder;
  globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder;
}
