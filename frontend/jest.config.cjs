const { localJestCaps } = require("../scripts/lib/jest-local-caps.cjs");
const { timingReporters } = require("../scripts/lib/jest-timing-capture.cjs");

module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  testMatch: ["<rootDir>/src/**/*.test.ts", "<rootDir>/src/**/*.test.tsx"],
  setupFilesAfterEnv: ["<rootDir>/src/test/jest.setup.ts"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  moduleNameMapper: {
    "\\.(css)$": "<rootDir>/src/test/styleMock.js",
    "^.*/config/env$": "<rootDir>/src/test/envMock.ts",
    "^react-markdown$": "<rootDir>/src/test/reactMarkdownMock.tsx",
    "^remark-gfm$": "<rootDir>/src/test/remarkGfmMock.ts",
    // F-022 — `echarts-for-react/lib/core` and ECharts' own `/core`,
    // `/charts`, `/components`, `/renderers` subpaths (used by `ChartPanel`
    // + `echartsCore.ts` for tree-shaking — see those mock files' docblocks)
    // are stubbed globally: the `echarts` subpaths are ESM-only (same class of
    // problem as `react-markdown`/`remark-gfm` above), and `lib/core` resolves
    // to a CommonJS build under Jest, so its mapper only supplies the stand-in
    // (jsdom cannot render the real canvas component). A test file's own
    // `jest.mock(...)` for either still wins over these —
    // see `ChartPanel.test.tsx`.
    "^echarts-for-react/lib/core$": "<rootDir>/src/test/echartsForReactCoreMock.tsx",
    "^echarts/(core|charts|components|renderers)$": "<rootDir>/src/test/echartsCoreSubpathMock.ts",
  },
  // HEL-1442: local-only worker/memory/cache caps (empty under CI).
  ...localJestCaps(__dirname),
  // HEL-1601: opt-in per-test timing capture (only when HELIO_JEST_TIMING_DIR is set; `{}` otherwise).
  ...timingReporters("frontend", __dirname),
};
