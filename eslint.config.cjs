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
      // Same reasoning one directory over: `.concertino/runs/**` holds a run's
      // EVIDENCE — probe scripts, derivation snippets, screenshots — not source.
      // CON-160 pushes agents to rescue those artifacts into the main checkout,
      // because anything left worktree-local is destroyed by `cleanup.sh
      // --phase4`. Doing the right thing there therefore dropped throwaway `.js`
      // probes into the lint path, and they blocked an unrelated commit in the
      // main checkout. Evidence is never shipped and must never gate a commit.
      ".concertino/runs/**",
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
      ...tseslint.configs.recommended.rules,
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
];
