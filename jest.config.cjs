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
    // full checkout, so without this the root suite runs every in-flight
    // worktree's tests alongside the real ones — making results depend on which
    // deliveries happen to be running.
    "/.claude/worktrees/",
  ],
  // `testPathIgnorePatterns` stops those tests executing, but jest-haste-map
  // still crawls the worktrees and reports naming collisions on the duplicate
  // `helio` / `helio-mcp` / `helio-frontend` package.json names. Only
  // `modulePathIgnorePatterns` keeps them out of the module map entirely.
  modulePathIgnorePatterns: ["<rootDir>/.claude/worktrees/"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
};
