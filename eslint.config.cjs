const js = require("@eslint/js");
const tseslint = require("typescript-eslint");
const reactPlugin = require("eslint-plugin-react");
const reactHooks = require("eslint-plugin-react-hooks");
const globals = require("globals");

module.exports = [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "backend/target/**",
      "openspec/**",
      ".cursor/**",
      // Concertino delivery worktrees live INSIDE this repo, so root-level
      // `eslint .` walks into them and lints another run's in-progress code.
      // That made any commit in the main checkout fail whenever a live run
      // happened to have a lint error — a failure in files outside the
      // committer's own diff, which invites a `-n` bypass. Gitignored, but
      // ESLint's flat config does not consult .gitignore.
      ".claude/worktrees/**",
      // Same reasoning one directory over: `.concertino/**` holds a run's
      // EVIDENCE — probe scripts, derivation snippets, screenshots — not source.
      // CON-160 pushes agents to rescue those artifacts into the main checkout,
      // because anything left worktree-local is destroyed by `cleanup.sh
      // --phase4`. Doing the right thing there therefore dropped throwaway `.js`
      // probes into the lint path, and they blocked an unrelated commit in the
      // main checkout. Evidence is never shipped and must never gate a commit.
      // Widened from `.concertino/runs/**` to `.concertino/**`: evidence has
      // also landed at sibling paths like `.concertino/skeptic-f4/**`, outside
      // `runs/`, and hit the exact same failure mode. Nothing lintable is
      // tracked outside `.concertino/laws/**`/`.concertino/workflow-state.
      // template.md` (both markdown, untouched by ESLint's `files` globs), so
      // this is safe.
      ".concertino/**",
      // `jest --coverage` writes a generated istanbul HTML report into
      // `coverage/` (root suite) or `frontend/coverage/` (frontend suite). Its
      // `lcov-report/block-navigation.js` carries an eslint-disable directive
      // ESLint reports as unused, so `--max-warnings=0` failed lint and the
      // pre-commit hook on a file outside the committer's diff. Gitignored, but
      // ESLint's flat config does not consult .gitignore.
      "**/coverage/**",
      // HEL-1442: local jest cache (cacheDirectory), generated; gitignored but ESLint ignores .gitignore.
      "**/.jest-cache/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,cjs,mjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  // typescript-eslint's recommended set is an ARRAY of config entries (base,
  // eslint-recommended, recommended), not an object with `.rules`. Scope every
  // entry to TS so the rules never apply to .js/.cjs/.mjs files. Spreading
  // `configs.recommended.rules` (undefined) silently enabled nothing (HEL-1448).
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ["**/*.{ts,tsx}"] })),
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // Disable base rule in favour of the TypeScript-aware version, which
      // correctly handles interface/type-level parameter names.
      "no-unused-vars": "off",
    },
  },
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
      },
    },
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooks,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
    },
  },
  {
    // Jest mocks/setup legitimately use require(); production TS and Playwright
    // specs keep the rule.
    files: ["**/*.test.{ts,tsx}", "frontend/src/test/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];
