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
    // F-022 — `echarts-for-react/esm/core` and ECharts' own `/core`,
    // `/charts`, `/components`, `/renderers` subpaths (used by `ChartPanel`
    // + `echartsCore.ts` for tree-shaking — see those mock files' docblocks)
    // are ESM-only, same class of problem as `react-markdown`/`remark-gfm`
    // above. A test file's own `jest.mock(...)` for either still wins over
    // these — see `ChartPanel.test.tsx`.
    "^echarts-for-react/esm/core$": "<rootDir>/src/test/echartsForReactCoreMock.tsx",
    "^echarts/(core|charts|components|renderers)$": "<rootDir>/src/test/echartsCoreSubpathMock.ts",
  },
};
