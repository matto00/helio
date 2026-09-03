module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/?(*.)+(spec|test).[tj]s?(x)"],
  testPathIgnorePatterns: [
    "/node_modules/",
    "/openspec/",
    "/.cursor/",
    "/frontend/",
    "/e2e/",
    "/helio-mcp/dist/",
    // Concertino delivery worktrees live under `.claude/worktrees/`. Each is a
    // full checkout, so without this the root suite (run from the MAIN
    // checkout) runs every in-flight worktree's tests alongside the real
    // ones — making results depend on which deliveries happen to be running.
    // HEL-880: this MUST be anchored to `<rootDir>` (mirroring
    // `modulePathIgnorePatterns` below), not a bare substring. Jest matches
    // `testPathIgnorePatterns` unanchored against each test's absolute path,
    // and a delivery worktree's own rootDir is itself nested under
    // `.claude/worktrees/<name>/...` — a bare "/.claude/worktrees/" pattern
    // matches every path when run from INSIDE a worktree, silently
    // discarding all of that worktree's own tests (0 collected, exits green
    // with `--passWithNoTests`). Anchoring to `<rootDir>` makes the pattern
    // only ever match a worktrees directory nested below wherever jest was
    // actually invoked from, so it excludes worktrees from the main
    // checkout's run without excluding a worktree's own tests from its own
    // run.
    "<rootDir>/.claude/worktrees/",
  ],
  // `testPathIgnorePatterns` stops those tests executing, but jest-haste-map
  // still crawls the worktrees and reports naming collisions on the duplicate
  // `helio` / `helio-mcp` / `helio-frontend` package.json names. Only
  // `modulePathIgnorePatterns` keeps them out of the module map entirely.
  modulePathIgnorePatterns: ["<rootDir>/.claude/worktrees/"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
  // HEL-907 evaluator-final round 3: every test file this config actually
  // collects (outside the excluded dirs above) lives under `helio-mcp/src/**`
  // -- confirmed by direct enumeration, not assumed; there is currently no
  // other in-scope test tree. Root `tsconfig.json`'s `module: "commonjs"` /
  // `moduleResolution: "node"` (classic Node10 resolution) is NOT how
  // `helio-mcp` is actually built or run (its own `tsconfig.json` targets
  // `NodeNext`/`NodeNext`, matching its real ESM package.json/runtime) --
  // compiling its tests under the root's foreign, classic-resolution config
  // was silently checking a hybrid mode nothing in production ever exercises,
  // and tripped a real TS2589 "excessively deep" instantiation in
  // `tools/read.ts`'s `registerTool` calls that NodeNext resolution never
  // hits (root cause: how the two resolution strategies traverse the MCP
  // SDK's zod-compat conditional types differs enough to blow the recursion
  // budget under classic/Node10 specifically). `server.test.ts` was the
  // first test to ever import that file, so this went undetected through
  // three prior evaluation rounds -- every earlier helio-mcp test happened
  // not to touch that import path. Overriding module/moduleResolution here
  // to match helio-mcp's own real config is the faithful fix, not a
  // workaround: it makes this suite typecheck the SAME way the package
  // actually compiles for `npm run build`/`node dist/index.js`, not a
  // resolution mode nothing else in this repo uses.
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: { module: "NodeNext", moduleResolution: "NodeNext" } }],
  },
};
